import sharp from 'sharp';

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapLines(text, maxChars = 28, maxLines = 3) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let curr = '';
  for (const w of words) {
    if ((`${curr} ${w}`).trim().length > maxChars && curr) {
      lines.push(curr.trim());
      curr = w;
      if (lines.length === maxLines) break;
    } else {
      curr = (`${curr} ${w}`).trim();
    }
  }
  if (curr && lines.length < maxLines) lines.push(curr);
  return lines;
}

export async function generateSocialCardPng(post, category = null, settings = {}) {
  const siteName = settings.site_name || 'TECHHAVEN US';
  const accent = category?.accent_color || '#2563EB';
  const catLabel = (category?.name || 'TECH NEWS').toUpperCase();
  const regionLabel = (post.region || 'USA & EUROPE').toUpperCase();
  const lines = wrapLines(post.meta_title || post.title, 30, 3);

  const headlineSvg = lines
    .map((line, i) => `<text x="72" y="${255 + i * 64}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="48" font-weight="800" fill="#F8FAFC" letter-spacing="-0.8">${escapeXml(line)}</text>`)
    .join('\n  ');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090D16" />
      <stop offset="100%" stop-color="#0F172A" />
    </linearGradient>
    <radialGradient id="glow" cx="88%" cy="15%" r="55%">
      <stop offset="0%" stop-color="${escapeXml(accent)}" stop-opacity="0.45" />
      <stop offset="100%" stop-color="${escapeXml(accent)}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)" />
  <rect width="1200" height="630" fill="url(#glow)" />

  <rect x="72" y="72" width="16" height="36" rx="5" fill="${escapeXml(accent)}" />
  <text x="102" y="98" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="24" font-weight="800" fill="#F8FAFC" letter-spacing="1.2">${escapeXml(siteName.toUpperCase())}</text>

  <rect x="72" y="138" width="290" height="38" rx="19" fill="${escapeXml(accent)}" fill-opacity="0.24" stroke="${escapeXml(accent)}" stroke-width="1.5" />
  <text x="217" y="163" text-anchor="middle" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="15" font-weight="700" fill="#F8FAFC" letter-spacing="1.2">${escapeXml(catLabel)}</text>

  <text x="385" y="163" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="16" font-weight="700" fill="#94A3B8" letter-spacing="1.4">${escapeXml(regionLabel)} • ${post.reading_time || 4} MIN READ</text>

  ${headlineSvg}

  <line x1="72" y1="510" x2="1128" y2="510" stroke="#334155" stroke-width="1.5" />
  <text x="72" y="556" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="22" font-weight="600" fill="#CBD5E1">By ${escapeXml(post.author_name || 'TechHaven Editorial')}</text>
  <text x="1128" y="556" text-anchor="end" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="21" font-weight="700" fill="#60A5FA">techhavenus.com</text>
</svg>`;

  return sharp(Buffer.from(svg, 'utf8')).png({ compressionLevel: 8 }).toBuffer();
}

export function buildPlatformShareLinks(post, siteUrl = 'https://techhavenus.com') {
  const base = String(siteUrl || 'https://techhavenus.com').replace(/\/+$/, '');
  const canonicalUrl = `${base}/article/${post.slug}`;
  const title = post.meta_title || post.title;
  const tags = String(post.meta_tags || '')
    .split(',')
    .map((t) => t.trim().replace(/\s+/g, ''))
    .filter(Boolean)
    .slice(0, 3)
    .map((t) => `#${t}`)
    .join(' ');

  const shortText = `${title}\n\n${post.subtitle || post.excerpt || ''}`.trim().slice(0, 220);

  return {
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(`${title} ${tags}`)}&url=${encodeURIComponent(`${canonicalUrl}?utm_source=x`)}`,
    bluesky: `https://bsky.app/intent/compose?text=${encodeURIComponent(`${title}\n\n${canonicalUrl}?utm_source=bluesky`)}`,
    reddit: `https://www.reddit.com/submit?url=${encodeURIComponent(`${canonicalUrl}?utm_source=reddit`)}&title=${encodeURIComponent(title)}`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(`${canonicalUrl}?utm_source=linkedin`)}`,
    hackernews: `https://news.ycombinator.com/submitlink?u=${encodeURIComponent(`${canonicalUrl}?utm_source=hackernews`)}&t=${encodeURIComponent(title)}`,
    cardImageUrl: `${base}/og/${post.slug}.png`,
    shortText
  };
}

