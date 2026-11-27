import express from 'express';
import { db, publishDueScheduledPosts, safeJsonParse } from '../db/database.js';
import { answerArticleQuestion } from '../utils/aiAssistant.js';
import { pageCache } from '../utils/cache.js';
import { ensureIndexNowKey, WEBSUB_HUB_URL } from '../utils/indexer.js';
import { injectMidArticleAd } from '../utils/markdown.js';
import {
  generateSubscriberTokens,
  sendDoubleOptInEmail,
  syncConfirmedSubscriber,
  unsubscribeFromProvider
} from '../utils/newsletter.js';
import { ensureVapidKeys } from '../utils/push.js';
import { buildPlatformShareLinks, generateSocialCardPng } from '../utils/social.js';
import { buildVideoObjectJsonLd, parseYouTubeUrl } from '../utils/video.js';
import {
  buildArticleJsonLd,
  buildBreadcrumbJsonLd,
  buildCollectionJsonLd,
  buildLlmsTxt,
  buildOrganizationJsonLd,
  buildProfilePageJsonLd,
  buildRobotsTxt,
  buildRssXml,
  buildSitemapXml,
  buildWebsiteJsonLd,
  serializeJsonLd
} from '../utils/seo.js';

const router = express.Router();

const BASE_POST_SELECT = `
  SELECT p.*,
         c.name AS category_name, c.slug AS category_slug, c.accent_color AS category_color,
         u.name AS author_name, u.slug AS author_slug, u.job_title AS author_job_title,
         u.expertise AS author_expertise, u.bio AS author_bio, u.avatar_url AS author_avatar, u.twitter_handle AS author_twitter,
         u.linkedin_url AS author_linkedin, u.website_url AS author_website, u.location AS author_location
  FROM posts p
  LEFT JOIN categories c ON c.id = p.category_id
  LEFT JOIN users u ON u.id = p.author_id
`;

const REGION_MAP = {
  usa: { dbValue: 'USA', name: 'USA Tech & Policy', description: 'Breaking US technology news, Silicon Valley launches, federal tech policy, and gaming updates.' },
  europe: { dbValue: 'Europe', name: 'Europe Tech & Regulation', description: 'European tech startups, Brussels AI Act rules, GDPR compliance, and EU digital markets.' },
  'usa-europe': { dbValue: 'USA & Europe', name: 'USA & Europe Coverage', description: 'Transatlantic technology, AI, gaming, and digital economy stories across North America and Europe.' },
  global: { dbValue: 'Global', name: 'Global Technology', description: 'Worldwide software, hardware, cybersecurity, and developer engineering coverage.' }
};

const CACHE_15M = 15 * 60_000;
const CACHE_20M = 20 * 60_000;
const CACHE_30M = 30 * 60_000;

function withCache(ttlMs = CACHE_20M, contentType = 'text/html; charset=utf-8') {
  return (req, res, next) => {
    publishDueScheduledPosts();
    if (req.method !== 'GET' || req.user) return next();
    const cacheKey = req.originalUrl;
    const hit = pageCache.get(cacheKey);
    if (hit !== null) {
      res.setHeader('X-Cache', 'HIT');
      res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=86400, stale-while-revalidate=3600');
      res.type(contentType);
      return res.send(hit);
    }
    const origSend = res.send.bind(res);
    res.send = (body) => {
      if (res.statusCode === 200 && typeof body === 'string') {
        pageCache.set(cacheKey, body, ttlMs);
        res.setHeader('X-Cache', 'MISS');
        res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=86400, stale-while-revalidate=3600');
      }
      return origSend(body);
    };
    next();
  };
}

function detectCountryAndRegion(req) {
  const cfCountry = String(req.headers['cf-ipcountry'] || req.headers['x-vercel-ip-country'] || '').trim().toUpperCase();
  let country = cfCountry;
  if (!country || country === 'XX') {
    const lang = String(req.headers['accept-language'] || '').toLowerCase();
    if (lang.includes('en-gb') || lang.includes('de') || lang.includes('fr') || lang.includes('es') || lang.includes('nl')) {
      country = 'EU';
    } else {
      country = 'US';
    }
  }
  const euSet = new Set(['GB', 'UK', 'DE', 'FR', 'NL', 'ES', 'IT', 'PL', 'SE', 'NO', 'DK', 'FI', 'IE', 'BE', 'AT', 'CH', 'PT', 'EU']);
  let regionBucket = 'Global';
  if (country === 'US' || country === 'CA') regionBucket = 'USA';
  else if (euSet.has(country)) regionBucket = 'Europe';
  return { country, regionBucket };
}

function recordPageView(req, postId = null) {
  try {
    const { country, regionBucket } = detectCountryAndRegion(req);
    const ref = String(req.headers.referer || '').slice(0, 240);
    db.prepare(`
      INSERT INTO page_views (path, post_id, country_code, region_bucket, referrer)
      VALUES (?, ?, ?, ?, ?)
    `).run(req.path.slice(0, 200), postId, country, regionBucket, ref);
  } catch {
    // Non-blocking analytics
  }
}

function getTrendingPosts(limit = 8) {
  return db.prepare(`
    ${BASE_POST_SELECT}
    WHERE p.status = 'published'
    ORDER BY p.is_trending DESC, p.views DESC, p.published_at DESC
    LIMIT ?
  `).all(limit);
}

function getPopularTags(limit = 16) {
  return db.prepare(`
    SELECT t.id, t.name, t.slug, COUNT(pt.post_id) AS post_count
    FROM tags t
    JOIN post_tags pt ON pt.tag_id = t.id
    JOIN posts p ON p.id = pt.post_id AND p.status = 'published'
    GROUP BY t.id
    ORDER BY post_count DESC, t.name ASC
    LIMIT ?
  `).all(limit);
}

function formatShortBriefDate(dateStr) {
  try {
    const dt = new Date(`${String(dateStr).slice(0, 10)}T12:00:00Z`);
    if (Number.isNaN(dt.getTime())) return dateStr;
    return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  } catch {
    return dateStr;
  }
}

