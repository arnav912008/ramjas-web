'use strict';
// Password hashing with Node's built-in scrypt: no native add-on to compile.
// Stored format:  scrypt$<log2 N>$<r>$<p>$<salt base64url>$<hash base64url>
const crypto = require('crypto');

const LOG_N = 16; // 64 MiB of memory per hash; OWASP-recommended range for scrypt
const R = 8;
const P = 1;
const KEY_LEN = 64;

function derive(password, salt, logN, r, p) {
  const N = 2 ** logN;
  return new Promise((resolve, reject) => {
    crypto.scrypt(password.normalize('NFKC'), salt, KEY_LEN, { N, r, p, maxmem: 256 * N * r }, (err, key) =>
      err ? reject(err) : resolve(key));
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await derive(password, salt, LOG_N, R, P);
  return ['scrypt', LOG_N, R, P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

function parse(stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, logN, r, p, salt, hash] = parts;
  const n = { logN: +logN, r: +r, p: +p };
  if (![n.logN, n.r, n.p].every(Number.isInteger) || n.logN < 10 || n.logN > 20 || n.r < 1 || n.r > 32 || n.p < 1 || n.p > 8) return null;
  const saltBuf = Buffer.from(salt, 'base64url');
  const hashBuf = Buffer.from(hash, 'base64url');
  if (saltBuf.length < 8 || hashBuf.length !== KEY_LEN) return null;
  return { ...n, saltBuf, hashBuf };
}

const isValidHash = stored => parse(stored) !== null;

async function verifyPassword(password, stored) {
  const h = parse(stored);
  if (!h) return false;
  const key = await derive(password, h.saltBuf, h.logN, h.r, h.p);
  return crypto.timingSafeEqual(key, h.hashBuf);
}

module.exports = { hashPassword, verifyPassword, isValidHash };
