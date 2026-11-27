export function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96) || 'post';
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function absoluteUrl(siteUrl, maybeRelative) {
  if (!maybeRelative) return '';
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  const base = String(siteUrl || '').replace(/\/+$/, '');
  const pathPart = maybeRelative.startsWith('/') ? maybeRelative : `/${maybeRelative}`;
  return `${base}${pathPart}`;
}

export function toIsoTimestamp(raw) {
  if (!raw) return '';
  const str = String(raw).trim();
  if (!str) return '';
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(str)
    ? `${str.replace(' ', 'T')}Z`
    : str;
  const dt = new Date(normalized);
  return Number.isNaN(dt.getTime()) ? '' : dt.toISOString();
}

function maxIsoTimestamp(items, picker) {
  let best = '';
  for (const item of items || []) {
    const iso = toIsoTimestamp(picker(item));
    if (iso && iso > best) best = iso;
  }
  return best;
}

export function serializeJsonLd(obj) {
  return JSON.stringify(obj).replace(/<\/script/gi, '<\\/script');
}

export function buildWebsiteJsonLd(settings) {
  const siteUrl = (settings.site_url || 'https://techhavenus.com').replace(/\/+$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: settings.site_name || 'TechHaven US',
    url: `${siteUrl}/`,
    description: settings.site_tagline || 'Breaking US & Europe Tech, AI, Gaming & Practical Guides',
    inLanguage: 'en-US',
    potentialAction: {
      '@type': 'SearchAction',
      target: `${siteUrl}/search?q={search_term_string}`,
      'query-input': 'required name=search_term_string'
    }
  };
}

export function buildOrganizationJsonLd(settings) {
  const siteUrl = (settings.site_url || 'https://techhavenus.com').replace(/\/+$/, '');
  const siteName = settings.site_name || 'TechHaven US';
  const legalName = settings.publisher_legal_name || 'TechHaven US';
  const ownerName = settings.publisher_owner_name || 'Alex Mercer';

  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${siteUrl}/#organization`,
    name: siteName,
    legalName,
    url: `${siteUrl}/`,
    founder: {
      '@type': 'Person',
      name: ownerName.replace(/\s*\([^)]*\)/, '')
    },
    logo: {
      '@type': 'ImageObject',
      url: `${siteUrl}/favicon.svg`,
      width: 512,
      height: 512
    },
    address: {
      '@type': 'PostalAddress',
      ...(settings.publisher_street_address ? { streetAddress: settings.publisher_street_address } : {}),
      addressLocality: settings.publisher_city || 'New York',
      addressRegion: settings.publisher_state || 'NY',
      ...(settings.publisher_postal_code ? { postalCode: settings.publisher_postal_code } : {}),
      addressCountry: settings.publisher_country || 'United States'
    },
    ...(settings.publisher_phone ? { telephone: settings.publisher_phone } : {}),
    publishingPrinciples: `${siteUrl}/editorial-policy`,
    ownershipFundingInfo: `${siteUrl}/about#ownership`,
    correctionsPolicy: `${siteUrl}/editorial-policy`,
    areaServed: ['GB', 'DE', 'FR', 'NL', 'IE', 'SE', 'NO', 'CH', 'ES', 'IT', 'EU', 'US'],
    contactPoint: [
      {
        '@type': 'ContactPoint',
        email: settings.contact_email || 'contact@techhavenus.com',
        ...(settings.publisher_phone ? { telephone: settings.publisher_phone } : {}),
        contactType: 'editorial',
        areaServed: ['GB', 'DE', 'FR', 'NL', 'IE', 'SE', 'NO', 'CH', 'EU', 'US']
      },
      {
        '@type': 'ContactPoint',
        email: settings.privacy_email || 'privacy@techhavenus.com',
        contactType: 'customer support',
        areaServed: ['GB', 'DE', 'FR', 'NL', 'IE', 'SE', 'NO', 'CH', 'EU', 'US']
      }
    ]
  };
}

