import express from 'express';
import { db, safeJsonParse } from '../db/database.js';
import { verifyCsrf } from '../middleware/authMiddleware.js';
import { clearLoginLockouts, hashPassword } from '../utils/auth.js';
import { createDatabaseBackup, getBackupPath, listBackups } from '../utils/backup.js';
import { pageCache } from '../utils/cache.js';
import { purgeCloudflareUrls, triggerSelectiveSectionPurge } from '../utils/cloudflare.js';
import { ensureIndexNowKey, getLastIndexingReport, notifySearchEngines, WEBSUB_HUB_URL } from '../utils/indexer.js';
import { ensureVapidKeys, sendBreakingPushNotification } from '../utils/push.js';
import { extractLinksFromMarkdown, slugify, validatePostSchema } from '../utils/seo.js';
import { generateDraftSocialPosts, publishSocialPost } from '../utils/social.js';

const router = express.Router();

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).send('Permission denied for your editorial role.');
    }
    next();
  };
}

// 1. Multi-Author Role Management
router.get('/users', requireRole('admin'), (req, res) => {
  const users = db.prepare(`
    SELECT u.*,
      (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id) AS post_count
    FROM users u
    ORDER BY u.id ASC
  `).all();

  res.render('admin/users', {
    adminPage: 'users',
    users,
    flash: req.query.msg || null,
    error: req.query.err || null
  });
});

