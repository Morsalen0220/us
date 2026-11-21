export function parseYouTubeUrl(rawUrl) {
  let input = String(rawUrl || '').trim();
  if (!input) return null;

  if (!/^https?:\/\//i.test(input)) {
    input = `https://${input}`;
  }

  let urlObj;
  try {
    urlObj = new URL(input);
  } catch {
    return null;
  }

  const host = urlObj.hostname.toLowerCase();
  if (!host.includes('youtube.com') && !host.includes('youtu.be') && !host.includes('youtube-nocookie.com')) {
    return null;
  }

  let videoId = '';
  let isShort = false;

  if (host.includes('youtu.be')) {
    videoId = urlObj.pathname.replace(/^\/+/, '').split('/')[0] || '';
  } else if (urlObj.pathname.startsWith('/shorts/')) {
    videoId = urlObj.pathname.split('/')[2] || '';
    isShort = true;
  } else if (urlObj.pathname.startsWith('/embed/') || urlObj.pathname.startsWith('/live/') || urlObj.pathname.startsWith('/v/')) {
    videoId = urlObj.pathname.split('/')[2] || '';
  } else {
    videoId = urlObj.searchParams.get('v') || '';
  }

  if (!/^[a-zA-Z0-9_-]{6,20}$/.test(videoId)) return null;

  return {
    videoId,
    isShort,
    embedUrl: `https://www.youtube.com/embed/${videoId}`,
    watchUrl: isShort ? `https://www.youtube.com/shorts/${videoId}` : `https://www.youtube.com/watch?v=${videoId}`,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
  };
}

export function buildVideoObjectJsonLd(post, videoInfo, settings = {}) {
  if (!post || !videoInfo) return null;
  const siteUrl = (settings.site_url || 'https://techhavenus.com').replace(/\/+$/, '');
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: post.video_title || post.meta_title || post.title,
    description: post.meta_description || post.excerpt || post.title,
    thumbnailUrl: [
      videoInfo.thumbnailUrl,
      ...(post.featured_image ? [`${siteUrl}${post.featured_image}`] : [])
    ],
    uploadDate: post.published_at || post.created_at,
    duration: post.video_duration || 'PT5M30S',
    embedUrl: videoInfo.embedUrl,
    contentUrl: videoInfo.watchUrl,
    publisher: {
      '@type': 'Organization',
      name: settings.site_name || 'TechHaven US',
      logo: {
        '@type': 'ImageObject',
        url: `${siteUrl}/favicon.svg`
      }
    }
  };
}
