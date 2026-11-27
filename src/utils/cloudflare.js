import { db, getAllSettings } from '../db/database.js';
import { SITE_URL } from '../config.js';
import { notifySearchEngines } from './indexer.js';
import { slugify } from './seo.js';

const CF_MAX_FILES_PER_CALL = 30;

export function getCloudflareConfig(overrideSettings = null) {
  const settings = overrideSettings || getAllSettings();
  const zoneId = String(settings.cf_zone_id || process.env.CF_ZONE_ID || '').trim();
  const apiToken = String(settings.cf_api_token || process.env.CF_API_TOKEN || '').trim();
  const autoPurge = settings.cf_auto_purge !== '0';
  const baseUrl = String(settings.site_url || SITE_URL || 'https://techhavenus.com').trim().replace(/\/+$/, '');
  return {
    zoneId,
    apiToken,
    autoPurge,
    baseUrl,
    configured: Boolean(zoneId && apiToken)
  };
}

export async function purgeCloudflareUrls(urls = [], overrideConfig = null) {
  const cfg = overrideConfig || getCloudflareConfig();
  if (!cfg.zoneId || !cfg.apiToken) {
    return { ok: false, skipped: true, purgedCount: 0, error: 'Cloudflare Zone ID or API Token is not configured.' };
  }

  const uniqueUrls = Array.from(
    new Set(
      urls
        .map((u) => String(u || '').trim())
        .filter((u) => /^https?:\/\//i.test(u))
    )
  );

  if (uniqueUrls.length === 0) {
    return { ok: true, purgedCount: 0, urls: [] };
  }

  let purgedCount = 0;
  for (let i = 0; i < uniqueUrls.length; i += CF_MAX_FILES_PER_CALL) {
    const batch = uniqueUrls.slice(i, i + CF_MAX_FILES_PER_CALL);
    try {
      const res = await fetch(`https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(cfg.zoneId)}/purge_cache`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${cfg.apiToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ files: batch }),
        signal: AbortSignal.timeout(10_000)
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const errMsg = data?.errors?.[0]?.message || `Cloudflare HTTP ${res.status}`;
        return { ok: false, purgedCount, error: errMsg, urls: uniqueUrls };
      }
      purgedCount += batch.length;
    } catch (err) {
      return { ok: false, purgedCount, error: err.message || 'Cloudflare request failed', urls: uniqueUrls };
    }
  }

  return { ok: true, purgedCount, urls: uniqueUrls };
}

export function collectUrlsForPostRecord(post, baseUrl) {
  const base = String(baseUrl || 'https://techhavenus.com').replace(/\/+$/, '');
  const urls = [
    `${base}/`,
    `${base}/?page=1`,
    `${base}/sitemap.xml`,
    `${base}/rss.xml`,
    `${base}/llms.txt`
  ];

  if (!post) return urls;

  if (post.slug) {
    urls.push(`${base}/article/${post.slug}`);
    urls.push(`${base}/og/${post.slug}.png`);
  }

  if (post.category_id) {
    const cat = db.prepare('SELECT slug FROM categories WHERE id = ? LIMIT 1').get(post.category_id);
    if (cat?.slug) {
      urls.push(`${base}/category/${cat.slug}`);
    }
  }

  if (post.author_id) {
    const author = db.prepare('SELECT slug FROM users WHERE id = ? LIMIT 1').get(post.author_id);
    if (author?.slug) {
      urls.push(`${base}/author/${author.slug}`);
    }
  }

  if (post.video_url) {
    urls.push(`${base}/videos`);
  }

  if (post.meta_tags) {
    const tagSlugs = String(post.meta_tags)
      .split(',')
      .map((t) => slugify(t.trim()))
      .filter(Boolean)
      .slice(0, 5);
    for (const ts of tagSlugs) {
      urls.push(`${base}/tag/${ts}`);
    }
  }

  return urls;
}

export function triggerSelectivePostPurge({ postId = null, oldPost = null } = {}) {
  try {
    const cfg = getCloudflareConfig();
    const currentPost = postId ? db.prepare('SELECT * FROM posts WHERE id = ? LIMIT 1').get(postId) : null;
    const wasPublished = Boolean(oldPost && oldPost.status === 'published');
    const isPublished = Boolean(currentPost && currentPost.status === 'published');
    if (!wasPublished && !isPublished) return;

    const currentUrls = isPublished ? collectUrlsForPostRecord(currentPost, cfg.baseUrl) : [];
    const oldUrls = wasPublished ? collectUrlsForPostRecord(oldPost, cfg.baseUrl) : [];
    const allPurgeUrls = [...currentUrls, ...oldUrls];
    const indexUrls = isPublished ? currentUrls : oldUrls;

    const runIndexing = () => {
      notifySearchEngines(indexUrls, cfg.baseUrl).catch((err) => {
        console.warn('[Auto Indexing Warning]', err?.message || err);
      });
    };

    if (cfg.configured && cfg.autoPurge) {
      purgeCloudflareUrls(allPurgeUrls, cfg)
        .catch((err) => {
          console.warn('[Cloudflare Purge Warning]', err?.message || err);
        })
        .finally(runIndexing);
    } else {
      runIndexing();
    }
  } catch (err) {
    console.warn('[Cloudflare/Indexing Trigger Error]', err?.message || err);
  }
}

export function triggerSelectiveSectionPurge(paths = ['/']) {
  try {
    const cfg = getCloudflareConfig();
    const base = cfg.baseUrl;
    const urls = [
      `${base}/`,
      `${base}/sitemap.xml`,
      `${base}/rss.xml`,
      ...paths.map((p) => (p.startsWith('http') ? p : `${base}${p.startsWith('/') ? p : `/${p}`}`))
    ];

    const runIndexing = () => {
      notifySearchEngines(urls, base).catch((err) => {
        console.warn('[Auto Section Indexing Warning]', err?.message || err);
      });
    };

    if (cfg.configured && cfg.autoPurge) {
      purgeCloudflareUrls(urls, cfg)
        .catch((err) => {
          console.warn('[Cloudflare Section Purge Warning]', err?.message || err);
        })
        .finally(runIndexing);
    } else {
      runIndexing();
    }
  } catch (err) {
    console.warn('[Cloudflare Section Trigger Error]', err?.message || err);
  }
}
