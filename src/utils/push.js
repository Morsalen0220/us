import * as webPush from 'web-push';
import { db, getAllSettings, setSetting } from '../db/database.js';

export function ensureVapidKeys() {
  const settings = getAllSettings();
  let publicKey = String(settings.vapid_public_key || '').trim();
  let privateKey = String(settings.vapid_private_key || '').trim();
  const subject = String(settings.vapid_subject || `mailto:${settings.contact_email || 'contact@techhavenus.com'}`).trim();

  if (!publicKey || !privateKey) {
    const keys = webPush.generateVAPIDKeys();
    publicKey = keys.publicKey;
    privateKey = keys.privateKey;
    setSetting('vapid_public_key', publicKey);
    setSetting('vapid_private_key', privateKey);
    if (!settings.vapid_subject) {
      setSetting('vapid_subject', subject);
    }
  }

  return { publicKey, privateKey, subject };
}

export async function sendBreakingPushNotification({ title, body, url = '/', createdBy = null }) {
  const { publicKey, privateKey, subject } = ensureVapidKeys();
  webPush.setVapidDetails(subject, publicKey, privateKey);

  const subscriptions = db.prepare('SELECT * FROM push_subscriptions').all();
  const payload = JSON.stringify({
    title: String(title || 'TechHaven US Breaking News').slice(0, 120),
    body: String(body || 'Tap to read the latest US & Europe tech briefing.').slice(0, 220),
    url: String(url || '/')
  });

  let sent = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webPush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          },
          payload
        );
        sent += 1;
      } catch (err) {
        failed += 1;
        if (err && (err.statusCode === 404 || err.statusCode === 410)) {
          db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(sub.id);
        }
      }
    })
  );

  db.prepare(`
    INSERT INTO push_campaigns (title, body, url, sent_count, failed_count, created_by)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(title, body, url, sent, failed, createdBy);

  return { sent, failed, total: subscriptions.length };
}
