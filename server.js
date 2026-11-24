'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Load .env if present. Real environment variables (e.g. set in your host's dashboard) always win.
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { z } = require('zod');
// Node's built-in SQLite: nothing to compile or download, so installs cannot fail on this.
const quiet = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : quiet.call(process, w, ...rest));
const { DatabaseSync } = require('node:sqlite');
process.emitWarning = quiet;
const { verifyPassword, isValidHash } = require('./lib/password');

function fail(message) {
  console.error('\n' + message + '\n');
  process.exit(1);
}

// ---------- Configuration: stop with a plain-English message if anything is missing ----------
const DEV = process.argv.includes('--dev');
const PROD = process.env.NODE_ENV === 'production' && !DEV;
const { ADMIN_USER, ADMIN_PASSWORD_HASH } = process.env;

if (!ADMIN_USER || !ADMIN_PASSWORD_HASH) {
  fail('The admin login has not been set up yet.\nRun this once, then start again:\n\n    npm run setup');
}
if (!isValidHash(ADMIN_PASSWORD_HASH)) {
  fail('ADMIN_PASSWORD_HASH is not in the expected format (older versions used a different one).\nRun  npm run setup  to create a new admin password.');
}

const PORT = Number(process.env.PORT || 3000);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) fail('PORT must be a number between 1 and 65535.');
const TRUST_PROXY = Number(process.env.TRUST_PROXY ?? 1); // number of proxies between the internet and this app

function normaliseFormUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.hostname !== 'docs.google.com' || !u.pathname.startsWith('/forms/')) return null;
    if (/\/edit\b/.test(u.pathname)) return null; // the editor link only works for the form owner
    const open = new URL(u); open.searchParams.delete('embedded');
    const embed = new URL(u); embed.searchParams.set('embedded', 'true');
    return { open: open.toString(), embed: embed.toString() };
  } catch { return null; }
}
let grievance = null;
if (process.env.GRIEVANCE_FORM_URL) {
  grievance = normaliseFormUrl(process.env.GRIEVANCE_FORM_URL);
  if (!grievance) console.warn('Warning: GRIEVANCE_FORM_URL is not a usable Google Form link, so the Grievance page will show "not available".\n' +
    '         In Google Forms click Send, choose the link tab, and paste the long https://docs.google.com/forms/... address (not forms.gle, not the /edit link).');
}

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, 'data'));
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads'); // outside /public: never served statically
const PUBLIC_DIR = path.join(__dirname, 'public');
try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o750 });
  fs.accessSync(UPLOAD_DIR, fs.constants.W_OK);
} catch (e) {
  fail(`Cannot write to the data folder (${DATA_DIR}): ${e.message}\nSet DATA_DIR in .env to a folder this app is allowed to write to.`);
}
if (!fs.existsSync(path.join(PUBLIC_DIR, 'index.html'))) fail(`Missing ${PUBLIC_DIR}/index.html: the website files should sit in a "public" folder next to server.js.`);

// ---------- Database (parameterised statements only) ----------
const db = new DatabaseSync(path.join(DATA_DIR, 'pyq.db'));
db.exec(`
  PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS papers(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    course TEXT NOT NULL, semester INTEGER NOT NULL CHECK(semester BETWEEN 1 AND 8),
    paper_name TEXT NOT NULL, year INTEGER NOT NULL,
    stored_name TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, size INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
  CREATE INDEX IF NOT EXISTS idx_papers_course_sem ON papers(course, semester);
  CREATE TABLE IF NOT EXISTS sessions(
    token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);`);
