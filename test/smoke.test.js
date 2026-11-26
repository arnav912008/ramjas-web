'use strict';
// Boots the real server on a temporary folder and checks the main behaviours and security rules.
// Run with:  npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { hashPassword } = require('../lib/password');

const PORT = 3900 + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
const ADMIN = '/manage-testpath12345';
const PASSWORD = 'a-long-test-passphrase';
let proc, dataDir, cookie = '';
const H = { 'X-Requested-With': 'pyq' };
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);

function form(fields, file, name = 'paper.pdf') {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  if (file) fd.append('file', new Blob([file]), name);
  return fd;
}
const good = { course: 'B.Sc. Physics (Hons)', semester: '3', paperName: 'Mechanics', year: '2023' };
const upload = (fields, file, name, headers = H) =>
  fetch(BASE + '/api/admin/papers', { method: 'POST', headers: { ...headers, cookie }, body: form(fields, file, name) });

test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyq-test-'));
  proc = spawn(process.execPath, ['server.js', '--dev'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATA_DIR: dataDir, ADMIN_USER: 'admin', ADMIN_PATH: ADMIN,
      ADMIN_PASSWORD_HASH: await hashPassword(PASSWORD),
      GRIEVANCE_FORM_URL: 'https://docs.google.com/forms/d/e/TESTID/viewform' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = ''; proc.stderr.on('data', d => (log += d));
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE + '/healthz')).ok) return; } catch {}
    await new Promise(r => setTimeout(r, 100));
    if (proc.exitCode !== null) throw new Error('Server exited: ' + log);
  }
  throw new Error('Server did not start: ' + log);
});
test.after(() => { proc?.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); });

test('pages load and private files are not exposed', async () => {
  for (const p of ['/', '/grievance', ADMIN, '/css/style.css', '/js/slides.js', '/api/slides', '/js/app.js', '/img/logo.webp', '/favicon.ico', '/healthz'])
    assert.equal((await fetch(BASE + p)).status, 200, p);
  for (const p of ['/admin', '/admin.html', '/private/admin.html', '/server.js', '/package.json', '/.env', '/lib/password.js', '/data/pyq.db', '/node_modules/express/package.json', '/%2e%2e/server.js', '/files/abc', '/files/999'])
    assert.equal((await fetch(BASE + p)).status, 404, p);
  const nf = await fetch(BASE + '/no-such-page');
  assert.equal(nf.status, 404); assert.match(await nf.text(), /Page not found/);
  assert.equal((await fetch(BASE + '/api/nope')).headers.get('content-type').includes('json'), true);
});

test('admin link is hidden from every public page', async () => {
  for (const p of ['/', '/grievance', '/no-such-page']) {
    const html = await (await fetch(BASE + p)).text();
    assert.doesNotMatch(html, /href="\/admin|manage-|>Admin</i, p);
  }
});

test('security headers are present', async () => {
  const r = await fetch(BASE + '/');
  const csp = r.headers.get('content-security-policy');
  assert.match(csp, /default-src 'self'/); assert.match(csp, /script-src 'self'/); assert.match(csp, /frame-ancestors 'none'/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('x-powered-by'), null);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  assert.match((await fetch(BASE + ADMIN)).headers.get('x-robots-tag'), /noindex/);
});

test('admin API refuses anonymous and cross-site requests', async () => {
  assert.equal((await (await fetch(BASE + '/api/admin/me')).json()).signedIn, false);
  assert.equal((await upload(good, PDF)).status, 401);
  assert.equal((await fetch(BASE + '/api/admin/papers/1', { method: 'DELETE', headers: H })).status, 401);
  const noHeader = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PASSWORD }) });
  assert.equal(noHeader.status, 403, 'login without the custom header');
  const cross = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { ...H, 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PASSWORD }) });
  assert.equal(cross.status, 403, 'login marked cross-site by the browser');
});