function buildAutoBriefings() {
  const manualRows = db.prepare(`
    SELECT * FROM daily_briefings
    WHERE status = 'published' AND title NOT LIKE 'Daily AI & US/EU Tech Briefing — %'
    ORDER BY briefing_date DESC
    LIMIT 10
  `).all().map((b) => ({ ...b, items: safeJsonParse(b.items_json, []) }));

  const recentPosts = db.prepare(`
    SELECT p.title, p.slug, p.excerpt, p.published_at, p.created_at,
           c.name AS category_name
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'published'
    ORDER BY p.published_at DESC
    LIMIT 35
  `).all();

  if (recentPosts.length === 0) {
    return manualRows;
  }

  // Latest live edition always reflects the newest 5 published articles
  const topFive = recentPosts.slice(0, 5);
  const newestDate = String(topFive[0].published_at || topFive[0].created_at || new Date().toISOString()).slice(0, 10);
  const prettyNewestDate = formatShortBriefDate(newestDate);
  const topDesks = Array.from(new Set(topFive.map((p) => p.category_name || 'Tech').filter(Boolean))).slice(0, 3);
  const liveEdition = {
    id: 0,
    slug: `edition-${newestDate}`,
    briefing_date: newestDate,
    pretty_date: prettyNewestDate,
    title: `Daily AI & Tech Briefing — ${prettyNewestDate}`,
    summary: `2-minute executive roundup across ${topDesks.join(', ')} — featuring "${topFive[0].title}" and ${Math.max(1, topFive.length - 1)} more verified updates.`,
    items: topFive.map((p) => ({
      tag: p.category_name || 'Tech',
      headline: p.title,
      summary: p.excerpt,
      url: `/article/${p.slug}`
    }))
  };

  // Group older articles by date for archive editions
  const byDate = new Map();
  for (const p of recentPosts.slice(5)) {
    const d = String(p.published_at || p.created_at || '').slice(0, 10);
    if (!d || d === newestDate) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    if (byDate.get(d).length < 5) byDate.get(d).push(p);
  }

  const archiveAuto = [];
  for (const [d, list] of byDate.entries()) {
    if (archiveAuto.length >= 6) break;
    const pretty = formatShortBriefDate(d);
    const desks = Array.from(new Set(list.map((p) => p.category_name || 'Tech'))).slice(0, 3);
    archiveAuto.push({
      id: 0,
      slug: `edition-${d}`,
      briefing_date: d,
      pretty_date: pretty,
      title: `Daily AI & Tech Briefing — ${pretty}`,
      summary: `Key highlights across ${desks.join(', ')}: ${list[0].title}.`,
      items: list.map((p) => ({
        tag: p.category_name || 'Tech',
        headline: p.title,
        summary: p.excerpt,
        url: `/article/${p.slug}`
      }))
    });
  }

  const manualDates = new Set(manualRows.map((m) => m.briefing_date));
  const combined = [
    ...manualRows,
    ...(manualDates.has(newestDate) ? [] : [liveEdition]),
    ...archiveAuto.filter((a) => !manualDates.has(a.briefing_date))
  ].sort((a, b) => String(b.briefing_date).localeCompare(String(a.briefing_date)));

  return combined;
}

router.get('/', withCache(CACHE_20M), (req, res) => {
  setImmediate(() => recordPageView(req, null));
  const { settings, siteUrl } = res.locals;
  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
  const perPage = 8;
  const offset = (page - 1) * perPage;

  const featuredPosts = db.prepare(`
    ${BASE_POST_SELECT}
    WHERE p.status = 'published'
    ORDER BY p.is_featured DESC, p.published_at DESC
    LIMIT 4
  `).all();

  const totalRow = db.prepare("SELECT COUNT(*) AS count FROM posts WHERE status = 'published'").get();
  const totalPosts = totalRow ? totalRow.count : 0;
  const totalPages = Math.max(1, Math.ceil(totalPosts / perPage));

  const latestPosts = db.prepare(`
    ${BASE_POST_SELECT}
    WHERE p.status = 'published'
    ORDER BY p.published_at DESC
    LIMIT ? OFFSET ?
  `).all(perPage, offset);

  const trendingPosts = getTrendingPosts(8);
  const popularTags = getPopularTags(14);

  const aiTodayPosts = db.prepare(`
    ${BASE_POST_SELECT}
    WHERE p.status = 'published' AND c.slug = 'ai'
    ORDER BY p.published_at DESC
    LIMIT 4
  `).all();

  const editorsPicks = db.prepare(`
    ${BASE_POST_SELECT}
    WHERE p.status = 'published' AND p.is_editors_pick = 1
    ORDER BY p.published_at DESC
    LIMIT 4
  `).all();

  const reviewsPosts = db.prepare(`
    ${BASE_POST_SELECT}
    WHERE p.status = 'published' AND c.slug = 'reviews-comparisons'
    ORDER BY p.published_at DESC
    LIMIT 3
  `).all();

  const howToGuides = db.prepare(`
    ${BASE_POST_SELECT}
    WHERE p.status = 'published' AND c.slug = 'how-to'
    ORDER BY p.published_at DESC
    LIMIT 3
  `).all();

  const latestBriefing = buildAutoBriefings()[0] || null;

  const featuredTools = db.prepare(`
    SELECT * FROM ai_tools ORDER BY is_featured DESC, rating DESC LIMIT 4
  `).all();

  const videoPosts = db.prepare(`
    ${BASE_POST_SELECT}
    WHERE p.status = 'published' AND p.video_url != ''
    ORDER BY p.published_at DESC
    LIMIT 4
  `).all().map((vp) => ({ ...vp, videoInfo: parseYouTubeUrl(vp.video_url) })).filter((vp) => vp.videoInfo);

  const pageTitle = page > 1
    ? `${settings.site_name || 'TechHaven US'} — Page ${page} | US & Europe Tech, AI & Gaming`
    : `${settings.site_name || 'TechHaven US'} — ${settings.site_tagline || 'US & Europe Tech, AI & Gaming News'}`;

  res.render('public/index', {
    featuredPosts,
    latestPosts,
    trendingPosts,
    aiTodayPosts,
    editorsPicks,
    reviewsPosts,
    howToGuides,
    latestBriefing,
    featuredTools,
    videoPosts,
    popularTags,
    pagination: { page, totalPages, totalPosts },
    seo: {
      title: pageTitle,
      subtitle: settings.site_tagline || 'US & Europe Tech, AI, GTA & Developer Tutorials',
      description: settings.site_description || 'Independent tech guides, AI updates, gadget reviews, software tips, cybersecurity insights, and gaming coverage for US readers.',
      tags: 'US Tech News, Europe Tech, Artificial Intelligence, GTA 5, GTA 6, Developer Tutorials, Cybersecurity',
      canonical: page > 1 ? `${siteUrl}/?page=${page}` : `${siteUrl}/`,
      ogType: 'website',
      ogImage: featuredPosts[0]?.featured_image ? `${siteUrl}${featuredPosts[0].featured_image}` : `${siteUrl}/favicon.svg`,
      lcpImage: featuredPosts[0]?.featured_image ? res.locals.assetUrl(featuredPosts[0].featured_image) : '',
      lcpImageSrcset: featuredPosts[0]?.featured_image && featuredPosts[0]?.featured_image_thumb
        ? `${res.locals.assetUrl(featuredPosts[0].featured_image_thumb)} 640w, ${res.locals.assetUrl(featuredPosts[0].featured_image)} 1400w`
        : '',
      lcpImageSizes: '(max-width: 768px) 100vw, (max-width: 1200px) 66vw, 760px',
      robots: 'index, follow'
    },
    jsonLdList: [
      serializeJsonLd(buildWebsiteJsonLd(settings)),
      serializeJsonLd(buildOrganizationJsonLd(settings))
    ]
  });
});

