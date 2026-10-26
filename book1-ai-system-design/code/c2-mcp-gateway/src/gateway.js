// gateway.js
//
// The gateway's decision pipeline. Agents never talk to MCP servers directly;
// every tool call comes through here and passes these checks in order:
//
//   1. kill switch      is this tool switched off right now?
//   2. allow-list       may this user's role use this tool at all?
//   3. rate limit       has this user made too many calls this minute?
//   4. registry check   is the upstream server and this tool's description
//                       exactly what was approved? (rug-pull detection)
//   5. forward          call the upstream server, passing the user's identity
//   6. redact           scrub emails and phone numbers from the result
//   7. audit            write one JSONL line, whatever the outcome
//
// Authentication happens before this file, in http.js, using auth.js.

import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RateLimiter } from './rate-limiter.js';
import { redactToolResult } from './redact.js';
import { AuditLog } from './audit.js';
import { checkUpstream } from './registry.js';

const configFile = (name) => new URL(`../config/${name}`, import.meta.url);
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export class Gateway {
  constructor({
    policy = readJson(configFile('policy.json')),
    registry = readJson(configFile('approved-servers.json')),
    killSwitchPath = configFile('killswitch.json'),
    auditLogPath = new URL('../logs/audit.jsonl', import.meta.url).pathname,
    now = () => Date.now(),
  } = {}) {
    this.policy = policy;
    this.registry = registry;
    this.killSwitchPath = killSwitchPath;
    this.audit = new AuditLog(auditLogPath);
    this.rateLimiter = new RateLimiter({ now });
    this.now = now;
    this.alreadyAlerted = new Set(); // so each rug pull is logged once, not on every call
  }

  // Read the kill switch file on EVERY call, so an operator can disable a
  // tool by editing one file, with no restart. If the file cannot be read,
  // fail closed: treat every tool as disabled rather than every tool as allowed.
  isKilled(toolName) {
    try {
      return readJson(this.killSwitchPath).disabledTools.includes(toolName);
    } catch {
      return true;
    }
  }

  roleAllows(role, toolName) {
    return this.policy.roles[role]?.tools.includes(toolName) ?? false;
  }

  // Which approved upstream server offers this tool? Routing comes from the
  // registry, not from whatever servers happen to claim, so an unapproved
  // server cannot "shadow" a tool name.
  routeFor(toolName) {
    return this.registry.servers.find((s) => toolName in s.tools);
  }

  // Open an MCP client connection to one upstream server, as this user.
  // The upstream (C1) trusts these headers only because it is reachable
  // solely from the gateway. It then applies its own territory filtering.
  async withUpstream(server, identity, work) {
    const client = new Client({ name: 'mcp-gateway', version: '1.0.0' });
    const headers = {
      'x-caller-user': identity.user,
      'x-caller-role': identity.role,
      'x-caller-territories': identity.territories.join(','),
    };
    await client.connect(new StreamableHTTPClientTransport(new URL(server.url), { requestInit: { headers } }));
    try {
      return await work(client);
    } finally {
      await client.close();
    }
  }

  // Ask the upstream for its tools and compare each against the registry.
  // Blocked tools are written to the audit log the first time we see them.
  async verifiedTools(server, client) {
    const { tools } = await client.listTools();
    const verdicts = checkUpstream(server, client.getServerVersion(), tools);
    for (const v of verdicts.filter((x) => x.status === 'blocked')) {
      const key = `${server.name}/${v.tool.name}/${v.reason}/${v.actual}`;
      if (this.alreadyAlerted.has(key)) continue;
      this.alreadyAlerted.add(key);
      this.audit.write({
        event: v.reason === 'tool_description_changed' ? 'rug_pull_detected' : 'tool_blocked',
        server: server.name, tool: v.tool.name, reason: v.reason, expected: v.expected, actual: v.actual,
      });
    }
    return verdicts;
  }

  // tools/list: show an agent only the tools it could actually call.
  async listTools(identity) {
    const visible = [];
    for (const server of this.registry.servers) {
      const verdicts = await this.withUpstream(server, identity, (c) => this.verifiedTools(server, c));
      for (const { tool, status } of verdicts) {
        if (status === 'approved' && this.roleAllows(identity.role, tool.name) && !this.isKilled(tool.name)) {
          visible.push(tool);
        }
      }
    }
    return visible;
  }

  // tools/call: the full pipeline described at the top of this file.
  async callTool(identity, toolName, args) {
    const started = this.now();
    const who = { user: identity.user, agent: identity.agent, tool: toolName, args };
    const deny = (reason, message) => {
      this.audit.record({ ...who, decision: 'deny', reason, latencyMs: this.now() - started });
      return { isError: true, content: [{ type: 'text', text: `Denied by gateway (${reason}): ${message}` }] };
    };

    if (this.isKilled(toolName)) return deny('kill_switch', `${toolName} is disabled by an operator.`);
    if (!this.roleAllows(identity.role, toolName)) {
      return deny('tool_not_allowed_for_role', `role ${identity.role} may not use ${toolName}.`);
    }
    const limit = this.policy.roles[identity.role].rateLimitPerMinute;
    if (!this.rateLimiter.tryAcquire(identity.user, limit)) {
      return deny('rate_limited', `more than ${limit} calls per minute.`);
    }
    const server = this.routeFor(toolName);
    if (!server) return deny('unknown_tool', `${toolName} is not in the approved-server registry.`);

    try {
      return await this.withUpstream(server, identity, async (client) => {
        const verdict = (await this.verifiedTools(server, client)).find((v) => v.tool.name === toolName);
        if (verdict?.status !== 'approved') {
          return deny(verdict?.reason ?? 'tool_missing_upstream', `${toolName} does not match what was approved.`);
        }
        const raw = await client.callTool({ name: toolName, arguments: args });
        const { result, redactions } = redactToolResult(raw);
        this.audit.record({ ...who, decision: 'allow', latencyMs: this.now() - started, redactions });
        return result;
      });
    } catch (err) {
      this.audit.record({ ...who, decision: 'error', reason: err.message, latencyMs: this.now() - started });
      return { isError: true, content: [{ type: 'text', text: 'Upstream server error.' }] };
    }
  }
}
