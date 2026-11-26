(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const f = { q: $('q'), course: $('course'), subject: $('subject'), semester: $('sem'), year: $('year'), sort: $('sort') };
  const list = $('list'), count = $('count'), clearBtn = $('clear');
  const DEFAULT_SORT = 'year-desc';
  let papers = [];

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  const fmtSize = b => b < 1048576 ? Math.max(1, Math.round(b / 1024)) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
  const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
  const text = (a, b) => a.localeCompare(b);

  const sorters = {
    'year-desc': (a, b) => b.year - a.year || text(a.paperName, b.paperName),
    'year-asc': (a, b) => a.year - b.year || text(a.paperName, b.paperName),
    subject: (a, b) => text(a.paperName, b.paperName) || b.year - a.year,
    course: (a, b) => text(a.course, b.course) || a.semester - b.semester || text(a.paperName, b.paperName) || b.year - a.year,
    sem: (a, b) => a.semester - b.semester || text(a.course, b.course) || text(a.paperName, b.paperName) || b.year - a.year,
  };

  // ----- filter menus -----
  function setOptions(select, values, label) {
    const keep = select.value;
    select.length = 1; // keep the "All ..." entry
    values.forEach(v => select.add(new Option(label ? label(v) : v, v)));
    select.value = values.map(String).includes(keep) ? keep : '';
  }
  // The subject list only shows subjects that exist for the chosen course and semester.
  function rebuildSubjects() {
    const names = papers
      .filter(p => (!f.course.value || p.course === f.course.value) && (!f.semester.value || String(p.semester) === f.semester.value))
      .map(p => p.paperName);
    setOptions(f.subject, [...new Set(names)].sort(text));
  }

  // ----- states -----
  function showSkeleton() {
    list.replaceChildren(...[0, 1, 2].map(() => el('div', 'skel')));
    list.setAttribute('aria-busy', 'true'); count.textContent = 'Loading papers…';
  }
  function showState(title, message, btnText, onClick) {
    const box = el('div', 'state');
    box.append(el('h2', '', title), el('p', '', message));
    if (btnText) { const b = el('button', 'btn', btnText); b.type = 'button'; b.addEventListener('click', onClick); box.append(b); }
    list.replaceChildren(box);
  }

  // ----- results -----
  const read = () => ({ q: f.q.value.trim(), course: f.course.value, subject: f.subject.value, semester: f.semester.value, year: f.year.value, sort: f.sort.value });

  function render() {
    list.removeAttribute('aria-busy');
    const a = read();
    const needle = a.q.toLocaleLowerCase();
    const rows = papers.filter(p =>
      (!a.course || p.course === a.course) && (!a.subject || p.paperName === a.subject) &&
      (!a.semester || String(p.semester) === a.semester) && (!a.year || String(p.year) === a.year) &&
      (!needle || (p.paperName + ' ' + p.course + ' ' + p.year).toLocaleLowerCase().includes(needle)))
      .sort(sorters[a.sort] || sorters[DEFAULT_SORT]);
    const filtered = !!(a.q || a.course || a.subject || a.semester || a.year);
    clearBtn.hidden = !filtered;
    syncUrl(a);

    if (!papers.length) { count.textContent = ''; return showState('No papers yet', 'Papers will appear here once they are uploaded. Check back soon.'); }
    count.textContent = filtered ? `${rows.length} of ${plural(papers.length, 'paper')}` : plural(rows.length, 'paper');
    if (!rows.length) return showState('No papers match', 'Try a different course, subject or year, or search with fewer words.', 'Clear filters', clearAll);

    const table = el('table');
    const head = el('tr');
    ['Year', 'Subject', 'Course', 'Semester', 'File', 'Open'].forEach(h => head.append(el('th', '', h)));
    const thead = el('thead'); thead.append(head); table.append(thead);
    const body = el('tbody');
    for (const p of rows) {
      const tr = el('tr');
      const cell = (cls, label, content) => {
        const td = el('td', cls); td.dataset.label = label;
        if (content instanceof Node) td.append(content); else td.textContent = content;
        tr.append(td); return td;
      };
      cell('year', 'Year', String(p.year));
      cell('subject', 'Subject', p.paperName);
      cell('course', 'Course', p.course);
      cell('sem', 'Semester', String(p.semester));
      const file = el('span');
      file.append(el('span', 'tag', p.kind.toUpperCase()), el('span', 'size', fmtSize(p.size)));
      cell('file', 'File', file);
      const act = document.createDocumentFragment();
      const view = el('a', 'btn small', 'View');
      view.href = '/files/' + p.id; view.target = '_blank'; view.rel = 'noopener';
      view.setAttribute('aria-label', `View ${p.paperName}, ${p.year}`);
      const dl = el('a', 'btn small alt', 'Download');
      dl.href = '/files/' + p.id + '?download=1';
      dl.setAttribute('aria-label', `Download ${p.paperName}, ${p.year}`);
      act.append(view, dl);
      cell('act', 'Open', act);
      body.append(tr);
    }
    table.append(body);
    const wrap = el('div', 'scroll'); wrap.append(table);
    list.replaceChildren(wrap);
  }

  function clearAll() {
    f.q.value = f.course.value = f.semester.value = f.year.value = f.subject.value = '';
    f.sort.value = DEFAULT_SORT;
    rebuildSubjects(); render(); f.q.focus();
  }

  // Keep the address bar in sync so a filtered view can be shared as a link.
  const URL_KEYS = ['q', 'course', 'subject', 'semester', 'year', 'sort'];
  function syncUrl(a) {
    const p = new URLSearchParams();
    for (const k of URL_KEYS) if (a[k] && !(k === 'sort' && a[k] === DEFAULT_SORT)) p.set(k, a[k]);
    const qs = p.toString();
    history.replaceState(null, '', location.pathname + (qs ? '?' + qs : ''));
  }
  function readUrl() {
    const p = new URLSearchParams(location.search);
    f.q.value = (p.get('q') || '').slice(0, 80);
    f.course.value = p.get('course') || ''; f.semester.value = p.get('semester') || '';
    rebuildSubjects(); // subject choices depend on course and semester
    f.subject.value = p.get('subject') || ''; f.year.value = p.get('year') || '';
    f.sort.value = p.get('sort') || DEFAULT_SORT;
    if (f.sort.value === '') f.sort.value = DEFAULT_SORT; // unknown values fall back to the default
  }

  // ----- loading -----
  async function load() {
    showSkeleton();
    try {
      const r = await fetch('/api/papers', { signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error('status ' + r.status);
      papers = await r.json();
    } catch {
      count.textContent = '';
      return showState('Could not load the papers', 'Check your internet connection and try again.', 'Try again', load);
    }
    const uniq = (key, cmp) => [...new Set(papers.map(p => p[key]))].sort(cmp);
    setOptions(f.course, uniq('course', text));
    setOptions(f.semester, uniq('semester', (a, b) => a - b), v => 'Semester ' + v);
    setOptions(f.year, uniq('year', (a, b) => b - a));
    readUrl();
    render();
  }

  let timer;
  f.q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 120); });
  for (const k of ['course', 'semester']) f[k].addEventListener('change', () => { rebuildSubjects(); render(); });
  for (const k of ['subject', 'year', 'sort']) f[k].addEventListener('change', render);
  $('filters').addEventListener('submit', e => e.preventDefault());
  clearBtn.addEventListener('click', clearAll);
  load();
})();
