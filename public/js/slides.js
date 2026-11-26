(() => {
  'use strict';
  // Background slideshow of campus photos. Photos live in public/img/campus/ and are found automatically.
  // With no photos (or on any error) the page just keeps its calm dark background.
  const bg = document.getElementById('bg');
  if (!bg) return;
  const SHOW_MS = 8000;
  let urls = [], imgs = [], current = -1, timer = null;

  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

  function load(i) { // images are fetched only when needed, to spare students' mobile data
    if (imgs[i]) return imgs[i];
    const im = new Image();
    im.alt = ''; im.decoding = 'async';
    im.addEventListener('error', () => console.warn('Slideshow: could not load', urls[i]));
    im.src = urls[i];
    bg.insertBefore(im, bg.firstChild);
    return (imgs[i] = im);
  }
  function show(i) {
    const next = load(i);
    const go = () => {
      if (current >= 0 && imgs[current]) imgs[current].classList.remove('on');
      void next.offsetWidth; // restart the slow zoom
      next.classList.add('on');
      current = i;
      if (urls.length > 1) load((i + 1) % urls.length); // warm up the next one
    };
    if (next.complete) go(); else next.addEventListener('load', go, { once: true });
  }
  function start() {
    if (timer || urls.length < 2) return;
    timer = setInterval(() => show((current + 1) % urls.length), SHOW_MS);
  }
  function stop() { clearInterval(timer); timer = null; }

  fetch('/api/slides', { headers: { Accept: 'application/json' } })
    .then(r => (r.ok ? r.json() : []))
    .then(list => {
      urls = shuffle((Array.isArray(list) ? list : []).filter(u => typeof u === 'string' && u.startsWith('/img/campus/')));
      if (!urls.length) { console.info('Slideshow: no photos found in public/img/campus/'); return; }
      show(0);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) start();
    })
    .catch(() => {});

  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else if (urls.length > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) start(); });
})();
