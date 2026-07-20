---
name: infra-writeback
description: Write-back convention — after modifying infrastructure, persist changes to the fact store and wiki via infra_record_change
metadata:
  version: 1.0.0
  openfox:
    displayName: Write-Back Convention
---

# Write-Back Convention

After any infrastructure modification (deploy, config change, service
creation, DNS update, etc.), you MUST persist the change by calling
the `infra_record_change` MCP tool.

## Required Pattern

```python
# 1. Before modifying, read current state
current = infra_get_server(name="server-name")

# 2. Read the wiki page if you need to update it
wiki_content = infra_read_wiki(page="server-name")

# 3. Modify infrastructure (SSH, Docker, systemd, etc.)

# 4. Call infra_record_change to persist
infra_record_change(
    entity="server-name",
    summary="Deployed v2.1.0 to production (port change 8080 → 9090)",
    facts=[
        {"content": "server-name running app@v2.1.0 on port 9090",
         "category": "server", "tags": "deployed,v2.1.0"}
    ],
    wiki_content=reconstructed_wiki_page
)
```

## Important Notes

- `wiki_content` **replaces the entire page** — it is not append-only.
  To add a section without losing content:
  1. Read the current page with `infra_read_wiki()`
  2. Reconstruct the full page with your additions
  3. Pass the complete content to `wiki_content`

- A timestamped backup is automatically created before every wiki overwrite.
  Backups go to `_backups/` inside the wiki directory.

- If the exact fact content already exists, it is updated in place (dedup
  via SQL UNIQUE constraint on the `content` column).

## When to Write Back

| Action | Write back? | Example summary |
|--------|-------------|-----------------|
| Deploy new version | ✅ Always | "Deployed v2.1.0 to production" |
| Change config | ✅ Always | "Updated nginx rate limit to 100 req/s" |
| Create service | ✅ Always | "Created systemd unit for metrics collector" |
| Add DNS record | ✅ Always | "Added A record for monitoring.example.com" |
| Read-only check | ❌ Never | Use `infra_get_server` / `infra_read_wiki` instead |
| Temp debug | ❌ Skip | Only persist permanent changes |
