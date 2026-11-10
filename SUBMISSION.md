# Submission contents

| Item | Location |
|---|---|
| Source code | `server/`, `public/`, `test/`, `package.json`, `Dockerfile` |
| Setup / run instructions | `README.md` |
| Architecture note | `ARCHITECTURE.md` |
| AI workflow note | `AI_WORKFLOW.md` |
| Walkthrough video URL | `VIDEO_URL.txt` |
| Live product URL | https://docss-production.up.railway.app *(Railway)* |
| GitHub repo | https://github.com/danicpp/DOCSS |

## Test accounts
alice@example.com, bob@example.com, carol@example.com (no password; pick on the sign-in screen)

## Status
**Working end-to-end:**
- Document CRUD: create, rename, edit, auto-save, reopen (URL-routed, refresh-safe)
- Rich text: bold, italic, underline, H1-H3, bulleted/numbered lists, link insertion (Ctrl+K), undo/redo
- File upload: .txt, .md, .docx import to new document (button + drag-and-drop)
- Export: download as .txt, .md, .html, or .docx (server-side conversion)
- Full-text search: FTS5-powered instant search across titles and content with highlighted snippets
- Sharing: owner grants Can edit / Can view access; revoke; owned vs shared lists
- Security: helmet (CSP, HSTS, X-Frame-Options), rate limiting, CSRF protection, input sanitization
- Performance: gzip compression, SQLite WAL + busy_timeout, FTS5 indexing, static asset caching
- Accessibility: ARIA labels, toolbar active states, keyboard shortcuts, print stylesheet
- Mobile: responsive layout with sidebar toggle
- DevOps: multi-stage Docker build, non-root user, healthcheck, graceful shutdown
- 17 automated API tests covering auth, CRUD, sharing, search, export, and sanitization

**Intentionally not built (scope cuts):**
- Real authentication (mocked with cookie-based user picker — deliberate for demo scope)
- Real-time collaboration / CRDT (would need WebSocket + operational transform)
- Version history / undo at document level
- Comments / suggestion mode

**Next (2-4 hours):**
- TipTap or ProseMirror editor to replace deprecated `execCommand`
- Real auth with password hashing (bcrypt + JWT)
- Optimistic locking / conflict detection for concurrent edits
- Document version history with diff view
