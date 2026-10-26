#!/usr/bin/env node
// stdio.js
//
// Runs the MCP server over stdio: the client starts this file as a child
// process and they exchange JSON-RPC messages over stdin and stdout.
// This is how desktop assistants and IDEs usually run local MCP servers.
//
// Important: stdout carries the protocol, so all logging goes to stderr.

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildServer } from './server.js';
import { callerFromEnv } from './caller.js';

const caller = callerFromEnv();
const server = buildServer(caller);
await server.connect(new StdioServerTransport());

console.error(`[hcp360] stdio server ready for ${caller.userId} (${caller.territories.join(', ')})`);
