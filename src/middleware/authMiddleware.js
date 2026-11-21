import { db } from '../db/database.js';
import { createCsrfToken, parseCookies, verifyCsrfToken, verifySessionToken } from '../utils/auth.js';

export const SESSION_COOKIE_NAME = 'th_session';

export function attachAuth(req, res, next) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME] || '';
  const payload = verifySessionToken(token);

  req.user = null;
  req.sessionToken = null;
  res.locals.currentUser = null;
  res.locals.csrfToken = '';

  if (payload) {
    const user = db.prepare('SELECT id, name, slug, email, role, job_title, expertise, location, credentials, bio, twitter_handle, linkedin_url, website_url FROM users WHERE id = ?').get(payload.uid);
    if (user) {
      req.user = user;
      req.sessionToken = token;
      res.locals.currentUser = user;
      res.locals.csrfToken = createCsrfToken(token);
    }
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    if (req.originalUrl.startsWith('/admin/api/')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect('/admin/login');
  }
  next();
}

export function verifyCsrf(req, res, next) {
  const token = req.headers['x-csrf-token'] || req.body?._csrf || req.query?._csrf || '';
  if (!verifyCsrfToken(req.sessionToken, String(token))) {
    if (req.originalUrl.startsWith('/admin/api/') || req.accepts('json') === 'json' && !req.accepts('html')) {
      return res.status(403).json({ error: 'Invalid or expired security token. Refresh the page and retry.' });
    }
    return res.status(403).send('Invalid or expired security token. Please go back, refresh, and try again.');
  }
  next();
}
