import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const ROOT_DIR = path.resolve(__dirname, '..');

function loadEnvFile() {
  const envPath = path.join(ROOT_DIR, '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eqIndex = line.indexOf('=');
    if (eqIndex <= 0) continue;
    const key = line.slice(0, eqIndex).trim();
    let val = line.slice(eqIndex + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = val;
    }
  }
}

loadEnvFile();

function resolveDir(envVal, defaultPath) {
  const trimmed = String(envVal || '').trim();
  return trimmed ? path.resolve(ROOT_DIR, trimmed) : defaultPath;
}

export const DATA_DIR = resolveDir(process.env.DATA_DIR, path.join(ROOT_DIR, 'data'));
export const UPLOAD_DIR = resolveDir(process.env.UPLOAD_DIR, path.join(ROOT_DIR, 'public', 'uploads'));
export const VIEWS_DIR = path.join(ROOT_DIR, 'views');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function resolveSessionSecret() {
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    return process.env.SESSION_SECRET;
  }
  const secretPath = path.join(DATA_DIR, '.secret');
  if (fs.existsSync(secretPath)) {
    return fs.readFileSync(secretPath, 'utf8').trim();
  }
  const generated = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(secretPath, generated, { encoding: 'utf8', mode: 0o600 });
  return generated;
}

function resolveListenTarget() {
  const raw = String(process.env.SOCKET || process.env.PORT || '3000').trim();
  if (/^\d+$/.test(raw)) {
    return Number.parseInt(raw, 10);
  }
  return raw;
}

export const LISTEN_TARGET = resolveListenTarget();
export const PORT = LISTEN_TARGET;
export const NODE_ENV = process.env.NODE_ENV || 'development';
export const SITE_URL = (process.env.SITE_URL || 'https://techhavenus.com').replace(/\/+$/, '');
export const SESSION_SECRET = resolveSessionSecret();
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@techhavenus.com';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'TechHaven@2026!';