const q = {
  list: db.prepare(`SELECT id,course,semester,paper_name AS paperName,year,kind,size FROM papers
    WHERE (@course IS NULL OR course=@course) AND (@semester IS NULL OR semester=@semester)
    ORDER BY course,semester,paper_name,year DESC`),
  courses: db.prepare('SELECT DISTINCT course FROM papers ORDER BY course'),
  get: db.prepare('SELECT * FROM papers WHERE id=?'),
  insert: db.prepare(`INSERT INTO papers(course,semester,paper_name,year,stored_name,kind,size)
    VALUES(@course,@semester,@paperName,@year,@storedName,@kind,@size)`),
  del: db.prepare('DELETE FROM papers WHERE id=?'),
  addSession: db.prepare('INSERT INTO sessions(token_hash,expires_at) VALUES(?,?)'),
  findSession: db.prepare('SELECT 1 FROM sessions WHERE token_hash=? AND expires_at>?'),
  delSession: db.prepare('DELETE FROM sessions WHERE token_hash=?'),
  purgeSessions: db.prepare('DELETE FROM sessions WHERE expires_at<=?'),
};
q.purgeSessions.run(Date.now());
setInterval(() => q.purgeSessions.run(Date.now()), 60 * 60_000).unref();

// ---------- App + network hardening ----------
const app = express();
app.disable('x-powered-by');
if (PROD) {
  app.set('trust proxy', TRUST_PROXY);
  // Send plain-HTTP visitors to HTTPS. Skipped for /healthz and for direct (non-proxied) requests.
  app.use((req, res, next) => {
    if (req.secure || !req.get('x-forwarded-proto') || req.path === '/healthz') return next();
    const host = req.get('host') || '';
    if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return res.status(400).send('Bad request');
    res.redirect(301, 'https://' + host + req.originalUrl);
  });
}
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"], fontSrc: ["'self'"],
    imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], objectSrc: ["'none'"],
    frameSrc: ['https://docs.google.com'], baseUri: ["'self'"], formAction: ["'self'"],
    frameAncestors: ["'none'"], upgradeInsecureRequests: PROD ? [] : null,
  } },
  hsts: { maxAge: 31536000, includeSubDomains: false },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
}));
app.use((req, res, next) => { res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()'); next(); });
// CORS is intentionally NOT enabled: site and API are same-origin, so other websites cannot read responses.
app.use(express.json({ limit: '10kb' }));

const limiter = (windowMs, limit, message, extra = {}) =>
  rateLimit({ windowMs, limit, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: message }, ...extra });
// Limits are per visitor IP. Generous on reads because a whole campus can share one IP.
app.use('/api/', limiter(60_000, 600, 'Too many requests. Please slow down.'));
const filesLimiter = limiter(60_000, 600, 'Too many requests. Please slow down.');
const loginLimiter = limiter(15 * 60_000, 5, 'Too many failed attempts. Try again in 15 minutes.', { skipSuccessfulRequests: true });
const uploadLimiter = limiter(60 * 60_000, 30, 'Upload limit reached. Try again later.');

app.get('/healthz', (req, res) => { // for hosting platforms' uptime checks
  try { db.prepare('SELECT 1').get(); res.set('Cache-Control', 'no-store').json({ ok: true }); }
  catch { res.status(503).json({ ok: false }); }
});

// ---------- Validation ----------
// Letters, marks (needed for Hindi vowel signs), numbers and light punctuation only.
const textRule = /^[\p{L}\p{M}\p{N} .,&()'+:/\-]+$/u;
const clean = (min, max) => z.string().trim().min(min).max(max).regex(textRule).transform(s => s.replace(/\s+/g, ' '));
const thisYear = new Date().getFullYear();
const uploadSchema = z.strictObject({
  course: clean(2, 80), paperName: clean(2, 120),
  semester: z.coerce.number().int().min(1).max(8),
  year: z.coerce.number().int().min(2000).max(thisYear + 1),
});
const listSchema = z.object({
  course: clean(2, 80).optional(),
  semester: z.coerce.number().int().min(1).max(8).optional(),
});
const idSchema = z.coerce.number().int().positive();
const loginSchema = z.object({ username: z.string().max(100), password: z.string().max(200) });

// ---------- Admin authentication: random server-side sessions ----------
// The cookie holds a random token; only its hash is stored, so a leaked database cannot be used to sign in,
// and logging out really ends the session.
const SESSION_COOKIE = 'pyq_session';
const SESSION_MS = 4 * 60 * 60_000;
const sha256 = v => crypto.createHash('sha256').update(v).digest();
const safeEq = (a, b) => crypto.timingSafeEqual(sha256(a), sha256(b));
function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}
const sessionCookie = (req, maxAge) => ({ httpOnly: true, secure: req.secure, sameSite: 'strict', path: '/', maxAge });
const isAdmin = req => {
  const t = readCookie(req, SESSION_COOKIE);
  return /^[a-f0-9]{64}$/.test(t) && !!q.findSession.get(sha256(t).toString('hex'), Date.now());
};
function requireAdmin(req, res, next) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'Not signed in' });
}
// CSRF defence in depth for everything that changes data: browser fetch-metadata says "same origin",
// plus a custom header that other websites cannot send, plus the SameSite=Strict cookie.
app.use('/api/admin', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const site = req.get('sec-fetch-site');
  if ((site && site !== 'same-origin') || req.get('x-requested-with') !== 'pyq') return res.status(403).json({ error: 'Request blocked' });
  next();
});

