# AI Workflow Note

## Tools used
- **Claude Code (CLI)** — primary AI assistant for planning, implementation, code review, and iteration
- No other AI tools used (no Copilot, Cursor, or ChatGPT)

## Where AI materially sped things up
- **Initial scaffold:** Express + SQLite schema, API routes, and the access-control helper (`loadDoc` with role-based 404/403 logic) were generated quickly and iterated on
- **Security hardening:** helmet configuration, rate limiting setup, CSRF middleware, and sanitizer config with `rel=noopener noreferrer` injection — would have taken significant research time manually
- **FTS5 integration:** the virtual table schema, sync triggers, porter stemmer tokenization, prefix matching query builder, and access-controlled search endpoint
- **Server-side export:** html-to-docx integration, HTML-to-Markdown converter, proper Content-Disposition headers for all 4 formats
- **Frontend UX:** drag-and-drop upload zone, toolbar active state tracking, word count, mobile sidebar toggle, styled dialogs replacing `confirm()`
- **Test suite:** 17 tests covering auth, CRUD, sharing permissions, file upload, search (including access control), all 4 export formats, input validation, and sanitization
- **Docker:** multi-stage build, .dockerignore, non-root user, healthcheck — boilerplate that's easy to get wrong

## What I changed or rejected
- Chose `execCommand` + server-side sanitization over a heavier editor framework (TipTap/ProseMirror) to keep zero build step and minimal dependencies — accepted the deprecation tradeoff for shipping speed
- Changed rate limiter from `max: 0` (which blocks all requests in express-rate-limit v7) to conditional skip in test environment — AI's initial approach was wrong for the library version
- Fixed CSRF middleware to allow DELETE requests with no Content-Type header — AI's first version blocked legitimate no-body DELETE requests
- Chose 404 over 403 for documents the user has no access to, preventing document existence enumeration — kept this AI suggestion as it's a genuine security best practice
- Rejected including `crypto` import that was unused
- Added FTS rebuild-on-startup logic after testing showed existing DB rows weren't indexed when FTS table was added later

## How I verified correctness
- **Automated tests:** `npm test` runs 17 API tests with an in-memory database — all passing. Tests cover: health check, auth enforcement, CRUD with formatting preservation, XSS sanitization, sharing permissions (viewer/editor/owner/no-access/revoke), file upload + rejection, large content rejection, link sanitization, full-text search (match + no-match + access control), export in all 4 formats (txt/md/html/docx with content and header verification), and unsupported format rejection
- **Manual browser testing:** each toolbar action, auto-save cycle, refresh persistence, two-user sharing flow (Alice shares to Bob; verify view-only blocks editing, editor allows it), mobile width responsive behavior
- **Security verification:** confirmed helmet headers present via `curl -I`, verified unauthenticated `/api/users` returns 401, verified search results filtered by access
- **Export verification:** downloaded all 4 formats, opened .docx in Word to confirm valid file, checked .md output preserves heading/bold structure
