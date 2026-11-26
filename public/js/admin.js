(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const H = { 'X-Requested-With': 'pyq' };
  const MAX_BYTES = 15 * 1024 * 1024;
  const offline = 'Could not reach the server. Check your connection and try again.';
  let rows = [];

  function el(t, c, x) { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; }
  const say = (id, text, ok) => { $(id).textContent = text; $(id).className = 'msg ' + (ok ? 'ok' : 'err'); };
  const fmtSize = b => b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
  async function api(url, opts = {}) {
    try { return await fetch(url, { ...opts, signal: AbortSignal.timeout(60000) }); }
    catch { return null; } // network problem or timeout
  }
  const errorText = async (r, fallback) => { try { return (await r.json()).error || fallback; } catch { return fallback; } };

  for (let i = 1; i <= 8; i++) $('s').add(new Option('Semester ' + i, i));
  $('y').value = new Date().getFullYear();

  // ----- tabs: Upload paper / Manage papers -----
  const tabs = [$('tab-up'), $('tab-man')];
  function selectTab(tab, focus) {
    for (const t of tabs) {
      const on = t === tab;
      t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !on;
    }
    if (focus) tab.focus();
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => selectTab(t));
    t.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); selectTab(tabs[(i + 1) % tabs.length], true); }
    });
  });

  function show(signedIn, note) {
    $('login').hidden = signedIn; $('panel').hidden = !signedIn;
    if (signedIn) { selectTab(tabs[0]); refresh(); } else { say('lmsg', note || '', false); $('u').focus({ preventScroll: true }); }
  }

  // ----- list of uploaded papers -----
  async function refresh() {
    const [cs, ps] = await Promise.all([api('/api/courses'), api('/api/papers')]);
    if (!cs || !ps || !cs.ok || !ps.ok) { $('acount').textContent = 'Could not load the list. Reload the page to try again.'; return; }
    $('cl').replaceChildren(...(await cs.json()).map(c => new Option(c, c)));
    rows = await ps.json();
    renderList();
  }
  function renderList() {
    const needle = $('aq').value.trim().toLocaleLowerCase();
    const shown = rows.filter(x => !needle || (x.paperName + ' ' + x.course + ' ' + x.year).toLocaleLowerCase().includes(needle));
    $('acount').textContent = rows.length ? `${shown.length} of ${rows.length} papers` : 'No papers uploaded yet.';
    if (!shown.length) return $('list').replaceChildren();

    const table = el('table'), head = el('tr');
    ['Year', 'Subject', 'Course', 'Semester', 'File', 'Actions'].forEach(h => head.append(el('th', '', h)));
    const thead = el('thead'); thead.append(head); table.append(thead);
    const body = el('tbody');
    for (const x of shown) {
      const tr = el('tr');
      const cell = (cls, label, content) => {
        const td = el('td', cls); td.dataset.label = label;
        if (content instanceof Node) td.append(content); else td.textContent = content;
        tr.append(td);
      };
      cell('year', 'Year', String(x.year));
      cell('subject', 'Subject', x.paperName);
      cell('course', 'Course', x.course);
      cell('sem', 'Semester', String(x.semester));
      const file = el('span');
      file.append(el('span', 'tag', x.kind.toUpperCase()), el('span', 'size', fmtSize(x.size)));
      cell('file', 'File', file);
      const view = el('a', 'btn small alt', 'View'); view.href = '/files/' + x.id; view.target = '_blank'; view.rel = 'noopener';
      view.setAttribute('aria-label', `View ${x.paperName}, ${x.year}`);
      const del = el('button', 'btn small warn', 'Delete'); del.type = 'button';
      del.setAttribute('aria-label', `Delete ${x.paperName}, ${x.year}`);
      del.addEventListener('click', () => remove(x, del));
      const act = document.createDocumentFragment(); act.append(view, del);
      cell('act', 'Actions', act);
      body.append(tr);
    }
    table.append(body);
    const wrap = el('div', 'scroll'); wrap.append(table);
    $('list').replaceChildren(wrap);
  }

  // ----- delete, with a confirmation dialog -----
  const dlg = $('confirm');
  function confirmDelete(x) {
    $('cf-text').textContent = `“${x.paperName}” (${x.year}), ${x.course}, semester ${x.semester} will be removed permanently.`;
    return new Promise(resolve => {
      const done = v => { dlg.close(); $('cf-yes').onclick = $('cf-no').onclick = null; resolve(v); };
      $('cf-yes').onclick = () => done(true);
      $('cf-no').onclick = () => done(false);
      dlg.addEventListener('cancel', () => resolve(false), { once: true });
      dlg.showModal();
      $('cf-no').focus();
    });
  }
  async function remove(x, btn) {
    if (!(await confirmDelete(x))) return btn.focus();
    btn.disabled = true;
    const r = await api('/api/admin/papers/' + x.id, { method: 'DELETE', headers: H });
    if (!r) { btn.disabled = false; return say('dmsg', offline, false); }
    if (r.status === 401) return show(false, 'Your session has ended. Sign in again.');
    if (!r.ok) { btn.disabled = false; return say('dmsg', await errorText(r, 'Could not delete the paper.'), false); }
    say('dmsg', 'Paper deleted.', true);
    refresh();
  }

  // ----- sign in / out -----
  $('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!$('u').value || !$('p').value) return say('lmsg', 'Enter your username and password.', false);
    $('go').disabled = true;
    const r = await api('/api/admin/login', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('u').value, password: $('p').value }) });
    $('go').disabled = false; $('p').value = '';
    if (!r) return say('lmsg', offline, false);
    if (r.ok) { say('lmsg', '', true); show(true); } else say('lmsg', await errorText(r, 'Sign in failed.'), false);
  });
  $('out').addEventListener('click', async () => { await api('/api/admin/logout', { method: 'POST', headers: H }); show(false, ''); });

  // ----- upload -----
  const fileInput = $('f'), drop = $('drop');
  ['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { if (e.dataTransfer.files.length) fileInput.files = e.dataTransfer.files; });

  $('upForm').addEventListener('submit', async e => {
    e.preventDefault();
    const file = fileInput.files[0];
    if (!$('c').value.trim() || !$('n').value.trim() || !$('y').value) return say('umsg', 'Fill in the course, subject and year.', false);
    if (!file) return say('umsg', 'Choose a file first.', false);
    if (file.size > MAX_BYTES) return say('umsg', 'That file is larger than 15 MB.', false);
    const fd = new FormData();
    fd.append('course', $('c').value); fd.append('semester', $('s').value);
    fd.append('year', $('y').value); fd.append('paperName', $('n').value); fd.append('file', file);
    $('up').disabled = true; say('umsg', 'Uploading…', true);
    const r = await api('/api/admin/papers', { method: 'POST', headers: H, body: fd });
    $('up').disabled = false;
    if (!r) return say('umsg', offline, false);
    if (r.status === 401) return show(false, 'Your session has ended. Sign in again.');
    if (!r.ok) return say('umsg', await errorText(r, 'Upload failed.'), false);
    say('umsg', 'Paper uploaded.', true);
    $('n').value = ''; fileInput.value = ''; $('n').focus();
    refresh();
  });

  $('aq').addEventListener('input', renderList);
  api('/api/admin/me').then(async r => show(!!(r && r.ok && (await r.json()).signedIn)));
})();