router.get('/article/:slug', (req, res, next) => {
  const slugParam = req.params.slug;
  setImmediate(() => {
    try {
      publishDueScheduledPosts();
      const postMeta = db.prepare("SELECT id FROM posts WHERE slug = ? AND status = 'published' LIMIT 1").get(slugParam);
      if (postMeta) {
        db.prepare('UPDATE posts SET views = views + 1 WHERE id = ?').run(postMeta.id);
        recordPageView(req, postMeta.id);
      }
    } catch {}
  });
  next();
}, withCache(CACHE_30M), (req, res) => {
  const { settings, siteUrl, getRawAdHtml } = res.locals;
  const post = db.prepare(`
    ${BASE_POST_SELECT}
    WHERE p.slug = ? AND p.status = 'published'
    LIMIT 1
  `).get(req.params.slug);

  if (!post) {
    return res.status(404).render('public/404', {
      seo: { title: `Article Not Found — ${settings.site_name || 'TechHaven US'}`, robots: 'noindex, follow' }
    });
  }

  const tags = db.prepare(`
    SELECT t.* FROM tags t
    JOIN post_tags pt ON pt.tag_id = t.id
    WHERE pt.post_id = ?
    ORDER BY t.name ASC
  `).all(post.id);

  const relatedPosts = db.prepare(`
    ${BASE_POST_SELECT}
    WHERE p.status = 'published' AND p.id != ? AND (p.category_id = ? OR p.category_id IS NOT NULL)
    ORDER BY CASE WHEN p.category_id = ? THEN 0 ELSE 1 END, p.published_at DESC
    LIMIT 4
  `).all(post.id, post.category_id, post.category_id);

  const trendingPosts = getTrendingPosts(5);

  const toc = safeJsonParse(post.toc_json, []);
  const keyTakeaways = safeJsonParse(post.key_takeaways_json, []);
  const officialSources = safeJsonParse(post.official_sources_json, []);
  const corrections = safeJsonParse(post.corrections_json, []);

  const midParagraph = Number.parseInt(settings.ads_mid_paragraph || '3', 10) || 3;
  const midAdInner = getRawAdHtml('ads_slot_article_mid');
  const articleBodyHtml = midAdInner
    ? injectMidArticleAd(post.content_html, `<div class="ad-label">Advertisement</div>${midAdInner}`, midParagraph)
    : post.content_html;

  const categoryObj = post.category_name
    ? { name: post.category_name, slug: post.category_slug, accent_color: post.category_color }
    : null;
  const authorObj = post.author_name
    ? {
        name: post.author_name,
        slug: post.author_slug,
        job_title: post.author_job_title,
        expertise: post.author_expertise,
        bio: post.author_bio,
        avatar_url: post.author_avatar,
        twitter_handle: post.author_twitter,
        linkedin_url: post.author_linkedin,
        website_url: post.author_website,
        location: post.author_location
      }
    : null;

  const canonical = (post.canonical_url || '').trim() || `${siteUrl}/article/${post.slug}`;
  const ogImage = `${siteUrl}/og/${post.slug}.png`;
  const videoInfo = parseYouTubeUrl(post.video_url);
  const videoJsonLd = videoInfo ? buildVideoObjectJsonLd(post, videoInfo, settings) : null;
  const shareLinks = buildPlatformShareLinks(post, siteUrl);

  const breadcrumbItems = [
    { name: 'Home', url: '/' },
    ...(categoryObj ? [{ name: categoryObj.name, url: `/category/${categoryObj.slug}` }] : []),
    { name: post.title, url: `/article/${post.slug}` }
  ];

  const jsonLdList = [
    serializeJsonLd(buildArticleJsonLd(post, categoryObj, authorObj, tags, settings)),
    serializeJsonLd(buildBreadcrumbJsonLd(breadcrumbItems, siteUrl)),
    ...(videoJsonLd ? [serializeJsonLd(videoJsonLd)] : [])
  ];

  res.render('public/article', {
    post,
    articleBodyHtml,
    toc,
    keyTakeaways,
    officialSources,
    corrections,
    videoInfo,
    shareLinks,
    tags,
    relatedPosts,
    trendingPosts,
    seo: {
      title: `${post.meta_title || post.title} — ${settings.site_name || 'TechHaven US'}`,
      subtitle: post.meta_subtitle || post.subtitle || post.excerpt,
      description: post.meta_description || post.excerpt,
      tags: post.meta_tags || tags.map((t) => t.name).join(', '),
      canonical,
      ogType: 'article',
      ogImage,
      ogImageWidth: 1200,
      ogImageHeight: 630,
      ogImageAlt: post.featured_image_alt || post.title,
      lcpImage: post.featured_image ? res.locals.assetUrl(post.featured_image) : '',
      lcpImageSrcset: post.featured_image && post.featured_image_thumb
        ? `${res.locals.assetUrl(post.featured_image_thumb)} 640w, ${res.locals.assetUrl(post.featured_image)} 1400w`
        : '',
      lcpImageSizes: '(max-width: 768px) 100vw, (max-width: 1200px) 68vw, 820px',
      publishedAt: post.published_at,
      modifiedAt: post.updated_at || post.published_at,
      authorName: post.author_name || 'TechHaven Editorial',
      section: post.category_name || 'Technology',
      robots: post.robots || 'index, follow'
    },
    jsonLdList
  });
});

router.get('/og/:slug.png', async (req, res) => {
  const slug = String(req.params.slug || '').trim();
  const cacheKey = `og:${slug}`;
  const cached = pageCache.get(cacheKey);
  if (cached && Buffer.isBuffer(cached)) {
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.send(cached);
  }

  const post = db.prepare(`
    ${BASE_POST_SELECT}
    WHERE p.slug = ? AND p.status = 'published'
    LIMIT 1
  `).get(slug);
  if (!post) return res.status(404).send('Not found');

  const category = post.category_name ? { name: post.category_name, accent_color: post.category_color } : null;
  const pngBuffer = await generateSocialCardPng(post, category, res.locals.settings);
  pageCache.set(cacheKey, pngBuffer, 300_000);
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.send(pngBuffer);
});

router.get('/videos', withCache(CACHE_20M), (req, res) => {
  const { settings, siteUrl } = res.locals;
  const filter = String(req.query.type || 'all');
  const rows = db.prepare(`
    ${BASE_POST_SELECT}
    WHERE p.status = 'published' AND p.video_url != ''
    ORDER BY p.published_at DESC
    LIMIT 30
  `).all();

  let videos = rows
    .map((p) => ({ ...p, videoInfo: parseYouTubeUrl(p.video_url) }))
    .filter((p) => p.videoInfo);

  if (filter === 'shorts') {
    videos = videos.filter((v) => v.videoInfo.isShort || v.video_is_short);
  } else if (filter === 'reviews') {
    videos = videos.filter((v) => !v.videoInfo.isShort && !v.video_is_short);
  }

  res.render('public/videos', {
    videos,
    filter,
    trendingPosts: getTrendingPosts(5),
    seo: {
      title: `Video Reviews & YouTube Shorts — ${settings.site_name || 'TechHaven US'}`,
      description: 'Watch US & Europe hardware benchmarks, AI briefings, and GTA 6 / GTA 5 Online YouTube Shorts.',
      canonical: `${siteUrl}/videos`,
      robots: 'index, follow'
    },
    jsonLdList: [
      serializeJsonLd(buildCollectionJsonLd('Video Reviews & Shorts', 'TechHaven US video benchmarks and YouTube Shorts', '/videos', siteUrl))
    ]
  });
});

