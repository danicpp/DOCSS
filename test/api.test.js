const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../server/db');
const { createApp } = require('../server/app');

let server, base;
before(async () => {
  const app = createApp(openDb(':memory:'));
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

// tiny client that carries the mocked-auth cookie
async function client(email) {
  const login = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  return async (path, { method = 'GET', body, form } = {}) => {
    const headers = { cookie };
    let payload;
    if (form) payload = form;
    else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + '/api' + path, { method, headers, body: payload });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
}

test('health check returns ok', async () => {
  const res = await fetch(base + '/api/health');
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.status, 'ok');
  assert.equal(typeof data.uptime, 'number');
});

test('/api/users requires authentication', async () => {
  const res = await fetch(base + '/api/users');
  assert.equal(res.status, 401);
});

test('/api/users returns users when authenticated', async () => {
  const alice = await client('alice@example.com');
  const { status, data } = await alice('/users');
  assert.equal(status, 200);
  assert.equal(data.length, 3);
});

test('create, rename, edit and reopen a document keeps formatting', async () => {
  const alice = await client('alice@example.com');
  const { data: created } = await alice('/documents', { method: 'POST', body: {} });
  const html = '<h1>Plan</h1><p><strong>Bold</strong> <em>it</em> <u>un</u></p><ul><li>one</li></ul>';
  const patch = await alice('/documents/' + created.id, { method: 'PATCH', body: { title: 'Roadmap', content: html } });
  assert.equal(patch.status, 200);
  const { data: doc } = await alice('/documents/' + created.id);
  assert.equal(doc.title, 'Roadmap');
  assert.equal(doc.content, html);
  assert.equal(doc.role, 'owner');
});

test('content is sanitized and validation rejects bad input', async () => {
  const alice = await client('alice@example.com');
  const { data: d } = await alice('/documents', { method: 'POST', body: { content: '<p onclick="x()">hi</p><script>alert(1)</script>' } });
  const { data: doc } = await alice('/documents/' + d.id);
  assert.equal(doc.content, '<p>hi</p>');
  assert.equal((await alice('/documents/' + d.id, { method: 'PATCH', body: { title: '   ' } })).status, 400);
});

test('sharing: access, owned vs shared lists, and permissions', async () => {
  const alice = await client('alice@example.com');
  const bob = await client('bob@example.com');
  const carol = await client('carol@example.com');
  const { data: d } = await alice('/documents', { method: 'POST', body: { title: 'Private', content: '<p>secret</p>' } });

  // not shared yet -> 404 for everyone else
  assert.equal((await bob('/documents/' + d.id)).status, 404);

  // viewer share
  assert.equal((await alice(`/documents/${d.id}/shares`, { method: 'POST', body: { email: 'bob@example.com', role: 'viewer' } })).status, 201);
  const bobList = (await bob('/documents')).data;
  assert.equal(bobList.shared.length >= 1, true);
  assert.equal(bobList.shared.find((x) => x.id === d.id).role, 'viewer');
  assert.equal(bobList.owned.some((x) => x.id === d.id), false);
  assert.equal((await bob('/documents/' + d.id)).data.role, 'viewer');
  assert.equal((await bob('/documents/' + d.id, { method: 'PATCH', body: { content: '<p>x</p>' } })).status, 403);

  // upgrade to editor
  await alice(`/documents/${d.id}/shares`, { method: 'POST', body: { email: 'bob@example.com', role: 'editor' } });
  assert.equal((await bob('/documents/' + d.id, { method: 'PATCH', body: { content: '<p>edited</p>' } })).status, 200);

  // non-owners cannot share or delete; unrelated user still blocked
  assert.equal((await bob(`/documents/${d.id}/shares`, { method: 'POST', body: { email: 'carol@example.com' } })).status, 403);
  assert.equal((await bob('/documents/' + d.id, { method: 'DELETE' })).status, 403);
  assert.equal((await carol('/documents/' + d.id)).status, 404);

  // revoke
  const { data: shares } = await alice('/documents/' + d.id);
  await alice(`/documents/${d.id}/shares/${shares.shares[0].user_id}`, { method: 'DELETE' });
  assert.equal((await bob('/documents/' + d.id)).status, 404);
});

test('upload .md creates an editable document; unsupported types are rejected', async () => {
  const alice = await client('alice@example.com');
  const form = new FormData();
  form.append('file', new Blob(['# Hello\n\nSome **bold** text\n\n- a\n- b'], { type: 'text/markdown' }), 'notes.md');
  const res = await alice('/documents/import', { method: 'POST', form });
  assert.equal(res.status, 201);
  assert.equal(res.data.title, 'notes');
  const { data: doc } = await alice('/documents/' + res.data.id);
  assert.match(doc.content, /<h1[^>]*>Hello<\/h1>/);
  assert.match(doc.content, /<strong>bold<\/strong>/);
  assert.match(doc.content, /<li>a<\/li>/);

  const bad = new FormData();
  bad.append('file', new Blob(['MZ'], { type: 'application/octet-stream' }), 'virus.exe');
  assert.equal((await alice('/documents/import', { method: 'POST', form: bad })).status, 400);
});

test('requests without a session are rejected', async () => {
  const res = await fetch(base + '/api/documents');
  assert.equal(res.status, 401);
});

test('large content is rejected', async () => {
  const alice = await client('alice@example.com');
  const { data: d } = await alice('/documents', { method: 'POST', body: {} });
  const bigContent = '<p>' + 'x'.repeat(1_100_000) + '</p>';
  const res = await alice('/documents/' + d.id, { method: 'PATCH', body: { content: bigContent } });
  assert.equal(res.status, 413);
});

test('links get rel=noopener noreferrer added', async () => {
  const alice = await client('alice@example.com');
  const { data: d } = await alice('/documents', { method: 'POST', body: { content: '<p><a href="https://example.com">link</a></p>' } });
  const { data: doc } = await alice('/documents/' + d.id);
  assert.match(doc.content, /rel="noopener noreferrer"/);
  assert.match(doc.content, /target="_blank"/);
});

// raw-fetch helper that doesn't auto-parse JSON (needed for binary export)
async function rawClient(email) {
  const login = await fetch(base + '/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }),
  });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  return async (path) => {
    return fetch(base + '/api' + path, { headers: { cookie } });
  };
}

