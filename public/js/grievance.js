(async () => {
  'use strict';
  const box = document.getElementById('box');
  function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

  function unavailable(text) {
    const s = el('div', 'state');
    s.append(el('h2', '', 'The form is not available right now'), el('p', '', text));
    box.replaceChildren(s);
  }

  let cfg;
  try {
    const r = await fetch('/api/config', { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error();
    cfg = await r.json();
  } catch { return unavailable('Check your internet connection and reload this page.'); }
  if (!cfg.grievanceEmbedUrl) return unavailable('Please try again later or contact the college office.');

  // Forms are long and fiddly on phones, so a full-page option comes first.
  const note = el('div', 'form-note');
  note.append(el('p', '', 'If the form below does not load, or you are on a phone, open it on its own page.'));
  const open = el('a', 'btn', 'Open Google Form');
  open.href = cfg.grievanceFormUrl; open.target = '_blank'; open.rel = 'noopener noreferrer';
  note.append(open);

  const frame = el('div', 'form-frame');
  const loading = el('div', 'loading', 'Loading the form…');
  const iframe = el('iframe', 'form');
  iframe.title = 'Student grievance form'; iframe.loading = 'lazy'; iframe.referrerPolicy = 'no-referrer';
  iframe.addEventListener('load', () => loading.remove());
  iframe.src = cfg.grievanceEmbedUrl;
  frame.append(loading, iframe);
  box.replaceChildren(note, frame);
})();