test('login, session cookie flags, and upload validation', async () => {
  const bad = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'wrong' }) });
  assert.equal(bad.status, 401);
  const ok = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PASSWORD }) });
  assert.equal(ok.status, 200);
  const sc = ok.headers.get('set-cookie');
  assert.match(sc, /HttpOnly/i); assert.match(sc, /SameSite=Strict/i);
  cookie = sc.split(';')[0];
  assert.equal((await (await fetch(BASE + '/api/admin/me', { headers: { cookie } })).json()).signedIn, true);

  assert.equal((await upload(good, PDF, 'x.pdf', {})).status, 403, 'upload without CSRF header');
  assert.equal((await upload(good, Buffer.from('<script>alert(1)</script>'), 'evil.pdf')).status, 400, 'HTML disguised as PDF');
  assert.equal((await upload(good, Buffer.from('MZ\x90\x00exe'), 'a.png')).status, 400, 'exe disguised as PNG');
  assert.equal((await upload({ ...good, course: '<img src=x onerror=alert(1)>' }, PDF)).status, 400, 'markup in text field');
  assert.equal((await upload({ ...good, semester: '9' }, PDF)).status, 400, 'semester out of range');
  assert.equal((await upload({ ...good, year: '1999' }, PDF)).status, 400, 'year out of range');
  assert.equal((await upload({ ...good, extra: 'x' }, PDF)).status, 400, 'unexpected field');
  assert.equal((await upload(good, null)).status, 400, 'no file');
  const big = Buffer.concat([PDF, Buffer.alloc(16 * 1024 * 1024)]);
  const tooBig = await upload(good, big);
  assert.equal(tooBig.status, 400); assert.match((await tooBig.json()).error, /too large/i);

  assert.equal((await upload(good, PDF)).status, 201);
  assert.equal((await upload({ course: 'B.A. (Hons) हिन्दी', semester: '1', paperName: 'काव्य: भाग 1/2', year: '2022' }, PNG, 'scan.png')).status, 201, 'Hindi text with vowel marks');
});

test('papers are listed, filtered and served safely', async () => {
  const all = await (await fetch(BASE + '/api/papers')).json();
  assert.equal(all.length, 2);
  assert.equal((await (await fetch(BASE + '/api/papers?semester=3')).json()).length, 1);
  assert.equal((await fetch(BASE + '/api/papers?semester=abc')).status, 400);
  assert.equal((await fetch(BASE + '/api/papers?course=' + encodeURIComponent("x' OR 1=1 --"))).status, 400);
  assert.deepEqual(Object.keys(all[0]).sort(), ['course', 'id', 'kind', 'paperName', 'semester', 'size', 'year']); // no stored file names leak
  const pdf = all.find(p => p.kind === 'pdf'), png = all.find(p => p.kind === 'png');
  const f1 = await fetch(`${BASE}/files/${pdf.id}`);
  assert.equal(f1.status, 200); assert.equal(f1.headers.get('content-type'), 'application/pdf');
  assert.match(f1.headers.get('content-disposition'), /^inline/); assert.equal(f1.headers.get('x-content-type-options'), 'nosniff');
  assert.match((await fetch(`${BASE}/files/${pdf.id}?download=1`)).headers.get('content-disposition'), /^attachment/);
  const f2 = await fetch(`${BASE}/files/${png.id}`);
  assert.match(f2.headers.get('content-security-policy'), /sandbox/);
  const cfg = await (await fetch(BASE + '/api/config')).json();
  assert.match(cfg.grievanceEmbedUrl, /embedded=true/); assert.doesNotMatch(cfg.grievanceFormUrl, /embedded/);
});

test('logout really ends the session, then delete works only when signed in', async () => {
  const old = cookie;
  const out = await fetch(BASE + '/api/admin/logout', { method: 'POST', headers: { ...H, cookie } });
  assert.equal(out.status, 200);
  assert.equal((await (await fetch(BASE + '/api/admin/me', { headers: { cookie: old } })).json()).signedIn, false, 'old cookie must be dead');
  const login = await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: PASSWORD }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
  const id = (await (await fetch(BASE + '/api/papers')).json())[0].id;
  assert.equal((await fetch(`${BASE}/api/admin/papers/${id}`, { method: 'DELETE', headers: { ...H, cookie } })).status, 200);
  assert.equal((await fetch(`${BASE}/files/${id}`)).status, 404);
  assert.equal((await fetch(`${BASE}/api/admin/papers/${id}`, { method: 'DELETE', headers: { ...H, cookie } })).status, 404);
  assert.equal((await fetch(`${BASE}/api/admin/papers/abc`, { method: 'DELETE', headers: { ...H, cookie } })).status, 400);
  assert.equal(fs.readdirSync(path.join(dataDir, 'uploads')).length, 1, 'deleted file is removed from disk');
});

test('repeated wrong passwords are rate limited', async () => {
  const tries = [];
  for (let i = 0; i < 7; i++) {
    tries.push((await fetch(BASE + '/api/admin/login', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'nope' + i }) })).status);
  }
  assert.ok(tries.includes(429), 'got ' + tries.join(','));
});
