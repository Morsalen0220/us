import { db, getAllSettings, safeJsonParse } from '../db/database.js';
import { SITE_URL } from '../config.js';
import { parseCookies } from '../utils/auth.js';
import { pageCache } from '../utils/cache.js';
import { renderIcon } from '../utils/icons.js';
import { resolveAssetUrl } from '../utils/storage.js';

const META_TTL_MS = 20 * 60_000;
const KEY_CATEGORIES = '__meta:categories';
const KEY_BREAKING = '__meta:breaking';

const stmtCategories = db.prepare(`
  SELECT c.*,
    (SELECT COUNT(*) FROM posts p WHERE p.category_id = c.id AND p.status = 'published') AS post_count
  FROM categories c
  ORDER BY c.sort_order ASC, c.name ASC
`);

const stmtBreakingPosts = db.prepare(`
  SELECT p.title, p.slug, c.name AS category_name, c.accent_color AS category_color
  FROM posts p
  LEFT JOIN categories c ON c.id = p.category_id
  WHERE p.status = 'published'
  ORDER BY p.is_trending DESC, p.is_breaking DESC, p.published_at DESC
  LIMIT 6
`);

function formatDate(isoString) {
  if (!isoString) return '';
  try {
    const dt = new Date(isoString);
    return dt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return isoString;
  }
}

function formatDateTime(isoString) {
  if (!isoString) return '';
  try {
    const dt = new Date(isoString);
    return dt.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch {
    return isoString;
  }
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export const REGIONS = [
  { name: 'USA', slug: 'usa', label: 'United States' },
  { name: 'Europe', slug: 'europe', label: 'Europe' },
  { name: 'USA & Europe', slug: 'usa-europe', label: 'USA & Europe' },
  { name: 'Global', slug: 'global', label: 'Global Tech' }
];

export function localsMiddleware(req, res, next) {
  const settings = getAllSettings();
  const siteUrl = (settings.site_url || SITE_URL || 'https://techhavenus.com').replace(/\/+$/, '');
  const isApi = req.path.startsWith('/api/') || req.path === '/api';

  let categories = [];
  let breakingPosts = [];

  if (!isApi) {
    categories = pageCache.get(KEY_CATEGORIES);
    if (categories === null) {
      categories = stmtCategories.all();
      pageCache.set(KEY_CATEGORIES, categories, META_TTL_MS);
    }

    breakingPosts = pageCache.get(KEY_BREAKING);
    if (breakingPosts === null) {
      breakingPosts = stmtBreakingPosts.all();
      pageCache.set(KEY_BREAKING, breakingPosts, META_TTL_MS);
    }
  }

  const cookies = parseCookies(req);
  const userPrefs = safeJsonParse(cookies.th_prefs || '', { categories: [], regions: [] });

  const adsSlotsVisible = settings.ads_slots_visible === '1';
  const adsEnabled = settings.ads_enabled === '1';
  const placeholderMode = settings.ads_placeholder_mode === '1';

  const slotLabels = {
    ads_slot_header: 'Top Banner Ad (728×90 / Responsive)',
    ads_slot_infeed: 'In-Feed Native Ad Unit',
    ads_slot_article_top: 'Article Top Responsive Ad',
    ads_slot_article_mid: 'Mid-Article High-RPM Ad',
    ads_slot_sidebar: 'Sidebar Display Ad (300×250)',
    ads_slot_article_bottom: 'End-of-Article Multiplex Ad'
  };

  function getRawAdHtml(slotKey) {
    if (!adsSlotsVisible) return '';
    const code = (settings[slotKey] || '').trim();
    if (adsEnabled && code) {
      return code;
    }
    if (placeholderMode) {
      const label = slotLabels[slotKey] || 'AdSense Placement Ready';
      return `<div class="ad-placeholder"><span>AD SLOT READY</span><strong>${label}</strong></div>`;
    }
    return '';
  }

  function renderAd(slotKey, extraClass = '') {
    const inner = getRawAdHtml(slotKey);
    if (!inner) return '';
    return `<aside class="ad-slot ${extraClass}" aria-label="Advertisement"><div class="ad-label">Advertisement</div>${inner}</aside>`;
  }

  res.locals.settings = settings;
  res.locals.siteUrl = siteUrl;
  res.locals.categories = categories;
  res.locals.regions = REGIONS;
  res.locals.breakingPosts = breakingPosts;
  res.locals.userPrefs = userPrefs;
  res.locals.currentPath = req.path;
  res.locals.formatDate = formatDate;
  res.locals.formatDateTime = formatDateTime;
  res.locals.formatBytes = formatBytes;
  res.locals.assetUrl = (rel) => resolveAssetUrl(rel, settings);
  res.locals.icon = renderIcon;
  res.locals.getRawAdHtml = getRawAdHtml;
  res.locals.renderAd = renderAd;
  res.locals.seo = {};
  res.locals.jsonLdList = [];
  next();
}
