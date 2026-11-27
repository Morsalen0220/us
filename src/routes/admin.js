import express from 'express';
import multer from 'multer';
import { db, safeJsonParse, setSetting, syncPostTags } from '../db/database.js';
import { NODE_ENV } from '../config.js';
import { requireAdmin, SESSION_COOKIE_NAME, verifyCsrf } from '../middleware/authMiddleware.js';
import adminExtendedRoutes from './adminExtended.js';
import {
  checkLoginRateLimit,
  createSessionToken,
  getBackoffDelayMs,
  hashPassword,
  recordLoginAttempt,
  verifyPassword,
  verifyPasswordConstantTime
} from '../utils/auth.js';
import { pageCache } from '../utils/cache.js';
import { getCloudflareConfig, purgeCloudflareUrls, triggerSelectivePostPurge, triggerSelectiveSectionPurge } from '../utils/cloudflare.js';
import { deleteUploadedFiles, processAvatarImage, processUploadedImage } from '../utils/imageProcessor.js';
import { injectMidArticleAd, renderArticleContent } from '../utils/markdown.js';
import { sendBreakingPushNotification } from '../utils/push.js';
import { slugify } from '../utils/seo.js';
import { buildPlatformShareLinks, generateDraftSocialPosts } from '../utils/social.js';
import { parseYouTubeUrl } from '../utils/video.js';

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed (JPEG, PNG, WebP, GIF, AVIF, BMP, TIFF, SVG).'));
    }
  }
});

function generateUniquePostSlug(desiredSlug, excludeId = null) {
  const base = slugify(desiredSlug || 'article');
  let candidate = base;
  let counter = 2;
  while (true) {
    const row = excludeId
      ? db.prepare('SELECT id FROM posts WHERE slug = ? AND id != ?').get(candidate, excludeId)
      : db.prepare('SELECT id FROM posts WHERE slug = ?').get(candidate);
    if (!row) return candidate;
    candidate = `${base}-${counter}`;
    counter += 1;
  }
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect('/admin');
  res.render('admin/login', { error: null, email: '' });
});

router.post('/login', async (req, res) => {
  const ip = req.ip || req.socket?.remoteAddress || 'unknown';
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const userAgent = req.headers['user-agent'] || '';

  const rate = checkLoginRateLimit(ip, email);
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(rate.retryAfterSec));
    return res.status(429).render('admin/login', {
      error: `Account/IP temporarily locked after repeated failures. Please wait ${rate.retryAfterSec} seconds.`,
      email
    });
  }

  const user = db.prepare('SELECT * FROM users WHERE lower(email) = ? LIMIT 1').get(email);
  const valid = verifyPasswordConstantTime(password, user ? user.password_hash : null);

  if (!user || !valid) {
    recordLoginAttempt({ ip, email, success: false, userAgent });
    const delayMs = getBackoffDelayMs(rate.recentFails + 1);
    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }
    const left = Math.max(0, rate.remainingAttempts - 1);
    return res.status(401).render('admin/login', {
      error: `Invalid email or password.${left > 0 ? ` (${left} attempts remaining before lockout)` : ''}`,
      email
    });
  }

  recordLoginAttempt({ ip, email, success: true, userAgent });
  const token = createSessionToken(user);
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: NODE_ENV === 'production' && req.secure,
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/'
  });
  return res.redirect('/admin');
});

router.post('/logout', requireAdmin, verifyCsrf, (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
  res.redirect('/admin/login');
});

router.use(requireAdmin);
router.use(adminExtendedRoutes);

router.get('/', (req, res) => {
  const stats = {
    publishedPosts: db.prepare("SELECT COUNT(*) AS count FROM posts WHERE status = 'published'").get().count,
    draftPosts: db.prepare("SELECT COUNT(*) AS count FROM posts WHERE status = 'draft'").get().count,
    scheduledPosts: db.prepare("SELECT COUNT(*) AS count FROM posts WHERE status = 'scheduled'").get().count,
    reviewPosts: db.prepare("SELECT COUNT(*) AS count FROM posts WHERE status = 'in_review'").get().count,
    totalViews: db.prepare('SELECT COALESCE(SUM(views), 0) AS total FROM posts').get().total,
    mediaCount: db.prepare('SELECT COUNT(*) AS count FROM media').get().count,
    subscribersCount: db.prepare('SELECT COUNT(*) AS count FROM subscribers').get().count,
    unreadMessages: db.prepare('SELECT COUNT(*) AS count FROM contact_messages WHERE is_read = 0').get().count
  };

  const mediaStats = db.prepare(`
    SELECT COALESCE(SUM(original_size), 0) AS orig, COALESCE(SUM(webp_size), 0) AS webp
    FROM media WHERE original_size > 0 AND webp_size > 0
  `).get();
  stats.webpSavingsPercent = mediaStats.orig > 0
    ? Math.max(0, Math.round(((mediaStats.orig - mediaStats.webp) / mediaStats.orig) * 100))
    : 0;
  stats.webpBytesSaved = Math.max(0, (mediaStats.orig || 0) - (mediaStats.webp || 0));

  const recentPosts = db.prepare(`
    SELECT p.id, p.title, p.slug, p.status, p.views, p.reading_time, p.published_at, p.featured_image_thumb,
           c.name AS category_name, c.accent_color AS category_color
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    ORDER BY p.updated_at DESC
    LIMIT 8
  `).all();

  const topPosts = db.prepare(`
    SELECT id, title, slug, views, meta_title, featured_image
    FROM posts
    WHERE status = 'published'
    ORDER BY views DESC
    LIMIT 5
  `).all();

  res.render('admin/dashboard', {
    adminPage: 'dashboard',
    stats,
    recentPosts,
    topPosts,
    flash: req.query.msg || null
  });
});

