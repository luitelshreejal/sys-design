#!/usr/bin/env python3
"""Copy code listings verbatim from the example files into each WALKTHROUGH.md.

Why this exists
    Appendix D promises that every listing is copied verbatim from the code.
    Copying by hand drifts. This script does the copying, and the --check mode
    fails if a walkthrough is out of date, a listing is 60 lines or longer, or
    a walkthrough or README contains an em-dash or en-dash.

How a walkthrough marks a listing
    <!-- listing: 04_policies_and_agent_views.sql | from: CREATE ROW ACCESS POLICY | to: COMMENT = 'Rows visible -->
    ```sql
    (this block is replaced by the script)
    ```
    <!-- /listing -->

    "from" and "to" are plain text that must appear in the source file. The
    listing runs from the first line containing "from" to the first line after
    it containing "to", both included. "lines: 10-40" is also accepted.

Usage (standard library only, Python 3.9+):
    /usr/bin/python3 tools/build_walkthroughs.py           # rewrite listings
    /usr/bin/python3 tools/build_walkthroughs.py --check   # verify only
"""

import pathlib
import re
import sys

CODE_ROOT = pathlib.Path(__file__).resolve().parent.parent
MAX_LISTING_LINES = 59  # "each under 60 lines"
LANG_BY_SUFFIX = {
    ".sql": "sql", ".py": "python", ".tf": "hcl", ".tfvars": "hcl",
    ".yaml": "yaml", ".yml": "yaml", ".json": "json", ".sh": "bash",
    ".csv": "text", ".hcl": "hcl", ".txt": "text", ".tfbackend": "hcl",
}
MARKER = re.compile(
    r"<!-- listing: (?P<spec>.+?) -->\n(?P<body>.*?)<!-- /listing -->",
    re.DOTALL,
)
DASHES = ("—", "–")  # em-dash, en-dash


class ListingError(Exception):
    pass


def extract(source_lines, spec, source_name):
    """Return the lines selected by a marker spec such as 'from: X | to: Y'."""
    parts = {}
    for piece in spec.split("|")[1:]:
        key, _, value = piece.partition(":")
        parts[key.strip()] = value.strip()
    if "lines" in parts:
        start_s, _, end_s = parts["lines"].partition("-")
        start, end = int(start_s), int(end_s)
        return source_lines[start - 1:end]
    if "from" not in parts or "to" not in parts:
        return source_lines  # whole file
    start = next((i for i, line in enumerate(source_lines) if parts["from"] in line), None)
    if start is None:
        raise ListingError("%s: text not found: %r" % (source_name, parts["from"]))
    end = next((i for i in range(start, len(source_lines)) if parts["to"] in source_lines[i]), None)
    if end is None:
        raise ListingError("%s: end text not found after start: %r" % (source_name, parts["to"]))
    return source_lines[start:end + 1]


def render(walkthrough_path):
    text = walkthrough_path.read_text(encoding="utf-8")
    example_dir = walkthrough_path.parent
    problems = []

    def replace(match):
        spec = match.group("spec")
        rel = spec.split("|")[0].strip()
        source = example_dir / rel
        if not source.exists():
            problems.append("%s: missing source file %s" % (walkthrough_path.name, rel))
            return match.group(0)
        lines = source.read_text(encoding="utf-8").splitlines()
        try:
            chosen = extract(lines, spec, rel)
        except ListingError as exc:
            problems.append("%s: %s" % (walkthrough_path.parent.name, exc))
            return match.group(0)
        if len(chosen) > MAX_LISTING_LINES:
            problems.append("%s: listing from %s has %d lines (limit %d)"
                            % (walkthrough_path.parent.name, rel, len(chosen), MAX_LISTING_LINES))
        lang = LANG_BY_SUFFIX.get(source.suffix, "text")
        body = "```%s\n%s\n```\n" % (lang, "\n".join(chosen))
        return "<!-- listing: %s -->\n%s<!-- /listing -->" % (spec, body)

    new_text = MARKER.sub(replace, text)
    return text, new_text, problems


def dash_problems(path):
    found = []
    for number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if any(d in line for d in DASHES):
            found.append("%s:%d contains an em-dash or en-dash" % (path.relative_to(CODE_ROOT), number))
    return found


def main(argv):
    check_only = "--check" in argv
    problems = []
    walkthroughs = sorted(CODE_ROOT.glob("d*/WALKTHROUGH.md"))
    for path in walkthroughs:
        old, new, found = render(path)
        problems.extend(found)
        if old != new:
            if check_only:
                problems.append("%s is out of date; run tools/build_walkthroughs.py" % path.relative_to(CODE_ROOT))
            else:
                path.write_text(new, encoding="utf-8")
                print("updated", path.relative_to(CODE_ROOT))
    for path in walkthroughs + [CODE_ROOT / "README.md"]:
        if path.exists():
            problems.extend(dash_problems(path))
    for problem in problems:
        print("PROBLEM:", problem)
    print("%d walkthrough(s) checked, %d problem(s)" % (len(walkthroughs), len(problems)))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
