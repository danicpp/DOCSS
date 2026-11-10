# AI workflow note

> DRAFT - edit this so it reflects what you actually did; reviewers value honesty over polish.

## Tools used
- Claude (chat) to plan scope, generate the initial project scaffold, API, frontend and tests.
- _Add any others (Copilot, Cursor, etc.)._

## Where AI materially sped things up
- Scaffolding the Express/SQLite API, schema and the access-control helper.
- Writing boilerplate: upload handling, validation, test cases, README/architecture docs.

## What I changed or rejected
- _Fill in with real examples, e.g.:_ chose `execCommand` + sanitized HTML over a heavier editor
  framework to keep the build dependency-free; chose 404 over 403 for unshared documents;
  _(add anything you modified after review, e.g. UI tweaks, bug fixes)_.

## How I verified correctness
- Automated API tests (`npm test`) covering persistence of formatting, sanitization, sharing
  permissions (viewer/editor/owner/no access), revocation, upload import and unauthenticated access.
- Manual two-user walkthrough (Alice shares to Bob; check view-only and edit behaviour).
- Manual checks of the editor in the browser: each toolbar action, refresh persistence, mobile width.
- _Add what you actually ran and any bugs you found._
