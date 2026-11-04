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
  `,
  /* 3: per-book reader preferences (theme, font size, zoom...) */ `
  ALTER TABLE books ADD COLUMN reader_prefs TEXT;
  `,
  /* 4: annotations — jump location, chapter, ordering; per-book notebook */ `
  ALTER TABLE annotations ADD COLUMN location TEXT NOT NULL DEFAULT '';
  ALTER TABLE annotations ADD COLUMN chapter TEXT;
  ALTER TABLE annotations ADD COLUMN sort_key REAL NOT NULL DEFAULT 0;
  CREATE INDEX annotations_book_sort ON annotations(book_id, sort_key);

  CREATE TABLE notebooks (
    book_id    TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
    content    TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  `,
  /* 5: catalog (Discover) HTTP cache; lookup of downloaded books by catalog id */ `
  CREATE TABLE http_cache (
    url        TEXT PRIMARY KEY,
    body       TEXT NOT NULL,
    fetched_at INTEGER NOT NULL
  );
  CREATE INDEX books_source ON books(source, source_id);
  `,
  /* 6: AI Studio jobs (resumable, part by part) and version bookkeeping */ `
  CREATE TABLE ai_jobs (
    id            TEXT PRIMARY KEY,
    book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    action        TEXT NOT NULL,
    title         TEXT NOT NULL,
    options_json  TEXT NOT NULL,
    status        TEXT NOT NULL,
    model         TEXT NOT NULL,
    error         TEXT,
    version_id    TEXT,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX ai_jobs_book ON ai_jobs(book_id);

  CREATE TABLE ai_job_parts (
    job_id        TEXT NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
    idx           INTEGER NOT NULL,
    title         TEXT NOT NULL,
    source        TEXT NOT NULL,
    output        TEXT,
    status        TEXT NOT NULL DEFAULT 'pending',
    input_tokens  INTEGER,
    output_tokens INTEGER,
    PRIMARY KEY (job_id, idx)
  );

  ALTER TABLE versions ADD COLUMN input_tokens INTEGER;
  ALTER TABLE versions ADD COLUMN output_tokens INTEGER;
  CREATE INDEX annotations_version ON annotations(version_id);
  `,
  /* 7: chat with a book */ `
  CREATE TABLE chat_messages (
    id                TEXT PRIMARY KEY,
    book_id           TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
    role              TEXT NOT NULL CHECK (role IN ('user','assistant')),
    content           TEXT NOT NULL,
    citations_json    TEXT,
    -- user: {question, chunkIds} to rebuild the exact request; assistant: raw API content blocks
    api_json          TEXT NOT NULL,
    -- book text + mode the turn was sent with; turns with another key are not replayed
    context_key       TEXT NOT NULL,
    fresh_context     INTEGER NOT NULL DEFAULT 0,
    input_tokens      INTEGER,
    cache_read_tokens INTEGER,
    output_tokens     INTEGER,
    created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX chat_messages_book ON chat_messages(book_id, created_at);
  `
]