router.post('/users', requireRole('admin'), verifyCsrf, (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const role = ['admin', 'editor', 'author'].includes(req.body.role) ? req.body.role : 'author';
  const jobTitle = String(req.body.job_title || 'Staff Writer').trim();
  const expertise = String(req.body.expertise || '').trim();
  const location = String(req.body.location || '').trim();
  const credentials = String(req.body.credentials || '').trim();
  const linkedinUrl = String(req.body.linkedin_url || '').trim();
  const websiteUrl = String(req.body.website_url || '').trim();
  const bio = String(req.body.bio || '').trim();
  const twitterHandle = String(req.body.twitter_handle || '').trim();
  const password = String(req.body.password || '');

  if (!name || !email || password.length < 8) {
    return res.redirect('/admin/users?err=Name,+valid+email,+and+8%2B+char+password+required');
  }

  const slug = slugify(name);
  try {
    db.prepare(`
      INSERT INTO users (name, slug, email, password_hash, role, job_title, expertise, location, credentials, linkedin_url, website_url, bio, twitter_handle)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(name, slug, email, hashPassword(password), role, jobTitle, expertise, location, credentials, linkedinUrl, websiteUrl, bio, twitterHandle);
  } catch (err) {
    return res.redirect(`/admin/users?err=${encodeURIComponent(err.message || 'Could not create user')}`);
  }

  pageCache.clear();
  res.redirect('/admin/users?msg=User+created+successfully');
});

router.post('/users/:id/role', requireRole('admin'), verifyCsrf, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!existing) return res.redirect('/admin/users?err=Author+not+found');

  const role = ['admin', 'editor', 'author'].includes(req.body.role) ? req.body.role : existing.role;
  const name = String(req.body.name || existing.name).trim() || existing.name;
  const candidateSlug = slugify(name);
  const slugConflict = candidateSlug !== existing.slug
    ? db.prepare('SELECT id FROM users WHERE slug = ? AND id != ?').get(candidateSlug, id)
    : null;
  const nextSlug = slugConflict ? `${candidateSlug}-${id}` : candidateSlug;
  const email = String(req.body.email || existing.email).trim().toLowerCase() || existing.email;
  const jobTitle = req.body.job_title !== undefined ? String(req.body.job_title).trim() : existing.job_title;
  const expertise = req.body.expertise !== undefined ? String(req.body.expertise).trim() : existing.expertise;
  const location = req.body.location !== undefined ? String(req.body.location).trim() : existing.location;
  const credentials = req.body.credentials !== undefined ? String(req.body.credentials).trim() : existing.credentials;
  const bio = req.body.bio !== undefined ? String(req.body.bio).trim() : existing.bio;
  const twitterHandle = req.body.twitter_handle !== undefined ? String(req.body.twitter_handle).trim() : existing.twitter_handle;
  const linkedinUrl = req.body.linkedin_url !== undefined ? String(req.body.linkedin_url).trim() : existing.linkedin_url;
  const websiteUrl = req.body.website_url !== undefined ? String(req.body.website_url).trim() : existing.website_url;
  const newPassword = String(req.body.new_password || '');

  if (id === req.user.id && role !== 'admin') {
    return res.redirect('/admin/users?err=Cannot+demote+yourself');
  }

  try {
    db.prepare(`
      UPDATE users SET
        name = ?, slug = ?, email = ?, role = ?, job_title = ?, expertise = ?,
        location = ?, credentials = ?, bio = ?, twitter_handle = ?,
        linkedin_url = ?, website_url = ?
      WHERE id = ?
    `).run(name, nextSlug, email, role, jobTitle, expertise, location, credentials, bio, twitterHandle, linkedinUrl, websiteUrl, id);

    if (existing.slug && existing.slug !== nextSlug) {
      db.prepare(`
        INSERT INTO redirects (from_path, to_path, status_code) VALUES (?, ?, 301)
        ON CONFLICT(from_path) DO UPDATE SET to_path = excluded.to_path, status_code = 301
      `).run(`/author/${existing.slug}`, `/author/${nextSlug}`);
    }

    if (newPassword) {
      if (newPassword.length < 8) {
        return res.redirect('/admin/users?err=New+password+must+be+at+least+8+characters');
      }
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), id);
    }
  } catch (err) {
    return res.redirect(`/admin/users?err=${encodeURIComponent(err.message || 'Could not update author')}`);
  }

  pageCache.clear();
  res.redirect('/admin/users?msg=Author+profile+updated');
});

router.post('/users/:id/delete', requireRole('admin'), verifyCsrf, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (id === req.user.id) {
    return res.redirect('/admin/users?err=You+cannot+delete+your+own+logged-in+admin+account');
  }
  const target = db.prepare('SELECT id, slug FROM users WHERE id = ?').get(id);
  if (!target) {
    return res.redirect('/admin/users?err=Author+not+found');
  }

  db.prepare('UPDATE posts SET author_id = ? WHERE author_id = ?').run(req.user.id, target.id);
  if (target.slug && req.user.slug && target.slug !== req.user.slug) {
    db.prepare(`
      INSERT INTO redirects (from_path, to_path, status_code) VALUES (?, ?, 301)
      ON CONFLICT(from_path) DO UPDATE SET to_path = excluded.to_path, status_code = 301
    `).run(`/author/${target.slug}`, `/author/${req.user.slug}`);
  }
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  pageCache.clear();
  return res.redirect('/admin/users?msg=Author+deleted+successfully');
});

// 2. Editorial Calendar & Approval Queue
router.get('/calendar', (req, res) => {
  const posts = db.prepare(`
    SELECT p.id, p.title, p.slug, p.status, p.region, p.published_at, p.is_featured, p.is_breaking,
           c.name AS category_name, c.accent_color AS category_color,
           u.name AS author_name
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN users u ON u.id = p.author_id
    ORDER BY p.published_at DESC
    LIMIT 100
  `).all();

  const grouped = {
    in_review: posts.filter((p) => p.status === 'in_review'),
    scheduled: posts.filter((p) => p.status === 'scheduled'),
    draft: posts.filter((p) => p.status === 'draft'),
    published: posts.filter((p) => p.status === 'published')
  };

  res.render('admin/calendar', {
    adminPage: 'calendar',
    grouped,
    flash: req.query.msg || null
  });
});

// 3. SEO Management (301 Redirects, Canonical Validator, Schema Validation, Broken Link Checker)
router.get('/seo-tools', (req, res) => {
  const redirects = db.prepare('SELECT * FROM redirects ORDER BY created_at DESC').all();
  const posts = db.prepare(`
    SELECT p.*, u.name AS author_name
    FROM posts p
    LEFT JOIN users u ON u.id = p.author_id
    WHERE p.status = 'published'
    ORDER BY p.published_at DESC
  `).all();

  const knownPostSlugs = new Set(posts.map((p) => p.slug));
  const knownCatSlugs = new Set(res.locals.categories.map((c) => c.slug));

  const audits = posts.map((post) => {
    const schemaCheck = validatePostSchema(post, { name: post.author_name });
    const canonicalExpected = `${res.locals.siteUrl}/article/${post.slug}`;
    const canonicalVal = (post.canonical_url || '').trim();
    const canonicalValid = !canonicalVal || /^https?:\/\//i.test(canonicalVal);

    const links = extractLinksFromMarkdown(post.content_md);
    const brokenInternal = [];
    for (const l of links) {
      if (l.url.startsWith('/article/')) {
        const s = l.url.replace(/^\/article\//, '').split(/[?#]/)[0];
        if (!knownPostSlugs.has(s)) brokenInternal.push(l.url);
      } else if (l.url.startsWith('/category/')) {
        const c = l.url.replace(/^\/category\//, '').split(/[?#]/)[0];
        if (!knownCatSlugs.has(c)) brokenInternal.push(l.url);
      }
    }

    return {
      id: post.id,
      title: post.title,
      slug: post.slug,
      canonicalEffective: canonicalVal || canonicalExpected,
      canonicalValid,
      schemaValid: schemaCheck.valid,
      schemaIssues: schemaCheck.issues,
      linkCount: links.length,
      brokenInternal
    };
  });

  res.render('admin/seo-tools', {
    adminPage: 'seo-tools',
    redirects,
    audits,
    indexNowKey: ensureIndexNowKey(),
    indexingReport: getLastIndexingReport(),
    websubHubUrl: WEBSUB_HUB_URL,
    flash: req.query.msg || null,
    error: req.query.err || null
  });
});

router.post('/seo-tools/ping-search', verifyCsrf, async (req, res) => {
  try {
    const base = res.locals.siteUrl;
    const latestPosts = db.prepare(`
      SELECT slug FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 5
    `).all();
    const urls = [
      `${base}/`,
      `${base}/sitemap.xml`,
      ...latestPosts.map((p) => `${base}/article/${p.slug}`)
    ];
    await purgeCloudflareUrls([`${base}/sitemap.xml`, `${base}/rss.xml`]).catch(() => {});
    const report = await notifySearchEngines(urls, base);
    const wsOk = report.websub?.ok ? `Google WebSub OK (${report.websub.status})` : (report.websub?.note || report.websub?.error || 'WebSub check URL');
    const inOk = report.indexNow?.ok ? `IndexNow OK (${report.indexNow.count} URLs)` : (report.indexNow?.note || report.indexNow?.error || 'IndexNow check');
    return res.redirect(`/admin/seo-tools?msg=${encodeURIComponent(`Search engines notified — ${wsOk} | ${inOk}`)}`);
  } catch (err) {
    return res.redirect(`/admin/seo-tools?err=${encodeURIComponent(err?.message || 'Failed to notify search engines')}`);
  }
});

router.post('/seo-tools/redirects', verifyCsrf, (req, res) => {
  let fromPath = String(req.body.from_path || '').trim();
  let toPath = String(req.body.to_path || '').trim();
  const statusCode = Number.parseInt(req.body.status_code || '301', 10) === 302 ? 302 : 301;

  if (!fromPath || !toPath) {
    return res.redirect('/admin/seo-tools?err=Both+Source+and+Target+paths+are+required');
  }
  if (!fromPath.startsWith('/')) fromPath = `/${fromPath}`;
  if (!toPath.startsWith('/') && !/^https?:\/\//i.test(toPath)) toPath = `/${toPath}`;

  db.prepare(`
    INSERT INTO redirects (from_path, to_path, status_code) VALUES (?, ?, ?)
    ON CONFLICT(from_path) DO UPDATE SET to_path = excluded.to_path, status_code = excluded.status_code
  `).run(fromPath, toPath, statusCode);
  pageCache.clear();

  res.redirect('/admin/seo-tools?msg=Redirect+saved');
});

router.post('/seo-tools/redirects/:id/delete', verifyCsrf, (req, res) => {
  db.prepare('DELETE FROM redirects WHERE id = ?').run(req.params.id);
  pageCache.clear();
  res.redirect('/admin/seo-tools?msg=Redirect+deleted');
});

// 4. Analytics Dashboard (Views, Country/Region, Engagement, Search, Newsletter)
router.get('/analytics', (req, res) => {
  const topArticles = db.prepare(`
    SELECT p.id, p.title, p.slug, p.views, p.helpful_yes, p.helpful_no, p.save_count,
           c.name AS category_name
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'published'
    ORDER BY p.views DESC
    LIMIT 15
  `).all();

  const trafficByRegion = db.prepare(`
    SELECT region_bucket, COUNT(*) AS hits
    FROM page_views
    GROUP BY region_bucket
    ORDER BY hits DESC
  `).all();

  const trafficByCountry = db.prepare(`
    SELECT country_code, COUNT(*) AS hits
    FROM page_views
    GROUP BY country_code
    ORDER BY hits DESC
    LIMIT 12
  `).all();

  const topSearches = db.prepare(`
    SELECT query, COUNT(*) AS searches, ROUND(AVG(results_count), 1) AS avg_results
    FROM search_logs
    GROUP BY query
    ORDER BY searches DESC
    LIMIT 20
  `).all();

  const newsletterStats = db.prepare(`
    SELECT source, COUNT(*) AS total
    FROM subscribers
    GROUP BY source
    ORDER BY total DESC
  `).all();

  const engagementTotals = db.prepare(`
    SELECT COALESCE(SUM(helpful_yes), 0) AS yes_total,
           COALESCE(SUM(helpful_no), 0) AS no_total,
           COALESCE(SUM(save_count), 0) AS saves_total,
           COALESCE(SUM(views), 0) AS views_total
    FROM posts
  `).get();

  res.render('admin/analytics', {
    adminPage: 'analytics',
    topArticles,
    trafficByRegion,
    trafficByCountry,
    topSearches,
    newsletterStats,
    engagementTotals
  });
});

// 5. AI Tools Directory Manager
router.get('/ai-tools', (req, res) => {
  const tools = db.prepare('SELECT * FROM ai_tools ORDER BY is_featured DESC, rating DESC, name ASC').all();
  res.render('admin/ai-tools', {
    adminPage: 'ai-tools',
    tools: tools.map((t) => ({ ...t, pros: safeJsonParse(t.pros_json, []), cons: safeJsonParse(t.cons_json, []) })),
    flash: req.query.msg || null
  });
});

router.post('/ai-tools', verifyCsrf, (req, res) => {
  const id = /^\d+$/.test(String(req.body.id || '').trim()) ? Number.parseInt(req.body.id, 10) : null;
  const name = String(req.body.name || '').trim();
  if (!name) return res.redirect('/admin/ai-tools');
  const slug = slugify(req.body.slug || name);
  const tagline = String(req.body.tagline || '').trim();
  const description = String(req.body.description || '').trim();
  const category = String(req.body.category || 'AI Assistant').trim();
  const pricingModel = String(req.body.pricing_model || 'Freemium').trim();
  const priceLabel = String(req.body.price_label || 'Freemium').trim();
  const rating = Math.max(1, Math.min(5, Number.parseFloat(req.body.rating || '4.5') || 4.5));
  const pros = String(req.body.pros || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const cons = String(req.body.cons || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const websiteUrl = String(req.body.website_url || '').trim();
  const logoColor = /^#[0-9a-fA-F]{6}$/.test(req.body.logo_color || '') ? req.body.logo_color : '#2563EB';
  const imageUrl = String(req.body.image_url || '').trim();
  const isFeatured = req.body.is_featured === '1' ? 1 : 0;

  if (id) {
    db.prepare(`
      UPDATE ai_tools SET
        name = ?, slug = ?, tagline = ?, description = ?, category = ?,
        pricing_model = ?, price_label = ?, rating = ?, pros_json = ?, cons_json = ?,
        website_url = ?, logo_color = ?, image_url = ?, is_featured = ?,
        updated_at = datetime('now')
      WHERE id = ?
    `).run(name, slug, tagline, description, category, pricingModel, priceLabel, rating, JSON.stringify(pros), JSON.stringify(cons), websiteUrl, logoColor, imageUrl, isFeatured, id);
  } else {
    db.prepare(`
      INSERT INTO ai_tools (name, slug, tagline, description, category, pricing_model, price_label, rating, pros_json, cons_json, website_url, logo_color, image_url, is_featured)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(slug) DO UPDATE SET
        name = excluded.name,
        tagline = excluded.tagline,
        description = excluded.description,
        category = excluded.category,
        pricing_model = excluded.pricing_model,
        price_label = excluded.price_label,
        rating = excluded.rating,
        pros_json = excluded.pros_json,
        cons_json = excluded.cons_json,
        website_url = excluded.website_url,
        logo_color = excluded.logo_color,
        image_url = excluded.image_url,
        is_featured = excluded.is_featured,
        updated_at = datetime('now')
    `).run(name, slug, tagline, description, category, pricingModel, priceLabel, rating, JSON.stringify(pros), JSON.stringify(cons), websiteUrl, logoColor, imageUrl, isFeatured);
  }

  pageCache.clear();
  triggerSelectiveSectionPurge(['/ai-tools', `/ai-tools/${slug}`]);
  res.redirect('/admin/ai-tools?msg=AI+Tool+saved');
});

router.post('/ai-tools/:id/delete', verifyCsrf, (req, res) => {
  db.prepare('DELETE FROM ai_tools WHERE id = ?').run(req.params.id);
  pageCache.clear();
  triggerSelectiveSectionPurge(['/ai-tools']);
  res.redirect('/admin/ai-tools?msg=AI+Tool+deleted');
});

// 6. Daily AI Briefings Manager
router.get('/briefings', (req, res) => {
  const briefings = db.prepare('SELECT * FROM daily_briefings ORDER BY briefing_date DESC').all();
  res.render('admin/briefings', {
    adminPage: 'briefings',
    briefings: briefings.map((b) => ({ ...b, items: safeJsonParse(b.items_json, []) })),
    flash: req.query.msg || null
  });
});

router.post('/briefings', verifyCsrf, (req, res) => {
  const title = String(req.body.title || '').trim();
  const briefingDate = String(req.body.briefing_date || new Date().toISOString().slice(0, 10)).trim();
  const summary = String(req.body.summary || '').trim();
  const status = req.body.status === 'draft' ? 'draft' : 'published';
  if (!title) return res.redirect('/admin/briefings');

  const lines = String(req.body.items_text || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const items = lines.map((line) => {
    const [tag = 'Brief', headline = line, itemSummary = '', url = ''] = line.split('|').map((p) => p.trim());
    return { tag, headline, summary: itemSummary, url };
  });

  const slug = slugify(`daily-briefing-${briefingDate}`);
  db.prepare(`
    INSERT INTO daily_briefings (title, slug, briefing_date, summary, items_json, status)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(briefing_date) DO UPDATE SET
      title = excluded.title,
      summary = excluded.summary,
      items_json = excluded.items_json,
      status = excluded.status
  `).run(title, slug, briefingDate, summary, JSON.stringify(items), status);

  pageCache.clear();
  triggerSelectiveSectionPurge(['/briefing', `/briefing/${slug}`]);
  res.redirect('/admin/briefings?msg=Briefing+saved');
});

router.post('/briefings/:id/delete', verifyCsrf, (req, res) => {
  db.prepare('DELETE FROM daily_briefings WHERE id = ?').run(req.params.id);
  pageCache.clear();
  triggerSelectiveSectionPurge(['/briefing']);
  res.redirect('/admin/briefings?msg=Briefing+deleted');
});

// 7. Tech News Timelines Manager
router.get('/timelines', (req, res) => {
  const timelines = db.prepare('SELECT * FROM timelines ORDER BY updated_at DESC').all();
  const events = db.prepare('SELECT * FROM timeline_events ORDER BY event_date DESC, id DESC').all();
  res.render('admin/timelines', {
    adminPage: 'timelines',
    timelines,
    events,
    flash: req.query.msg || null
  });
});

router.post('/timelines', verifyCsrf, (req, res) => {
  const title = String(req.body.title || '').trim();
  if (!title) return res.redirect('/admin/timelines');
  const slug = slugify(req.body.slug || title);
  const description = String(req.body.description || '').trim();
  const categorySlug = String(req.body.category_slug || '').trim();
  const region = String(req.body.region || 'USA & Europe').trim();

  db.prepare(`
    INSERT INTO timelines (title, slug, description, category_slug, region, status)
    VALUES (?, ?, ?, ?, ?, 'published')
    ON CONFLICT(slug) DO UPDATE SET
      title = excluded.title,
      description = excluded.description,
      category_slug = excluded.category_slug,
      region = excluded.region,
      updated_at = datetime('now')
  `).run(title, slug, description, categorySlug, region);

  pageCache.clear();
  triggerSelectiveSectionPurge(['/timelines', `/timeline/${slug}`]);
  res.redirect('/admin/timelines?msg=Timeline+saved');
});

router.post('/timelines/events', verifyCsrf, (req, res) => {
  const timelineId = Number.parseInt(req.body.timeline_id, 10);
  const eventDate = String(req.body.event_date || new Date().toISOString().slice(0, 10)).trim();
  const headline = String(req.body.headline || '').trim();
  const summary = String(req.body.summary || '').trim();
  const postSlug = String(req.body.post_slug || '').trim();
  const sourceUrl = String(req.body.source_url || '').trim();
  const isMajor = req.body.is_major === '1' ? 1 : 0;

  if (!timelineId || !headline) return res.redirect('/admin/timelines');
  db.prepare(`
    INSERT INTO timeline_events (timeline_id, event_date, headline, summary, post_slug, source_url, is_major)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(timelineId, eventDate, headline, summary, postSlug, sourceUrl, isMajor);
  db.prepare("UPDATE timelines SET updated_at = datetime('now') WHERE id = ?").run(timelineId);

  pageCache.clear();
  triggerSelectiveSectionPurge(['/timelines']);
  res.redirect('/admin/timelines?msg=Timeline+event+added');
});

router.post('/timelines/events/:id/delete', verifyCsrf, (req, res) => {
  db.prepare('DELETE FROM timeline_events WHERE id = ?').run(req.params.id);
  pageCache.clear();
  triggerSelectiveSectionPurge(['/timelines']);
  res.redirect('/admin/timelines?msg=Timeline+event+deleted');
});

// 8. System Health, Backups & Error Monitoring
router.get('/system', requireRole('admin'), (req, res) => {
  const backups = listBackups();
  const errorLogs = db.prepare('SELECT * FROM error_logs ORDER BY created_at DESC LIMIT 40').all();
  const loginAttempts = db.prepare('SELECT * FROM login_attempts ORDER BY created_at DESC LIMIT 40').all();
  const mem = process.memoryUsage();

  res.render('admin/system', {
    adminPage: 'system',
    backups,
    errorLogs,
    loginAttempts,
    health: {
      uptimeSec: Math.round(process.uptime()),
      rssMb: Math.round(mem.rss / (1024 * 1024)),
      heapUsedMb: Math.round(mem.heapUsed / (1024 * 1024)),
      cacheEntries: pageCache.size(),
      nodeVersion: process.version
    },
    flash: req.query.msg || null
  });
});

router.post('/system/unlock-logins', requireRole('admin'), verifyCsrf, (req, res) => {
  clearLoginLockouts();
  res.redirect('/admin/system?msg=Login+lockouts+cleared');
});

router.post('/system/backup', requireRole('admin'), verifyCsrf, (req, res) => {
  const info = createDatabaseBackup('manual');
  res.redirect(`/admin/system?msg=${encodeURIComponent('Backup created: ' + info.filename)}`);
});

router.get('/system/backups/:filename', requireRole('admin'), (req, res) => {
  const filePath = getBackupPath(req.params.filename);
  if (!filePath) return res.status(404).send('Backup not found.');
  res.download(filePath);
});

router.post('/system/errors/clear', requireRole('admin'), verifyCsrf, (req, res) => {
  db.prepare('DELETE FROM error_logs').run();
  res.redirect('/admin/system?msg=Error+logs+cleared');
});

// 9. Social Distribution Queue (Reddit, X, Bluesky, LinkedIn, Hacker News)
router.get('/social', (req, res) => {
  const queue = db.prepare(`
    SELECT sp.*, p.title AS post_title, p.slug AS post_slug
    FROM social_posts sp
    LEFT JOIN posts p ON p.id = sp.post_id
    ORDER BY CASE WHEN sp.status = 'queued' THEN 0 ELSE 1 END, sp.created_at DESC
    LIMIT 80
  `).all();

  const publishedPosts = db.prepare(`
    SELECT id, title, slug FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 40
  `).all();

  res.render('admin/social', {
    adminPage: 'social',
    queue,
    publishedPosts,
    flash: req.query.msg || null
  });
});

router.post('/social/generate', verifyCsrf, (req, res) => {
  const postId = Number.parseInt(req.body.post_id, 10);
  const post = db.prepare("SELECT * FROM posts WHERE id = ? AND status = 'published'").get(postId);
  if (!post) return res.redirect('/admin/social');

  const selectedPlatforms = Array.isArray(req.body.platforms)
    ? req.body.platforms
    : req.body.platforms
      ? [req.body.platforms]
      : ['x', 'bluesky', 'reddit', 'linkedin', 'hackernews'];

  const drafts = generateDraftSocialPosts(post, res.locals.siteUrl)
    .filter((d) => selectedPlatforms.includes(d.platform));

  const ins = db.prepare(`
    INSERT INTO social_posts (post_id, platform, copy_text, share_url, status)
    VALUES (?, ?, ?, ?, 'queued')
  `);
  for (const d of drafts) {
    ins.run(post.id, d.platform, d.copy_text, d.share_url);
  }

  res.redirect(`/admin/social?msg=${encodeURIComponent(`Generated ${drafts.length} social cards/posts`)}`);
});

router.post('/social/:id/publish', verifyCsrf, async (req, res) => {
  const item = db.prepare('SELECT * FROM social_posts WHERE id = ?').get(req.params.id);
  if (!item) return res.redirect('/admin/social');

  const post = item.post_id ? db.prepare('SELECT * FROM posts WHERE id = ?').get(item.post_id) : null;
  const copyText = String(req.body.copy_text || item.copy_text).trim();
  const updatedItem = { ...item, copy_text: copyText };

  const outcome = await publishSocialPost(updatedItem, post, res.locals.settings);
  db.prepare(`
    UPDATE social_posts SET copy_text = ?, status = 'posted', posted_at = datetime('now'), response_note = ?
    WHERE id = ?
  `).run(copyText, outcome.note || '', item.id);

  res.redirect(`/admin/social?msg=${encodeURIComponent(outcome.note || 'Marked posted')}`);
});

router.post('/social/:id/delete', verifyCsrf, (req, res) => {
  db.prepare('DELETE FROM social_posts WHERE id = ?').run(req.params.id);
  res.redirect('/admin/social?msg=Social+item+removed');
});

// 10. Web Push Breaking News Console
router.get('/push', (req, res) => {
  const { publicKey, subject } = ensureVapidKeys();
  const subscriberCount = db.prepare('SELECT COUNT(*) AS c FROM push_subscriptions').get().c;
  const campaigns = db.prepare('SELECT * FROM push_campaigns ORDER BY created_at DESC LIMIT 30').all();
  const recentPosts = db.prepare("SELECT id, title, slug, excerpt FROM posts WHERE status = 'published' ORDER BY published_at DESC LIMIT 15").all();

  res.render('admin/push', {
    adminPage: 'push',
    publicKey,
    subject,
    subscriberCount,
    campaigns,
    recentPosts,
    flash: req.query.msg || null
  });
});

router.post('/push/send', verifyCsrf, async (req, res) => {
  const title = String(req.body.title || '').trim();
  const body = String(req.body.body || '').trim();
  const url = String(req.body.url || '/').trim() || '/';
  if (!title || !body) {
    return res.redirect('/admin/push?msg=Title+and+message+required');
  }
  const result = await sendBreakingPushNotification({ title, body, url, createdBy: req.user.id });
  res.redirect(`/admin/push?msg=${encodeURIComponent(`Breaking Push sent to ${result.sent} subscribers (${result.failed} failed)`)}`);
});

export default router;
