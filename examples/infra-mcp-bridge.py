#!/usr/bin/env python3
"""
MCP Server Bridge — SQLite Knowledge Base + Markdown Wiki → OpenFox

Provides read/write MCP tools for OpenFox to query and persist data to:
  - A SQLite database with facts, entities, and fact_entities tables (FTS5)
  - A directory of markdown `.md` files (e.g. an Obsidian vault wiki)

Usage:
  chmod +x infra-mcp-bridge.py

  # Configure in OpenFox config.json (~/.config/openfox/config.json):
  # {
  #   "mcpServers": {
  #     "my-infra": {
  #       "transport": "stdio",
  #       "command": "/path/to/infra-mcp-bridge.py"
  #     }
  #   }
  # }

Environment variables:
  FACTS_DB_PATH   — Path to SQLite database (default: ~/.openfox/knowledge.db)
  WIKI_DIR_PATH   — Path to wiki directory     (default: ~/wiki)
"""
import os
import re
import sqlite3
import json
import shutil
import sys
import textwrap
from datetime import datetime
from pathlib import Path
from typing import Any

from mcp.server import FastMCP

# ── Configuration ──────────────────────────────────────────────────────────
FACTS_DB_PATH = os.environ.get(
    "FACTS_DB_PATH",
    os.path.expanduser("~/.openfox/knowledge.db"),
)
WIKI_DIR_PATH = os.environ.get(
    "WIKI_DIR_PATH",
    os.path.expanduser("~/wiki"),
)

# ── App instance ───────────────────────────────────────────────────────────
app = FastMCP(
    "infra-bridge",
    instructions=textwrap.dedent("""\
        Infrastructure knowledge bridge for OpenFox.
        Query facts, entities, and markdown wiki pages.
        Use infra_record_change() to persist changes back
        to the fact store and wiki after modifying infrastructure.

        Expected SQLite schema:
          facts (fact_id PK, content UNIQUE, category, tags, trust_score, created_at, updated_at)
          entities (entity_id PK, name, entity_type)
          fact_entities (fact_id FK, entity_id FK)  — junction table

        To create this schema:
          sqlite3 ~/.openfox/knowledge.db < examples/schema.sql
    """),
)

# ── DB helpers ─────────────────────────────────────────────────────────────

