# Ajaia Docs — Lightweight Collaborative Document Editor

A small full-stack app inspired by Google Docs: create and edit rich-text documents, import files, export in multiple formats, search across documents, and share with other users.

**Live URL:** https://docss-production.up.railway.app
**GitHub:** https://github.com/danicpp/DOCSS

## Features
- **Document editing:** create, rename, edit, auto-save, reopen (URL-routed, refresh-safe)
- **Rich text:** bold, italic, underline, H1-H3, bulleted/numbered lists, link insert (Ctrl+K), undo/redo
- **File upload:** .txt, .md, .docx (max 2 MB) — button or drag-and-drop
- **Export:** download as .txt, .md, .html, or .docx
- **Full-text search:** FTS5-powered instant search with highlighted snippets
- **Sharing:** owner grants Can edit / Can view access; revoke; owned vs shared lists
- **Security:** helmet (CSP/HSTS), rate limiting, CSRF protection, HTML sanitization
- **Performance:** gzip compression, SQLite WAL mode, FTS5 indexing
- **Accessibility:** ARIA labels, keyboard shortcuts, toolbar active states, print stylesheet
- **Mobile:** responsive layout with sidebar toggle
- **17 automated API tests**

## Test accounts (mocked auth)
Pick any user on the sign-in screen (no password needed).

| Name  | Email             |
|-------|-------------------|
| Alice | alice@example.com |
| Bob   | bob@example.com   |
| Carol | carol@example.com |

**Review flow:** sign in as Alice → New document → format text → Share with bob@example.com → Switch user → sign in as Bob → open under "Shared with me". Try Can view vs Can edit.

## Run locally
Requires Node.js 18+ (20 recommended).

```bash
npm install
npm start          # http://localhost:3000
npm test           # 17 API tests with in-memory database
```

Environment variables: `PORT` (default 3000), `DB_PATH` (default `./data/app.db`).

## Deploy
A `Dockerfile` is included. On Railway / Render / Fly.io: create a web service from this repo (Docker runtime), expose port 3000. SQLite lives in `/app/data`; attach a persistent disk there if you need data to survive redeploys.

## Project layout
```
server/index.js      entry point + graceful shutdown
server/app.js        Express app: security, auth, documents, sharing, search, export
server/db.js         SQLite schema, FTS5 index, triggers, seeded users
server/importer.js   .txt/.md/.docx → HTML conversion
public/              static frontend (no build step)
test/api.test.js     17 automated API tests
Dockerfile           multi-stage build, non-root user, healthcheck
```