router.get('/api/push/vapid-key', (req, res) => {
  const { publicKey } = ensureVapidKeys();
  res.json({ ok: true, publicKey });
});

router.post('/api/push/subscribe', (req, res) => {
  const endpoint = String(req.body?.endpoint || '').trim();
  const p256dh = String(req.body?.keys?.p256dh || '').trim();
  const auth = String(req.body?.keys?.auth || '').trim();
  const regionPref = String(req.body?.region_pref || 'USA & Europe').trim().slice(0, 40);
  const ua = String(req.headers['user-agent'] || '').slice(0, 240);

  if (!endpoint.startsWith('https://') || !p256dh || !auth) {
    return res.status(400).json({ ok: false, error: 'Invalid push subscription payload.' });
  }

  db.prepare(`
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, region_pref, user_agent)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      region_pref = excluded.region_pref
  `).run(endpoint, p256dh, auth, regionPref, ua);

  return res.json({ ok: true, message: 'Tech Update Alerts enabled!' });
});

router.post('/api/push/unsubscribe', (req, res) => {
  const endpoint = String(req.body?.endpoint || '').trim();
  if (endpoint) {
    db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }
  return res.json({ ok: true });
});

router.post('/api/articles/:id/feedback', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const vote = req.body?.vote === 'no' ? 'no' : 'yes';
  const post = db.prepare("SELECT id, helpful_yes, helpful_no FROM posts WHERE id = ? AND status = 'published'").get(id);
  if (!post) return res.status(404).json({ ok: false, error: 'Article not found' });

  const col = vote === 'no' ? 'helpful_no' : 'helpful_yes';
  db.prepare(`UPDATE posts SET ${col} = ${col} + 1 WHERE id = ?`).run(id);
  const updated = db.prepare('SELECT helpful_yes, helpful_no FROM posts WHERE id = ?').get(id);
  pageCache.clear();
  return res.json({ ok: true, helpful_yes: updated.helpful_yes, helpful_no: updated.helpful_no });
});

router.post('/api/articles/:id/save', (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const delta = req.body?.action === 'unsave' ? -1 : 1;
  const post = db.prepare("SELECT id, save_count FROM posts WHERE id = ? AND status = 'published'").get(id);
  if (!post) return res.status(404).json({ ok: false });
  const nextCount = Math.max(0, (post.save_count || 0) + delta);
  db.prepare('UPDATE posts SET save_count = ? WHERE id = ?').run(nextCount, id);
  return res.json({ ok: true, save_count: nextCount });
});

router.post('/api/articles/:id/ask', async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const question = String(req.body?.question || '').trim().slice(0, 300);
  if (!question) {
    return res.status(400).json({ ok: false, error: 'Please type a question about this article.' });
  }
  const post = db.prepare("SELECT * FROM posts WHERE id = ? AND status = 'published' LIMIT 1").get(id);
  if (!post) {
    return res.status(404).json({ ok: false, error: 'Article not found.' });
  }
  const result = await answerArticleQuestion(post, question, res.locals.settings);
  return res.json({ ok: true, ...result });
});

router.get('/category/:slug', withCache(CACHE_20M), (req, res) => {
  const { settings, siteUrl } = res.locals;
  const category = db.prepare('SELECT * FROM categories WHERE slug = ? LIMIT 1').get(req.params.slug);
  if (!category) {
    return res.status(404).render('public/404', {
      seo: { title: `Category Not Found — ${settings.site_name || 'TechHaven US'}`, robots: 'noindex, follow' }
    });
  }

  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10) || 1);
  const perPage = 12;
  const offset = (page - 1) * perPage;

  const totalPosts = db.prepare("SELECT COUNT(*) AS count FROM posts WHERE category_id = ? AND status = 'published'").get(category.id).count;
  const totalPages = Math.max(1, Math.ceil(totalPosts / perPage));

  const posts = db.prepare(`
    ${BASE_POST_SELECT}
    WHERE p.category_id = ? AND p.status = 'published'
    ORDER BY p.published_at DESC
    LIMIT ? OFFSET ?
  `).all(category.id, perPage, offset);

  const canonical = page > 1 ? `${siteUrl}/category/${category.slug}?page=${page}` : `${siteUrl}/category/${category.slug}`;

  res.render('public/category', {
    category,
    posts,
    trendingPosts: getTrendingPosts(5),
    pagination: { page, totalPages, totalPosts },
    seo: {
      title: category.meta_title || `${category.name} News & Guides — ${settings.site_name || 'TechHaven US'}`,
      subtitle: category.description,
      description: category.meta_description || category.description,
      tags: `${category.name}, US Tech, Europe Tech, ${settings.site_name || 'TechHaven US'}`,
      canonical,
      ogType: 'website',
      robots: 'index, follow'
    },
    jsonLdList: [
      serializeJsonLd(buildCollectionJsonLd(category.name, category.description, `/category/${category.slug}`, siteUrl)),
      serializeJsonLd(buildBreadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: category.name, url: `/category/${category.slug}` }
      ], siteUrl))
    ]
  });
});

router.get('/region/:region', (req, res) => {
  return res.redirect(301, '/');
});

router.get('/briefing', withCache(CACHE_20M), (req, res) => {
  const { settings, siteUrl } = res.locals;
  const briefings = buildAutoBriefings();
  res.render('public/briefing', {
    briefings,
    activeBriefing: briefings[0] || null,
    trendingPosts: getTrendingPosts(5),
    seo: {
      title: `Daily AI & Tech Briefing — ${settings.site_name || 'TechHaven US'}`,
      description: 'Concise 2-minute executive summaries of the latest AI, gadgets, software, cybersecurity, and gaming developments.',
      canonical: `${siteUrl}/briefing`,
      robots: 'index, follow'
    },
    jsonLdList: []
  });
});

router.get('/briefing/:slug', withCache(CACHE_20M), (req, res) => {
  const { settings, siteUrl } = res.locals;
  const briefings = buildAutoBriefings();
  const found = briefings.find((b) => b.slug === req.params.slug);
  if (!found) {
    if (String(req.params.slug || '').startsWith('daily-briefing-')) {
      return res.redirect(301, '/briefing');
    }
    return res.status(404).render('public/404', { seo: { title: 'Briefing Not Found', robots: 'noindex' }, jsonLdList: [] });
  }
  res.render('public/briefing', {
    briefings,
    activeBriefing: found,
    trendingPosts: getTrendingPosts(5),
    seo: {
      title: `${found.title} — ${settings.site_name || 'TechHaven US'}`,
      description: found.summary,
      canonical: `${siteUrl}/briefing/${found.slug}`,
      robots: 'index, follow'
    },
    jsonLdList: []
  });
});

