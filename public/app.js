(() => {
  const $ = (s) => document.querySelector(s);
  const show = (el, on) => el.classList.toggle('hidden', !on);

  const state = { me: null, doc: null, dirty: false, timer: null, saving: Promise.resolve(), listVersion: 0 };

  // ---------- helpers ----------
  async function api(path, { method = 'GET', body } = {}) {
    const init = { method, headers: {} };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
    let res;
    try { res = await fetch('/api' + path, init); }
    catch { throw new Error('Network error - check your connection'); }
    let data = null;
    try { data = await res.json(); } catch { /* empty body */ }
    if (res.status === 401) { state.me = null; route(); }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  let toastTimer;
  function toast(msg, isError = false) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'show' + (isError ? ' error' : '');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.className = ''), 3000);
  }
  const fail = (e) => toast(e.message, true);

  const fmtDate = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

  function setLoading(el, on) {
    if (on) {
      el.dataset.origText = el.textContent;
      el.innerHTML = '<span class="loading-spinner"></span>Loading…';
      el.disabled = true;
    } else {
      el.textContent = el.dataset.origText || el.textContent;
      el.disabled = false;
    }
  }

  // ---------- auth ----------
  async function showLogin() {
    show($('#app'), false); show($('#login'), true);
    const users = await api('/users');
    const box = $('#login-users'); box.textContent = '';
    for (const u of users) {
      const b = document.createElement('button');
      b.innerHTML = '<strong></strong><br><span class="muted"></span>';
      b.querySelector('strong').textContent = u.name;
      b.querySelector('span').textContent = u.email;
      b.onclick = async () => {
        setLoading(b, true);
        try { await api('/login', { method: 'POST', body: { email: u.email } }); location.hash = ''; await boot(); }
        catch (e) { fail(e); setLoading(b, false); }
      };
      box.appendChild(b);
    }
  }

  async function boot() {
    state.me = await api('/me');
    if (!state.me) return showLogin();
    show($('#login'), false); show($('#app'), true);
    $('#me').textContent = `${state.me.name} (${state.me.email})`;
    await refreshList();
    route();
  }

  $('#logout').onclick = async () => {
    await flush().catch(() => {});
    await api('/logout', { method: 'POST' });
    state.doc = null; location.hash = ''; boot();
  };

  // ---------- sidebar toggle (mobile) ----------
  $('#sidebar-toggle').onclick = () => {
    $('#sidebar').classList.toggle('open');
  };

  // ---------- full-text search ----------
  let searchTimer = null;
  const searchInput = $('#doc-search');
  const searchResults = $('#search-results');

  searchInput.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = searchInput.value.trim();
    if (!q) { show(searchResults, false); return; }
    searchTimer = setTimeout(() => runSearch(q), 250);
  });
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { searchInput.value = ''; show(searchResults, false); }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrap')) show(searchResults, false);
  });

  async function runSearch(query) {
    try {
      const results = await api('/search?q=' + encodeURIComponent(query));
      searchResults.textContent = '';
      if (!results.length) {
        const li = document.createElement('li');
        li.className = 'no-results'; li.textContent = 'No results found';
        searchResults.appendChild(li);
      } else {
        for (const r of results) {
          const li = document.createElement('li');
          const t = document.createElement('span'); t.className = 'title'; t.textContent = r.title;
          const s = document.createElement('span'); s.className = 'snippet'; s.innerHTML = r.snippet || '';
          li.append(t, s);
          li.onclick = async () => {
            searchInput.value = ''; show(searchResults, false);
            await flush().catch(() => {});
            location.hash = '#/doc/' + r.id;
            if (window.innerWidth <= 760) $('#sidebar').classList.remove('open');
          };
          searchResults.appendChild(li);
        }
      }
      show(searchResults, true);
    } catch (e) { /* silently fail search */ }
  }

  // ---------- document list ----------
  function renderList(ul, docs, shared) {
    ul.textContent = '';
    if (!docs.length) {
      const li = document.createElement('li'); li.className = 'muted'; li.style.cursor = 'default';
      li.textContent = shared ? 'Nothing shared with you yet' : 'No documents yet'; ul.appendChild(li); return;
    }
    for (const d of docs) {
      const li = document.createElement('li');
      li.dataset.id = d.id;
      if (state.doc && state.doc.id === d.id) li.classList.add('active');
      const t = document.createElement('span'); t.className = 'title'; t.textContent = d.title;
      const m = document.createElement('span'); m.className = 'meta';
      m.textContent = shared ? `Shared by ${d.owner_name} · ${d.role === 'viewer' ? 'view only' : 'can edit'}` : `Owned by you · ${fmtDate(d.updated_at)}`;
      li.append(t, m);
      li.onclick = async () => {
        if (state.dirty && !confirm('You have unsaved changes. Leave anyway?')) return;
        await flush().catch(() => {});
        location.hash = '#/doc/' + d.id;
        if (window.innerWidth <= 760) $('#sidebar').classList.remove('open');
      };
      ul.appendChild(li);
    }
  }
  async function refreshList() {
    const { owned, shared } = await api('/documents');
    renderList($('#owned'), owned, false);
    renderList($('#shared'), shared, true);
  }

  // ---------- routing ----------
  async function route() {
    if (!state.me) return;
    const m = location.hash.match(/^#\/doc\/(\d+)$/);
    if (!m) { state.doc = null; show($('#editor-wrap'), false); show($('#empty'), true); return; }
    try { await openDoc(Number(m[1])); }
    catch (e) { fail(e); state.doc = null; show($('#editor-wrap'), false); show($('#empty'), true); location.hash = ''; }
  }
  window.addEventListener('hashchange', route);

  // ---------- editor ----------
  const editor = $('#editor'), title = $('#title');

  async function openDoc(id) {
    const doc = await api('/documents/' + id);
    state.doc = doc; state.dirty = false;
    title.value = doc.title;
    editor.innerHTML = doc.content;
    const canEdit = doc.role !== 'viewer';
    editor.contentEditable = canEdit; title.disabled = !canEdit;
    $('#toolbar').classList.toggle('disabled', !canEdit);
    const badge = $('#role-badge');
    badge.textContent = doc.role === 'owner' ? 'Owner' : doc.role === 'editor' ? `Shared by ${doc.owner.name} · can edit` : `Shared by ${doc.owner.name} · view only`;
    badge.classList.toggle('shared', doc.role !== 'owner');
    show($('#share-btn'), doc.role === 'owner'); show($('#delete-btn'), doc.role === 'owner');
    show($('#export-btn'), true);
    setSaveState(canEdit ? 'Saved' : 'Read-only');
    show($('#empty'), false); show($('#editor-wrap'), true);
    updateWordCount();
    updateToolbarState();
    await refreshList();
    editor.focus();
  }

  function setSaveState(s) { $('#save-state').textContent = s; }

  function markDirty() {
    if (!state.doc || state.doc.role === 'viewer') return;
    state.dirty = true; setSaveState('Unsaved changes…');
    clearTimeout(state.timer); state.timer = setTimeout(() => flush().catch(fail), 800);
    updateWordCount();
  }

  function flush() {
    clearTimeout(state.timer);
    if (!state.dirty || !state.doc) return state.saving;
    const doc = state.doc;
    const payload = { title: title.value.trim() || doc.title, content: editor.innerHTML };
    state.dirty = false; setSaveState('Saving…');
    state.saving = state.saving.catch(() => {}).then(async () => {
      try {
        const r = await api('/documents/' + doc.id, { method: 'PATCH', body: payload });
        doc.title = r.title;
        if (state.doc === doc) setSaveState('Saved ' + new Date().toLocaleTimeString([], { timeStyle: 'short' }));
      } catch (e) {
        state.dirty = true; setSaveState('Save failed - retrying on next edit'); throw e;
      }
    });
    return state.saving;
  }

  editor.addEventListener('input', markDirty);
  title.addEventListener('input', markDirty);
  title.addEventListener('blur', () => { if (!title.value.trim() && state.doc) title.value = state.doc.title; });
  window.addEventListener('beforeunload', (e) => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ---------- word count ----------
  function updateWordCount() {
    const text = editor.innerText || '';
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const chars = text.length;
    $('#word-count').textContent = `${words} word${words !== 1 ? 's' : ''} · ${chars} character${chars !== 1 ? 's' : ''}`;
  }

  // ---------- toolbar ----------
  $('#toolbar').addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
  $('#toolbar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-cmd]'); if (!b) return;
    editor.focus(); document.execCommand(b.dataset.cmd); markDirty();
    updateToolbarState();
  });
  $('#block').addEventListener('change', (e) => {
    editor.focus(); document.execCommand('formatBlock', false, e.target.value); markDirty();
  });

  function updateToolbarState() {
    for (const btn of document.querySelectorAll('#toolbar button[data-cmd]')) {
      const cmd = btn.dataset.cmd;
      if (['bold', 'italic', 'underline'].includes(cmd)) {
        btn.classList.toggle('active', document.queryCommandState(cmd));
      }
    }
    const tag = (document.queryCommandValue('formatBlock') || 'p').toLowerCase().replace(/[<>]/g, '');
    $('#block').value = ['h1', 'h2', 'h3'].includes(tag) ? tag : 'p';
  }

  document.addEventListener('selectionchange', () => {
    if (!editor.contains(document.getSelection()?.anchorNode)) return;
    updateToolbarState();
  });

  // ---------- link insertion ----------
  $('#link-btn').onclick = () => {
    const sel = window.getSelection();
    if (!sel.rangeCount || !editor.contains(sel.anchorNode)) { editor.focus(); return; }
    const url = prompt('Enter URL:', 'https://');
    if (!url) return;
    editor.focus();
    document.execCommand('createLink', false, url);
    markDirty();
  };
  editor.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      $('#link-btn').click();
    }
  });

  // ---------- create / upload / delete ----------
  $('#new-doc').onclick = async () => {
    const btn = $('#new-doc');
    setLoading(btn, true);
    try { await flush(); const d = await api('/documents', { method: 'POST', body: {} }); location.hash = '#/doc/' + d.id; }
    catch (e) { fail(e); }
    finally { setLoading(btn, false); }
  };

  async function importFile(file) {
    if (!file) return;
    if (!/\.(txt|md|docx)$/i.test(file.name)) return toast('Unsupported file type. Use .txt, .md or .docx', true);
    if (file.size > 2 * 1024 * 1024) return toast('File is too large (max 2 MB)', true);
    try {
      await flush();
      const fd = new FormData(); fd.append('file', file);
      const d = await api('/documents/import', { method: 'POST', body: fd });
      toast(`Imported "${d.title}"`); location.hash = '#/doc/' + d.id;
    } catch (err) { fail(err); }
  }

  $('#upload').onchange = async (e) => {
    const file = e.target.files[0]; e.target.value = '';
    await importFile(file);
  };

  // ---------- drag and drop ----------
  const mainArea = $('#main-area');
  const dropZone = $('#drop-zone');
  let dragCounter = 0;

  mainArea.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragCounter++;
    show(dropZone, true);
  });
  mainArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragCounter--;
    if (dragCounter <= 0) { dragCounter = 0; show(dropZone, false); }
  });
  mainArea.addEventListener('dragover', (e) => e.preventDefault());
  mainArea.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCounter = 0;
    show(dropZone, false);
    const file = e.dataTransfer.files[0];
    if (file) await importFile(file);
  });

  // ---------- delete (styled dialog) ----------
  $('#delete-btn').onclick = () => {
    if (!state.doc) return;
    $('#delete-msg').textContent = `Delete "${state.doc.title}" for everyone? This cannot be undone.`;
    $('#delete-dialog').showModal();
  };
  $('#delete-cancel').onclick = () => $('#delete-dialog').close();
  $('#delete-confirm').onclick = async () => {
    $('#delete-dialog').close();
    if (!state.doc) return;
    try {
      state.dirty = false;
      await api('/documents/' + state.doc.id, { method: 'DELETE' });
      state.doc = null; location.hash = ''; await refreshList(); toast('Document deleted');
    } catch (e) { fail(e); }
  };

  // ---------- export ----------
  $('#export-btn').onclick = () => {
    if (!state.doc) return;
    $('#export-dialog').showModal();
  };
  $('#export-cancel').onclick = () => $('#export-dialog').close();

  $('#export-dialog').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-export]');
    if (!btn || !state.doc) return;
    const fmt = btn.dataset.export;
    const exts = { txt: '.txt', md: '.md', html: '.html', docx: '.docx' };
    btn.disabled = true;
    btn.dataset.origLabel = btn.textContent;
    btn.textContent = 'Exporting…';
    try {
      await flush().catch(() => {});
      const res = await fetch(`/api/documents/${state.doc.id}/export/${fmt}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error((data && data.error) || 'Export failed');
      }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (state.doc.title || 'document').replace(/[<>:"/\\|?*]/g, '_') + (exts[fmt] || '');
      a.click();
      URL.revokeObjectURL(a.href);
      $('#export-dialog').close();
      toast(`Exported as ${exts[fmt]}`);
    } catch (err) {
      fail(err);
    } finally {
      btn.textContent = btn.dataset.origLabel;
      btn.disabled = false;
    }
  });

  // ---------- sharing ----------
  function renderShares(list) {
    const ul = $('#share-list'); ul.textContent = '';
    if (!list.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = 'Not shared with anyone yet'; ul.appendChild(li); return; }
    for (const s of list) {
      const li = document.createElement('li');
      const who = document.createElement('span'); who.className = 'who'; who.textContent = `${s.name} (${s.email})`;
      const badge = document.createElement('span'); badge.className = 'badge'; badge.textContent = s.role === 'viewer' ? 'Can view' : 'Can edit';
      const rm = document.createElement('button'); rm.className = 'btn'; rm.type = 'button'; rm.textContent = 'Remove';
      rm.onclick = async () => { try { renderShares(await api(`/documents/${state.doc.id}/shares/${s.user_id}`, { method: 'DELETE' })); } catch (e) { fail(e); } };
      li.append(who, badge, rm); ul.appendChild(li);
    }
  }
  $('#share-btn').onclick = async () => {
    try { await flush(); const d = await api('/documents/' + state.doc.id); renderShares(d.shares || []); $('#share-email').value = ''; $('#share-dialog').showModal(); }
    catch (e) { fail(e); }
  };
  $('#share-add').onclick = async () => {
    const email = $('#share-email').value.trim();
    if (!email) return toast('Enter an email address', true);
    try {
      renderShares(await api(`/documents/${state.doc.id}/shares`, { method: 'POST', body: { email, role: $('#share-role').value } }));
      $('#share-email').value = ''; toast('Shared');
    } catch (e) { fail(e); }
  };
  $('#share-form').addEventListener('submit', (e) => e.preventDefault());

  boot().catch(fail);
})();
