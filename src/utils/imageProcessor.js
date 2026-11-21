import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';
import { PUBLIC_DIR, UPLOAD_DIR } from '../config.js';

const LOGO_SVG_PATH = path.join(PUBLIC_DIR, 'logo.svg');
const watermarkCache = new Map();

async function getFloatingWatermark(imgWidth, imgHeight) {
  if (!fs.existsSync(LOGO_SVG_PATH) || imgWidth < 320 || imgHeight < 160) {
    return null;
  }

  const logoW = Math.round(Math.max(84, Math.min(240, imgWidth * 0.165)));
  const logoH = Math.round(logoW * (570 / 2324));
  const pad = Math.max(6, Math.round(logoH * 0.18));
  const cacheKey = `${logoW}x${logoH}x${pad}`;

  let wmBuf = watermarkCache.get(cacheKey);
  if (!wmBuf) {
    const logoSvgRaw = fs.readFileSync(LOGO_SVG_PATH, 'utf8');
    const whiteLogoSvg = logoSvgRaw.replace(/fill\s*:\s*#[0-9a-fA-F]{3,8}/gi, 'fill:#ffffff;fill-opacity:0.92');
    const shadowLogoSvg = logoSvgRaw.replace(/fill\s*:\s*#[0-9a-fA-F]{3,8}/gi, 'fill:#000000;fill-opacity:0.55');

    const [whiteLogoPng, shadowPng] = await Promise.all([
      sharp(Buffer.from(whiteLogoSvg), { density: 300 })
        .resize(logoW, logoH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
      sharp(Buffer.from(shadowLogoSvg), { density: 300 })
        .resize(logoW, logoH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .extend({ top: pad, bottom: pad, left: pad, right: pad, background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .blur(Math.max(1.5, Math.min(2.5, logoH * 0.045)))
        .png()
        .toBuffer()
    ]);

    wmBuf = await sharp(shadowPng)
      .composite([{ input: whiteLogoPng, left: pad, top: Math.max(0, pad - 2) }])
      .png()
      .toBuffer();

    if (watermarkCache.size > 12) watermarkCache.clear();
    watermarkCache.set(cacheKey, wmBuf);
  }

  const marginX = Math.round(Math.max(12, imgWidth * 0.024));
  const marginY = Math.round(Math.max(10, imgHeight * 0.032));
  const totalW = logoW + pad * 2;
  const totalH = logoH + pad * 2;

  return {
    input: wmBuf,
    left: Math.max(0, imgWidth - totalW - marginX + pad),
    top: Math.max(0, imgHeight - totalH - marginY + pad)
  };
}

function slugifyName(name) {
  return String(name || 'image')
    .replace(/\.[^/.]+$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'media';
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export async function processUploadedImage(buffer, originalName, mimeType = '', options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error('Empty image buffer provided.');
  }

  const applyWatermark = options.watermark !== false;
  const baseName = slugifyName(originalName);
  const uniqueId = crypto.randomBytes(4).toString('hex');
  const filename = `${baseName}-${uniqueId}.webp`;
  const thumbFilename = `${baseName}-${uniqueId}-thumb.webp`;
  const fullPath = path.join(UPLOAD_DIR, filename);
  const thumbPath = path.join(UPLOAD_DIR, thumbFilename);

  const probe = sharp(buffer, { failOn: 'none' });
  const meta = await probe.metadata();
  const detectedFormat = (meta.format || mimeType.split('/')[1] || 'unknown').toLowerCase();
  const isAnimated = Boolean(meta.pages && meta.pages > 1);

  let mainInfo;
  if (isAnimated || !applyWatermark) {
    const mainPipeline = isAnimated
      ? sharp(buffer, { animated: true, failOn: 'none' })
      : sharp(buffer, { failOn: 'none' }).rotate();

    mainInfo = await mainPipeline
      .resize({ width: 1400, withoutEnlargement: true })
      .webp({ quality: 80, effort: 5, smartSubsample: true })
      .toFile(fullPath);
  } else {
    const resized = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width: 1400, withoutEnlargement: true })
      .toBuffer({ resolveWithObject: true });

    const wm = await getFloatingWatermark(resized.info.width, resized.info.height);
    const outPipeline = sharp(resized.data);
    if (wm) {
      outPipeline.composite([wm]);
    }
    mainInfo = await outPipeline
      .webp({ quality: 80, effort: 5, smartSubsample: true })
      .toFile(fullPath);
  }

  const thumbResized = await sharp(buffer, { animated: false, failOn: 'none' })
    .rotate()
    .resize({ width: 640, height: 360, fit: 'cover', position: 'attention' })
    .toBuffer({ resolveWithObject: true });

  const thumbOut = sharp(thumbResized.data);
  if (applyWatermark) {
    const thumbWm = await getFloatingWatermark(thumbResized.info.width, thumbResized.info.height);
    if (thumbWm) {
      thumbOut.composite([thumbWm]);
    }
  }
  await thumbOut
    .webp({ quality: 76, effort: 5, smartSubsample: true })
    .toFile(thumbPath);

  const originalSize = buffer.length;
  const webpSize = mainInfo.size;
  const savingsPercent = originalSize > 0
    ? Math.max(0, Math.round(((originalSize - webpSize) / originalSize) * 100))
    : 0;

  return {
    filename,
    thumbFilename,
    url: `/uploads/${filename}`,
    thumbUrl: `/uploads/${thumbFilename}`,
    width: mainInfo.width || meta.width || 1200,
    height: mainInfo.height || meta.height || 675,
    webpSize,
    originalSize,
    originalFormat: detectedFormat,
    savingsPercent
  };
}

export function deleteUploadedFiles(filename, thumbFilename) {
  for (const candidate of [filename, thumbFilename]) {
    if (!candidate) continue;
    const safeName = path.basename(candidate);
    if (!safeName.endsWith('.webp')) continue;
    const target = path.join(UPLOAD_DIR, safeName);
    if (fs.existsSync(target)) {
      fs.unlinkSync(target);
    }
  }
}

export async function generateEditorialCoverWebp(
  filenameBase,
  { category = 'TECHHAVEN US', headline = '', kicker = 'TECHHAVEN US BRIEFING', accentColor = '#2563EB', secondaryColor = '#0F172A' }
) {
  const safeBase = slugifyName(filenameBase);
  const filename = `${safeBase}.webp`;
  const thumbFilename = `${safeBase}-thumb.webp`;
  const fullPath = path.join(UPLOAD_DIR, filename);
  const thumbPath = path.join(UPLOAD_DIR, thumbFilename);

  const words = String(headline || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + ' ' + word).trim().length > 26 && current) {
      lines.push(current.trim());
      current = word;
      if (lines.length === 3) break;
    } else {
      current = (current + ' ' + word).trim();
    }
  }
  if (current && lines.length < 3) lines.push(current);

  const lineSvg = lines
    .map((line, i) => `<text x="96" y="${335 + i * 74}" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="56" font-weight="800" fill="#F8FAFC" letter-spacing="-1.2">${escapeXml(line)}</text>`)
    .join('\n    ');

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="788" viewBox="0 0 1400 788">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#090D16" />
      <stop offset="55%" stop-color="${escapeXml(secondaryColor)}" />
      <stop offset="100%" stop-color="#0F172A" />
    </linearGradient>
    <radialGradient id="glow1" cx="85%" cy="18%" r="55%">
      <stop offset="0%" stop-color="${escapeXml(accentColor)}" stop-opacity="0.45" />
      <stop offset="100%" stop-color="${escapeXml(accentColor)}" stop-opacity="0" />
    </radialGradient>
    <radialGradient id="glow2" cx="12%" cy="88%" r="48%">
      <stop offset="0%" stop-color="${escapeXml(accentColor)}" stop-opacity="0.24" />
      <stop offset="100%" stop-color="${escapeXml(accentColor)}" stop-opacity="0" />
    </radialGradient>
    <pattern id="grid" width="56" height="56" patternUnits="userSpaceOnUse">
      <path d="M 56 0 L 0 0 0 56" fill="none" stroke="#94A3B8" stroke-opacity="0.09" stroke-width="1" />
    </pattern>
  </defs>
  <rect width="1400" height="788" fill="url(#bg)" />
  <rect width="1400" height="788" fill="url(#grid)" />
  <rect width="1400" height="788" fill="url(#glow1)" />
  <rect width="1400" height="788" fill="url(#glow2)" />

  <circle cx="1180" cy="210" r="190" fill="none" stroke="${escapeXml(accentColor)}" stroke-opacity="0.28" stroke-width="2" />
  <circle cx="1180" cy="210" r="132" fill="none" stroke="#E2E8F0" stroke-opacity="0.14" stroke-width="1.5" stroke-dasharray="8 8" />
  <circle cx="1180" cy="210" r="64" fill="${escapeXml(accentColor)}" fill-opacity="0.22" />

  <rect x="96" y="132" width="236" height="44" rx="22" fill="${escapeXml(accentColor)}" fill-opacity="0.22" stroke="${escapeXml(accentColor)}" stroke-width="1.5" />
  <text x="214" y="160" text-anchor="middle" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="18" font-weight="700" fill="#F8FAFC" letter-spacing="1.6">${escapeXml(category.toUpperCase())}</text>

  <text x="96" y="238" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="22" font-weight="600" fill="#94A3B8" letter-spacing="2.2">${escapeXml(kicker.toUpperCase())}</text>
  ${lineSvg}

  <line x1="96" y1="628" x2="1304" y2="628" stroke="#E2E8F0" stroke-opacity="0.16" stroke-width="1.5" />
  <rect x="96" y="660" width="14" height="36" rx="4" fill="${escapeXml(accentColor)}" />
  <text x="124" y="685" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="22" font-weight="700" fill="#E2E8F0">TECHHAVENUS.COM</text>
  <text x="1304" y="685" text-anchor="end" font-family="Inter, Segoe UI, Arial, sans-serif" font-size="20" font-weight="500" fill="#94A3B8">US &amp; EUROPE TECH EDITION • 2026</text>
</svg>`;

  const svgBuf = Buffer.from(svg, 'utf8');
  const mainInfo = await sharp(svgBuf)
    .webp({ quality: 86, effort: 5 })
    .toFile(fullPath);

  await sharp(svgBuf)
    .resize({ width: 640, height: 360, fit: 'cover' })
    .webp({ quality: 80, effort: 5 })
    .toFile(thumbPath);

  return {
    filename,
    thumbFilename,
    url: `/uploads/${filename}`,
    thumbUrl: `/uploads/${thumbFilename}`,
    width: mainInfo.width || 1400,
    height: mainInfo.height || 788,
    webpSize: mainInfo.size,
    originalSize: svgBuf.length,
    originalFormat: 'svg'
  };
}