router.get('/timelines', withCache(CACHE_20M), (req, res) => {
  const { settings, siteUrl } = res.locals;
  const timelines = db.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM timeline_events te WHERE te.timeline_id = t.id) AS event_count
    FROM timelines t
    WHERE t.status = 'published'
    ORDER BY t.updated_at DESC
  `).all();

  res.render('public/timelines', {
    timelines,
    trendingPosts: getTrendingPosts(5),
    seo: {
      title: `Tech Timelines — Topic Trackers | ${settings.site_name || 'TechHaven US'}`,
      description: 'Follow chronological tech timelines covering GTA 6, AI updates, and major hardware launches.',
      canonical: `${siteUrl}/timelines`,
      robots: 'index, follow'
    },
    jsonLdList: []
  });
});

router.get('/timeline/:slug', withCache(CACHE_20M), (req, res) => {
  const { settings, siteUrl } = res.locals;
  const timeline = db.prepare("SELECT * FROM timelines WHERE slug = ? AND status = 'published' LIMIT 1").get(req.params.slug);
  if (!timeline) {
    return res.status(404).render('public/404', { seo: { title: 'Timeline Not Found', robots: 'noindex' } });
  }
  const events = db.prepare(`
    SELECT * FROM timeline_events WHERE timeline_id = ? ORDER BY event_date DESC, id DESC
  `).all(timeline.id);

  res.render('public/timeline-detail', {
    timeline,
    events,
    trendingPosts: getTrendingPosts(5),
    seo: {
      title: `${timeline.title} — Timeline | ${settings.site_name || 'TechHaven US'}`,
      description: timeline.description,
      canonical: `${siteUrl}/timeline/${timeline.slug}`,
      robots: 'index, follow'
    },
    jsonLdList: []
  });
});

router.get('/ai-tools', withCache(CACHE_20M), (req, res) => {
  const { settings, siteUrl } = res.locals;
  const category = String(req.query.category || 'all').trim();
  const pricing = String(req.query.pricing || 'all').trim();
  const q = String(req.query.q || '').trim();

  const where = [];
  const params = [];
  if (category && category !== 'all') {
    where.push('category = ?');
    params.push(category);
  }
  if (pricing && pricing !== 'all') {
    where.push('pricing_model = ?');
    params.push(pricing);
  }
  if (q) {
    where.push('(name LIKE ? OR tagline LIKE ? OR description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const tools = db.prepare(`SELECT * FROM ai_tools ${whereSql} ORDER BY is_featured DESC, rating DESC, name ASC`).all(...params);
  const categoriesList = db.prepare('SELECT DISTINCT category FROM ai_tools ORDER BY category ASC').all().map((r) => r.category);

  res.render('public/ai-tools', {
    tools: tools.map((t) => ({ ...t, pros: safeJsonParse(t.pros_json, []), cons: safeJsonParse(t.cons_json, []) })),
    categoriesList,
    filters: { category, pricing, q },
    trendingPosts: getTrendingPosts(5),
    seo: {
      title: `AI Tools Directory — Tested Tools, Pricing, Pros & Cons | ${settings.site_name || 'TechHaven US'}`,
      description: 'Curated directory of AI assistants, coding tools, AI search engines, and image generators tested for US & EU workflows.',
      canonical: `${siteUrl}/ai-tools`,
      robots: 'index, follow'
    },
    jsonLdList: []
  });
});

router.get('/ai-tools/:slug', withCache(CACHE_20M), (req, res) => {
  const { settings, siteUrl } = res.locals;
  const tool = db.prepare('SELECT * FROM ai_tools WHERE slug = ? LIMIT 1').get(req.params.slug);
  if (!tool) {
    return res.status(404).render('public/404', { seo: { title: 'AI Tool Not Found', robots: 'noindex' } });
  }
  const otherTools = db.prepare('SELECT * FROM ai_tools WHERE id != ? ORDER BY rating DESC LIMIT 4').all(tool.id);

  res.render('public/ai-tool-detail', {
    tool: { ...tool, pros: safeJsonParse(tool.pros_json, []), cons: safeJsonParse(tool.cons_json, []) },
    otherTools,
    trendingPosts: getTrendingPosts(5),
    seo: {
      title: `${tool.name} Review, Pricing, Pros & Cons — ${settings.site_name || 'TechHaven US'}`,
      description: tool.tagline || tool.description,
      canonical: `${siteUrl}/ai-tools/${tool.slug}`,
      robots: 'index, follow'
    },
    jsonLdList: [
      serializeJsonLd({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: tool.name,
        applicationCategory: tool.category,
        operatingSystem: 'Web, Windows, macOS, iOS, Android',
        description: tool.description,
        ...(tool.website_url ? { url: tool.website_url } : {})
      })
    ]
  });
});

router.get('/my-feed', (req, res) => {
  const { settings, siteUrl, userPrefs } = res.locals;
  const selectedCats = Array.isArray(userPrefs.categories) ? userPrefs.categories : [];
  const selectedRegions = Array.isArray(userPrefs.regions) ? userPrefs.regions : [];

  const where = ["p.status = 'published'"];
  const params = [];

  if (selectedCats.length > 0) {
    where.push(`c.slug IN (${selectedCats.map(() => '?').join(',')})`);
    params.push(...selectedCats);
  }
  if (selectedRegions.length > 0) {
    where.push(`p.region IN (${selectedRegions.map(() => '?').join(',')})`);
    params.push(...selectedRegions);
  }

  const posts = db.prepare(`
    ${BASE_POST_SELECT}
    WHERE ${where.join(' AND ')}
    ORDER BY p.published_at DESC
    LIMIT 24
  `).all(...params);

  res.render('public/my-feed', {
    posts,
    selectedCats,
    selectedRegions,
    trendingPosts: getTrendingPosts(5),
    seo: {
      title: `My Personalized Feed — ${settings.site_name || 'TechHaven US'}`,
      description: 'Customize your personalized US tech, AI, gadget review, gaming, and tutorial feed.',
      canonical: `${siteUrl}/my-feed`,
      robots: 'noindex, follow'
    },
    jsonLdList: []
  });
});

router.post('/api/preferences', (req, res) => {
  const categories = Array.isArray(req.body?.categories)
    ? req.body.categories.map((c) => String(c).trim()).filter(Boolean).slice(0, 12)
    : [];
  const regions = Array.isArray(req.body?.regions)
    ? req.body.regions.map((r) => String(r).trim()).filter(Boolean).slice(0, 6)
    : [];

  const payload = JSON.stringify({ categories, regions });
  res.cookie('th_prefs', payload, {
    maxAge: 180 * 24 * 60 * 60 * 1000,
    sameSite: 'lax',
    path: '/'
  });
  return res.json({ ok: true, categories, regions });
});

router.get('/saved', (req, res) => {
  const { settings, siteUrl } = res.locals;
  res.render('public/saved', {
    trendingPosts: getTrendingPosts(5),
    seo: {
      title: `Saved Articles — ${settings.site_name || 'TechHaven US'}`,
      description: 'Your saved TechHaven US articles for reading later.',
      canonical: `${siteUrl}/saved`,
      robots: 'noindex, follow'
    },
    jsonLdList: []
  });
});

router.get('/api/posts/by-slugs', (req, res) => {
  const slugs = String(req.query.slugs || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);

  if (slugs.length === 0) return res.json({ ok: true, posts: [] });
  const posts = db.prepare(`
    ${BASE_POST_SELECT}
    WHERE p.status = 'published' AND p.slug IN (${slugs.map(() => '?').join(',')})
    ORDER BY p.published_at DESC
  `).all(...slugs);
  return res.json({ ok: true, posts });
});

router.get('/tag/:slug', withCache(CACHE_20M), (req, res) => {
  const { settings, siteUrl } = res.locals;
  const tag = db.prepare('SELECT * FROM tags WHERE slug = ? LIMIT 1').get(req.params.slug);
  if (!tag) {
    return res.status(404).render('public/404', {
      seo: { title: `Tag Not Found — ${settings.site_name || 'TechHaven US'}`, robots: 'noindex, follow' }
    });
  }

  const posts = db.prepare(`
    ${BASE_POST_SELECT}
    JOIN post_tags pt ON pt.post_id = p.id
    WHERE pt.tag_id = ? AND p.status = 'published'
    ORDER BY p.published_at DESC
    LIMIT 24
  `).all(tag.id);

  res.render('public/tag', {
    tag,
    posts,
    trendingPosts: getTrendingPosts(5),
    seo: {
      title: `${tag.name} — Coverage & Guides | ${settings.site_name || 'TechHaven US'}`,
      description: `Latest news, updates, and guides tagged ${tag.name} on ${settings.site_name || 'TechHaven US'}.`,
      canonical: `${siteUrl}/tag/${tag.slug}`,
      robots: 'index, follow'
    },
    jsonLdList: [
      serializeJsonLd(buildBreadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: `Tag: ${tag.name}`, url: `/tag/${tag.slug}` }
      ], siteUrl))
    ]
  });
});

router.get('/author/:slug', withCache(CACHE_20M), (req, res) => {
  const { settings, siteUrl } = res.locals;
  const author = db.prepare(`
    SELECT id, name, slug, role, job_title, expertise, bio, avatar_url, twitter_handle, linkedin_url, website_url, location, credentials, created_at
    FROM users WHERE slug = ? LIMIT 1
  `).get(req.params.slug);
  if (!author) {
    return res.status(404).render('public/404', {
      seo: { title: `Author Not Found — ${settings.site_name || 'TechHaven US'}`, robots: 'noindex, follow' }
    });
  }

  const posts = db.prepare(`
    ${BASE_POST_SELECT}
    WHERE p.author_id = ? AND p.status = 'published'
    ORDER BY p.published_at DESC
    LIMIT 30
  `).all(author.id);

  const statsRow = db.prepare("SELECT COUNT(*) AS total_articles, COALESCE(SUM(views), 0) AS total_views FROM posts WHERE author_id = ? AND status = 'published'").get(author.id);

  res.render('public/author', {
    author,
    authorStats: statsRow || { total_articles: posts.length, total_views: 0 },
    posts,
    trendingPosts: getTrendingPosts(5),
    seo: {
      title: `${author.name} (${author.job_title || 'Editor'}) — ${settings.site_name || 'TechHaven US'}`,
      description: author.bio || `Articles written by ${author.name} on ${settings.site_name || 'TechHaven US'}.`,
      canonical: `${siteUrl}/author/${author.slug}`,
      robots: 'index, follow'
    },
    jsonLdList: [
      serializeJsonLd(buildProfilePageJsonLd(author, settings)),
      serializeJsonLd(buildBreadcrumbJsonLd([
        { name: 'Home', url: '/' },
        { name: 'Authors', url: '/about' },
        { name: author.name, url: `/author/${author.slug}` }
      ], siteUrl))
    ]
  });
});

router.get('/search', (req, res) => {
  publishDueScheduledPosts();
  const { settings, siteUrl } = res.locals;
  const q = String(req.query.q || '').trim().slice(0, 120);
  let posts = [];

  if (q) {
    const cleanTerms = q
      .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 6);

    if (cleanTerms.length > 0) {
      const ftsQuery = cleanTerms.map((term) => `"${term}"*`).join(' AND ');
      try {
        posts = db.prepare(`
          ${BASE_POST_SELECT}
          JOIN posts_fts ON posts_fts.rowid = p.id
          WHERE posts_fts MATCH ? AND p.status = 'published'
          ORDER BY rank, p.published_at DESC
          LIMIT 24
        `).all(ftsQuery);
      } catch {
        const likePattern = `%${q}%`;
        posts = db.prepare(`
          ${BASE_POST_SELECT}
          WHERE p.status = 'published'
            AND (p.title LIKE ? OR p.subtitle LIKE ? OR p.excerpt LIKE ? OR p.meta_tags LIKE ?)
          ORDER BY p.published_at DESC
          LIMIT 24
        `).all(likePattern, likePattern, likePattern, likePattern);
      }
    }

    try {
      db.prepare('INSERT INTO search_logs (query, results_count) VALUES (?, ?)').run(q.toLowerCase(), posts.length);
    } catch {}
  }

  res.render('public/search', {
    q,
    posts,
    trendingPosts: getTrendingPosts(5),
    seo: {
      title: q ? `Search: ${q} — ${settings.site_name || 'TechHaven US'}` : `Search — ${settings.site_name || 'TechHaven US'}`,
      description: `Search tech news, AI updates, GTA guides, and developer tutorials on ${settings.site_name || 'TechHaven US'}.`,
      canonical: `${siteUrl}/search`,
      robots: 'noindex, follow'
    },
    jsonLdList: []
  });
});

router.get('/about', withCache(CACHE_30M), (req, res) => {
  const { settings, siteUrl } = res.locals;
  const authors = db.prepare('SELECT id, name, slug, job_title, expertise, bio, avatar_url, twitter_handle FROM users ORDER BY id ASC').all();
  res.render('public/page', {
    pageKey: 'about',
    pageTitle: `About ${settings.site_name || 'TechHaven US'}`,
    pageSubtitle: 'Independent US & Europe Technology, AI, Gaming & Engineering Publication',
    authors,
    seo: {
      title: `About Us — ${settings.site_name || 'TechHaven US'}`,
      description: `Learn about ${settings.site_name || 'TechHaven US'}, our US & European coverage mission, editorial team, and benchmark testing standards.`,
      canonical: `${siteUrl}/about`,
      robots: 'index, follow'
    },
    jsonLdList: [serializeJsonLd(buildOrganizationJsonLd(settings))]
  });
});

router.get('/editorial-policy', withCache(CACHE_30M), (req, res) => {
  const { settings, siteUrl } = res.locals;
  res.render('public/page', {
    pageKey: 'editorial',
    pageTitle: 'Editorial Policy & Fact-Checking Standards',
    pageSubtitle: 'How TechHaven US verifies sources, benchmarks hardware, and publishes transparent corrections.',
    authors: [],
    seo: {
      title: `Editorial Policy — ${settings.site_name || 'TechHaven US'}`,
      description: `Verification standards, correction history policies, and editorial independence guidelines at ${settings.site_name || 'TechHaven US'}.`,
      canonical: `${siteUrl}/editorial-policy`,
      robots: 'index, follow'
    },
    jsonLdList: []
  });
});

router.get('/privacy-policy', withCache(CACHE_30M), (req, res) => {
  const { settings, siteUrl } = res.locals;
  res.render('public/page', {
    pageKey: 'privacy',
    pageTitle: 'Privacy Policy (GDPR, CCPA & Google AdSense)',
    pageSubtitle: 'How we protect reader privacy across the United States, United Kingdom, and European Union.',
    authors: [],
    seo: {
      title: `Privacy Policy — ${settings.site_name || 'TechHaven US'}`,
      description: `GDPR, CCPA/CPRA, and Google AdSense DoubleClick cookie privacy disclosures for ${settings.site_name || 'TechHaven US'}.`,
      canonical: `${siteUrl}/privacy-policy`,
      robots: 'index, follow'
    },
    jsonLdList: []
  });
});

router.get('/terms', withCache(CACHE_30M), (req, res) => {
  const { settings, siteUrl } = res.locals;
  res.render('public/page', {
    pageKey: 'terms',
    pageTitle: 'Terms of Service',
    pageSubtitle: 'Rules and licensing terms governing use of TechHaven US.',
    authors: [],
    seo: {
      title: `Terms of Service — ${settings.site_name || 'TechHaven US'}`,
      description: `Terms and conditions for reading and interacting with ${settings.site_name || 'TechHaven US'}.`,
      canonical: `${siteUrl}/terms`,
      robots: 'index, follow'
    },
    jsonLdList: []
  });
});

router.get('/disclaimer', withCache(CACHE_30M), (req, res) => {
  const { settings, siteUrl } = res.locals;
  res.render('public/page', {
    pageKey: 'disclaimer',
    pageTitle: 'Disclaimer & Advertising Disclosure',
    pageSubtitle: 'Transparency on informational content, trademarks, and Google AdSense advertising.',
    authors: [],
    seo: {
      title: `Disclaimer — ${settings.site_name || 'TechHaven US'}`,
      description: `Legal disclaimer and advertising transparency notice for ${settings.site_name || 'TechHaven US'}.`,
      canonical: `${siteUrl}/disclaimer`,
      robots: 'index, follow'
    },
    jsonLdList: []
  });
});

router.get('/contact', (req, res) => {
  const { settings, siteUrl } = res.locals;
  res.render('public/contact', {
    status: req.query.sent === '1' ? 'success' : null,
    errorMsg: null,
    formValues: {},
    seo: {
      title: `Contact Editorial Team — ${settings.site_name || 'TechHaven US'}`,
      description: `Contact ${settings.site_name || 'TechHaven US'} for questions, feedback, corrections, or partnership inquiries.`,
      canonical: `${siteUrl}/contact`,
      robots: 'index, follow'
    },
    jsonLdList: []
  });
});

router.post('/contact', (req, res) => {
  const { settings, siteUrl } = res.locals;
  const name = String(req.body.name || '').trim().slice(0, 120);
  const email = String(req.body.email || '').trim().slice(0, 160);
  const subject = String(req.body.subject || '').trim().slice(0, 180);
  const message = String(req.body.message || '').trim().slice(0, 4000);
  const honeypot = String(req.body.website || '').trim();

  if (honeypot) return res.redirect('/contact?sent=1');

  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || message.length < 10) {
    return res.status(400).render('public/contact', {
      status: 'error',
      errorMsg: 'Please provide your name, a valid email address, and a message (at least 10 characters).',
      formValues: { name, email, subject, message },
      seo: {
        title: `Contact Editorial Team — ${settings.site_name || 'TechHaven US'}`,
        canonical: `${siteUrl}/contact`,
        robots: 'index, follow'
      },
      jsonLdList: []
    });
  }

  db.prepare('INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)')
    .run(name, email, subject || 'General Inquiry', message);

  return res.redirect('/contact?sent=1');
});

router.post('/api/newsletter', async (req, res) => {
  const { settings, siteUrl } = res.locals;
  const email = String(req.body.email || '').trim().toLowerCase().slice(0, 160);
  const source = String(req.body.source || 'website').trim().slice(0, 40);
  const gdprConsent = req.body.gdpr_consent === true || req.body.gdpr_consent === '1' || req.body.gdpr_consent === 'true';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, message: 'Please enter a valid email address.' });
  }
  if (!gdprConsent) {
    return res.status(400).json({ ok: false, message: 'Please check the GDPR & email consent box before subscribing.' });
  }

  const existing = db.prepare('SELECT id, status, unsubscribe_token FROM subscribers WHERE email = ?').get(email);
  if (existing && existing.status === 'confirmed') {
    return res.json({
      ok: true,
      status: 'confirmed',
      message: 'You are already confirmed on our Weekly Tech Digest.'
    });
  }

  const { confirmToken, unsubscribeToken } = generateSubscriberTokens();
  const providerName = String(settings.newsletter_provider || 'local').toLowerCase();
  const consentText = 'Explicit double opt-in newsletter consent (GDPR / CAN-SPAM)';
  const ip = String(req.ip || req.socket?.remoteAddress || '').slice(0, 80);

  db.prepare(`
    INSERT INTO subscribers (email, source, status, confirm_token, unsubscribe_token, gdpr_consent, consent_text, consent_ip, provider_name)
    VALUES (?, ?, 'pending', ?, ?, 1, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      source = excluded.source,
      status = 'pending',
      confirm_token = excluded.confirm_token,
      unsubscribe_token = CASE WHEN subscribers.unsubscribe_token = '' THEN excluded.unsubscribe_token ELSE subscribers.unsubscribe_token END,
      gdpr_consent = 1,
      consent_text = excluded.consent_text,
      consent_ip = excluded.consent_ip,
      provider_name = excluded.provider_name
  `).run(email, source, confirmToken, existing?.unsubscribe_token || unsubscribeToken, consentText, ip, providerName);

  const reqOrigin = `${req.protocol}://${req.get('host')}`;
  const linkBase = req.get('host')?.includes('localhost') || req.get('host')?.startsWith('127.') ? reqOrigin : siteUrl;
  const confirmUrl = `${linkBase}/newsletter/confirm?token=${encodeURIComponent(confirmToken)}`;
  const unsubscribeUrl = `${linkBase}/newsletter/unsubscribe?token=${encodeURIComponent(existing?.unsubscribe_token || unsubscribeToken)}`;

  const delivery = await sendDoubleOptInEmail({ email, confirmUrl, unsubscribeUrl, settings });
  if (delivery.providerId) {
    db.prepare('UPDATE subscribers SET provider_id = ? WHERE email = ?').run(delivery.providerId, email);
  }

  if (delivery.delivered) {
    return res.json({
      ok: true,
      status: 'pending',
      provider: delivery.provider,
      message: 'Almost done! Check your inbox and click the confirmation link to activate your subscription.'
    });
  }

  return res.json({
    ok: true,
    status: 'pending',
    provider: delivery.provider,
    confirmUrl,
    message: 'Double opt-in created! Click "Confirm Subscription Now" below to verify your email.'
  });
});

