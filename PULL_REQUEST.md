### Summary

This PR adds a reference MCP infrastructure bridge for OpenFox,
enabling agents to query and persist infrastructure knowledge using
a SQLite fact store with FTS5 full-text search and a Markdown wiki.

**Dual-mode design:**

The bridge works **standalone** from scratch — point it to an empty
SQLite file and an empty wiki directory, and it initializes the schema
automatically. Ideal for new setups.

But its real purpose is to plug OpenFox into an **existing knowledge
base** — specifically [Hermes Agent](https://github.com/HermesAgent)'s
`memory_store.db` and Obsidian vault. Schema compatibility was verified
against a production Hermes instance containing **894 facts** across
**585 entities** (categories: project, general, tool, user_pref, system)
and a **wiki of 100+ markdown pages** (index, articles, concepts,
conventions, templates). Facts written by OpenFox via
`infra_record_change` are immediately visible to Hermes, and vice versa.

**Key changes:**

- `examples/infra-mcp-bridge.py` — MCP server with 6 tools
  (`infra_search`, `infra_get_server`, `infra_list_servers`,
  `infra_list_facts`, `infra_read_wiki`, `infra_record_change`)
- `examples/schema.sql` — SQLite schema with FTS5 and sync triggers
- `docs/mcp-server-config.md` — Updated with Hermes integration example,
  troubleshooting guide, stdio and HTTP transport reference
- `examples/requirements.txt` — Dependency declaration
- `examples/skills/` — Three operation workflow skills (infra-ssh,
  infra-deployment, infra-writeback)
- `.gitignore` — Prevents `__pycache__` / `.pyc` tracking

**Bidirectional facts:** Same SQLite database, same wiki directory.
No migration, no duplication.

### AI-Enhanced Development

Tell what models helped shape this PR:

- **AI Models:** DeepSeek V4 Flash

### Cache Impact

Does this PR affect anything cached — system prompts, tool definitions,
skills, or other context?

- **No**
