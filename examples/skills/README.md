# Skills Examples

This directory contains example [OpenFox skills](https://github.com/co-l/openfox)
that demonstrate how to combine MCP tools with skill instructions for
operations workflows.

## Structure

Each skill is a directory containing a `SKILL.md` file with YAML frontmatter:

```
skills/
├── infra-ssh/
│   └── SKILL.md         # SSH access conventions
├── infra-deployment/
│   └── SKILL.md         # Deployment methods and patterns
└── infra-writeback/
    └── SKILL.md         # Write-back convention (MCP + infra_record_change)
```

## Usage

Copy a skill to your config skills directory:

```bash
cp -r examples/skills/infra-ssh ~/.config/openfox/skills/
```

Or load it at runtime via the `load_skill` tool.

## How Skills Combine with MCP Tools

Skills provide **static instructions** (conventions, procedures, rules).
MCP tools provide **dynamic data** (queries, writes, lookups).

Workflow:

1. A skill tells OpenFox *how* to access a server (user, key, alias)
2. An MCP tool tells OpenFox the server's *current state* (IP, config, facts)
3. OpenFox modifies the infrastructure
4. The write-back skill tells OpenFox to call `infra_record_change()`
   to persist the change back to the knowledge base

This turns OpenFox from a stateless agent into one that maintains
its own operational knowledge base.