router.get('/newsletter/confirm', async (req, res) => {
  const { settings, siteUrl } = res.locals;
  const token = String(req.query.token || '').trim();
  const subscriber = token ? db.prepare('SELECT * FROM subscribers WHERE confirm_token = ? LIMIT 1').get(token) : null;

  if (!subscriber) {
    return res.status(400).render('public/newsletter-status', {
      mode: 'error',
      heading: 'Confirmation Link Invalid or Expired',
      message: 'Please submit your email again in the newsletter form to receive a fresh confirmation link.',
      unsubscribeUrl: null,
      seo: { title: `Newsletter Confirmation — ${settings.site_name || 'TechHaven US'}`, robots: 'noindex, follow' },
      jsonLdList: []
    });
  }

  db.prepare(`
    UPDATE subscribers SET status = 'confirmed', confirm_token = '', confirmed_at = datetime('now')
    WHERE id = ?
  `).run(subscriber.id);

  const syncRes = await syncConfirmedSubscriber(subscriber, settings);
  if (syncRes.synced) {
    db.prepare('UPDATE subscribers SET provider_synced = 1 WHERE id = ?').run(subscriber.id);
  }

  const unsubscribeUrl = `${siteUrl}/newsletter/unsubscribe?token=${encodeURIComponent(subscriber.unsubscribe_token)}`;
  return res.render('public/newsletter-status', {
    mode: 'confirmed',
    heading: 'Subscription Confirmed!',
    message: `${subscriber.email} is now subscribed to ${settings.site_name || 'TechHaven US'}. Expect our US & Europe tech digest every Friday.`,
    unsubscribeUrl,
    seo: { title: `Subscription Confirmed — ${settings.site_name || 'TechHaven US'}`, robots: 'noindex, follow' },
    jsonLdList: []
  });
});