def get_db():
    """Get a read-only connection to the fact store."""
    if not os.path.exists(FACTS_DB_PATH):
        raise FileNotFoundError(
            f"Fact database not found at {FACTS_DB_PATH}. "
            f"Create it with:\n  sqlite3 {FACTS_DB_PATH} < examples/schema.sql"
        )
    conn = sqlite3.connect(f"file:{FACTS_DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn

def get_db_rw():
    """Get a read-write connection to the fact store (for writes)."""
    conn = sqlite3.connect(FACTS_DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=3000")
    return conn

def ensure_entity(db, name: str) -> int:
    """Find or create an entity, return its entity_id."""
    row = db.execute(
        "SELECT entity_id FROM entities WHERE name = ?", (name,)
    ).fetchone()
    if row:
        return row["entity_id"]
    cursor = db.execute(
        "INSERT INTO entities (name, entity_type) VALUES (?, 'unknown')",
        (name,)
    )
    return cursor.lastrowid

def upsert_fact(db, content: str, category: str = "general",
                tags: str = "", entity: str = None) -> dict:
    """Insert or update a fact. Returns {'action': ..., 'fact_id': int}."""
    existing = db.execute(
        "SELECT fact_id, content FROM facts WHERE content = ?", (content,)
    ).fetchone()

    if existing:
        db.execute(
            "UPDATE facts SET category = ?, tags = ?, updated_at = CURRENT_TIMESTAMP WHERE fact_id = ?",
            (category, tags, existing["fact_id"]),
        )
        fact_id = existing["fact_id"]
        action = "updated"
    else:
        cursor = db.execute(
            "INSERT INTO facts (content, category, tags) VALUES (?, ?, ?)",
            (content, category, tags),
        )
        fact_id = cursor.lastrowid
        action = "inserted"

    if entity:
        eid = ensure_entity(db, entity)
        db.execute(
            "INSERT OR IGNORE INTO fact_entities (fact_id, entity_id) VALUES (?, ?)",
            (fact_id, eid),
        )

    return {"action": action, "fact_id": fact_id}


def format_fact(row) -> str:
    """Format a fact row as a readable string."""
    r = dict(row)
    return (
        f"[#{r.get('fact_id', '?')}] "
        f"({r.get('category', 'general')}, trust={r.get('trust_score', 0.5)}) "
        f"{r.get('content', '')}"
    )


def safe_fts_query(raw: str) -> str:
    """Wrap bare words with special FTS characters in double quotes."""
    tokens = re.findall(r'"[^"]*"|\S+', raw)
    safe = []
    for t in tokens:
        if t.startswith('"') and t.endswith('"'):
            safe.append(t)
        elif any(c in t for c in '-/:@.#$%^&*+='):
            safe.append(f'"{t}"')
        else:
            safe.append(t)
    return " ".join(safe)


# ── Read Tools ─────────────────────────────────────────────────────────────

@app.tool(
    description=(
        "Full-text search across all infrastructure facts. "
        "Supports boolean queries (AND default, OR, NOT, quoted phrases). "
        "Returns matching facts with category, trust score, and tags."
    )
)
def infra_search(query: str, limit: int = 10) -> str:
    """
    Search infrastructure facts using FTS5 full-text search.

    Args:
        query: Search terms. AND is default. Use OR for any-match,
               quoted "exact phrase", NOT to exclude, prefix* for wildcard.
        limit: Maximum results (default 10, max 50).
    """
    limit = min(limit, 50)
    try:
        db = get_db()
        safe_q = safe_fts_query(query)
        try:
            cursor = db.execute(
                """SELECT f.fact_id, f.content, f.category, f.tags, f.trust_score
                   FROM facts f
                   JOIN facts_fts fts ON f.rowid = fts.rowid
                   WHERE facts_fts MATCH ?
                   ORDER BY rank
                   LIMIT ?""",
                (safe_q, limit),
            )
            rows = cursor.fetchall()
        except sqlite3.OperationalError:
            rows = []

        if not rows:
            terms = query.replace('"', '').split()
            like_clauses = " OR ".join(
                ["(content LIKE ? OR tags LIKE ?)" for _ in terms]
            )
            params = []
            for t in terms:
                params.extend([f"%{t}%", f"%{t}%"])
            cursor = db.execute(
                f"""SELECT fact_id, content, category, tags, trust_score
                   FROM facts
                   WHERE {like_clauses}
                   ORDER BY trust_score DESC
                   LIMIT ?""",
                params + [limit],
            )
            rows = cursor.fetchall()
            if not rows:
                return f"No results for '{query}'."
            results = [format_fact(r) for r in rows]
            return (
                f"LIKE search ({len(results)} results):\n"
                + "\n---\n".join(results)
            )

        results = [format_fact(r) for r in rows]
        return (
            f"FTS search ({len(results)} results):\n"
            + "\n---\n".join(results)
        )
    except Exception as e:
        return f"Search error: {e}"
    finally:
        db.close()


@app.tool(
    description=(
        "Get all facts about a specific server or named entity "
        "(e.g. 'production-server', 'db-primary'). "
        "First tries exact entity match by name, then falls back "
        "to a broader text search across all fact content/tags."
    )
)
def infra_get_server(name: str) -> str:
    """
    Look up all facts linked to a named entity (server, service, etc.).

    Args:
        name: Entity name (case-insensitive, partial match).
    """
    try:
        db = get_db()
        entities = db.execute(
            "SELECT entity_id, name, entity_type FROM entities WHERE name LIKE ?",
            (f"%{name}%",),
        ).fetchall()

        if not entities:
            facts = db.execute(
                """SELECT fact_id, content, category, tags, trust_score
                   FROM facts
                   WHERE content LIKE ? OR tags LIKE ?
                   ORDER BY trust_score DESC
                   LIMIT 15""",
                (f"%{name}%", f"%{name}%"),
            ).fetchall()
            if facts:
                results = [format_fact(r) for r in facts]
                return (
                    f"Facts containing '{name}' ({len(results)}):\n"
                    + "\n---\n".join(results)
                )
            return f"No results for '{name}'."

        parts = []
        for ent in entities:
            parts.append(f"\n=== {ent['name']} ({ent['entity_type']}) ===")
            facts = db.execute(
                """SELECT f.fact_id, f.content, f.category, f.tags, f.trust_score
                   FROM facts f
                   JOIN fact_entities fe ON f.fact_id = fe.fact_id
                   WHERE fe.entity_id = ?
                   ORDER BY f.trust_score DESC, f.updated_at DESC""",
                (ent["entity_id"],),
            ).fetchall()
            if facts:
                for r in facts:
                    parts.append(f"  [{r['category']}] {r['content']}")
            else:
                parts.append("  (no linked facts)")

        return "\n".join(parts)
    except Exception as e:
        return f"Entity lookup error: {e}"
    finally:
        db.close()


@app.tool(
    description=(
        "List known infrastructure servers and entities. "
        "Shows entities with fact counts, grouped by type."
    )
)
def infra_list_servers() -> str:
    """
    List infrastructure entities from the fact store.
    Groups by entity_type and shows fact counts.
    """
    try:
        db = get_db()
        entities = db.execute(
            """SELECT e.entity_id, e.name, e.entity_type,
                      COUNT(fe.fact_id) as fact_count
               FROM entities e
               JOIN fact_entities fe ON e.entity_id = fe.entity_id
               GROUP BY e.entity_id
               ORDER BY e.entity_type, e.name
               LIMIT 100"""
        ).fetchall()

        if not entities:
            return "No infrastructure entities found."

        by_type: dict[str, list[dict[str, Any]]] = {}
        for e in entities:
            t = e["entity_type"] or "unknown"
            by_type.setdefault(t, []).append(e)

        lines = [f"Infrastructure entities ({len(entities)} found):\n"]
        for etype, items in sorted(by_type.items()):
            label = etype.capitalize() if etype != "unknown" else "Other"
            lines.append(f"  [{label}]")
            for e in items:
                lines.append(f"    {e['name']} — {e['fact_count']} facts")

        return "\n".join(lines)
    except Exception as e:
        return f"Entity list error: {e}"
    finally:
        db.close()


@app.tool(
    description=(
        "List facts filtered by category. "
        "Categories: general, infra, server, tool, project, user_pref. "
        "Use without category to see available categories with counts."
    )
)
def infra_list_facts(category: str = None, limit: int = 20) -> str:
    """
    List facts, optionally filtered by category.

    Args:
        category: Filter by category. Omit to show all categories with counts.
        limit: Max facts to return (default 20, max 100).
    """
    limit = min(limit, 100)
    try:
        db = get_db()
        if category:
            cursor = db.execute(
                """SELECT fact_id, content, category, tags, trust_score
                   FROM facts
                   WHERE category = ?
                   ORDER BY trust_score DESC, updated_at DESC
                   LIMIT ?""",
                (category, limit),
            )
            rows = cursor.fetchall()
            if not rows:
                return f"No facts in category '{category}'."
            results = [format_fact(r) for r in rows]
            return (
                f"Facts [{category}] ({len(results)}):\n"
                + "\n---\n".join(results)
            )
        else:
            cursor = db.execute(
                "SELECT category, COUNT(*) as cnt FROM facts GROUP BY category ORDER BY cnt DESC"
            )
            counts = [f"  {r['category']}: {r['cnt']}" for r in cursor.fetchall()]
            return "Available categories:\n" + "\n".join(counts)
    except Exception as e:
        return f"Fact list error: {e}"
    finally:
        db.close()


@app.tool(
    description=(
        "Read a page from the markdown wiki. "
        "Pages are .md files stored in the wiki directory. "
        "Common page names: index, architecture, deployment."
    )
)
def infra_read_wiki(page: str = "index") -> str:
    """
    Read a page from the markdown wiki.

    Args:
        page: Page name (without .md extension).
    """
    page = page.lstrip("/")
    if not page.endswith(".md"):
        page += ".md"

    wiki_dir = Path(WIKI_DIR_PATH)
    full_path = wiki_dir / page

    if full_path.exists() and full_path.is_file():
        content = full_path.read_text(encoding="utf-8", errors="replace")
        if len(content) > 8000:
            content = content[:8000] + f"\n\n[... truncated, file: {full_path}]"
        return content

    # Try normalized name (lowercase, hyphens) to match infra_record_change
    normalized = page.lower().replace(" ", "-").replace("_", "-")
    if normalized != page:
        full_path = wiki_dir / normalized
        if full_path.exists() and full_path.is_file():
            content = full_path.read_text(encoding="utf-8", errors="replace")
            if len(content) > 8000:
                content = content[:8000] + f"\n\n[... truncated, file: {full_path}]"
            return content

    # List available pages
    available = []
    if wiki_dir.exists():
        for f in sorted(wiki_dir.rglob("*.md")):
            rel = f.relative_to(wiki_dir)
            available.append(f"  {rel.with_suffix('')}")

    msg = f"Page '{page}' not found."
    if available:
        msg += f"\nAvailable pages in {wiki_dir}:\n" + "\n".join(available[:30])
    else:
        msg += f"\nWiki directory '{wiki_dir}' is empty or does not exist."
    return msg


# ── Write Tools ────────────────────────────────────────────────────────────

@app.tool(
    description=(
        "Record infrastructure changes: add facts to the knowledge base "
        "and update the markdown wiki. Handles dedup, entity linking, "
        "and wiki page creation/update in one call."
    )
)
def infra_record_change(
    entity: str,
    summary: str,
    facts: list = None,
    wiki_content: str = None,
    tags: str = "",
) -> str:
    """
    Persist infrastructure changes to both the fact store and markdown wiki.

    Call this AFTER modifying infrastructure (deploying a service, changing
    a config, creating a unit). Do NOT call it just for reading state.

    Args:
        entity: Entity name (e.g. 'production-server', 'db-primary').
                Will be linked to all facts.
        summary: One-line human-readable summary of what changed.
                 Saved as a fact automatically.
        facts: Optional list of additional facts. Each entry is either:
               - A dict: {"content": "...", "category": "server|general|tool|project",
                          "tags": "optional,tags"}
               - A plain string (category defaults to "general").
               Invalid types are skipped with a warning.
        wiki_content: Optional full markdown content for the wiki page.
                      **IMPORTANT: this REPLACES the entire page content.**
                      To add a section without losing existing content:
                      1. Read the current page with infra_read_wiki()
                      2. Reconstruct the full page with your additions
                      3. Pass the complete content here
                      If omitted, only facts are updated — no wiki change.
        tags: Optional comma-separated tags applied to the summary fact.
    """
    results = []
    try:
        db = get_db_rw()
        facts_list = list(facts or [])

        r = upsert_fact(db, summary, category="server",
                        tags=tags, entity=entity)
        results.append(
            f"  {r['action']} fact #{r['fact_id']}: {summary[:80]}"
        )

        for i, f in enumerate(facts_list):
            if isinstance(f, str):
                content = f
                cat = "general"
                f_tags = ""
            elif isinstance(f, dict):
                content = str(f.get("content", ""))
                cat = str(f.get("category", "general"))
                f_tags = str(f.get("tags", ""))
            else:
                results.append(f"  skipped fact #{i+1}: expected string or dict, got {type(f).__name__}")
                continue
            if not content:
                continue
            r = upsert_fact(db, content, category=cat, tags=f_tags, entity=entity)
            results.append(
                f"  {r['action']} fact #{r['fact_id']}: {content[:80]}"
            )

        db.commit()

        wiki_path = None
        if wiki_content:
            page_name = entity.lower().replace(" ", "-").replace("_", "-")
            wiki_dir = Path(WIKI_DIR_PATH)
            wiki_dir.mkdir(parents=True, exist_ok=True)
            wiki_path = wiki_dir / f"{page_name}.md"

            if wiki_path.exists():
                backup_dir = wiki_dir / "_backups"
                backup_dir.mkdir(exist_ok=True)
                backup_name = f"{page_name}-{datetime.now().strftime('%Y%m%d-%H%M%S')}.md"
                shutil.copy2(str(wiki_path), str(backup_dir / backup_name))
                results.append(f"  backup created: _backups/{backup_name}")

            wiki_path.write_text(wiki_content, encoding="utf-8")
            results.append(f"  wiki updated: {page_name}.md")

        report = [f"Change recorded: {summary}"]
        report.append(f"\n  Entity: {entity}")
        report.append(f"  Facts:  {len(facts_list) + 1}")
        if wiki_path:
            report.append(f"  Wiki:   {wiki_path}")
        report.append("\nDetails:")
        report.append("\n".join(results))

        return "\n".join(report)

    except sqlite3.IntegrityError as e:
        return f"DB constraint error: {e}"
    except Exception as e:
        return f"Write-back error: {e}"
    finally:
        try:
            db.close()
        except Exception:
            pass


# ── Main ───────────────────────────────────────────────────────────────────

def check_schema():
    """Verify that the required tables exist. Print a warning if not."""
    if not os.path.exists(FACTS_DB_PATH):
        print(
            f"Warning: fact database not found at {FACTS_DB_PATH}",
            file=sys.stderr,
        )
        print(
            "Create the schema with:\n"
            f"  sqlite3 {FACTS_DB_PATH} < examples/schema.sql",
            file=sys.stderr,
        )
        return

    try:
        db = get_db()
        tables = db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        table_names = {r["name"] for r in tables}
        required = {"facts", "entities", "fact_entities"}
        missing = required - table_names
        if missing:
            print(
                f"Warning: missing tables: {', '.join(missing)}",
                file=sys.stderr,
            )
        db.close()
    except Exception:
        pass


def main():
    """Start the MCP server on stdio."""
    check_schema()
    app.run(transport="stdio")


if __name__ == "__main__":
    main()
