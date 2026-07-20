# MCP Server Configuration

OpenFox supports the [Model Context Protocol (MCP)](https://modelcontextprotocol.io/)
for extending its toolset with external servers. MCP servers are configured
in `~/.config/openfox/config.json` under the `mcpServers` key.

## Quick Start

Add a server entry to your config:

```json
{
  "mcpServers": {
    "my-server": {
      "transport": "stdio",
      "command": "uvx",
      "args": ["mcp-server-time"],
      "env": {"KEY": "value"},
      "disabledTools": []
    }
  }
}
```

On startup, OpenFox connects to each server, calls `tools/list`, and
registers all discovered tools with the prefix `{server_name}_{tool_name}`.
The tool count appears in startup logs:

```
[INFO] Connected to MCP server {"name":"my-server","toolCount":3}
[INFO] MCP tools registered {"count":3}
```

## Supported Transports

### stdio

Spawns a local process and communicates over stdin/stdout. Best for local
servers (Python scripts, npx packages, compiled binaries).

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `transport` | `"stdio"` | — | Transport type |
| `command` | string | — | Executable path |
| `args` | string[] | `[]` | Command arguments |
| `env` | object | `{}` | Extra environment variables |
| `disabledTools` | string[] | `[]` | Tools to exclude |
| `timeout` | number | — | Tool call timeout in seconds |

Example:

```json
{
  "my-py-server": {
    "transport": "stdio",
    "command": "/usr/local/bin/my-mcp-server.py",
    "env": {
      "FACTS_DB_PATH": "/data/knowledge.db"
    }
  }
}
```

### http

Connects to a remote MCP server via HTTP. Use for servers running on
different machines or in containers.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `transport` | `"http"` | — | Transport type |
| `url` | string | — | Server URL |
| `headers` | object | `{}` | HTTP headers |
| `disabledTools` | string[] | `[]` | Tools to exclude |
| `timeout` | number | — | Tool call timeout in seconds |

Example:

```json
{
  "remote-infra": {
    "transport": "http",
    "url": "https://mcp.internal.example.com/infra",
    "headers": {
      "Authorization": "Bearer token123"
    },
    "timeout": 30
  }
}
```

## Managing Servers at Runtime

OpenFox exposes the `mcp_config` tool for runtime management:

- `mcp_config action=list` — list all configured servers, their status,
  enabled/disabled tools
- `mcp_config action=add name=... command=...` — add a new server
- `mcp_config action=update name=... command=...` — modify an existing server
- `mcp_config action=remove name=...` — delete a server
- `mcp_config action=toggle-tool name=... toolName=... enabled=false` —
  disable a specific tool

Changes are persisted to `~/.config/openfox/config.json` automatically.

## How It Works

1. OpenFox reads `mcpServers` from config on startup
2. For each server, the `McpManager` creates a transport and connects
   via the MCP SDK `Client`
3. The client calls `tools/list` and caches the results
4. Each tool is wrapped with a `{server_name}_` prefix and registered
   alongside built-in tools
5. When an agent calls `{server_name}_{tool_name}`, OpenFox delegates
   to the MCP server via `tools/call`

### Caching

If a server fails to connect (e.g. the process is not installed yet),
OpenFox falls back to any previously cached tool definitions. This lets
you start the server later without restarting OpenFox.

### Timeouts

Set `timeout` (in seconds) per server. If a tool call takes longer,
it is interrupted and an error is returned to the agent.

## Example: Infrastructure Bridge

The repository includes a reference implementation at
[examples/infra-mcp-bridge.py](../examples/infra-mcp-bridge.py) —
a Python MCP server that provides read/write access to a SQLite
knowledge base and a markdown wiki.

```json
{
  "mcpServers": {
    "infra-bridge": {
      "transport": "stdio",
      "command": "/path/to/examples/infra-mcp-bridge.py",
      "env": {
        "FACTS_DB_PATH": "/data/knowledge.db",
        "WIKI_DIR_PATH": "/data/wiki"
      }
    }
  }
}
```

## Real-World: Hermes Agent Integration

The bridge is designed to connect OpenFox directly to an existing
[Hermes Agent](https://github.com/HermesAgent) knowledge base and
Obsidian vault — no migration, no duplication.

**Schema compatibility:** Hermes uses the same SQLite tables
(`facts`, `entities`, `fact_entities` with FTS5) with a few extra
columns. The bridge ignores unknown columns seamlessly.

**Bidirectional facts:** Point `FACTS_DB_PATH` to Hermes'
`memory_store.db`. Facts written by OpenFox via `infra_record_change`
are immediately visible to Hermes, and vice versa.

**Wiki as livrable:** Point `WIKI_DIR_PATH` to the Obsidian vault's wiki
directory. OpenFox reads freely and writes complete pages (with
timestamped backups). Since wiki writes are final deliverables, the
full-replacement semantics are intentional — not a merge concern.

```json
{
  "mcpServers": {
    "infra-bridge": {
      "transport": "stdio",
      "command": "/path/to/infra-mcp-bridge.py",
      "env": {
        "FACTS_DB_PATH": "/home/user/.hermes/memory_store.db",
        "WIKI_DIR_PATH": "/home/user/vault/wiki"
      }
    }
  }
}
```
```

## Troubleshooting

| Symptom | Likely Cause |
|---------|-------------|
| Server status is `error` | Command not found, or startup failed. Check logs. |
| Tools not appearing | Server may be using cached tools from a previous run. Use `mcp_config action=list` to check. |
| `outputSchema` parse error | Some servers include broken `$defs` references. OpenFox strips `outputSchema` automatically. |
| Tool call times out | Increase the `timeout` field for that server. |
