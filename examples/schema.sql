-- SQLite schema for the OpenFox MCP infrastructure bridge.
-- Create the database and tables, then enable FTS5 for full-text search.
--
-- Usage:
--   sqlite3 ~/.openfox/knowledge.db < examples/schema.sql

CREATE TABLE IF NOT EXISTS facts (
    fact_id    INTEGER PRIMARY KEY AUTOINCREMENT,
    content    TEXT NOT NULL UNIQUE,
    category   TEXT DEFAULT 'general',
    tags       TEXT DEFAULT '',
    trust_score REAL DEFAULT 0.5,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS entities (
    entity_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    entity_type TEXT DEFAULT 'unknown'
);

CREATE TABLE IF NOT EXISTS fact_entities (
    fact_id   INTEGER REFERENCES facts(fact_id),
    entity_id INTEGER REFERENCES entities(entity_id),
    PRIMARY KEY (fact_id, entity_id)
);

-- FTS5 virtual table for full-text search on facts
CREATE VIRTUAL TABLE IF NOT EXISTS facts_fts USING fts5(
    content,
    category,
    tags,
    content=facts,
    content_rowid=rowid
);

-- Triggers to keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS facts_ai AFTER INSERT ON facts BEGIN
    INSERT INTO facts_fts(rowid, content, category, tags)
    VALUES (new.rowid, new.content, new.category, new.tags);
END;

CREATE TRIGGER IF NOT EXISTS facts_ad AFTER DELETE ON facts BEGIN
    INSERT INTO facts_fts(facts_fts, rowid, content, category, tags)
    VALUES ('delete', old.rowid, old.content, old.category, old.tags);
END;

CREATE TRIGGER IF NOT EXISTS facts_au AFTER UPDATE ON facts BEGIN
    INSERT INTO facts_fts(facts_fts, rowid, content, category, tags)
    VALUES ('delete', old.rowid, old.content, old.category, old.tags);
    INSERT INTO facts_fts(rowid, content, category, tags)
    VALUES (new.rowid, new.content, new.category, new.tags);
END;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_facts_category ON facts(category);
CREATE INDEX IF NOT EXISTS idx_facts_trust_score ON facts(trust_score DESC);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