export function generateDraftSocialPosts(post, siteUrl = 'https://techhavenus.com') {
  const links = buildPlatformShareLinks(post, siteUrl);
  const base = String(siteUrl || 'https://techhavenus.com').replace(/\/+$/, '');
  const url = `${base}/article/${post.slug}`;
  const title = post.meta_title || post.title;
  const subtitle = post.subtitle || post.excerpt || '';

  return [
    {
      platform: 'x',
      copy_text: `${title}\n\n${subtitle.slice(0, 110)}\n\nRead more: ${url}?utm_source=x`,
      share_url: links.x
    },
    {
      platform: 'bluesky',
      copy_text: `${title}\n\n${subtitle.slice(0, 130)}\n\n${url}?utm_source=bluesky`,
      share_url: links.bluesky
    },
    {
      platform: 'reddit',
      copy_text: `[${post.region || 'Tech'}] ${title} — ${url}?utm_source=reddit`,
      share_url: links.reddit
    },
    {
      platform: 'linkedin',
      copy_text: `${title}\n\n${subtitle}\n\nFull breakdown on TechHaven US: ${url}?utm_source=linkedin`,
      share_url: links.linkedin
    },
    {
      platform: 'hackernews',
      copy_text: `${title} (${url}?utm_source=hackernews)`,
      share_url: links.hackernews
    }
  ];
}

export async function publishSocialPost(socialItem, post, settings = {}) {
  const siteUrl = (settings.site_url || 'https://techhavenus.com').replace(/\/+$/, '');
  const articleUrl = post ? `${siteUrl}/article/${post.slug}?utm_source=${socialItem.platform}` : siteUrl;
  const ogImage = post ? `${siteUrl}/og/${post.slug}.png` : `${siteUrl}/favicon.svg`;

  if (socialItem.platform === 'bluesky' && settings.bluesky_handle && settings.bluesky_app_password) {
    try {
      const authRes = await fetch('https://bsky.social/xrpc/com.atproto.server.createSession', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identifier: settings.bluesky_handle.trim(),
          password: settings.bluesky_app_password.trim()
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (!authRes.ok) throw new Error(`Bluesky auth HTTP ${authRes.status}`);
      const session = await authRes.json();

      const record = {
        $type: 'app.bsky.feed.post',
        text: socialItem.copy_text.slice(0, 295),
        createdAt: new Date().toISOString(),
        embed: {
          $type: 'app.bsky.embed.external',
          external: {
            uri: articleUrl,
            title: post?.meta_title || post?.title || 'TechHaven US',
            description: post?.meta_description || post?.excerpt || ''
          }
        }
      };

      const postRes = await fetch('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.accessJwt}`
        },
        body: JSON.stringify({
          repo: session.did,
          collection: 'app.bsky.feed.post',
          record
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (!postRes.ok) throw new Error(`Bluesky post HTTP ${postRes.status}`);
      return { delivered: true, note: 'Published directly to Bluesky ATProto' };
    } catch (err) {
      return { delivered: false, note: err.message };
    }
  }

  if (settings.social_webhook_url) {
    try {
      const hookRes = await fetch(settings.social_webhook_url.trim(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: socialItem.platform,
          text: socialItem.copy_text,
          url: articleUrl,
          ogImage,
          title: post?.title || '',
          siteName: settings.site_name || 'TechHaven US'
        }),
        signal: AbortSignal.timeout(8000)
      });
      if (hookRes.ok) {
        return { delivered: true, note: `Sent via Automation Webhook (${hookRes.status})` };
      }
      return { delivered: false, note: `Webhook HTTP ${hookRes.status}` };
    } catch (err) {
      return { delivered: false, note: err.message };
    }
  }

  return { delivered: false, note: 'Marked posted after manual share intent' };
}
