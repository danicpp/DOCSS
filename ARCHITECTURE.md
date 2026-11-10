# Architecture note

## What I prioritized
1. **A complete vertical slice** (create -> edit -> save -> reopen -> share -> upload) over breadth.
2. **Correct access logic** enforced on the server, not just hidden in the UI.
3. **Zero-friction review**: no build step, one `npm install`, seeded users, one Dockerfile.

## Stack and why
- **Node + Express + SQLite (better-sqlite3):** small, synchronous, easy to reason about, no external
  service for reviewers to pay for or configure. Three tables: `users`, `documents`, `shares`.
- **Vanilla JS frontend** served statically. The editor is a `contenteditable` surface driven by
  `document.execCommand`, with content stored as **sanitized HTML**. Dependencies stay minimal and the
  toolbar behaviour is easy to read.
- **Content format = HTML**: preserves headings/lists/inline formatting directly, round-trips from
  Markdown and .docx imports, and needs no custom serialization.

## Key decisions
- **Sharing model:** `documents.owner_id` is the owner; `shares(document_id, user_id, role)` grants
  `editor` or `viewer`. Every document route goes through one `loadDoc()` helper that resolves the role
  and enforces owner/write checks. Users with no access get **404**, not 403, so document IDs don't leak.
- **Mocked auth:** sign-in picks a seeded user and sets an HttpOnly cookie with the user id. It is NOT
  secure (the id is unsigned) and exists only to demonstrate the sharing flows.
- **Sanitization:** all content (typed, imported, API-submitted) passes through `sanitize-html` with an
  allow-list before storage, so stored XSS via HTML content or imports is blocked.
- **Autosave:** debounced (800 ms) and serialized, so a slow request can't overwrite a newer one;
  failures are surfaced and retried on the next edit; flushes before navigating away.
- **Upload:** imports create a new document (.txt paragraphs, .md via `marked`, .docx via `mammoth`).
  Type and size limits are enforced client- and server-side and stated in the UI.

## Deliberately deprioritized
- Real authentication, password handling, invites for people who don't have an account
- Real-time collaboration / conflict resolution (last write wins; the second editor to save overwrites)
- Version history, comments, export, image support, tables
- `execCommand` is deprecated but universally supported; a library such as TipTap/ProseMirror is the
  right upgrade for production (schema-based, collaborative editing via Yjs).

## With another 2-4 hours
1. Swap the editor for TipTap and add Markdown/PDF export.
2. Real auth (sessions + hashed passwords or OAuth).
3. Optimistic concurrency (`updated_at` check) and simple presence indicators, then Yjs for live collaboration.
4. Version history (snapshot on save) and more tests (importer unit tests, UI smoke test with Playwright).
