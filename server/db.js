const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SEED_USERS = [
  { email: 'alice@example.com', name: 'Alice Owner' },
  { email: 'bob@example.com', name: 'Bob Reviewer' },
  { email: 'carol@example.com', name: 'Carol Guest' },
];

function openDb(file = ':memory:') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY,
      owner_id INTEGER NOT NULL REFERENCES users(id),
      title TEXT NOT NULL DEFAULT 'Untitled document',
      content TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS shares (
      document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('viewer','editor')),
      PRIMARY KEY (document_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_docs_owner ON documents(owner_id);
    CREATE INDEX IF NOT EXISTS idx_shares_user ON shares(user_id);

    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      title, content, content=documents, content_rowid=id,
      tokenize='porter unicode61'
    );

    CREATE TRIGGER IF NOT EXISTS fts_insert AFTER INSERT ON documents BEGIN
      INSERT INTO documents_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS fts_update AFTER UPDATE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
      INSERT INTO documents_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;
    CREATE TRIGGER IF NOT EXISTS fts_delete AFTER DELETE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, title, content) VALUES ('delete', old.id, old.title, old.content);
    END;
  `);

  // Rebuild FTS index from existing rows on startup
  const ftsCount = db.prepare('SELECT COUNT(*) AS n FROM documents_fts').get().n;
  const docCount = db.prepare('SELECT COUNT(*) AS n FROM documents').get().n;
  if (ftsCount === 0 && docCount > 0) {
    db.exec("INSERT INTO documents_fts(documents_fts) VALUES ('rebuild')");
  }

  const insert = db.prepare('INSERT OR IGNORE INTO users (email, name) VALUES (?, ?)');
  for (const u of SEED_USERS) insert.run(u.email, u.name);
  return db;
}

module.exports = { openDb, SEED_USERS };
