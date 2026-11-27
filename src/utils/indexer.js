import crypto from 'node:crypto';
import { getAllSettings, setSetting } from '../db/database.js';
import { SITE_URL } from '../config.js';

export const WEBSUB_HUB_URL = 'https://pubsubhubbub.appspot.com/';
const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';

let lastIndexingReport = {
  lastRunAt: null,
  websub: null,
  indexNow: null,
  submittedUrls: []
};

export function getLastIndexingReport() {
  return lastIndexingReport;
}

export function resolveCanonicalBaseUrl(overrideSettings = null) {
  const settings = overrideSettings || getAllSettings();
  return String(settings.site_url || SITE_URL || 'https://techhavenus.com')
    .trim()
    .replace(/\/+$/, '');
}

export function ensureIndexNowKey() {
  const settings = getAllSettings();
  const existing = String(settings.indexnow_key || '').trim().toLowerCase();
  if (/^[a-f0-9]{32}$/.test(existing)) {
    return existing;
  }
  const generated = crypto.randomBytes(16).toString('hex');
  setSetting('indexnow_key', generated);
  return generated;
}

export async function pingGoogleWebSub(baseUrl = resolveCanonicalBaseUrl()) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const feedUrl = `${base}/rss.xml`;

  try {
    const parsed = new URL(feedUrl);
    if (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1') {
      return { ok: false, skipped: true, feedUrl, note: 'Skipped on localhost' };
    }
  } catch {
    return { ok: false, error: 'Invalid site URL', feedUrl };
  }

  try {
    const body = new URLSearchParams({
      'hub.mode': 'publish',
      'hub.url': feedUrl
    });
    const res = await fetch(WEBSUB_HUB_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'TechHavenUS-Publisher/2.0'
      },
      body: body.toString(),
      signal: AbortSignal.timeout(8_000)
    });

    return {
      ok: res.status >= 200 && res.status < 300,
      status: res.status,
      feedUrl
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'WebSub ping failed',
      feedUrl
    };
  }
}

export async function submitIndexNowUrls(urls = [], baseUrl = resolveCanonicalBaseUrl()) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  let host = '';
  try {
    host = new URL(base).hostname;
  } catch {
    return { ok: false, error: 'Invalid base URL' };
  }

  if (!host || host === 'localhost' || host === '127.0.0.1') {
    return { ok: false, skipped: true, note: 'Skipped on localhost' };
  }

  const key = ensureIndexNowKey();
  const keyLocation = `${base}/${key}.txt`;

  const cleanUrls = Array.from(
    new Set(
      urls
        .map((u) => String(u || '').trim())
        .filter((u) => {
          try {
            return new URL(u).hostname === host;
          } catch {
            return false;
          }
        })
        .filter((u) => !u.endsWith('.png') && !u.endsWith('.webp') && !u.includes('?page='))
    )
  ).slice(0, 50);

  if (cleanUrls.length === 0) {
    return { ok: true, count: 0, urls: [] };
  }

  try {
    const res = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'User-Agent': 'TechHavenUS-Publisher/2.0'
      },
      body: JSON.stringify({
        host,
        key,
        keyLocation,
        urlList: cleanUrls
      }),
      signal: AbortSignal.timeout(8_000)
    });

    return {
      ok: res.status === 200 || res.status === 202,
      status: res.status,
      count: cleanUrls.length,
      keyLocation,
      urls: cleanUrls
    };
  } catch (err) {
    return {
      ok: false,
      error: err?.message || 'IndexNow request failed',
      count: cleanUrls.length,
      urls: cleanUrls
    };
  }
}

export async function notifySearchEngines(urls = [], baseUrl = resolveCanonicalBaseUrl()) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  const targetUrls = urls.length > 0 ? urls : [`${base}/`, `${base}/sitemap.xml`];

  const [websubRes, indexNowRes] = await Promise.all([
    pingGoogleWebSub(base),
    submitIndexNowUrls(targetUrls, base)
  ]);

  lastIndexingReport = {
    lastRunAt: new Date().toISOString(),
    websub: websubRes,
    indexNow: indexNowRes,
    submittedUrls: indexNowRes.urls || targetUrls
  };

  return lastIndexingReport;
}