router.get('/posts', (req, res) => {
  const statusFilter = String(req.query.status || 'all');
  const categoryFilter = String(req.query.category || 'all');
  const q = String(req.query.q || '').trim();

  const where = [];
  const params = [];

  if (['published', 'draft', 'scheduled', 'in_review'].includes(statusFilter)) {
    where.push('p.status = ?');
    params.push(statusFilter);
  }
  if (categoryFilter !== 'all' && /^\d+$/.test(categoryFilter)) {
    where.push('p.category_id = ?');
    params.push(Number.parseInt(categoryFilter, 10));
  }
  if (q) {
    where.push('(p.title LIKE ? OR p.meta_tags LIKE ? OR p.slug LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const posts = db.prepare(`
    SELECT p.id, p.title, p.slug, p.status, p.region, p.is_featured, p.is_trending, p.is_breaking, p.is_editors_pick,
           p.views, p.word_count, p.reading_time, p.published_at, p.updated_at,
           p.featured_image_thumb, p.meta_title, p.meta_description,
           c.name AS category_name, c.accent_color AS category_color,
           u.name AS author_name
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    LEFT JOIN users u ON u.id = p.author_id
    ${whereSql}
    ORDER BY p.updated_at DESC
    LIMIT 100
  `).all(...params);

  const rawCounts = db.prepare('SELECT status, COUNT(*) AS cnt FROM posts GROUP BY status').all();
  const statusCounts = { all: 0, published: 0, draft: 0, scheduled: 0, in_review: 0 };
  for (const row of rawCounts) {
    statusCounts.all += row.cnt;
    if (Object.hasOwn(statusCounts, row.status)) {
      statusCounts[row.status] = row.cnt;
    }
  }

  res.render('admin/posts', {
    adminPage: 'posts',
    posts,
    statusCounts,
    filters: { status: statusFilter, category: categoryFilter, q },
    flash: req.query.msg || null
  });
});

function parseTakeaways(raw) {
  return String(raw || '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 8);
}

function parseSources(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf('|');
      if (idx > 0) {
        return { label: line.slice(0, idx).trim(), url: line.slice(idx + 1).trim() };
      }
      return { label: line, url: line };
    })
    .filter((s) => s.url);
}

function parseCorrections(raw) {
  return String(raw || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf('|');
      if (idx > 0) {
        return { date: line.slice(0, idx).trim(), note: line.slice(idx + 1).trim() };
      }
      return { date: new Date().toISOString().slice(0, 10), note: line };
    });
}

function formatSourcesText(jsonStr) {
  return safeJsonParse(jsonStr, []).map((s) => `${s.label} | ${s.url}`).join('\n');
}

function formatCorrectionsText(jsonStr) {
  return safeJsonParse(jsonStr, []).map((c) => `${c.date} | ${c.note}`).join('\n');
}

function getAuthorsList() {
  return db.prepare('SELECT id, name, role, job_title FROM users ORDER BY id ASC').all();
}

router.get('/posts/new', (req, res) => {
  const mediaLibrary = db.prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT 40').all();
  res.render('admin/post-editor', {
    adminPage: 'new-post',
    post: {
      id: null,
      title: '',
      subtitle: '',
      slug: '',
      excerpt: '',
      content_md: '',
      category_id: res.locals.categories[0]?.id || '',
      author_id: req.user.id,
      status: 'draft',
      region: 'USA & Europe',
      is_featured: 1,
      is_trending: 1,
      is_breaking: 0,
      is_editors_pick: 0,
      featured_image: '',
      featured_image_thumb: '',
      featured_image_width: 1400,
      featured_image_height: 788,
      featured_image_title: '',
      featured_image_alt: '',
      featured_image_caption: '',
      featured_image_description: '',
      meta_title: '',
      meta_subtitle: '',
      meta_description: '',
      meta_tags: '',
      focus_keyword: '',
      canonical_url: '',
      robots: 'index, follow',
      key_takeaways_text: '',
      whats_new: '',
      fact_check_status: '',
      last_fact_checked: '',
      official_sources_text: '',
      corrections_text: '',
      video_url: '',
      video_title: '',
      video_duration: '',
      video_is_short: 0,
      published_at: ''
    },
    authors: getAuthorsList(),
    revisions: [],
    mediaLibrary,
    error: null,
    saved: false
  });
});

function renderAdminArticlePreview(req, res, previewPostData) {
  const { settings, siteUrl, getRawAdHtml } = res.locals;

  const categoryId = /^\d+$/.test(String(previewPostData.category_id || ''))
    ? Number.parseInt(previewPostData.category_id, 10)
    : null;
  const authorId = /^\d+$/.test(String(previewPostData.author_id || ''))
    ? Number.parseInt(previewPostData.author_id, 10)
    : (req.user?.id || null);

  const cat = categoryId
    ? db.prepare('SELECT id, name, slug, accent_color FROM categories WHERE id = ? LIMIT 1').get(categoryId)
    : null;
  const author = authorId
    ? db.prepare('SELECT id, name, slug, job_title, expertise, bio, avatar_url, twitter_handle, linkedin_url, website_url, location FROM users WHERE id = ? LIMIT 1').get(authorId)
    : null;

  const contentMd = String(previewPostData.content_md || '');
  const rendered = renderArticleContent(contentMd);
  const title = String(previewPostData.title || '').trim() || 'Untitled Article Preview';
  const subtitle = String(previewPostData.subtitle || '').trim();
  const slug = slugify(previewPostData.slug || title) || 'preview-draft';

  let excerpt = String(previewPostData.excerpt || '').trim();
  if (!excerpt && contentMd) {
    excerpt = contentMd
      .replace(/[#>*`_\[\]\(\)]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
  }

  const post = {
    id: previewPostData.id || null,
    title,
    subtitle,
    slug,
    excerpt,
    status: previewPostData.status || 'draft',
    region: previewPostData.region || 'USA & Europe',
    fact_check_status: String(previewPostData.fact_check_status || '').trim(),
    last_fact_checked: previewPostData.last_fact_checked || '',
    featured_image: String(previewPostData.featured_image || '').trim(),
    featured_image_width: Number.parseInt(previewPostData.featured_image_width || '1400', 10) || 1400,
    featured_image_height: Number.parseInt(previewPostData.featured_image_height || '788', 10) || 788,
    featured_image_title: String(previewPostData.featured_image_title || '').trim(),
    featured_image_alt: String(previewPostData.featured_image_alt || '').trim(),
    featured_image_caption: String(previewPostData.featured_image_caption || '').trim(),
    featured_image_description: String(previewPostData.featured_image_description || '').trim(),
    whats_new: String(previewPostData.whats_new || '').trim(),
    video_url: String(previewPostData.video_url || '').trim(),
    video_title: String(previewPostData.video_title || '').trim(),
    video_duration: String(previewPostData.video_duration || '').trim(),
    video_is_short: Number(previewPostData.video_is_short) || 0,
    helpful_yes: Number(previewPostData.helpful_yes) || 0,
    helpful_no: Number(previewPostData.helpful_no) || 0,
    reading_time: rendered.readingTime,
    word_count: rendered.wordCount,
    published_at: previewPostData.published_at || new Date().toISOString(),
    updated_at: previewPostData.updated_at || new Date().toISOString(),
    category_id: cat?.id || categoryId,
    category_name: cat?.name || null,
    category_slug: cat?.slug || null,
    category_color: cat?.accent_color || '#2563EB',
    author_name: author?.name || req.user?.name || 'TechHaven Editorial',
    author_slug: author?.slug || 'alex-mercer',
    author_job_title: author?.job_title || '',
    author_expertise: author?.expertise || '',
    author_bio: author?.bio || '',
    author_avatar: author?.avatar_url || ''
  };

  const midParagraph = Number.parseInt(settings.ads_mid_paragraph || '3', 10) || 3;
  const midAdInner = getRawAdHtml('ads_slot_article_mid');
  const articleBodyHtml = midAdInner
    ? injectMidArticleAd(rendered.html, `<div class="ad-label">Advertisement</div>${midAdInner}`, midParagraph)
    : rendered.html;

  const keyTakeaways = Array.isArray(previewPostData.keyTakeaways)
    ? previewPostData.keyTakeaways
    : parseTakeaways(previewPostData.key_takeaways_text);
  const officialSources = Array.isArray(previewPostData.officialSources)
    ? previewPostData.officialSources
    : parseSources(previewPostData.official_sources_text);
  const corrections = Array.isArray(previewPostData.corrections)
    ? previewPostData.corrections
    : parseCorrections(previewPostData.corrections_text);

  const tags = String(previewPostData.meta_tags || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean)
    .map((name) => ({ name, slug: slugify(name) || 'tag' }));

  const relatedPosts = db.prepare(`
    SELECT p.*, c.name AS category_name, c.slug AS category_slug, c.accent_color AS category_color
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'published' AND p.id != ? AND (p.category_id = ? OR p.category_id IS NOT NULL)
    ORDER BY CASE WHEN p.category_id = ? THEN 0 ELSE 1 END, p.published_at DESC
    LIMIT 4
  `).all(post.id || 0, post.category_id || 0, post.category_id || 0);

  const trendingPosts = db.prepare(`
    SELECT p.*, c.name AS category_name, c.slug AS category_slug
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'published'
    ORDER BY p.is_trending DESC, p.views DESC, p.published_at DESC
    LIMIT 5
  `).all();

  const videoInfo = parseYouTubeUrl(post.video_url);
  if (videoInfo && !post.video_is_short && videoInfo.isShort) {
    post.video_is_short = 1;
  }

  const shareLinks = buildPlatformShareLinks(post, siteUrl);

  res.setHeader('Cache-Control', 'no-store');
  return res.render('public/article', {
    isPreview: true,
    previewStatus: post.status,
    post,
    articleBodyHtml,
    toc: rendered.toc,
    keyTakeaways,
    officialSources,
    corrections,
    videoInfo,
    shareLinks,
    tags,
    relatedPosts,
    trendingPosts,
    seo: {
      title: `[Preview] ${previewPostData.meta_title || post.title} — ${settings.site_name || 'TechHaven US'}`,
      subtitle: previewPostData.meta_subtitle || post.subtitle || post.excerpt,
      description: previewPostData.meta_description || post.excerpt,
      tags: previewPostData.meta_tags || tags.map((t) => t.name).join(', '),
      canonical: `${siteUrl}/article/${post.slug}`,
      ogType: 'article',
      ogImage: post.featured_image ? `${siteUrl}${post.featured_image}` : `${siteUrl}/favicon.svg`,
      robots: 'noindex, nofollow'
    },
    jsonLdList: []
  });
}

function decodeContentMd(body) {
  if (body && typeof body.content_md_b64 === 'string' && body.content_md_b64.length > 0) {
    try {
      return Buffer.from(body.content_md_b64, 'base64').toString('utf8');
    } catch {
      // Fallback to raw content_md
    }
  }
  return String((body && body.content_md) || '');
}

router.post('/posts/preview', verifyCsrf, (req, res) => {
  const b = req.body || {};
  const parsedPublished = String(b.published_at || '').trim() ? new Date(String(b.published_at).trim()) : null;
  const publishedAtIso = parsedPublished && !Number.isNaN(parsedPublished.getTime())
    ? parsedPublished.toISOString()
    : new Date().toISOString();

  return renderAdminArticlePreview(req, res, {
    id: /^\d+$/.test(String(b.preview_post_id || '')) ? Number.parseInt(b.preview_post_id, 10) : null,
    title: b.title,
    subtitle: b.subtitle,
    slug: b.slug,
    excerpt: b.excerpt,
    content_md: decodeContentMd(b),
    category_id: b.category_id,
    author_id: b.author_id,
    status: ['published', 'draft', 'scheduled', 'in_review'].includes(b.status) ? b.status : 'draft',
    region: b.region,
    fact_check_status: b.fact_check_status,
    last_fact_checked: b.last_fact_checked,
    featured_image: b.featured_image,
    featured_image_width: b.featured_image_width,
    featured_image_height: b.featured_image_height,
    featured_image_title: b.featured_image_title,
    featured_image_alt: b.featured_image_alt,
    featured_image_caption: b.featured_image_caption,
    featured_image_description: b.featured_image_description,
    meta_title: b.meta_title,
    meta_subtitle: b.meta_subtitle,
    meta_description: b.meta_description,
    meta_tags: b.meta_tags,
    whats_new: b.whats_new,
    key_takeaways_text: b.key_takeaways_text,
    official_sources_text: b.official_sources_text,
    corrections_text: b.corrections_text,
    video_url: b.video_url,
    video_title: b.video_title,
    video_duration: b.video_duration,
    video_is_short: b.video_is_short === '1' || b.video_is_short === 'on' ? 1 : 0,
    published_at: publishedAtIso
  });
});

router.get('/posts/:id/preview', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? LIMIT 1').get(req.params.id);
  if (!post) return res.redirect('/admin/posts');

  return renderAdminArticlePreview(req, res, {
    ...post,
    keyTakeaways: safeJsonParse(post.key_takeaways_json, []),
    officialSources: safeJsonParse(post.official_sources_json, []),
    corrections: safeJsonParse(post.corrections_json, [])
  });
});

