export function resolveAssetUrl(relativePath, settings = {}) {
  if (!relativePath) return '';
  if (/^https?:\/\//i.test(relativePath)) return relativePath;
  const cdnBase = String(settings.cdn_base_url || '').trim().replace(/\/+$/, '');
  const cleanRel = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
  return cdnBase ? `${cdnBase}${cleanRel}` : cleanRel;
}
