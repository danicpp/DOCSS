const path = require('path');
const express = require('express');
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const morgan = require('morgan');
const HTMLtoDOCX = require('html-to-docx');
const { fileToHtml, titleFromFilename, SUPPORTED } = require('./importer');

const MAX_TITLE = 200;
const MAX_CONTENT = 1_000_000; // ~1 MB of HTML
const MAX_EMAIL = 254;

const SANITIZE = {
  allowedTags: ['h1', 'h2', 'h3', 'p', 'br', 'div', 'span', 'strong', 'b', 'em', 'i', 'u',
    'ul', 'ol', 'li', 'blockquote', 'a', 'code', 'pre', 'hr'],
  allowedAttributes: { a: ['href', 'rel', 'target'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    a: (tagName, attribs) => ({
      tagName,
      attribs: { ...attribs, rel: 'noopener noreferrer', target: '_blank' },
    }),
  },
};
const clean = (html) => sanitizeHtml(html, SANITIZE);

function htmlToBasicMarkdown(html) {
  return html
    .replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
    .replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
    .replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
    .replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
    .replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
    .replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
    .replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
    .replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
    .replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gi, '> $1\n\n')
    .replace(/<hr[^>]*\/?>/gi, '---\n\n')
    .replace(/<br[^>]*\/?>/gi, '\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
    .replace(/<\/?(div|span|ul|ol|pre)[^>]*>/gi, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function parseCookies(header = '') {
  return Object.fromEntries(
    header.split(';').map((c) => c.trim()).filter(Boolean).map((c) => {
      const i = c.indexOf('=');
      return [c.slice(0, i), decodeURIComponent(c.slice(i + 1))];
    })
  );
}

// Express 4 does not catch rejected promises from async handlers; wrap them.
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function createApp(db) {
  const app = express();

  // ---- security headers ----
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }));

  // ---- compression ----
  app.use(compression());

  // ---- request logging ----
  app.use(morgan('short'));

  // ---- rate limiting ----
  if (process.env.NODE_ENV !== 'test') {
    app.use('/api/login', rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 20,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many login attempts, try again later' },
    }));
    app.use('/api', rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
      message: { error: 'Too many requests, slow down' },
    }));
  }

  app.use(express.json({ limit: '2mb' }));

  const q = {
    userById: db.prepare('SELECT id, email, name FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT id, email, name FROM users WHERE email = ?'),
    users: db.prepare('SELECT id, email, name FROM users ORDER BY id'),
    docById: db.prepare('SELECT * FROM documents WHERE id = ?'),
    share: db.prepare('SELECT role FROM shares WHERE document_id = ? AND user_id = ?'),
    owned: db.prepare('SELECT id, title, updated_at FROM documents WHERE owner_id = ? ORDER BY updated_at DESC, id DESC'),
    sharedWith: db.prepare(`
      SELECT d.id, d.title, d.updated_at, s.role, u.name AS owner_name, u.email AS owner_email
      FROM shares s JOIN documents d ON d.id = s.document_id JOIN users u ON u.id = d.owner_id
      WHERE s.user_id = ? ORDER BY d.updated_at DESC, d.id DESC`),
    shareList: db.prepare(`
      SELECT u.id AS user_id, u.name, u.email, s.role
      FROM shares s JOIN users u ON u.id = s.user_id WHERE s.document_id = ? ORDER BY u.name`),
    insertDoc: db.prepare('INSERT INTO documents (owner_id, title, content) VALUES (?, ?, ?)'),
    updateDoc: db.prepare(`UPDATE documents SET title = ?, content = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?`),
    deleteDoc: db.prepare('DELETE FROM documents WHERE id = ?'),
    upsertShare: db.prepare(`INSERT INTO shares (document_id, user_id, role) VALUES (?, ?, ?)
      ON CONFLICT(document_id, user_id) DO UPDATE SET role = excluded.role`),
    deleteShare: db.prepare('DELETE FROM shares WHERE document_id = ? AND user_id = ?'),
    search: db.prepare(`
      SELECT d.id, d.title, d.updated_at, snippet(documents_fts, 1, '<mark>', '</mark>', '…', 40) AS snippet,
             rank
      FROM documents_fts f
      JOIN documents d ON d.id = f.rowid
      WHERE documents_fts MATCH ?
      ORDER BY rank
      LIMIT 50`),
  };

  // ---- CSRF protection ----
  app.use((req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (!ct || ct.startsWith('application/json') || ct.startsWith('multipart/form-data')) return next();
    next(new HttpError(400, 'Invalid content type'));
  });

  // ---- auth (mocked: pick a seeded user; cookie holds the user id) ----
  app.use((req, _res, next) => {
    const uid = Number(parseCookies(req.headers.cookie).uid);
    req.user = uid ? q.userById.get(uid) : null;
    next();
  });
  const requireUser = (req, _res, next) =>
    req.user ? next() : next(new HttpError(401, 'Please sign in'));

  // ---- health check ----
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

  app.get('/api/users', requireUser, (_req, res) => res.json(q.users.all()));

  app.post('/api/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (email.length > MAX_EMAIL) throw new HttpError(400, 'Invalid email');
    const user = q.userByEmail.get(email);
    if (!user) throw new HttpError(404, 'Unknown user');
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.setHeader('Set-Cookie', `uid=${user.id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
    res.json(user);
  });
  app.post('/api/logout', (_req, res) => {
    res.setHeader('Set-Cookie', 'uid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ ok: true });
  });
  app.get('/api/me', (req, res) => res.json(req.user));

  // 404 (not 403) when the user has no access at all, so document existence is not leaked.
  function loadDoc(req, { needOwner = false, needWrite = false } = {}) {
    const id = Number(req.params.id);
    const doc = Number.isInteger(id) ? q.docById.get(id) : null;
    if (!doc) throw new HttpError(404, 'Document not found');
    const role = doc.owner_id === req.user.id ? 'owner' : q.share.get(doc.id, req.user.id)?.role || null;
    if (!role) throw new HttpError(404, 'Document not found');
    if (needOwner && role !== 'owner') throw new HttpError(403, 'Only the owner can do this');
    if (needWrite && role === 'viewer') throw new HttpError(403, 'You have view-only access');
    return { doc, role };
  }

  const validTitle = (t) => {
    if (typeof t !== 'string' || !t.trim()) throw new HttpError(400, 'Title cannot be empty');
    if (t.length > MAX_TITLE) throw new HttpError(400, `Title must be at most ${MAX_TITLE} characters`);
    return t.trim();
  };
  const validContent = (c) => {
    if (typeof c !== 'string') throw new HttpError(400, 'Content must be a string');
    if (c.length > MAX_CONTENT) throw new HttpError(413, 'Document is too large');
    return clean(c);
  };

  // ---- documents ----
  app.get('/api/documents', requireUser, (req, res) => {
    res.json({ owned: q.owned.all(req.user.id), shared: q.sharedWith.all(req.user.id) });
  });

  app.post('/api/documents', requireUser, (req, res) => {
    const title = req.body?.title === undefined ? 'Untitled document' : validTitle(req.body.title);
    const content = req.body?.content === undefined ? '' : validContent(req.body.content);
    const { lastInsertRowid } = q.insertDoc.run(req.user.id, title, content);
    res.status(201).json({ id: Number(lastInsertRowid), title });
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });
  app.post('/api/documents/import', requireUser, upload.single('file'), wrap(async (req, res) => {
    if (!req.file) throw new HttpError(400, `Choose a file to upload (${SUPPORTED.join(', ')})`);
    const html = clean(await fileToHtml(req.file.originalname, req.file.buffer));
    const title = titleFromFilename(req.file.originalname);
    const { lastInsertRowid } = q.insertDoc.run(req.user.id, title, html);
    res.status(201).json({ id: Number(lastInsertRowid), title });
  }));

  app.get('/api/documents/:id', requireUser, (req, res) => {
    const { doc, role } = loadDoc(req);
    const owner = q.userById.get(doc.owner_id);
    res.json({
      id: doc.id, title: doc.title, content: doc.content, updated_at: doc.updated_at,
      role, owner: { name: owner.name, email: owner.email },
      shares: role === 'owner' ? q.shareList.all(doc.id) : undefined,
    });
  });

  app.patch('/api/documents/:id', requireUser, (req, res) => {
    const { doc } = loadDoc(req, { needWrite: true });
    const title = req.body?.title === undefined ? doc.title : validTitle(req.body.title);
    const content = req.body?.content === undefined ? doc.content : validContent(req.body.content);
    q.updateDoc.run(title, content, doc.id);
    res.json({ id: doc.id, title, updated_at: q.docById.get(doc.id).updated_at });
  });

  app.delete('/api/documents/:id', requireUser, (req, res) => {
    const { doc } = loadDoc(req, { needOwner: true });
    q.deleteDoc.run(doc.id);
    res.json({ ok: true });
  });

  // ---- sharing (owner only) ----
  app.post('/api/documents/:id/shares', requireUser, (req, res) => {
    const { doc } = loadDoc(req, { needOwner: true });
    const email = String(req.body?.email || '').trim().toLowerCase();
    const role = req.body?.role === 'viewer' ? 'viewer' : 'editor';
    if (!email) throw new HttpError(400, 'Enter an email address');
    if (email.length > MAX_EMAIL) throw new HttpError(400, 'Invalid email');
    const target = q.userByEmail.get(email);
    if (!target) throw new HttpError(404, 'No user with that email (try alice/bob/carol@example.com)');
    if (target.id === doc.owner_id) throw new HttpError(400, 'You already own this document');
    q.upsertShare.run(doc.id, target.id, role);
    res.status(201).json(q.shareList.all(doc.id));
  });

  app.delete('/api/documents/:id/shares/:userId', requireUser, (req, res) => {
    const { doc } = loadDoc(req, { needOwner: true });
    q.deleteShare.run(doc.id, Number(req.params.userId));
    res.json(q.shareList.all(doc.id));
  });

  // ---- full-text search ----
  app.get('/api/search', requireUser, (req, res) => {
    const raw = String(req.query.q || '').trim();
    if (!raw) return res.json([]);
    if (raw.length > 200) throw new HttpError(400, 'Search query too long');
    // Escape FTS5 special characters and build a prefix query
    const escaped = raw.replace(/[""*():^{}~\\/<>!@#$%&=+|`[\]]/g, ' ').trim();
    if (!escaped) return res.json([]);
    const terms = escaped.split(/\s+/).filter(Boolean).map(t => `"${t}"*`).join(' AND ');
    if (!terms) return res.json([]);
    const allResults = q.search.all(terms);
    // Filter to only docs the user can access (owned or shared)
    const accessible = allResults.filter(r => {
      const doc = q.docById.get(r.id);
      if (!doc) return false;
      if (doc.owner_id === req.user.id) return true;
      return !!q.share.get(doc.id, req.user.id);
    });
    res.json(accessible.map(r => ({
      id: r.id, title: r.title, updated_at: r.updated_at, snippet: r.snippet,
    })));
  });

  // ---- export ----
  app.get('/api/documents/:id/export/:format', requireUser, wrap(async (req, res) => {
    const { doc } = loadDoc(req);
    const format = req.params.format;
    const safeName = (doc.title || 'document').replace(/[<>:"/\\|?*]/g, '_');

    if (format === 'docx') {
      const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${doc.content}</body></html>`;
      const buffer = await HTMLtoDOCX(htmlContent, null, {
        title: doc.title,
        margins: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
      });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.docx"`);
      res.send(Buffer.from(buffer));
    } else if (format === 'html') {
      const full = `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${doc.title.replace(/</g, '&lt;')}</title></head><body>\n${doc.content}\n</body></html>`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.html"`);
      res.send(full);
    } else if (format === 'txt') {
      const text = doc.content.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'");
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.txt"`);
      res.send(text);
    } else if (format === 'md') {
      res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}.md"`);
      res.send(htmlToBasicMarkdown(doc.content));
    } else {
      throw new HttpError(400, 'Unsupported format. Use: txt, md, html, docx');
    }
  }));

  // ---- static + errors ----
  app.use(express.static(path.join(__dirname, '..', 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0,
    etag: true,
  }));
  app.use('/api', (_req, _res, next) => next(new HttpError(404, 'Not found')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    let status = err.status || 500;
    let message = err.message;
    if (err instanceof multer.MulterError) {
      status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
      message = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 2 MB)' : err.message;
    } else if (err.type === 'entity.parse.failed') {
      status = 400; message = 'Invalid JSON';
    } else if (err.type === 'entity.too.large') {
      status = 413; message = 'Request too large';
    } else if (status === 500) {
      console.error(err);
      message = 'Something went wrong';
    }
    res.status(status).json({ error: message });
  });

  return app;
}

module.exports = { createApp };