router.get('/posts/:id/edit', (req, res) => {
  const post = db.prepare('SELECT * FROM posts WHERE id = ? LIMIT 1').get(req.params.id);
  if (!post) return res.redirect('/admin/posts');
  const mediaLibrary = db.prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT 40').all();
  const revisions = db.prepare(`
    SELECT r.*, u.name AS editor_name
    FROM post_revisions r
    LEFT JOIN users u ON u.id = r.edited_by
    WHERE r.post_id = ?
    ORDER BY r.created_at DESC
    LIMIT 15
  `).all(post.id);

  const editablePost = {
    ...post,
    key_takeaways_text: safeJsonParse(post.key_takeaways_json, []).join('\n'),
    official_sources_text: formatSourcesText(post.official_sources_json),
    corrections_text: formatCorrectionsText(post.corrections_json),
    published_at: (post.published_at || new Date().toISOString()).slice(0, 16)
  };

  res.render('admin/post-editor', {
    adminPage: 'posts',
    post: editablePost,
    authors: getAuthorsList(),
    revisions,
    mediaLibrary,
    error: null,
    saved: req.query.saved || ''
  });
});

function extractPostPayload(body, existingId = null, currentUser = null, existingPost = null) {
  const submitAction = String(body.submit_action || '').trim();
  let title = String(body.title || '').trim();
  if (submitAction === 'draft' && !title) {
    title = 'Untitled Draft';
  }
  const subtitle = String(body.subtitle || '').trim();
  const slug = generateUniquePostSlug(body.slug || title, existingId);
  const contentMd = decodeContentMd(body);
  const rendered = renderArticleContent(contentMd);

  let excerpt = String(body.excerpt || '').trim();
  if (!excerpt && contentMd) {
    excerpt = contentMd
      .replace(/[#>*`_\[\]\(\)]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
  }

  let status = ['published', 'draft', 'scheduled', 'in_review'].includes(body.status) ? body.status : 'draft';
  if (submitAction === 'draft') {
    status = 'draft';
  } else if (submitAction === 'publish') {
    if (body.status === 'scheduled') {
      status = 'scheduled';
    } else if (body.status === 'in_review') {
      status = 'in_review';
    } else {
      status = 'published';
    }
  }

  const publishedAtInput = String(body.published_at || '').trim();
  let publishedAt = (existingPost && existingPost.status === 'published' && existingPost.published_at)
    ? existingPost.published_at
    : new Date().toISOString();

  if (status === 'scheduled' && publishedAtInput) {
    const parsed = new Date(publishedAtInput);
    if (!Number.isNaN(parsed.getTime())) {
      publishedAt = parsed.toISOString();
    }
  }

  if (currentUser?.role === 'author' && status === 'published') {
    status = 'in_review';
  }
  if (status === 'scheduled' && new Date(publishedAt).getTime() <= Date.now()) {
    status = currentUser?.role === 'author' ? 'in_review' : 'published';
  }

  const validRegions = ['USA', 'Europe', 'USA & Europe', 'Global'];
  const region = validRegions.includes(body.region) ? body.region : 'Global';

  return {
    title,
    subtitle,
    slug,
    excerpt,
    content_md: contentMd,
    content_html: rendered.html,
    toc_json: JSON.stringify(rendered.toc),
    word_count: rendered.wordCount,
    reading_time: rendered.readingTime,
    category_id: /^\d+$/.test(String(body.category_id || '')) ? Number.parseInt(body.category_id, 10) : null,
    author_id: /^\d+$/.test(String(body.author_id || '')) ? Number.parseInt(body.author_id, 10) : (currentUser?.id || 1),
    status,
    region,
    is_featured: body.is_featured === '1' || body.is_featured === 'on' ? 1 : 0,
    is_trending: body.is_trending === '1' || body.is_trending === 'on' ? 1 : 0,
    is_breaking: body.is_breaking === '1' || body.is_breaking === 'on' ? 1 : 0,
    is_editors_pick: body.is_editors_pick === '1' || body.is_editors_pick === 'on' ? 1 : 0,
    featured_image: String(body.featured_image || '').trim(),
    featured_image_thumb: String(body.featured_image_thumb || '').trim(),
    featured_image_width: Number.parseInt(body.featured_image_width || '1400', 10) || 1400,
    featured_image_height: Number.parseInt(body.featured_image_height || '788', 10) || 788,
    featured_image_title: String(body.featured_image_title || '').trim(),
    featured_image_alt: String(body.featured_image_alt || '').trim(),
    featured_image_caption: String(body.featured_image_caption || '').trim(),
    featured_image_description: String(body.featured_image_description || '').trim(),
    meta_title: String(body.meta_title || '').trim() || title.slice(0, 65),
    meta_subtitle: String(body.meta_subtitle || '').trim() || subtitle,
    meta_description: String(body.meta_description || '').trim() || excerpt.slice(0, 160),
    meta_tags: String(body.meta_tags || '').trim(),
    focus_keyword: String(body.focus_keyword || '').trim(),
    canonical_url: String(body.canonical_url || '').trim(),
    robots: String(body.robots || 'index, follow').trim() || 'index, follow',
    key_takeaways_json: JSON.stringify(parseTakeaways(body.key_takeaways_text)),
    whats_new: String(body.whats_new || '').trim(),
    fact_check_status: String(body.fact_check_status || '').trim(),
    last_fact_checked: String(body.last_fact_checked || '').trim(),
    official_sources_json: JSON.stringify(parseSources(body.official_sources_text)),
    corrections_json: JSON.stringify(parseCorrections(body.corrections_text)),
    video_url: String(body.video_url || '').trim(),
    video_title: String(body.video_title || '').trim(),
    video_duration: String(body.video_duration || '').trim(),
    video_is_short: body.video_is_short === '1' || parseYouTubeUrl(body.video_url || '')?.isShort ? 1 : 0,
    published_at: publishedAt
  };
}

router.post('/posts', verifyCsrf, async (req, res) => {
  const payload = extractPostPayload(req.body, null, req.user);
  if (!payload.title) {
    const mediaLibrary = db.prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT 40').all();
    return res.status(400).render('admin/post-editor', {
      adminPage: 'new-post',
      post: { id: null, ...payload, key_takeaways_text: req.body.key_takeaways_text || '', official_sources_text: req.body.official_sources_text || '', corrections_text: req.body.corrections_text || '' },
      authors: getAuthorsList(),
      revisions: [],
      mediaLibrary,
      error: 'Article title is required.',
      saved: false
    });
  }

  const result = db.prepare(`
    INSERT INTO posts (
      title, subtitle, slug, excerpt, content_md, content_html, toc_json,
      category_id, author_id, status, region, is_featured, is_trending, is_breaking, is_editors_pick,
      featured_image, featured_image_thumb, featured_image_width, featured_image_height,
      featured_image_title, featured_image_alt, featured_image_caption, featured_image_description,
      meta_title, meta_subtitle, meta_description, meta_tags, focus_keyword,
      canonical_url, robots, key_takeaways_json, whats_new, fact_check_status,
      last_fact_checked, official_sources_json, corrections_json,
      video_url, video_title, video_duration, video_is_short,
      reading_time, word_count, published_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    payload.title, payload.subtitle, payload.slug, payload.excerpt, payload.content_md, payload.content_html, payload.toc_json,
    payload.category_id, payload.author_id, payload.status, payload.region, payload.is_featured, payload.is_trending, payload.is_breaking, payload.is_editors_pick,
    payload.featured_image, payload.featured_image_thumb, payload.featured_image_width, payload.featured_image_height,
    payload.featured_image_title, payload.featured_image_alt, payload.featured_image_caption, payload.featured_image_description,
    payload.meta_title, payload.meta_subtitle, payload.meta_description, payload.meta_tags, payload.focus_keyword,
    payload.canonical_url, payload.robots, payload.key_takeaways_json, payload.whats_new, payload.fact_check_status,
    payload.last_fact_checked, payload.official_sources_json, payload.corrections_json,
    payload.video_url, payload.video_title, payload.video_duration, payload.video_is_short,
    payload.reading_time, payload.word_count, payload.published_at
  );

  const newId = Number(result.lastInsertRowid);
  syncPostTags(newId, payload.meta_tags);

  if (payload.status === 'published') {
    const savedPost = db.prepare('SELECT * FROM posts WHERE id = ?').get(newId);
    if (req.body.queue_social === '1' && savedPost) {
      const drafts = generateDraftSocialPosts(savedPost, res.locals.siteUrl);
      const ins = db.prepare('INSERT INTO social_posts (post_id, platform, copy_text, share_url, status) VALUES (?, ?, ?, ?, ?)');
      for (const d of drafts) ins.run(newId, d.platform, d.copy_text, d.share_url, 'queued');
    }
    if (req.body.send_push === '1' && savedPost) {
      await sendBreakingPushNotification({
        title: `🔴 ${savedPost.title}`,
        body: savedPost.excerpt || savedPost.subtitle,
        url: `/article/${savedPost.slug}`,
        createdBy: req.user.id
      }).catch(() => {});
    }
  }

  pageCache.clear();
  triggerSelectivePostPurge({ postId: newId });
  return res.redirect(`/admin/posts/${newId}/edit?saved=${payload.status === 'draft' ? 'draft' : '1'}`);
});

router.post('/posts/:id', verifyCsrf, async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!existing) return res.redirect('/admin/posts');

  const payload = extractPostPayload(req.body, id, req.user, existing);
  if (!payload.title) {
    const mediaLibrary = db.prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT 40').all();
    return res.status(400).render('admin/post-editor', {
      adminPage: 'posts',
      post: { id, ...payload, key_takeaways_text: req.body.key_takeaways_text || '', official_sources_text: req.body.official_sources_text || '', corrections_text: req.body.corrections_text || '' },
      authors: getAuthorsList(),
      revisions: [],
      mediaLibrary,
      error: 'Article title is required.',
      saved: false
    });
  }

  // Save snapshot into revision history before overwriting
  db.prepare(`
    INSERT INTO post_revisions (post_id, title, subtitle, content_md, meta_title, meta_description, edited_by, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, existing.title, existing.subtitle, existing.content_md, existing.meta_title, existing.meta_description, req.user.id, 'Updated via Editor');

  db.prepare(`
    UPDATE posts SET
      title = ?, subtitle = ?, slug = ?, excerpt = ?, content_md = ?, content_html = ?, toc_json = ?,
      category_id = ?, author_id = ?, status = ?, region = ?, is_featured = ?, is_trending = ?, is_breaking = ?, is_editors_pick = ?,
      featured_image = ?, featured_image_thumb = ?, featured_image_width = ?, featured_image_height = ?,
      featured_image_title = ?, featured_image_alt = ?, featured_image_caption = ?, featured_image_description = ?,
      meta_title = ?, meta_subtitle = ?, meta_description = ?, meta_tags = ?, focus_keyword = ?,
      canonical_url = ?, robots = ?, key_takeaways_json = ?, whats_new = ?, fact_check_status = ?,
      last_fact_checked = ?, official_sources_json = ?, corrections_json = ?,
      video_url = ?, video_title = ?, video_duration = ?, video_is_short = ?,
      reading_time = ?, word_count = ?, published_at = ?,
      updated_at = datetime('now')
    WHERE id = ?
  `).run(
    payload.title, payload.subtitle, payload.slug, payload.excerpt, payload.content_md, payload.content_html, payload.toc_json,
    payload.category_id, payload.author_id, payload.status, payload.region, payload.is_featured, payload.is_trending, payload.is_breaking, payload.is_editors_pick,
    payload.featured_image, payload.featured_image_thumb, payload.featured_image_width, payload.featured_image_height,
    payload.featured_image_title, payload.featured_image_alt, payload.featured_image_caption, payload.featured_image_description,
    payload.meta_title, payload.meta_subtitle, payload.meta_description, payload.meta_tags, payload.focus_keyword,
    payload.canonical_url, payload.robots, payload.key_takeaways_json, payload.whats_new, payload.fact_check_status,
    payload.last_fact_checked, payload.official_sources_json, payload.corrections_json,
    payload.video_url, payload.video_title, payload.video_duration, payload.video_is_short,
    payload.reading_time, payload.word_count, payload.published_at,
    id
  );

  syncPostTags(id, payload.meta_tags);

  if (payload.status === 'published') {
    const savedPost = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    if (req.body.queue_social === '1' && savedPost) {
      const drafts = generateDraftSocialPosts(savedPost, res.locals.siteUrl);
      const ins = db.prepare('INSERT INTO social_posts (post_id, platform, copy_text, share_url, status) VALUES (?, ?, ?, ?, ?)');
      for (const d of drafts) ins.run(id, d.platform, d.copy_text, d.share_url, 'queued');
    }
    if (req.body.send_push === '1' && savedPost) {
      await sendBreakingPushNotification({
        title: `🔴 ${savedPost.title}`,
        body: savedPost.excerpt || savedPost.subtitle,
        url: `/article/${savedPost.slug}`,
        createdBy: req.user.id
      }).catch(() => {});
    }
  }

  pageCache.clear();
  triggerSelectivePostPurge({ postId: id, oldPost: existing });
  return res.redirect(`/admin/posts/${id}/edit?saved=${payload.status === 'draft' ? 'draft' : '1'}`);
});

router.post('/posts/:id/restore/:revId', verifyCsrf, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const revId = Number.parseInt(req.params.revId, 10);
  const rev = db.prepare('SELECT * FROM post_revisions WHERE id = ? AND post_id = ?').get(revId, id);
  if (!rev) return res.redirect(`/admin/posts/${id}/edit`);

  const rendered = renderArticleContent(rev.content_md);
  db.prepare(`
    UPDATE posts SET
      title = ?, subtitle = ?, content_md = ?, content_html = ?, toc_json = ?,
      word_count = ?, reading_time = ?, meta_title = ?, meta_description = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(rev.title, rev.subtitle, rev.content_md, rendered.html, JSON.stringify(rendered.toc), rendered.wordCount, rendered.readingTime, rev.meta_title, rev.meta_description, id);

  pageCache.clear();
  triggerSelectivePostPurge({ postId: id });
  res.redirect(`/admin/posts/${id}/edit?saved=1`);
});

router.post('/posts/:id/approve', verifyCsrf, (req, res) => {
  if (!['admin', 'editor'].includes(req.user.role)) {
    return res.status(403).send('Only Editors or Admins can approve articles.');
  }
  const id = Number.parseInt(req.params.id, 10);
  db.prepare(`
    UPDATE posts SET status = 'published', reviewed_by = ?, reviewed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ?
  `).run(req.user.id, id);
  pageCache.clear();
  triggerSelectivePostPurge({ postId: id });
  res.redirect('/admin/calendar?msg=Article+approved+and+published');
});

router.post('/api/posts/:id/autosave', verifyCsrf, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT id, status FROM posts WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ ok: false });

  const title = String(req.body.title || '').trim();
  const subtitle = String(req.body.subtitle || '').trim();
  const contentMd = decodeContentMd(req.body);
  if (!title) return res.json({ ok: false, message: 'Title empty' });

  const rendered = renderArticleContent(contentMd);
  db.prepare(`
    UPDATE posts SET
      title = ?, subtitle = ?, content_md = ?, content_html = ?, toc_json = ?,
      word_count = ?, reading_time = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(title, subtitle, contentMd, rendered.html, JSON.stringify(rendered.toc), rendered.wordCount, rendered.readingTime, id);

  pageCache.clear();
  return res.json({ ok: true, savedAt: new Date().toLocaleTimeString('en-US') });
});

router.get('/api/seo/internal-links', (req, res) => {
  const q = String(req.query.q || '').trim();
  const excludeId = Number.parseInt(req.query.exclude || '0', 10) || 0;
  const terms = q.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 3).slice(0, 5);

  let rows = db.prepare(`
    SELECT p.id, p.title, p.slug, p.meta_tags, c.name AS category_name
    FROM posts p
    LEFT JOIN categories c ON c.id = p.category_id
    WHERE p.status = 'published' AND p.id != ?
    ORDER BY p.published_at DESC
    LIMIT 30
  `).all(excludeId);

  if (terms.length > 0) {
    rows = rows
      .map((r) => {
        const hay = `${r.title} ${r.meta_tags}`.toLowerCase();
        let score = 0;
        for (const t of terms) if (hay.includes(t)) score += 1;
        return { ...r, score };
      })
      .sort((a, b) => b.score - a.score);
  }

  res.json({ ok: true, suggestions: rows.slice(0, 6) });
});

router.post('/posts/:id/delete', verifyCsrf, (req, res) => {
  const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  db.prepare('DELETE FROM posts WHERE id = ?').run(req.params.id);
  pageCache.clear();
  if (existing) {
    triggerSelectivePostPurge({ oldPost: existing });
  }
  res.redirect('/admin/posts?msg=deleted');
});

router.get('/media', (req, res) => {
  const mediaList = db.prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT 120').all();
  res.render('admin/media', {
    adminPage: 'media',
    mediaList
  });
});

router.get('/api/media', (req, res) => {
  const items = db.prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT 80').all();
  res.json({ ok: true, items });
});

router.post('/api/media/upload', verifyCsrf, upload.single('image'), async (req, res) => {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ ok: false, error: 'No image file uploaded.' });
    }

    const processed = await processUploadedImage(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      { watermark: req.body?.watermark !== '0' }
    );

    const fallbackTitle = req.file.originalname.replace(/\.[^/.]+$/, '').replace(/[-_]+/g, ' ').trim();
    const title = String(req.body.title || fallbackTitle || 'TechHaven US Image').trim().slice(0, 200);
    const altText = String(req.body.alt_text || title).trim().slice(0, 250);
    const caption = String(req.body.caption || '').trim().slice(0, 400);
    const description = String(req.body.description || caption || altText).trim().slice(0, 600);

    const result = db.prepare(`
      INSERT INTO media (
        filename, thumb_filename, url, thumb_url, original_name, original_format,
        original_size, webp_size, width, height, title, alt_text, caption, description, uploaded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      processed.filename,
      processed.thumbFilename,
      processed.url,
      processed.thumbUrl,
      req.file.originalname,
      processed.originalFormat,
      processed.originalSize,
      processed.webpSize,
      processed.width,
      processed.height,
      title,
      altText,
      caption,
      description,
      req.user.id
    );

    const item = db.prepare('SELECT * FROM media WHERE id = ?').get(result.lastInsertRowid);
    return res.json({
      ok: true,
      item,
      conversion: {
        originalFormat: processed.originalFormat,
        originalSize: processed.originalSize,
        webpSize: processed.webpSize,
        savingsPercent: processed.savingsPercent
      }
    });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || 'Failed to convert image to WebP.' });
  }
});

router.post('/api/media/:id', verifyCsrf, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: 'Media item not found.' });
  }
  const title = String(req.body.title || existing.title).trim().slice(0, 200);
  const altText = String(req.body.alt_text || existing.alt_text).trim().slice(0, 250);
  const caption = String(req.body.caption ?? existing.caption).trim().slice(0, 400);
  const description = String(req.body.description ?? existing.description ?? '').trim().slice(0, 600);

  db.prepare('UPDATE media SET title = ?, alt_text = ?, caption = ?, description = ? WHERE id = ?')
    .run(title, altText, caption, description, id);
  const updated = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  return res.json({ ok: true, item: updated });
});

router.delete('/api/media/:id', verifyCsrf, (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  const existing = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ ok: false, error: 'Media item not found.' });
  }
  deleteUploadedFiles(existing.filename, existing.thumb_filename);
  db.prepare('DELETE FROM media WHERE id = ?').run(id);
  pageCache.clear();
  return res.json({ ok: true });
});

router.get('/categories', (req, res) => {
  res.render('admin/categories', {
    adminPage: 'categories',
    flash: req.query.msg || null
  });
});

router.post('/categories', verifyCsrf, (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.redirect('/admin/categories');
  const slug = slugify(req.body.slug || name);
  const description = String(req.body.description || '').trim();
  const metaTitle = String(req.body.meta_title || '').trim();
  const metaDescription = String(req.body.meta_description || '').trim();
  const accentColor = /^#[0-9a-fA-F]{6}$/.test(req.body.accent_color || '') ? req.body.accent_color : '#2563EB';
  const sortOrder = Number.parseInt(req.body.sort_order || '0', 10) || 0;

  db.prepare(`
    INSERT INTO categories (name, slug, description, meta_title, meta_description, accent_color, sort_order)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(slug) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      meta_title = excluded.meta_title,
      meta_description = excluded.meta_description,
      accent_color = excluded.accent_color,
      sort_order = excluded.sort_order
  `).run(name, slug, description, metaTitle, metaDescription, accentColor, sortOrder);

  pageCache.clear();
  triggerSelectiveSectionPurge([`/category/${slug}`]);
  res.redirect('/admin/categories?msg=saved');
});

router.post('/categories/:id/delete', verifyCsrf, (req, res) => {
  db.prepare('DELETE FROM categories WHERE id = ?').run(req.params.id);
  pageCache.clear();
  triggerSelectiveSectionPurge(['/']);
  res.redirect('/admin/categories?msg=deleted');
});

router.get('/settings', (req, res) => {
  res.render('admin/settings', {
    adminPage: 'settings',
    flash: req.query.msg || null,
    error: req.query.err || null
  });
});

router.post('/settings', verifyCsrf, (req, res) => {
  const section = String(req.body.section || 'general');

  if (section === 'general') {
    const keys = [
      'site_name', 'site_tagline', 'site_description', 'site_url', 'contact_email', 'privacy_email', 'twitter_handle', 'cdn_base_url',
      'publisher_legal_name', 'publisher_owner_name', 'publisher_street_address', 'publisher_city',
      'publisher_state', 'publisher_postal_code', 'publisher_country', 'publisher_phone'
    ];
    for (const key of keys) {
      if (req.body[key] !== undefined) {
        let val = String(req.body[key]).trim();
        if (key === 'site_url' || key === 'cdn_base_url') val = val.replace(/\/+$/, '');
        setSetting(key, val);
      }
    }
  } else if (section === 'newsletter') {
    const keys = ['newsletter_provider', 'newsletter_api_key', 'newsletter_list_id', 'newsletter_from_name', 'newsletter_from_email'];
    for (const key of keys) {
      if (req.body[key] !== undefined) {
        setSetting(key, String(req.body[key]).trim());
      }
    }
  } else if (section === 'social') {
    const keys = ['bluesky_handle', 'bluesky_app_password', 'social_webhook_url', 'vapid_subject'];
    for (const key of keys) {
      if (req.body[key] !== undefined) {
        setSetting(key, String(req.body[key]).trim());
      }
    }
  } else if (section === 'seo') {
    const keys = ['google_site_verification', 'bing_site_verification', 'ga_measurement_id', 'robots_extra', 'gemini_api_key', 'openai_api_key'];
    for (const key of keys) {
      if (req.body[key] !== undefined) {
        setSetting(key, String(req.body[key]).trim());
      }
    }
  } else if (section === 'cloudflare') {
    setSetting('cf_auto_purge', req.body.cf_auto_purge === '1' ? '1' : '0');
    if (req.body.cf_zone_id !== undefined) {
      setSetting('cf_zone_id', String(req.body.cf_zone_id).trim());
    }
    if (req.body.cf_api_token !== undefined) {
      setSetting('cf_api_token', String(req.body.cf_api_token).trim());
    }
  } else if (section === 'monetization') {
    setSetting('ads_slots_visible', req.body.ads_slots_visible === '1' ? '1' : '0');
    setSetting('ads_enabled', req.body.ads_enabled === '1' ? '1' : '0');
    setSetting('ads_auto_enabled', req.body.ads_auto_enabled === '1' ? '1' : '0');
    setSetting('ads_placeholder_mode', req.body.ads_placeholder_mode === '1' ? '1' : '0');
    const midP = Math.max(1, Math.min(12, Number.parseInt(req.body.ads_mid_paragraph || '3', 10) || 3));
    setSetting('ads_mid_paragraph', String(midP));

    const adKeys = [
      'adsense_publisher_id',
      'ads_slot_header',
      'ads_slot_infeed',
      'ads_slot_article_top',
      'ads_slot_article_mid',
      'ads_slot_sidebar',
      'ads_slot_article_bottom',
      'ads_txt'
    ];
    for (const key of adKeys) {
      if (req.body[key] !== undefined) {
        setSetting(key, String(req.body[key]).trim());
      }
    }
  } else if (section === 'account') {
    const name = String(req.body.name || req.user.name).trim();
    const bio = String(req.body.bio || '').trim();
    const jobTitle = String(req.body.job_title || '').trim();
    const expertise = String(req.body.expertise || '').trim();
    const location = String(req.body.location || '').trim();
    const credentials = String(req.body.credentials || '').trim();
    const twitterHandle = String(req.body.twitter_handle || '').trim();
    const linkedinUrl = String(req.body.linkedin_url || '').trim();
    const websiteUrl = String(req.body.website_url || '').trim();
    const email = String(req.body.email || req.user.email).trim().toLowerCase();

    db.prepare(`
      UPDATE users SET
        name = ?, email = ?, bio = ?, job_title = ?, expertise = ?,
        location = ?, credentials = ?, twitter_handle = ?, linkedin_url = ?, website_url = ?
      WHERE id = ?
    `).run(name, email, bio, jobTitle, expertise, location, credentials, twitterHandle, linkedinUrl, websiteUrl, req.user.id);

    const newPassword = String(req.body.new_password || '');
    const currentPassword = String(req.body.current_password || '');
    if (newPassword) {
      const fullUser = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
      if (!verifyPassword(currentPassword, fullUser.password_hash)) {
        return res.redirect('/admin/settings?err=Current+password+is+incorrect');
      }
      if (newPassword.length < 8) {
        return res.redirect('/admin/settings?err=New+password+must+be+at+least+8+characters');
      }
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), req.user.id);
    }
  }

  pageCache.clear();
  if (section !== 'cloudflare') {
    triggerSelectiveSectionPurge(['/']);
  }
  return res.redirect(`/admin/settings?msg=${encodeURIComponent('Settings saved successfully')}`);
});

router.post('/settings/cloudflare-test', verifyCsrf, async (req, res) => {
  const cfg = getCloudflareConfig();
  if (!cfg.configured) {
    return res.redirect('/admin/settings?err=Please+save+your+Cloudflare+Zone+ID+and+API+Token+first');
  }
  const testUrls = [
    `${cfg.baseUrl}/`,
    `${cfg.baseUrl}/?page=1`,
    `${cfg.baseUrl}/sitemap.xml`,
    `${cfg.baseUrl}/rss.xml`
  ];
  const result = await purgeCloudflareUrls(testUrls, cfg);
  if (!result.ok) {
    return res.redirect(`/admin/settings?err=${encodeURIComponent('Cloudflare Purge Failed: ' + result.error)}`);
  }
  return res.redirect(
    `/admin/settings?msg=${encodeURIComponent(`Cloudflare Selective Purge succeeded (${result.purgedCount} URLs refreshed; all other articles & images kept cached)!`)}`
  );
});

router.post('/settings/avatar', verifyCsrf, upload.single('avatar'), async (req, res) => {
  try {
    if (req.body.remove_avatar === '1') {
      db.prepare("UPDATE users SET avatar_url = '' WHERE id = ?").run(req.user.id);
      pageCache.clear();
      return res.redirect('/admin/settings?msg=Profile+photo+removed');
    }
    if (!req.file) {
      return res.redirect('/admin/settings?err=Please+choose+an+image+file+to+upload');
    }
    const processed = await processAvatarImage(req.file.buffer, req.user.slug || req.file.originalname);
    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(processed.url, req.user.id);
    pageCache.clear();
    return res.redirect('/admin/settings?msg=Author+profile+photo+updated');
  } catch (err) {
    return res.redirect(`/admin/settings?err=${encodeURIComponent(err.message || 'Avatar upload failed')}`);
  }
});

router.post('/users/:id/avatar', verifyCsrf, upload.single('avatar'), async (req, res) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).send('Permission denied.');
  }
  const targetId = Number.parseInt(req.params.id, 10);
  const target = db.prepare('SELECT id, slug FROM users WHERE id = ?').get(targetId);
  if (!target) return res.redirect('/admin/users?err=Author+not+found');
  try {
    if (req.body.remove_avatar === '1') {
      db.prepare("UPDATE users SET avatar_url = '' WHERE id = ?").run(target.id);
      pageCache.clear();
      return res.redirect('/admin/users?msg=Author+photo+removed');
    }
    if (!req.file) {
      return res.redirect('/admin/users?err=Please+select+a+photo+file');
    }
    const processed = await processAvatarImage(req.file.buffer, target.slug || req.file.originalname);
    db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').run(processed.url, target.id);
    pageCache.clear();
    return res.redirect('/admin/users?msg=Author+photo+updated');
  } catch (err) {
    return res.redirect(`/admin/users?err=${encodeURIComponent(err.message || 'Photo upload failed')}`);
  }
});

router.post('/settings/toggle-ads', verifyCsrf, (req, res) => {
  const nextVal = req.body.ads_slots_visible === '1' ? '1' : '0';
  setSetting('ads_slots_visible', nextVal);
  pageCache.clear();
  const returnTo = req.body.return_to === '/admin/settings' ? '/admin/settings' : '/admin';
  const msg = nextVal === '1'
    ? 'Ad slots are now visible on the website.'
    : 'All ad slots are now hidden on the website.';
  return res.redirect(`${returnTo}?msg=${encodeURIComponent(msg)}`);
});

router.get('/inbox', (req, res) => {
  const messages = db.prepare('SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 100').all();
  const subscribers = db.prepare('SELECT * FROM subscribers ORDER BY created_at DESC LIMIT 200').all();
  res.render('admin/inbox', {
    adminPage: 'inbox',
    messages,
    subscribers
  });
});

router.post('/inbox/messages/:id/read', verifyCsrf, (req, res) => {
  db.prepare('UPDATE contact_messages SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.redirect('/admin/inbox');
});

router.post('/inbox/messages/:id/delete', verifyCsrf, (req, res) => {
  db.prepare('DELETE FROM contact_messages WHERE id = ?').run(req.params.id);
  res.redirect('/admin/inbox');
});

router.get('/inbox/subscribers.csv', (req, res) => {
  const includeAll = req.query.all === '1';
  const sql = includeAll
    ? 'SELECT email, status, gdpr_consent, source, confirmed_at, created_at FROM subscribers ORDER BY created_at DESC'
    : "SELECT email, status, gdpr_consent, source, confirmed_at, created_at FROM subscribers WHERE status = 'confirmed' ORDER BY created_at DESC";
  const rows = db.prepare(sql).all();
  const csv = [
    'email,status,gdpr_consent,source,confirmed_at,created_at',
    ...rows.map((r) => `"${r.email}","${r.status}","${r.gdpr_consent}","${r.source}","${r.confirmed_at || ''}","${r.created_at}"`)
  ].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="techhavenus-subscribers.csv"');
  res.send(csv);
});

router.use((err, req, res, next) => {
  if (req.originalUrl.startsWith('/admin/api/')) {
    return res.status(400).json({ ok: false, error: err.message || 'Request failed' });
  }
  return next(err);
});

export default router;