export function buildAuthorPersonJsonLd(author, settings = {}, includeContext = false) {
  const siteUrl = (settings.site_url || 'https://techhavenus.com').replace(/\/+$/, '');
  const authorUrl = author?.slug ? `${siteUrl}/author/${author.slug}` : `${siteUrl}/about`;
  const knowsAbout = String(author?.expertise || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const sameAs = [];
  if (author?.twitter_handle) {
    const handle = String(author.twitter_handle).replace(/^@/, '').trim();
    if (handle) sameAs.push(`https://x.com/${handle}`);
  }
  if (author?.linkedin_url) sameAs.push(author.linkedin_url);
  if (author?.website_url && author.website_url !== authorUrl) sameAs.push(author.website_url);

  const avatarRaw = String(author?.avatar_url || '').trim();
  const avatarAbs = avatarRaw
    ? (/^https?:\/\//i.test(avatarRaw) ? avatarRaw : `${siteUrl}${avatarRaw.startsWith('/') ? '' : '/'}${avatarRaw}`)
    : '';

  const person = {
    ...(includeContext ? { '@context': 'https://schema.org' } : {}),
    '@type': 'Person',
    '@id': `${authorUrl}#person`,
    name: author?.name || 'TechHaven Editorial',
    url: authorUrl,
    ...(avatarAbs ? { image: avatarAbs } : {}),
    ...(author?.job_title ? { jobTitle: author.job_title } : {}),
    ...(author?.bio ? { description: author.bio } : {}),
    ...(author?.location ? { homeLocation: { '@type': 'Place', name: author.location } } : {}),
    ...(knowsAbout.length ? { knowsAbout } : {}),
    ...(sameAs.length ? { sameAs } : {}),
    worksFor: {
      '@type': 'Organization',
      '@id': `${siteUrl}/#organization`,
      name: settings.site_name || 'TechHaven US',
      url: `${siteUrl}/`
    }
  };
  return person;
}

export function buildProfilePageJsonLd(author, settings = {}) {
  const siteUrl = (settings.site_url || 'https://techhavenus.com').replace(/\/+$/, '');
  const authorUrl = `${siteUrl}/author/${author.slug}`;
  return {
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    '@id': `${authorUrl}#profile`,
    url: authorUrl,
    mainEntity: buildAuthorPersonJsonLd(author, settings, false),
    isPartOf: {
      '@type': 'WebSite',
      name: settings.site_name || 'TechHaven US',
      url: `${siteUrl}/`
    }
  };
}

export function buildArticleJsonLd(post, category, author, tags, settings) {
  const siteUrl = (settings.site_url || 'https://techhavenus.com').replace(/\/+$/, '');
  const articleUrl = `${siteUrl}/article/${post.slug}`;
  const imgUrl = post.featured_image ? absoluteUrl(siteUrl, post.featured_image) : `${siteUrl}/favicon.svg`;

  const schema = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': articleUrl
    },
    headline: post.meta_title || post.title,
    alternativeHeadline: post.meta_subtitle || post.subtitle || post.excerpt,
    description: post.meta_description || post.excerpt,
    image: {
      '@type': 'ImageObject',
      url: imgUrl,
      width: post.featured_image_width || 1400,
      height: post.featured_image_height || 788,
      name: post.featured_image_title || post.title,
      caption: post.featured_image_caption || post.featured_image_alt || post.title,
      description: post.featured_image_description || post.featured_image_caption || post.featured_image_alt || post.excerpt
    },
    datePublished: toIsoTimestamp(post.published_at || post.created_at) || post.published_at || post.created_at,
    dateModified: toIsoTimestamp(post.updated_at || post.published_at || post.created_at) || post.updated_at || post.published_at || post.created_at,
    author: buildAuthorPersonJsonLd(author, settings, false),
    publisher: {
      '@type': 'Organization',
      '@id': `${siteUrl}/#organization`,
      name: settings.site_name || 'TechHaven US',
      logo: {
        '@type': 'ImageObject',
        url: `${siteUrl}/favicon.svg`,
        width: 512,
        height: 512
      }
    },
    articleSection: category ? category.name : 'Technology',
    keywords: post.meta_tags || (Array.isArray(tags) ? tags.map((t) => t.name).join(', ') : ''),
    wordCount: post.word_count || 600,
    inLanguage: 'en',
    audience: {
      '@type': 'Audience',
      audienceType: 'Technology & Gaming Readers',
      geographicArea: [
        { '@type': 'AdministrativeArea', name: 'Europe' },
        { '@type': 'Country', name: 'United Kingdom' },
        { '@type': 'Country', name: 'Germany' },
        { '@type': 'Country', name: 'Netherlands' },
        { '@type': 'Country', name: 'Ireland' },
        { '@type': 'Country', name: 'France' },
        { '@type': 'Country', name: 'United States' }
      ]
    },
    isAccessibleForFree: true
  };

  return schema;
}

export function buildBreadcrumbJsonLd(items, siteUrl) {
  const base = String(siteUrl || 'https://techhavenus.com').replace(/\/+$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, idx) => ({
      '@type': 'ListItem',
      position: idx + 1,
      name: item.name,
      item: absoluteUrl(base, item.url)
    }))
  };
}

