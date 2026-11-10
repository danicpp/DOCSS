# Ajaia Docs - lightweight collaborative document editor

A small full-stack app inspired by Google Docs: create and edit rich-text documents, import files,
and share documents between users. Built for the Ajaia AI-Native Full Stack Developer assignment.

**Live URL:** _<paste deployment URL>_

## Features
- Create, rename, edit, auto-save and reopen documents (refresh-safe, URL `#/doc/<id>`)
- Rich text: bold, italic, underline, Heading 1-3, bulleted and numbered lists
- File upload: **.txt, .md, .docx** (max 2 MB) -> becomes a new editable document
- Sharing: owner can grant another user **Can edit** or **Can view** access and revoke it
- "My documents" vs "Shared with me" lists, with owner and permission shown
- SQLite persistence, server-side HTML sanitization, input validation, error toasts
- Automated API tests (`npm test`)

## Test accounts (mocked auth)
Pick any user on the sign-in screen (no password; this is a deliberate scope cut, see ARCHITECTURE.md).

| Name  | Email             |
|-------|-------------------|
| Alice | alice@example.com |
| Bob   | bob@example.com   |
| Carol | carol@example.com |

**Suggested review flow:** sign in as Alice -> New document -> format text -> Share with bob@example.com
-> "Switch user" -> sign in as Bob -> open it under "Shared with me". Try "Can view" vs "Can edit".

## Run locally
Requires Node.js 18+ (20 recommended).

```bash
npm install
npm start          # http://localhost:3000
npm test           # runs API tests with an in-memory database
```

Environment variables: `PORT` (default 3000), `DB_PATH` (default `./data/app.db`).

## Deploy
A `Dockerfile` is included. On Render / Railway / Fly.io: create a web service from this repo
(Docker runtime), expose port 3000. SQLite lives in `/app/data`; attach a persistent disk there
if you need data to survive redeploys (free tiers without a disk reset data on redeploy, and the
seeded users are re-created automatically on start).

## Project layout
```
server/index.js      entry point
server/app.js        Express app: auth, documents, sharing, upload, error handling
server/db.js         SQLite schema + seeded users
server/importer.js   .txt/.md/.docx -> HTML
public/              static frontend (index.html, app.js, styles.css) - no build step
test/api.test.js     automated tests
```
