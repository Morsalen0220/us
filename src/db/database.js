import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DATA_DIR } from '../config.js';
import { pageCache } from '../utils/cache.js';
import { slugify } from '../utils/seo.js';

const dbPath = path.join(DATA_DIR, 'techhaven.db');

export const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  PRAGMA cache_size = -32000;
  PRAGMA temp_store = MEMORY;
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    job_title TEXT NOT NULL DEFAULT 'Tech Editor',
    expertise TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    twitter_handle TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    meta_title TEXT NOT NULL DEFAULT '',
    meta_description TEXT NOT NULL DEFAULT '',
    accent_color TEXT NOT NULL DEFAULT '#2563EB',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    slug TEXT NOT NULL UNIQUE,
    excerpt TEXT NOT NULL DEFAULT '',
    content_md TEXT NOT NULL DEFAULT '',
    content_html TEXT NOT NULL DEFAULT '',
    toc_json TEXT NOT NULL DEFAULT '[]',
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'draft', 'scheduled', 'in_review')),
    region TEXT NOT NULL DEFAULT 'Global',
    is_featured INTEGER NOT NULL DEFAULT 0,
    is_trending INTEGER NOT NULL DEFAULT 0,
    is_breaking INTEGER NOT NULL DEFAULT 0,
    is_editors_pick INTEGER NOT NULL DEFAULT 0,
    featured_image TEXT NOT NULL DEFAULT '',
    featured_image_thumb TEXT NOT NULL DEFAULT '',
    featured_image_width INTEGER NOT NULL DEFAULT 1400,
    featured_image_height INTEGER NOT NULL DEFAULT 788,
    featured_image_title TEXT NOT NULL DEFAULT '',
    featured_image_alt TEXT NOT NULL DEFAULT '',
    featured_image_caption TEXT NOT NULL DEFAULT '',
    featured_image_description TEXT NOT NULL DEFAULT '',
    meta_title TEXT NOT NULL DEFAULT '',
    meta_subtitle TEXT NOT NULL DEFAULT '',
    meta_description TEXT NOT NULL DEFAULT '',
    meta_tags TEXT NOT NULL DEFAULT '',
    focus_keyword TEXT NOT NULL DEFAULT '',
    canonical_url TEXT NOT NULL DEFAULT '',
    robots TEXT NOT NULL DEFAULT 'index, follow',
    key_takeaways_json TEXT NOT NULL DEFAULT '[]',
    whats_new TEXT NOT NULL DEFAULT '',
    fact_check_status TEXT NOT NULL DEFAULT 'Fact-Checked',
    last_fact_checked TEXT NOT NULL DEFAULT '',
    official_sources_json TEXT NOT NULL DEFAULT '[]',
    corrections_json TEXT NOT NULL DEFAULT '[]',
    helpful_yes INTEGER NOT NULL DEFAULT 0,
    helpful_no INTEGER NOT NULL DEFAULT 0,
    save_count INTEGER NOT NULL DEFAULT 0,
    reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    reviewed_at TEXT NOT NULL DEFAULT '',
    reading_time INTEGER NOT NULL DEFAULT 1,
    word_count INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    published_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS post_tags (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    thumb_filename TEXT NOT NULL DEFAULT '',
    url TEXT NOT NULL,
    thumb_url TEXT NOT NULL DEFAULT '',
    original_name TEXT NOT NULL DEFAULT '',
    original_format TEXT NOT NULL DEFAULT '',
    original_size INTEGER NOT NULL DEFAULT 0,
    webp_size INTEGER NOT NULL DEFAULT 0,
    width INTEGER NOT NULL DEFAULT 0,
    height INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL DEFAULT '',
    alt_text TEXT NOT NULL DEFAULT '',
    caption TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS subscribers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT 'website',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS contact_messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL,
    is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS post_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    content_md TEXT NOT NULL DEFAULT '',
    meta_title TEXT NOT NULL DEFAULT '',
    meta_description TEXT NOT NULL DEFAULT '',
    edited_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS redirects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_path TEXT NOT NULL UNIQUE,
    to_path TEXT NOT NULL,
    status_code INTEGER NOT NULL DEFAULT 301,
    hits INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS page_views (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    country_code TEXT NOT NULL DEFAULT 'US',
    region_bucket TEXT NOT NULL DEFAULT 'USA',
    referrer TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS search_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    query TEXT NOT NULL,
    results_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS ai_tools (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    tagline TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT 'AI Assistant',
    pricing_model TEXT NOT NULL DEFAULT 'Freemium',
    price_label TEXT NOT NULL DEFAULT 'Free / $20 mo',
    rating REAL NOT NULL DEFAULT 4.5,
    pros_json TEXT NOT NULL DEFAULT '[]',
    cons_json TEXT NOT NULL DEFAULT '[]',
    website_url TEXT NOT NULL DEFAULT '',
    logo_color TEXT NOT NULL DEFAULT '#2563EB',
    image_url TEXT NOT NULL DEFAULT '',
    is_featured INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS daily_briefings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    briefing_date TEXT NOT NULL UNIQUE,
    summary TEXT NOT NULL DEFAULT '',
    items_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'draft')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS timelines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    category_slug TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT 'Global',
    status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'draft')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS timeline_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timeline_id INTEGER NOT NULL REFERENCES timelines(id) ON DELETE CASCADE,
    event_date TEXT NOT NULL,
    headline TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    post_slug TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    is_major INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS error_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'error',
    method TEXT NOT NULL DEFAULT 'GET',
    path TEXT NOT NULL DEFAULT '/',
    message TEXT NOT NULL,
    stack TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip TEXT NOT NULL,
    email TEXT NOT NULL DEFAULT '',
    success INTEGER NOT NULL DEFAULT 0,
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS social_posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER REFERENCES posts(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    copy_text TEXT NOT NULL,
    share_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued',
    scheduled_for TEXT NOT NULL DEFAULT '',
    posted_at TEXT NOT NULL DEFAULT '',
    response_note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    region_pref TEXT NOT NULL DEFAULT 'USA & Europe',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS push_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT NOT NULL DEFAULT '/',
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

function runMigrations() {
  const userCols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!userCols.includes('job_title')) {
    db.exec("ALTER TABLE users ADD COLUMN job_title TEXT NOT NULL DEFAULT 'Tech Editor'");
  }
  if (!userCols.includes('expertise')) {
    db.exec("ALTER TABLE users ADD COLUMN expertise TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes('linkedin_url')) {
    db.exec("ALTER TABLE users ADD COLUMN linkedin_url TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes('website_url')) {
    db.exec("ALTER TABLE users ADD COLUMN website_url TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes('location')) {
    db.exec("ALTER TABLE users ADD COLUMN location TEXT NOT NULL DEFAULT ''");
  }
  if (!userCols.includes('credentials')) {
    db.exec("ALTER TABLE users ADD COLUMN credentials TEXT NOT NULL DEFAULT ''");
  }

  const subCols = db.prepare('PRAGMA table_info(subscribers)').all().map((c) => c.name);
  const subAlters = [
    ['status', "TEXT NOT NULL DEFAULT 'pending'"],
    ['confirm_token', "TEXT NOT NULL DEFAULT ''"],
    ['unsubscribe_token', "TEXT NOT NULL DEFAULT ''"],
    ['gdpr_consent', 'INTEGER NOT NULL DEFAULT 1'],
    ['consent_text', "TEXT NOT NULL DEFAULT ''"],
    ['consent_ip', "TEXT NOT NULL DEFAULT ''"],
    ['confirmed_at', "TEXT NOT NULL DEFAULT ''"],
    ['unsubscribed_at', "TEXT NOT NULL DEFAULT ''"],
    ['provider_name', "TEXT NOT NULL DEFAULT 'local'"],
    ['provider_synced', 'INTEGER NOT NULL DEFAULT 0'],
    ['provider_id', "TEXT NOT NULL DEFAULT ''"]
  ];
  for (const [col, def] of subAlters) {
    if (!subCols.includes(col)) {
      db.exec(`ALTER TABLE subscribers ADD COLUMN ${col} ${def}`);
    }
  }

  const mediaCols = db.prepare('PRAGMA table_info(media)').all().map((c) => c.name);
  if (!mediaCols.includes('description')) {
    db.exec("ALTER TABLE media ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }

  const aiToolCols = db.prepare('PRAGMA table_info(ai_tools)').all().map((c) => c.name);
  if (aiToolCols.length > 0 && !aiToolCols.includes('image_url')) {
    db.exec("ALTER TABLE ai_tools ADD COLUMN image_url TEXT NOT NULL DEFAULT ''");
  }

  const postCols = db.prepare('PRAGMA table_info(posts)').all().map((c) => c.name);
  if (postCols.length > 0 && !postCols.includes('featured_image_description')) {
    db.exec("ALTER TABLE posts ADD COLUMN featured_image_description TEXT NOT NULL DEFAULT ''");
  }
  const postVideoCols = [
    ['video_url', "TEXT NOT NULL DEFAULT ''"],
    ['video_title', "TEXT NOT NULL DEFAULT ''"],
    ['video_duration', "TEXT NOT NULL DEFAULT ''"],
    ['video_is_short', 'INTEGER NOT NULL DEFAULT 0']
  ];
  for (const [col, def] of postVideoCols) {
    if (postCols.length > 0 && !postCols.includes(col)) {
      db.exec(`ALTER TABLE posts ADD COLUMN ${col} ${def}`);
    }
  }

  const postsSchemaRow = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'posts'").get();
  const postsSql = postsSchemaRow ? String(postsSchemaRow.sql || '') : '';
  const needsPostsRebuild = !postsSql.includes("'scheduled'") || !postsSql.includes('key_takeaways_json');

  if (needsPostsRebuild) {
    const existingCols = new Set(db.prepare('PRAGMA table_info(posts)').all().map((c) => c.name));
    const colOrDefault = (colName, fallbackSql) => (existingCols.has(colName) ? colName : fallbackSql);

    db.exec('PRAGMA foreign_keys = OFF;');
    try {
      db.exec('BEGIN IMMEDIATE;');
      db.exec(`
        DROP TRIGGER IF EXISTS posts_fts_ai;
        DROP TRIGGER IF EXISTS posts_fts_ad;
        DROP TRIGGER IF EXISTS posts_fts_au;

        CREATE TABLE posts_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          subtitle TEXT NOT NULL DEFAULT '',
          slug TEXT NOT NULL UNIQUE,
          excerpt TEXT NOT NULL DEFAULT '',
          content_md TEXT NOT NULL DEFAULT '',
          content_html TEXT NOT NULL DEFAULT '',
          toc_json TEXT NOT NULL DEFAULT '[]',
          category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
          author_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
          status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('published', 'draft', 'scheduled', 'in_review')),
          region TEXT NOT NULL DEFAULT 'Global',
          is_featured INTEGER NOT NULL DEFAULT 0,
          is_trending INTEGER NOT NULL DEFAULT 0,
          is_breaking INTEGER NOT NULL DEFAULT 0,
          is_editors_pick INTEGER NOT NULL DEFAULT 0,
          featured_image TEXT NOT NULL DEFAULT '',
          featured_image_thumb TEXT NOT NULL DEFAULT '',
          featured_image_width INTEGER NOT NULL DEFAULT 1400,
          featured_image_height INTEGER NOT NULL DEFAULT 788,
          featured_image_title TEXT NOT NULL DEFAULT '',
          featured_image_alt TEXT NOT NULL DEFAULT '',
          featured_image_caption TEXT NOT NULL DEFAULT '',
          featured_image_description TEXT NOT NULL DEFAULT '',
          meta_title TEXT NOT NULL DEFAULT '',
          meta_subtitle TEXT NOT NULL DEFAULT '',
          meta_description TEXT NOT NULL DEFAULT '',
          meta_tags TEXT NOT NULL DEFAULT '',
          focus_keyword TEXT NOT NULL DEFAULT '',
          canonical_url TEXT NOT NULL DEFAULT '',
          robots TEXT NOT NULL DEFAULT 'index, follow',
          key_takeaways_json TEXT NOT NULL DEFAULT '[]',
          whats_new TEXT NOT NULL DEFAULT '',
          fact_check_status TEXT NOT NULL DEFAULT 'Fact-Checked',
          last_fact_checked TEXT NOT NULL DEFAULT '',
          official_sources_json TEXT NOT NULL DEFAULT '[]',
          corrections_json TEXT NOT NULL DEFAULT '[]',
          helpful_yes INTEGER NOT NULL DEFAULT 0,
          helpful_no INTEGER NOT NULL DEFAULT 0,
          save_count INTEGER NOT NULL DEFAULT 0,
          reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          reviewed_at TEXT NOT NULL DEFAULT '',
          reading_time INTEGER NOT NULL DEFAULT 1,
          word_count INTEGER NOT NULL DEFAULT 0,
          views INTEGER NOT NULL DEFAULT 0,
          published_at TEXT NOT NULL DEFAULT (datetime('now')),
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        INSERT INTO posts_new (
          id, title, subtitle, slug, excerpt, content_md, content_html, toc_json,
          category_id, author_id, status, region, is_featured, is_trending, is_breaking, is_editors_pick,
          featured_image, featured_image_thumb, featured_image_width, featured_image_height,
          featured_image_title, featured_image_alt, featured_image_caption, featured_image_description,
          meta_title, meta_subtitle, meta_description, meta_tags, focus_keyword,
          canonical_url, robots, key_takeaways_json, whats_new, fact_check_status,
          last_fact_checked, official_sources_json, corrections_json, helpful_yes, helpful_no,
          save_count, reviewed_by, reviewed_at, reading_time, word_count, views,
          published_at, created_at, updated_at
        )
        SELECT
          id, title, subtitle, slug, excerpt, content_md, content_html, toc_json,
          category_id, author_id, status,
          ${colOrDefault('region', "'Global'")},
          is_featured, is_trending,
          ${colOrDefault('is_breaking', '0')},
          ${colOrDefault('is_editors_pick', '0')},
          featured_image, featured_image_thumb, featured_image_width, featured_image_height,
          featured_image_title, featured_image_alt, featured_image_caption,
          ${colOrDefault('featured_image_description', "''")},
          meta_title, meta_subtitle, meta_description, meta_tags, focus_keyword,
          canonical_url, robots,
          ${colOrDefault('key_takeaways_json', "'[]'")},
          ${colOrDefault('whats_new', "''")},
          ${colOrDefault('fact_check_status', "'Fact-Checked'")},
          ${colOrDefault('last_fact_checked', "''")},
          ${colOrDefault('official_sources_json', "'[]'")},
          ${colOrDefault('corrections_json', "'[]'")},
          ${colOrDefault('helpful_yes', '0')},
          ${colOrDefault('helpful_no', '0')},
          ${colOrDefault('save_count', '0')},
          ${colOrDefault('reviewed_by', 'NULL')},
          ${colOrDefault('reviewed_at', "''")},
          reading_time, word_count, views, published_at, created_at, updated_at
        FROM posts;

        DROP TABLE posts;
        ALTER TABLE posts_new RENAME TO posts;
      `);
      db.exec('COMMIT;');
    } catch (err) {
      db.exec('ROLLBACK;');
      throw err;
    } finally {
      db.exec('PRAGMA foreign_keys = ON;');
    }
  }
}

runMigrations();

db.exec(`
  CREATE INDEX IF NOT EXISTS idx_posts_status_pub ON posts(status, published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_breaking_trending ON posts(status, is_trending DESC, is_breaking DESC, published_at DESC);
  CREATE INDEX IF NOT EXISTS idx_posts_category_status ON posts(category_id, status);
  CREATE INDEX IF NOT EXISTS idx_posts_region_status ON posts(region, status);
  CREATE INDEX IF NOT EXISTS idx_posts_slug ON posts(slug);
  CREATE INDEX IF NOT EXISTS idx_media_created ON media(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_page_views_created ON page_views(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_page_views_post ON page_views(post_id);
  CREATE INDEX IF NOT EXISTS idx_revisions_post ON post_revisions(post_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_sub_confirm_tok ON subscribers(confirm_token);
  CREATE INDEX IF NOT EXISTS idx_sub_unsub_tok ON subscribers(unsubscribe_token);
  CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_social_posts_status ON social_posts(status, created_at DESC);

  CREATE VIRTUAL TABLE IF NOT EXISTS posts_fts USING fts5(
    title,
    subtitle,
    excerpt,
    content_md,
    meta_tags,
    content='posts',
    content_rowid='id'
  );

  CREATE TRIGGER IF NOT EXISTS posts_fts_ai AFTER INSERT ON posts BEGIN
    INSERT INTO posts_fts(rowid, title, subtitle, excerpt, content_md, meta_tags)
    VALUES (new.id, new.title, new.subtitle, new.excerpt, new.content_md, new.meta_tags);
  END;

  CREATE TRIGGER IF NOT EXISTS posts_fts_ad AFTER DELETE ON posts BEGIN
    INSERT INTO posts_fts(posts_fts, rowid, title, subtitle, excerpt, content_md, meta_tags)
    VALUES ('delete', old.id, old.title, old.subtitle, old.excerpt, old.content_md, old.meta_tags);
  END;

  CREATE TRIGGER IF NOT EXISTS posts_fts_au AFTER UPDATE ON posts BEGIN
    INSERT INTO posts_fts(posts_fts, rowid, title, subtitle, excerpt, content_md, meta_tags)
    VALUES ('delete', old.id, old.title, old.subtitle, old.excerpt, old.content_md, old.meta_tags);
    INSERT INTO posts_fts(rowid, title, subtitle, excerpt, content_md, meta_tags)
    VALUES (new.id, new.title, new.subtitle, new.excerpt, new.content_md, new.meta_tags);
  END;

  INSERT INTO posts_fts(posts_fts) VALUES('rebuild');
`);

export function safeJsonParse(str, fallback) {
  if (!str || typeof str !== 'string') return fallback;
  try {
    const parsed = JSON.parse(str);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

let cachedSettings = null;
let cachedRedirectMap = null;

const stmtAllSettings = db.prepare('SELECT key, value FROM settings');
const stmtUpsertSetting = db.prepare(`
  INSERT INTO settings (key, value) VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`);
const stmtAllRedirects = db.prepare('SELECT id, from_path, to_path, status_code FROM redirects');

pageCache.onClear(() => {
  cachedSettings = null;
  cachedRedirectMap = null;
});

export function getAllSettings() {
  if (cachedSettings !== null) return cachedSettings;
  const rows = stmtAllSettings.all();
  const out = {};
  for (const row of rows) {
    out[row.key] = row.value;
  }
  cachedSettings = out;
  return out;
}

export function setSetting(key, value) {
  stmtUpsertSetting.run(String(key), String(value ?? ''));
  cachedSettings = null;
}

export function getRedirectMap() {
  if (cachedRedirectMap !== null) return cachedRedirectMap;
  const map = new Map();
  for (const row of stmtAllRedirects.all()) {
    map.set(row.from_path, row);
  }
  cachedRedirectMap = map;
  return map;
}

export function syncPostTags(postId, metaTagsString = '') {
  const tagNames = String(metaTagsString || '')
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && t.length <= 48);

  const uniqueBySlug = new Map();
  for (const rawName of tagNames) {
    const tagSlug = slugify(rawName);
    if (!uniqueBySlug.has(tagSlug)) {
      uniqueBySlug.set(tagSlug, rawName);
    }
  }

  db.prepare('DELETE FROM post_tags WHERE post_id = ?').run(postId);

  const upsertTag = db.prepare(`
    INSERT INTO tags (name, slug) VALUES (?, ?)
    ON CONFLICT(slug) DO UPDATE SET name = excluded.name
  `);
  const getTag = db.prepare('SELECT id FROM tags WHERE slug = ?');
  const linkTag = db.prepare('INSERT OR IGNORE INTO post_tags (post_id, tag_id) VALUES (?, ?)');

  for (const [tagSlug, rawName] of uniqueBySlug.entries()) {
    upsertTag.run(rawName, tagSlug);
    const row = getTag.get(tagSlug);
    if (row && row.id) {
      linkTag.run(postId, row.id);
    }
  }
}

let lastScheduleCheckAt = 0;
let scheduledPublishHook = null;

export function onScheduledPostsPublished(fn) {
  scheduledPublishHook = typeof fn === 'function' ? fn : null;
}

export function publishDueScheduledPosts(force = false) {
  const now = Date.now();
  if (!force && now - lastScheduleCheckAt < 30_000) return 0;
  lastScheduleCheckAt = now;

  const dueRows = db.prepare(`
    SELECT id FROM posts
    WHERE status = 'scheduled' AND datetime(published_at) <= datetime('now')
  `).all();

  if (dueRows.length === 0) return 0;

  const info = db.prepare(`
    UPDATE posts
    SET status = 'published', updated_at = datetime('now')
    WHERE status = 'scheduled' AND datetime(published_at) <= datetime('now')
  `).run();

  if (info.changes > 0) {
    pageCache.clear();
    if (scheduledPublishHook) {
      for (const row of dueRows) {
        try {
          scheduledPublishHook(row.id);
        } catch {}
      }
    }
  }
  return info.changes;
}

export function logServerError(err, req = null, level = 'error') {
  try {
    const method = req?.method || 'SYSTEM';
    const reqPath = req?.originalUrl || req?.path || '/';
    const message = String(err?.message || err || 'Unknown error').slice(0, 500);
    const stack = String(err?.stack || '').slice(0, 4000);
    db.prepare(`
      INSERT INTO error_logs (level, method, path, message, stack)
      VALUES (?, ?, ?, ?, ?)
    `).run(level, method, reqPath, message, stack);
  } catch {
    // Prevent recursive logging failure
  }
}