export function buildCollectionJsonLd(name, description, url, siteUrl) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    description,
    url: absoluteUrl(siteUrl, url),
    inLanguage: 'en-US'
  };
}

export function buildSitemapXml(siteUrl, posts, categories, tags, extras = {}) {
  const base = String(siteUrl || 'https://techhavenus.com').replace(/\/+$/, '');

  const latestPostIso = maxIsoTimestamp(posts, (p) => p.updated_at || p.published_at || p.created_at);
  const latestVideoIso = maxIsoTimestamp(
    (posts || []).filter((p) => p.video_url),
    (p) => p.updated_at || p.published_at || p.created_at
  );
  const latestAiToolIso = maxIsoTimestamp(extras.aiTools || [], (t) => t.updated_at || t.created_at);
  const latestTimelineIso = maxIsoTimestamp(extras.timelines || [], (tl) => tl.updated_at || tl.created_at);
  const latestBriefingIso = toIsoTimestamp(extras.latestBriefingAt);

  const catLastmodById = new Map();
  for (const post of posts || []) {
    if (!post.category_id) continue;
    const iso = toIsoTimestamp(post.updated_at || post.published_at || post.created_at);
    if (!iso) continue;
    const prev = catLastmodById.get(post.category_id) || '';
    if (iso > prev) catLastmodById.set(post.category_id, iso);
  }

  const staticPages = [
    { path: '/', lastmod: latestPostIso },
    { path: '/videos', lastmod: latestVideoIso || latestPostIso },
    { path: '/ai-tools', lastmod: latestAiToolIso },
    { path: '/briefing', lastmod: latestBriefingIso },
    { path: '/timelines', lastmod: latestTimelineIso },
    { path: '/about', lastmod: '' },
    { path: '/contact', lastmod: '' },
    { path: '/editorial-policy', lastmod: '' },
    { path: '/privacy-policy', lastmod: '' },
    { path: '/terms', lastmod: '' },
    { path: '/disclaimer', lastmod: '' }
  ];

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">'
  ];

  for (const page of staticPages) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(`${base}${page.path}`)}</loc>`);
    if (page.lastmod) {
      lines.push(`    <lastmod>${page.lastmod}</lastmod>`);
    }
    lines.push('  </url>');
  }

  for (const cat of categories) {
    const catLastmod = catLastmodById.get(cat.id) || toIsoTimestamp(cat.created_at);
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(`${base}/category/${cat.slug}`)}</loc>`);
    if (catLastmod) {
      lines.push(`    <lastmod>${catLastmod}</lastmod>`);
    }
    lines.push('  </url>');
  }

  for (const tag of tags) {
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(`${base}/tag/${tag.slug}`)}</loc>`);
    lines.push('  </url>');
  }

  for (const tool of extras.aiTools || []) {
    const toolLastmod = toIsoTimestamp(tool.updated_at || tool.created_at);
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(`${base}/ai-tools/${tool.slug}`)}</loc>`);
    if (toolLastmod) {
      lines.push(`    <lastmod>${toolLastmod}</lastmod>`);
    }
    lines.push('  </url>');
  }

  for (const tl of extras.timelines || []) {
    const tlLastmod = toIsoTimestamp(tl.updated_at || tl.created_at);
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(`${base}/timeline/${tl.slug}`)}</loc>`);
    if (tlLastmod) {
      lines.push(`    <lastmod>${tlLastmod}</lastmod>`);
    }
    lines.push('  </url>');
  }

  for (const post of posts) {
    const lastmod = toIsoTimestamp(post.updated_at || post.published_at || post.created_at);
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(`${base}/article/${post.slug}`)}</loc>`);
    if (lastmod) {
      lines.push(`    <lastmod>${lastmod}</lastmod>`);
    }
    if (post.featured_image) {
      const imgUrl = absoluteUrl(base, post.featured_image);
      const imgTitle = post.featured_image_title || post.meta_title || post.title;
      const imgCaption = post.featured_image_caption || post.featured_image_description || post.featured_image_alt || post.excerpt || post.title;
      lines.push('    <image:image>');
      lines.push(`      <image:loc>${escapeXml(imgUrl)}</image:loc>`);
      lines.push(`      <image:title>${escapeXml(imgTitle)}</image:title>`);
      lines.push(`      <image:caption>${escapeXml(imgCaption)}</image:caption>`);
      lines.push('    </image:image>');
    }
    lines.push('  </url>');
  }

  lines.push('</urlset>');
  return lines.join('\n');
}