app.post('/api/admin/login', loginLimiter, async (req, res) => {
  const body = loginSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: 'Invalid request' });
  const userOk = safeEq(body.data.username, ADMIN_USER);
  // Always run the (slow) password check, even for a wrong username, so response time reveals nothing.
  const passOk = await verifyPassword(body.data.password, ADMIN_PASSWORD_HASH);
  if (!(userOk && passOk)) return res.status(401).json({ error: 'Wrong username or password' });
  const token = crypto.randomBytes(32).toString('hex');
  q.addSession.run(sha256(token).toString('hex'), Date.now() + SESSION_MS);
  res.cookie(SESSION_COOKIE, token, sessionCookie(req, SESSION_MS)).json({ ok: true });
});
app.post('/api/admin/logout', (req, res) => {
  const t = readCookie(req, SESSION_COOKIE);
  if (/^[a-f0-9]{64}$/.test(t)) q.delSession.run(sha256(t).toString('hex'));
  res.clearCookie(SESSION_COOKIE, sessionCookie(req, undefined)).json({ ok: true });
});
app.get('/api/admin/me', (req, res) => res.json({ signedIn: isAdmin(req) })); // 200 either way: no red error in the browser console

// ---------- Public API ----------
app.get('/api/config', (req, res) => res.json({
  grievanceFormUrl: grievance?.open || '', grievanceEmbedUrl: grievance?.embed || '',
}));
app.get('/api/courses', (req, res) => res.json(q.courses.all().map(r => r.course)));
app.get('/api/papers', (req, res) => {
  const p = listSchema.safeParse(req.query);
  if (!p.success) return res.status(400).json({ error: 'Invalid filter' });
  res.set('Cache-Control', 'no-cache').json(q.list.all({ course: p.data.course ?? null, semester: p.data.semester ?? null }));
});

// ---------- File upload: zero trust ----------
const MAGIC = [
  { kind: 'pdf', ext: 'pdf', mime: 'application/pdf', test: b => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  { kind: 'jpg', ext: 'jpg', mime: 'image/jpeg', test: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { kind: 'png', ext: 'png', mime: 'image/png', test: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
];
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024, files: 1, fields: 6, fieldSize: 1024 } });

