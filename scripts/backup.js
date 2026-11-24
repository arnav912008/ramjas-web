#!/usr/bin/env node
'use strict';
// Copies the database and all uploaded papers into backups/<date-time>/ and keeps the newest 14 copies.
// Run it from a scheduled job (cron, or your host's "cron job" feature) and copy the folder somewhere safe.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));
const quiet = process.emitWarning;
process.emitWarning = (w, ...rest) => (String(w).includes('SQLite') ? undefined : quiet.call(process, w, ...rest));
const { DatabaseSync, backup } = require('node:sqlite');
process.emitWarning = quiet;

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR || path.join(root, 'backups'));
const KEEP = 14;

(async () => {
  const dbFile = path.join(DATA_DIR, 'pyq.db');
  if (!fs.existsSync(dbFile)) { console.error(`No database found at ${dbFile}. Nothing to back up.`); process.exit(1); }
  const dest = path.join(BACKUP_DIR, new Date().toISOString().replace(/[:.]/g, '-'));
  fs.mkdirSync(dest, { recursive: true });
  const db = new DatabaseSync(dbFile);
  await backup(db, path.join(dest, 'pyq.db')); // safe even while the site is running
  db.close();
  const uploads = path.join(DATA_DIR, 'uploads');
  if (fs.existsSync(uploads)) fs.cpSync(uploads, path.join(dest, 'uploads'), { recursive: true });
  const all = fs.readdirSync(BACKUP_DIR).filter(n => /^\d{4}-/.test(n)).sort();
  for (const old of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(BACKUP_DIR, old), { recursive: true, force: true });
  console.log('Backup saved to ' + dest);
})().catch(e => { console.error('Backup failed:', e.message); process.exit(1); });