export function buildNewsSitemapXml(siteUrl, recentPosts, siteName = 'TechHaven US') {
  const base = String(siteUrl || 'https://techhavenus.com').replace(/\/+$/, '');
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">'
  ];

  for (const post of recentPosts) {
    const pubIso = new Date(post.published_at || post.created_at).toISOString();
    lines.push('  <url>');
    lines.push(`    <loc>${escapeXml(`${base}/article/${post.slug}`)}</loc>`);
    lines.push('    <news:news>');
    lines.push('      <news:publication>');
    lines.push(`        <news:name>${escapeXml(siteName)}</news:name>`);
    lines.push('        <news:language>en</news:language>');
    lines.push('      </news:publication>');
    lines.push(`      <news:publication_date>${pubIso}</news:publication_date>`);
    lines.push(`      <news:title>${escapeXml(post.meta_title || post.title)}</news:title>`);
    if (post.meta_tags) {
      lines.push(`      <news:keywords>${escapeXml(post.meta_tags)}</news:keywords>`);
    }
    lines.push('    </news:news>');
    lines.push('  </url>');
  }

  lines.push('</urlset>');
  return lines.join('\n');
}

export function buildRssXml(siteUrl, posts, settings) {
  const base = String(siteUrl || 'https://techhavenus.com').replace(/\/+$/, '');
  const siteName = settings.site_name || 'TechHaven US';
  const tagline = settings.site_tagline || 'Breaking US & Europe Tech, AI, Gaming & Practical Guides';
  const latestIso = maxIsoTimestamp(posts, (p) => p.updated_at || p.published_at || p.created_at);

  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">',
    '  <channel>',
    `    <title>${escapeXml(siteName)}</title>`,
    `    <link>${escapeXml(base)}/</link>`,
    `    <description>${escapeXml(tagline)}</description>`,
    '    <language>en-us</language>',
    ...(latestIso ? [`    <lastBuildDate>${new Date(latestIso).toUTCString()}</lastBuildDate>`] : []),
    '    <atom:link href="https://pubsubhubbub.appspot.com/" rel="hub" />',
    `    <atom:link href="${escapeXml(base)}/rss.xml" rel="self" type="application/rss+xml" />`
  ];

  for (const post of posts) {
    const postUrl = `${base}/article/${post.slug}`;
    const pubDate = new Date(post.published_at || post.created_at).toUTCString();
    lines.push('    <item>');
    lines.push(`      <title>${escapeXml(post.meta_title || post.title)}</title>`);
    lines.push(`      <link>${escapeXml(postUrl)}</link>`);
    lines.push(`      <guid isPermaLink="true">${escapeXml(postUrl)}</guid>`);
    lines.push(`      <pubDate>${pubDate}</pubDate>`);
    if (post.category_name) {
      lines.push(`      <category>${escapeXml(post.category_name)}</category>`);
    }
    lines.push(`      <description>${escapeXml(post.meta_description || post.excerpt)}</description>`);
    if (post.featured_image) {
      lines.push(`      <media:content url="${escapeXml(absoluteUrl(base, post.featured_image))}" medium="image" type="image/webp" />`);
    }
    lines.push('    </item>');
  }

  lines.push('  </channel>');
  lines.push('</rss>');
  return lines.join('\n');
}

export function buildRobotsTxt(siteUrl, customRules = '') {
  const base = String(siteUrl || 'https://techhavenus.com').replace(/\/+$/, '');
  const lines = [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /admin/',
    ''
  ];
  if (customRules && customRules.trim()) {
    lines.push(customRules.trim());
    lines.push('');
  }
  lines.push(`Sitemap: ${base}/sitemap.xml`);
  lines.push(`Sitemap: ${base}/rss.xml`);
  return lines.join('\n');
}

export function validatePostSchema(post, author) {
  const issues = [];
  if (!post.meta_title && !post.title) issues.push('Missing headline');
  if (!post.meta_description && !post.excerpt) issues.push('Missing description');
  if (!post.featured_image) issues.push('Missing WebP image');
  if (!post.featured_image_caption && !post.featured_image_alt) issues.push('Missing image alt/caption');
  if (!author?.name) issues.push('Missing author byline');
  if (!post.published_at) issues.push('Missing datePublished');
  return { valid: issues.length === 0, issues };
}

export function extractLinksFromMarkdown(md = '') {
  const links = [];
  const mdRegex = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  let m;
  while ((m = mdRegex.exec(String(md))) !== null) {
    links.push({ label: m[1], url: m[2] });
  }
  const hrefRegex = /href=["']([^"']+)["']/gi;
  while ((m = hrefRegex.exec(String(md))) !== null) {
    links.push({ label: 'HTML link', url: m[1] });
  }
  return links;
}
