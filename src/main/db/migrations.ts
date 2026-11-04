/**
 * Ordered schema migrations. Each entry runs once; the applied count lives in PRAGMA user_version.
 * Never edit a migration that has shipped — add a new one.
 */
export const migrations: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE books (
    id              TEXT PRIMARY KEY,
    title           TEXT NOT NULL,
    author          TEXT,
    format          TEXT NOT NULL CHECK (format IN ('pdf','epub','docx','txt','md')),
    source          TEXT NOT NULL DEFAULT 'local',
    source_id       TEXT,
    license         TEXT,
    file_path       TEXT NOT NULL,
    cover_path      TEXT,
    hash            TEXT NOT NULL UNIQUE,
    language        TEXT,
    added_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_opened_at  TEXT,
    progress_json   TEXT,
    progress        REAL NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread','reading','finished'))
  );
  CREATE INDEX books_added_at ON books(added_at);
  CREATE INDEX books_last_opened ON books(last_opened_at);

  CREATE TABLE annotations (
    id          TEXT PRIMARY KEY,
    book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    version_id  TEXT REFERENCES versions(id) ON DELETE CASCADE,
    type        TEXT NOT NULL CHECK (type IN ('highlight','note','bookmark')),
    anchor_json TEXT NOT NULL,
    text        TEXT,
    note        TEXT,
    color       TEXT,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX annotations_book ON annotations(book_id);

  CREATE TABLE versions (
    id          TEXT PRIMARY KEY,
    book_id     TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    kind        TEXT NOT NULL,
    title       TEXT NOT NULL,
    prompt      TEXT,
    model       TEXT,
    file_path   TEXT NOT NULL,
    created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX versions_book ON versions(book_id);

  CREATE TABLE collections (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE book_collections (
    book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    PRIMARY KEY (book_id, collection_id)
  );

  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE book_text USING fts5(
    book_id  UNINDEXED,
    chunk_id UNINDEXED,
    location UNINDEXED,
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  `,
  /* 2: import pipeline bookkeeping */ `
  ALTER TABLE books ADD COLUMN text_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (text_status IN ('pending','processing','done','needs_ocr','error'));
  ALTER TABLE books ADD COLUMN text_error TEXT;
  ALTER TABLE books ADD COLUMN page_count INTEGER;
  ALTER TABLE books ADD COLUMN word_count INTEGER;
  ALTER TABLE books ADD COLUMN description TEXT;
  ALTER TABLE books ADD COLUMN original_name TEXT;
  ALTER TABLE books ADD COLUMN size_bytes INTEGER;
  ALTER TABLE books ADD COLUMN meta_edited INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX book_collections_collection ON book_collections(collection_id);

  -- FTS5 tables can't be altered; book_text was always empty before this migration.
  DROP TABLE book_text;
  CREATE VIRTUAL TABLE book_text USING fts5(
    book_id  UNINDEXED,
    chunk_id UNINDEXED,
    chapter  UNINDEXED,
    location UNINDEXED,
    content,
    tokenize = 'unicode61 remove_diacritics 2'
  );
  `
]