router.get('/newsletter/unsubscribe', async (req, res) => {
  const { settings } = res.locals;
  const token = String(req.query.token || '').trim();
  const subscriber = token ? db.prepare('SELECT * FROM subscribers WHERE unsubscribe_token = ? LIMIT 1').get(token) : null;

  if (!subscriber) {
    return res.status(400).render('public/newsletter-status', {
      mode: 'error',
      heading: 'Unsubscribe Link Not Recognized',
      message: 'If you still receive emails, contact our privacy desk and we will remove you immediately.',
      unsubscribeUrl: null,
      seo: { title: `Unsubscribe — ${settings.site_name || 'TechHaven US'}`, robots: 'noindex, follow' },
      jsonLdList: []
    });
  }

  db.prepare(`
    UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = datetime('now')
    WHERE id = ?
  `).run(subscriber.id);
  await unsubscribeFromProvider(subscriber.email, settings);

  return res.render('public/newsletter-status', {
    mode: 'unsubscribed',
    heading: 'You Have Been Unsubscribed',
    message: `${subscriber.email} has been permanently removed from all ${settings.site_name || 'TechHaven US'} mailing lists under GDPR and US CAN-SPAM rules.`,
    unsubscribeUrl: null,
    seo: { title: `Unsubscribed — ${settings.site_name || 'TechHaven US'}`, robots: 'noindex, follow' },
    jsonLdList: []
  });
});

