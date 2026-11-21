import crypto from 'node:crypto';
import { SESSION_SECRET } from '../config.js';
import { db } from '../db/database.js';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const IP_WINDOW_MINUTES = 15;
const MAX_IP_FAILURES = 8;
const EMAIL_WINDOW_MINUTES = 30;
const MAX_EMAIL_FAILURES = 5;

const DUMMY_SCRYPT_HASH = hashPassword('dummy-constant-time-check-secret');

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string' || !storedHash.includes(':')) {
    return false;
  }
  const [salt, keyHex] = storedHash.split(':');
  if (!salt || !keyHex) return false;
  try {
    const derivedBuffer = crypto.scryptSync(password, salt, 64);
    const keyBuffer = Buffer.from(keyHex, 'hex');
    if (derivedBuffer.length !== keyBuffer.length) return false;
    return crypto.timingSafeEqual(derivedBuffer, keyBuffer);
  } catch {
    return false;
  }
}

export function verifyPasswordConstantTime(password, storedHash) {
  const hashToCheck = storedHash && storedHash.includes(':') ? storedHash : DUMMY_SCRYPT_HASH;
  const matched = verifyPassword(password, hashToCheck);
  return Boolean(storedHash) && matched;
}

function signPayload(encodedPayload) {
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(encodedPayload)
    .digest('base64url');
}

export function createSessionToken(user) {
  const payload = {
    uid: user.id,
    email: user.email,
    role: user.role,
    exp: Date.now() + SESSION_TTL_MS
  };
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = signPayload(encoded);
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = signPayload(encoded);
  try {
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload || !payload.uid || !payload.exp || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    try {
      out[name] = decodeURIComponent(val);
    } catch {
      out[name] = val;
    }
  }
  return out;
}

export function createCsrfToken(sessionToken) {
  const base = sessionToken || 'anon';
  return crypto
    .createHmac('sha256', SESSION_SECRET)
    .update(`csrf:${base}`)
    .digest('base64url');
}

export function verifyCsrfToken(sessionToken, candidateToken) {
  if (!sessionToken || !candidateToken || typeof candidateToken !== 'string') return false;
  const expected = createCsrfToken(sessionToken);
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(candidateToken);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function secondsUntilReset(oldestIso, windowMinutes) {
  if (!oldestIso) return windowMinutes * 60;
  const oldestMs = new Date(`${oldestIso}Z`).getTime();
  if (Number.isNaN(oldestMs)) return windowMinutes * 60;
  const unlockAt = oldestMs + windowMinutes * 60 * 1000;
  return Math.max(1, Math.ceil((unlockAt - Date.now()) / 1000));
}

export function checkLoginRateLimit(ip = 'unknown', email = '') {
  const cleanIp = String(ip || 'unknown').slice(0, 80);
  const cleanEmail = String(email || '').trim().toLowerCase().slice(0, 160);

  const lastIpSuccess = db.prepare(`
    SELECT created_at FROM login_attempts
    WHERE ip = ? AND success = 1
    ORDER BY id DESC LIMIT 1
  `).get(cleanIp);
  const ipCutoff = lastIpSuccess?.created_at || '1970-01-01 00:00:00';

  const ipFails = db.prepare(`
    SELECT COUNT(*) AS cnt, MIN(created_at) AS oldest
    FROM login_attempts
    WHERE ip = ? AND success = 0
      AND datetime(created_at) >= datetime('now', ?)
      AND created_at > ?
  `).get(cleanIp, `-${IP_WINDOW_MINUTES} minutes`, ipCutoff);

  if (ipFails && ipFails.cnt >= MAX_IP_FAILURES) {
    return {
      allowed: false,
      reason: 'ip',
      recentFails: ipFails.cnt,
      remainingAttempts: 0,
      retryAfterSec: secondsUntilReset(ipFails.oldest, IP_WINDOW_MINUTES)
    };
  }

  let emailCount = 0;
  if (cleanEmail) {
    const lastEmailSuccess = db.prepare(`
      SELECT created_at FROM login_attempts
      WHERE lower(email) = ? AND success = 1
      ORDER BY id DESC LIMIT 1
    `).get(cleanEmail);
    const emailCutoff = lastEmailSuccess?.created_at || '1970-01-01 00:00:00';

    const emailFails = db.prepare(`
      SELECT COUNT(*) AS cnt, MIN(created_at) AS oldest
      FROM login_attempts
      WHERE lower(email) = ? AND success = 0
        AND datetime(created_at) >= datetime('now', ?)
        AND created_at > ?
    `).get(cleanEmail, `-${EMAIL_WINDOW_MINUTES} minutes`, emailCutoff);

    emailCount = emailFails?.cnt || 0;
    if (emailCount >= MAX_EMAIL_FAILURES) {
      return {
        allowed: false,
        reason: 'account',
        recentFails: emailCount,
        remainingAttempts: 0,
        retryAfterSec: secondsUntilReset(emailFails.oldest, EMAIL_WINDOW_MINUTES)
      };
    }
  }

  const remainingByIp = MAX_IP_FAILURES - (ipFails?.cnt || 0);
  const remainingByEmail = cleanEmail ? MAX_EMAIL_FAILURES - emailCount : remainingByIp;
  return {
    allowed: true,
    recentFails: Math.max(ipFails?.cnt || 0, emailCount),
    remainingAttempts: Math.max(0, Math.min(remainingByIp, remainingByEmail))
  };
}

export function recordLoginAttempt({ ip = 'unknown', email = '', success = false, userAgent = '' }) {
  db.prepare(`
    INSERT INTO login_attempts (ip, email, success, user_agent)
    VALUES (?, ?, ?, ?)
  `).run(
    String(ip || 'unknown').slice(0, 80),
    String(email || '').trim().toLowerCase().slice(0, 160),
    success ? 1 : 0,
    String(userAgent || '').slice(0, 240)
  );
  db.prepare("DELETE FROM login_attempts WHERE datetime(created_at) < datetime('now', '-30 days')").run();
}

export function getBackoffDelayMs(recentFails = 0) {
  if (recentFails <= 1) return 0;
  return Math.min(2500, 300 * 2 ** (recentFails - 2));
}

export function clearLoginLockouts(ip = null, email = null) {
  if (ip && email) {
    db.prepare('DELETE FROM login_attempts WHERE success = 0 AND (ip = ? OR lower(email) = ?)').run(ip, email.toLowerCase());
  } else {
    db.prepare('DELETE FROM login_attempts WHERE success = 0').run();
  }
}
