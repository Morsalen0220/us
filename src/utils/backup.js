import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../config.js';
import { db } from '../db/database.js';

export const BACKUPS_DIR = path.join(DATA_DIR, 'backups');
fs.mkdirSync(BACKUPS_DIR, { recursive: true });

export function createDatabaseBackup(label = 'auto') {
  const safeLabel = String(label || 'auto').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 24) || 'auto';
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `techhaven-${stamp}-${safeLabel}.db`;
  const destPath = path.join(BACKUPS_DIR, filename);

  try {
    const escapedPath = destPath.replace(/'/g, "''");
    db.exec(`VACUUM INTO '${escapedPath}'`);
  } catch {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    fs.copyFileSync(path.join(DATA_DIR, 'techhaven.db'), destPath);
  }

  pruneOldBackups(10);
  const stat = fs.statSync(destPath);
  return {
    filename,
    size: stat.size,
    createdAt: stat.mtime.toISOString()
  };
}

export function listBackups() {
  if (!fs.existsSync(BACKUPS_DIR)) return [];
  return fs
    .readdirSync(BACKUPS_DIR)
    .filter((name) => name.endsWith('.db'))
    .map((name) => {
      const stat = fs.statSync(path.join(BACKUPS_DIR, name));
      return {
        filename: name,
        size: stat.size,
        createdAt: stat.mtime.toISOString()
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getBackupPath(filename) {
  const safeName = path.basename(String(filename || ''));
  if (!safeName.endsWith('.db')) return null;
  const target = path.join(BACKUPS_DIR, safeName);
  return fs.existsSync(target) ? target : null;
}

function pruneOldBackups(keepCount = 10) {
  const files = listBackups();
  if (files.length <= keepCount) return;
  for (const old of files.slice(keepCount)) {
    const target = path.join(BACKUPS_DIR, path.basename(old.filename));
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }
}

let schedulerTimer = null;

export function startDailyBackupScheduler() {
  if (schedulerTimer) return;
  const existing = listBackups();
  const latest = existing[0];
  const ageMs = latest ? Date.now() - new Date(latest.createdAt).getTime() : Infinity;
  if (ageMs > 24 * 60 * 60 * 1000) {
    try {
      createDatabaseBackup('daily');
    } catch {
      // Ignore startup backup failures cleanly
    }
  }

  schedulerTimer = setInterval(() => {
    try {
      createDatabaseBackup('daily');
    } catch {
      // Logged elsewhere if needed
    }
  }, 24 * 60 * 60 * 1000);
  schedulerTimer.unref();
}
