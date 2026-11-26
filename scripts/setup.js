#!/usr/bin/env node
'use strict';
// One-time setup: asks for an admin username + password and an (optional) Google Form link,
// then writes a ready-to-use .env file. Nothing is sent anywhere.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { Writable } = require('stream');
const crypto = require('crypto');
const { hashPassword } = require('../lib/password');

const ENV_FILE = path.join(__dirname, '..', '.env');
const auto = process.env.SETUP_PASSWORD !== undefined; // non-interactive mode, for scripts / CI
const interactive = process.stdin.isTTY && process.stdout.isTTY;

if (!auto && !interactive) {
  console.error('This command needs an interactive terminal. Open a terminal window and run:  npm run setup');
  process.exit(1);
}

let muted = false;
const out = new Writable({ write(chunk, enc, cb) { if (!muted) process.stdout.write(chunk, enc); cb(); } });
const rl = interactive ? readline.createInterface({ input: process.stdin, output: out, terminal: true }) : null;
const ask = (text, hidden = false) => new Promise(resolve => {
  process.stdout.write(text);
  muted = hidden;
  rl.question('', answer => { muted = false; if (hidden) process.stdout.write('\n'); resolve(answer); });
});

const formOk = u => { try { const x = new URL(u); return x.protocol === 'https:' && x.hostname === 'docs.google.com' && x.pathname.startsWith('/forms/') && !/\/edit\b/.test(x.pathname); } catch { return false; } };

(async () => {
  console.log('\nRamjas College PYQ portal: first-time setup\n');

  if (fs.existsSync(ENV_FILE) && !(auto && process.env.SETUP_OVERWRITE === '1')) {
    if (auto) { console.error('.env already exists. Set SETUP_OVERWRITE=1 to replace it.'); process.exit(1); }
    const a = (await ask('A .env file already exists. Replace it (this also changes the admin password)? [y/N] ')).trim().toLowerCase();
    if (a !== 'y' && a !== 'yes') { console.log('Nothing changed.'); rl.close(); return; }
  }

  let user, password, formUrl;
  if (auto) {
    user = process.env.SETUP_USER || 'admin';
    password = process.env.SETUP_PASSWORD;
    formUrl = process.env.SETUP_FORM_URL || '';
    if (password.length < 12) { console.error('SETUP_PASSWORD must be at least 12 characters.'); process.exit(1); }
    if (formUrl && !formOk(formUrl)) { console.error('SETUP_FORM_URL is not a usable Google Form link.'); process.exit(1); }
  } else {
    user = (await ask('Admin username [admin]: ')).trim() || 'admin';
    if (!/^[\w.@-]{3,60}$/.test(user)) { console.error('Use 3 to 60 letters, numbers or . _ - @ in the username.'); process.exit(1); }
    for (let tries = 0; ; tries++) {
      const p1 = await ask('Admin password (at least 12 characters, typing is hidden): ', true);
      if (p1.length < 12) { console.log('Too short. Use a long phrase, e.g. four random words.'); }
      else if ((await ask('Type it again to confirm: ', true)) !== p1) { console.log('Those did not match.'); }
      else { password = p1; break; }
      if (tries >= 4) { console.error('Too many tries. Run  npm run setup  again.'); process.exit(1); }
    }
    for (;;) {
      formUrl = (await ask('Google Form link for the Grievance page (press Enter to add later): ')).trim();
      if (!formUrl || formOk(formUrl)) break;
      console.log('That is not a usable link. It must start with https://docs.google.com/forms/ (in Google Forms: Send > link icon). Not the forms.gle short link or the /edit link.');
    }
  }

  process.stdout.write('Securing your password... ');
  const hash = await hashPassword(password);
  console.log('done');

  const adminPath = '/manage-' + crypto.randomBytes(8).toString('hex');
  const env = [
    '# Created by "npm run setup". Keep this file private: never share it or put it on GitHub.',
    'NODE_ENV=production',
    'PORT=3000',
    `ADMIN_USER="${user}"`,
    `ADMIN_PASSWORD_HASH="${hash}"`,
    `GRIEVANCE_FORM_URL="${formUrl}"`,
    '# Private address of the admin page. It is not linked anywhere on the site, so keep it to yourself.',
    `ADMIN_PATH=${adminPath}`,
    '',
    '# On a hosting service, point this at the persistent disk so papers survive restarts, e.g. DATA_DIR=/var/data',
    '# DATA_DIR=./data',
    '',
  ].join('\n');
  fs.writeFileSync(ENV_FILE, env, { mode: 0o600 });

  console.log('\nAll set. Next steps:');
  console.log('  Try it on this computer:   npm run dev     then open http://localhost:3000');
  console.log('  Run it for real:           npm start');
  console.log(`  Admin page (private):      ${adminPath}  (sign in with the username and password you just chose)\n`);
  if (rl) rl.close();
})().catch(e => { console.error('Setup failed:', e.message); process.exit(1); });
