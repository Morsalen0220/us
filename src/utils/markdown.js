import { marked } from 'marked';
import sanitizeHtml from 'sanitize-html';
import { renderIcon } from './icons.js';
import { parseYouTubeUrl } from './video.js';

function slugifyHeading(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'section';
}

function stripTags(html) {
  return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function renderArticleContent(markdownText = '') {
  const withYouTubeEmbeds = String(markdownText || '').replace(/\{\{youtube:([^\}\s]+)\}\}/gi, (m, url) => {
    const info = parseYouTubeUrl(url);
    if (!info) return m;
    const cls = info.isShort ? 'yt-lite yt-lite-short' : 'yt-lite';
    return `\n<div class="${cls}" data-yt-id="${info.videoId}" data-yt-short="${info.isShort ? '1' : '0'}" data-yt-title="Embedded YouTube Video"><img src="${info.thumbnailUrl}" alt="YouTube Video Thumbnail" loading="lazy"><button type="button" class="yt-play-btn" aria-label="Play Video"></button></div>\n`;
  });

  const rawHtml = marked.parse(withYouTubeEmbeds, {
    gfm: true,
    breaks: false
  });

  const cleanHtml = sanitizeHtml(rawHtml, {
    allowedTags: [
      'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'ul', 'ol', 'li', 'blockquote',
      'pre', 'code', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'figure', 'figcaption', 'img', 'a', 'button',
      'strong', 'b', 'em', 'i', 'mark', 'hr', 'br', 'div', 'span',
      'details', 'summary', 'kbd', 'sup', 'sub'
    ],
    allowedAttributes: {
      '*': ['id', 'class'],
      a: ['href', 'title', 'target', 'rel'],
      button: ['type', 'aria-label'],
      div: ['id', 'class', 'data-yt-id', 'data-yt-short', 'data-yt-title'],
      img: ['src', 'alt', 'title', 'aria-description', 'data-description', 'width', 'height', 'loading', 'decoding'],
      th: ['align'],
      td: ['align']
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesByTag: {
      img: ['http', 'https', 'data']
    },
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href || '#';
        const isExternal = /^https?:\/\//i.test(href) && !href.includes('techhavenus.com');
        return {
          tagName,
          attribs: {
            ...attribs,
            ...(isExternal ? { target: '_blank', rel: 'noopener noreferrer nofollow' } : {})
          }
        };
      },
      img: (tagName, attribs) => ({
        tagName,
        attribs: {
          ...attribs,
          loading: attribs.loading || 'lazy',
          decoding: attribs.decoding || 'async'
        }
      })
    }
  });

  const toc = [];
  const usedIds = new Map();

  const htmlWithIds = cleanHtml.replace(/<(h[23])([^>]*)>([\s\S]*?)<\/\1>/gi, (match, tag, attrs, inner) => {
    const plainText = stripTags(inner);
    let id = slugifyHeading(plainText);
    const seen = usedIds.get(id) || 0;
    usedIds.set(id, seen + 1);
    if (seen > 0) id = `${id}-${seen + 1}`;

    toc.push({
      id,
      text: plainText,
      level: Number(tag.slice(1))
    });

    const cleanedAttrs = attrs.replace(/\sid="[^"]*"/i, '');
    return `<${tag}${cleanedAttrs} id="${id}">${inner}</${tag}>`;
  });

  const htmlWithPlayIcons = htmlWithIds.replaceAll(
    '<button type="button" class="yt-play-btn" aria-label="Play Video"></button>',
    `<button type="button" class="yt-play-btn" aria-label="Play Video">${renderIcon('play', 22)}</button>`
  );

  const plainBody = stripTags(htmlWithPlayIcons);
  const words = plainBody ? plainBody.split(/\s+/).filter(Boolean) : [];
  const wordCount = words.length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 220));

  return {
    html: htmlWithPlayIcons,
    toc,
    wordCount,
    readingTime
  };
}

export function injectMidArticleAd(html, adHtml, afterParagraph = 3) {
  if (!html || !adHtml || !adHtml.trim()) return html;
  const pCount = (html.match(/<\/p>/gi) || []).length;
  const targetIndex = Math.max(1, Number.parseInt(afterParagraph, 10) || 3);
  if (pCount < targetIndex + 1) return html;

  let current = 0;
  let injected = false;
  return html.replace(/<\/p>/gi, (match) => {
    current += 1;
    if (!injected && current === targetIndex) {
      injected = true;
      return `${match}\n<div class="ad-slot ad-slot-mid" aria-label="Advertisement">${adHtml}</div>`;
    }
    return match;
  });
}