test('full-text search returns matching documents', async () => {
  const alice = await client('alice@example.com');
  await alice('/documents', { method: 'POST', body: { title: 'Quantum Physics', content: '<p>Entanglement and superposition experiments</p>' } });
  await alice('/documents', { method: 'POST', body: { title: 'Cooking Recipes', content: '<p>Delicious pasta carbonara instructions</p>' } });

  const { data: results } = await alice('/search?q=quantum');
  assert.equal(results.length >= 1, true);
  assert.equal(results[0].title, 'Quantum Physics');

  const { data: pasta } = await alice('/search?q=carbonara');
  assert.equal(pasta.length >= 1, true);
  assert.equal(pasta[0].title, 'Cooking Recipes');

  const { data: none } = await alice('/search?q=xyznonexistent');
  assert.equal(none.length, 0);
});

test('search respects access control', async () => {
  const alice = await client('alice@example.com');
  const bob = await client('bob@example.com');
  await alice('/documents', { method: 'POST', body: { title: 'Secret Plans', content: '<p>Top secret classified information</p>' } });

  const { data: bobResults } = await bob('/search?q=classified');
  assert.equal(bobResults.length, 0);
});

test('export document as txt', async () => {
  const alice = await client('alice@example.com');
  const { data: d } = await alice('/documents', { method: 'POST', body: { title: 'Export Test', content: '<p>Hello world</p>' } });
  const raw = await rawClient('alice@example.com');
  const res = await raw(`/documents/${d.id}/export/txt`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const text = await res.text();
  assert.match(text, /Hello world/);
});

test('export document as html', async () => {
  const alice = await client('alice@example.com');
  const { data: d } = await alice('/documents', { method: 'POST', body: { title: 'HTML Export', content: '<p><strong>Bold</strong></p>' } });
  const raw = await rawClient('alice@example.com');
  const res = await raw(`/documents/${d.id}/export/html`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.match(html, /<strong>Bold<\/strong>/);
  assert.match(html, /<!DOCTYPE html>/);
});

test('export document as md', async () => {
  const alice = await client('alice@example.com');
  const { data: d } = await alice('/documents', { method: 'POST', body: { title: 'MD Export', content: '<h1>Title</h1><p><strong>bold</strong> text</p>' } });
  const raw = await rawClient('alice@example.com');
  const res = await raw(`/documents/${d.id}/export/md`);
  assert.equal(res.status, 200);
  const md = await res.text();
  assert.match(md, /# Title/);
  assert.match(md, /\*\*bold\*\*/);
});

test('export document as docx', async () => {
  const alice = await client('alice@example.com');
  const { data: d } = await alice('/documents', { method: 'POST', body: { title: 'DOCX Export', content: '<p>Word document content</p>' } });
  const raw = await rawClient('alice@example.com');
  const res = await raw(`/documents/${d.id}/export/docx`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /officedocument/);
  assert.match(res.headers.get('content-disposition'), /\.docx/);
  const buf = await res.arrayBuffer();
  assert.equal(buf.byteLength > 0, true);
  // DOCX files start with PK zip signature
  const sig = new Uint8Array(buf.slice(0, 2));
  assert.equal(sig[0], 0x50); // 'P'
  assert.equal(sig[1], 0x4B); // 'K'
});

test('export unsupported format returns 400', async () => {
  const raw = await rawClient('alice@example.com');
  // reuse a doc created in an earlier test
  const listRes = await raw('/documents');
  const list = await listRes.json();
  const docId = list.owned[0].id;
  const res = await raw(`/documents/${docId}/export/pdf`);
  assert.equal(res.status, 400);
});