// Serve IndexNow dynamic key verification file (/<32-char-hex>.txt)
router.use((req, res, next) => {
  if (req.method === 'GET' && /^\/([a-f0-9]{32})\.txt$/i.test(req.path)) {
    const requestedKey = req.path.slice(1, -4).toLowerCase();
    const activeKey = ensureIndexNowKey().toLowerCase();
    if (requestedKey === activeKey) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
      return res.type('text/plain; charset=utf-8').send(activeKey);
    }
  }
  next();
});

router.get('/sitemap.xml', withCache(CACHE_15M, 'application/xml; charset=utf-8'), (req, res) => {
  const { siteUrl, categories } = res.locals;
  const posts = db.prepare(`
    SELECT slug, title, excerpt, meta_title, category_id, video_url, featured_image, featured_image_title, featured_image_caption, featured_image_description, featured_image_alt, is_featured, published_at, updated_at, created_at
    FROM posts
    WHERE status = 'published'
    ORDER BY published_at DESC
  `).all();
  const tags = db.prepare(`
    SELECT DISTINCT t.slug FROM tags t
    JOIN post_tags pt ON pt.tag_id = t.id
    JOIN posts p ON p.id = pt.post_id AND p.status = 'published'
  `).all();
  const aiTools = db.prepare('SELECT slug, updated_at, created_at FROM ai_tools').all();
  const timelines = db.prepare("SELECT slug, updated_at, created_at FROM timelines WHERE status = 'published'").all();
  const latestBriefing = db.prepare("SELECT created_at FROM daily_briefings WHERE status = 'published' ORDER BY briefing_date DESC LIMIT 1").get();
  const authors = db.prepare(`
    SELECT u.slug, u.created_at, MAX(p.updated_at) AS latest_post_at
    FROM users u
    JOIN posts p ON p.author_id = u.id AND p.status = 'published'
    GROUP BY u.id
  `).all();

  const xml = buildSitemapXml(siteUrl, posts, categories, tags, {
    aiTools,
    timelines,
    authors,
    latestBriefingAt: latestBriefing?.created_at || posts[0]?.updated_at || posts[0]?.published_at || ''
  });
  res.type('application/xml; charset=utf-8').send(xml);
});

router.get(['/rss.xml', '/feed.xml'], withCache(CACHE_15M, 'application/rss+xml; charset=utf-8'), (req, res) => {
  const { settings, siteUrl } = res.locals;
  const posts = db.prepare(`
    SELECT p.slug, p.title, p.meta_title, p.meta_description, p.excerpt, p.featured_image, p.published_at, p.updated_at, p.created_at,
           c.name AS category_name
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'published'
    ORDER BY p.published_at DESC
    LIMIT 50
  `).all();
  res.setHeader('Link', `<${WEBSUB_HUB_URL}>; rel="hub", <${siteUrl}/rss.xml>; rel="self"`);
  const xml = buildRssXml(siteUrl, posts, settings);
  res.type('application/rss+xml; charset=utf-8').send(xml);
});

router.get('/robots.txt', withCache(300_000, 'text/plain; charset=utf-8'), (req, res) => {
  const { settings, siteUrl } = res.locals;
  res.type('text/plain; charset=utf-8').send(buildRobotsTxt(siteUrl, settings.robots_extra || ''));
});

router.get('/llms.txt', withCache(CACHE_15M, 'text/plain; charset=utf-8'), (req, res) => {
  const { settings, siteUrl, categories } = res.locals;
  const posts = db.prepare(`
    SELECT slug, title, excerpt, meta_description
    FROM posts
    WHERE status = 'published'
    ORDER BY published_at DESC
    LIMIT 40
  `).all();
  res.type('text/plain; charset=utf-8').send(buildLlmsTxt(siteUrl, settings, categories, posts));
});

router.get('/ads.txt', withCache(300_000, 'text/plain; charset=utf-8'), (req, res) => {
  const { settings } = res.locals;
  const content = (settings.ads_txt || '').trim() || '# Configure ads.txt in Admin Settings';
  res.type('text/plain; charset=utf-8').send(`${content}\n`);
});

export default router;
