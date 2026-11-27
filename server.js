import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import compression from 'compression';
import helmet from 'helmet';
import { LISTEN_TARGET, NODE_ENV, PUBLIC_DIR, SITE_URL, UPLOAD_DIR, VIEWS_DIR } from './src/config.js';
import { db, getRedirectMap, logServerError, onScheduledPostsPublished, publishDueScheduledPosts } from './src/db/database.js';
import { seedDatabase } from './src/db/seed.js';
import { attachAuth } from './src/middleware/authMiddleware.js';
import { localsMiddleware } from './src/middleware/localsMiddleware.js';
import adminRoutes from './src/routes/admin.js';
import publicRoutes from './src/routes/public.js';
import { startDailyBackupScheduler } from './src/utils/backup.js';
import { pageCache } from './src/utils/cache.js';
import { triggerSelectivePostPurge } from './src/utils/cloudflare.js';

const app = express();

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', VIEWS_DIR);
if (NODE_ENV !== 'test') {
  app.set('view cache', true);
}
app.disable('x-powered-by');

app.use(compression({ threshold: 512 }));
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  })
);
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.json({ limit: '10mb' }));

app.use(
  '/uploads',
  express.static(UPLOAD_DIR, {
    maxAge: '365d',
    immutable: true
  })
);

const STYLE_CSS_PATH = path.join(PUBLIC_DIR, 'css', 'style.css');
let cachedMinifiedCss = '';
let cachedCssMtime = 0;

app.get('/css/style.css', (req, res, next) => {
  try {
    const stat = fs.statSync(STYLE_CSS_PATH);
    if (!cachedMinifiedCss || stat.mtimeMs !== cachedCssMtime) {
      const rawCss = fs.readFileSync(STYLE_CSS_PATH, 'utf8');
      cachedMinifiedCss = rawCss
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\s+/g, ' ')
        .replace(/\s*([{};,])\s*/g, '$1')
        .replace(/:\s+/g, ':')
        .replace(/;\}/g, '}')
        .trim();
      cachedCssMtime = stat.mtimeMs;
    }
    res.setHeader('Content-Type', 'text/css; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return res.send(cachedMinifiedCss);
  } catch {
    return next();
  }
});

app.use(
  express.static(PUBLIC_DIR, {
    maxAge: '365d',
    immutable: true,
    setHeaders(res, filePath) {
      if (filePath.endsWith('sw.js')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    }
  })
);

app.get('/favicon.ico', (req, res) => {
  res.redirect(301, '/favicon.svg');
});

app.get('/health', (req, res) => {
  const t0 = Date.now();
  let dbOk = false;
  try {
    db.prepare('SELECT 1 AS ok').get();
    dbOk = true;
  } catch {
    dbOk = false;
  }
  const dbLatencyMs = Date.now() - t0;
  const mem = process.memoryUsage();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? 'ok' : 'degraded',
    uptimeSec: Math.round(process.uptime()),
    dbOk,
    dbLatencyMs,
    memoryMb: Math.round(mem.rss / (1024 * 1024)),
    cacheEntries: pageCache.size(),
    nodeVersion: process.version,
    timestamp: new Date().toISOString()
  });
});

app.use(attachAuth);
app.use(localsMiddleware);

// Prevent Cloudflare Edge Cache or browsers from ever caching Admin CMS, API endpoints, or logged-in views
app.use((req, res, next) => {
  if (req.path.startsWith('/admin') || req.path.startsWith('/api') || req.user) {
    res.setHeader('Cache-Control', 'private, no-store, no-cache, must-revalidate');
    res.setHeader('CDN-Cache-Control', 'no-store');
    res.setHeader('Cloudflare-CDN-Cache-Control', 'no-store');
  }
  next();
});

// Dynamic 301/302 Redirect Manager middleware (O(1) in-memory map lookup)
const stmtIncrementRedirectHit = db.prepare('UPDATE redirects SET hits = hits + 1 WHERE id = ?');
app.use((req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/admin') || req.path.startsWith('/api/')) {
    return next();
  }
  const normalized = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path;
  const redir = getRedirectMap().get(normalized);
  if (redir) {
    setImmediate(() => {
      try {
        stmtIncrementRedirectHit.run(redir.id);
      } catch {}
    });
    return res.redirect(redir.status_code === 302 ? 302 : 301, redir.to_path);
  }
  next();
});

app.use('/admin', adminRoutes);
app.use('/', publicRoutes);

app.use((req, res) => {
  res.status(404).render('public/404', {
    seo: {
      title: `404 Page Not Found — ${res.locals.settings.site_name || 'TechHaven US'}`,
      robots: 'noindex, follow'
    },
    jsonLdList: []
  });
});

app.use((err, req, res, next) => {
  console.error('Server error:', err);
  logServerError(err, req);
  res.status(500).send('Internal server error. Please try again shortly.');
});

let schedulersStarted = false;

export async function startServer(listenTarget = LISTEN_TARGET) {
  process.env.__TECHHAVEN_STARTED = '1';
  await seedDatabase();
  onScheduledPostsPublished((postId) => triggerSelectivePostPurge({ postId }));
  publishDueScheduledPosts(true);

  if (!schedulersStarted) {
    schedulersStarted = true;
    startDailyBackupScheduler();
    const timer = setInterval(() => publishDueScheduledPosts(true), 60_000);
    timer.unref();
  }

  if (typeof listenTarget === 'string' && listenTarget.startsWith('/')) {
    try {
      if (fs.existsSync(listenTarget)) fs.unlinkSync(listenTarget);
    } catch {}
  }

  return new Promise((resolve) => {
    const server = app.listen(listenTarget, () => {
      const endpointLabel = typeof listenTarget === 'number' || /^\d+$/.test(String(listenTarget))
        ? `http://localhost:${listenTarget}`
        : `unix socket ${listenTarget}`;
      console.log(`TechHaven US v2.0 running on ${endpointLabel} (canonical: ${SITE_URL})`);
      resolve(server);
    });
  });
}

const isDirectEntry =
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1].endsWith('server.js'));

if ((isDirectEntry || process.env.PASSENGER_APP_ENV || process.env.SOCKET) && process.env.NO_AUTO_START !== '1' && !process.env.__TECHHAVEN_STARTED) {
  startServer();
}

export default app;