app.post('/api/admin/papers', requireAdmin, uploadLimiter, upload.single('file'), (req, res) => {
  const f = req.file;
  const fields = uploadSchema.safeParse(req.body);
  if (!f || !fields.success) return res.status(400).json({ error: 'Check every field and attach a file' });
  const type = MAGIC.find(m => m.test(f.buffer)); // the browser's MIME type and the file's name are ignored
  if (!type) return res.status(400).json({ error: 'Only real PDF, JPG or PNG files are allowed' });
  const storedName = crypto.randomBytes(16).toString('hex') + '.' + type.ext; // server-generated name
  const target = path.join(UPLOAD_DIR, storedName);
  fs.writeFileSync(target, f.buffer, { mode: 0o640, flag: 'wx' });
  try {
    q.insert.run({ ...fields.data, storedName, kind: type.kind, size: f.size });
  } catch (e) {
    fs.rmSync(target, { force: true }); // never leave a file behind without a database record
    throw e;
  }
  res.status(201).json({ ok: true });
});

app.delete('/api/admin/papers/:id', requireAdmin, (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  if (!id.success) return res.status(400).json({ error: 'Invalid id' });
  const row = q.get.get(id.data);
  if (!row) return res.status(404).json({ error: 'Not found' });
  q.del.run(id.data);
  fs.rm(path.join(UPLOAD_DIR, row.stored_name), { force: true }, () => {});
  res.json({ ok: true });
});

// Files are served only through this route, by numeric id, never by a user-supplied path.
app.get('/files/:id', filesLimiter, (req, res) => {
  const id = idSchema.safeParse(req.params.id);
  const row = id.success && q.get.get(id.data);
  if (!row) return res.status(404).send('Not found');
  const type = MAGIC.find(m => m.kind === row.kind);
  const file = path.join(UPLOAD_DIR, row.stored_name);
  if (!type || !fs.existsSync(file)) return res.status(404).send('Not found');
  const nice = `${row.course}-sem${row.semester}-${row.paper_name}-${row.year}`.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 100) + '.' + type.ext;
  res.set({
    'Content-Type': type.mime, 'X-Content-Type-Options': 'nosniff',
    'Content-Disposition': `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${nice}"`,
    // Images are fully sandboxed. Chrome's built-in PDF viewer will not open a PDF served with "sandbox", so PDFs
    // get the lighter rule (no framing by other sites).
    'Content-Security-Policy': type.kind === 'pdf' ? "frame-ancestors 'none'" : "default-src 'none'; sandbox",
    'Cache-Control': 'public, max-age=300',
  });
  res.sendFile(file, { cacheControl: false });
});

// ---------- Website ----------
app.use(['/admin', '/admin.html'], (req, res, next) => { res.set('X-Robots-Tag', 'noindex, nofollow'); next(); });
app.use(express.static(PUBLIC_DIR, {
  dotfiles: 'ignore', index: 'index.html', extensions: ['html'], maxAge: 0,
  setHeaders(res, file) {
    if (file.endsWith('.woff2')) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    else if (/\.(webp|png|ico)$/.test(file)) res.set('Cache-Control', 'public, max-age=604800');
    else res.set('Cache-Control', 'no-cache'); // pages, CSS and JS: always revalidate, so updates show up straight away
  },
}));
app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});
app.use((err, req, res, next) => { // never leak stack traces
  if (res.headersSent) return next(err);
  if (err instanceof multer.MulterError) return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 15 MB)' : 'Upload rejected' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request' });
  if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request too large' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// ---------- Start, and shut down cleanly ----------
const server = app.listen(PORT, err => {
  if (err) return; // Express 5 also calls this on errors; the 'error' handler below reports them
  console.log(`Ramjas PYQ portal is running (${PROD ? 'production' : 'development'} mode)`);
  console.log(`  Website: http://localhost:${PORT}`);
  console.log(`  Admin:   http://localhost:${PORT}/admin`);
});
server.keepAliveTimeout = 65_000; // longer than the 60 s idle timeout of most load balancers, which prevents random 502s
server.headersTimeout = 66_000;
server.on('error', e => fail(e.code === 'EADDRINUSE'
  ? `Port ${PORT} is already in use. Close the other program, or set a different PORT in .env.`
  : `Could not start the server: ${e.message}`));

function shutdown() {
  server.close(() => { db.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('unhandledRejection', e => console.error('Unhandled rejection:', e));
