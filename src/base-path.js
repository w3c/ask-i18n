// Support for serving the app under a subpath, for example
// https://labs.w3.org/ask-i18n/ behind a reverse proxy.

export function normalizeBasePath(value = '') {
  const trimmed = String(value ?? '').trim();
  if (!trimmed || trimmed === '/') return '';

  if (trimmed.includes('?') || trimmed.includes('#')) {
    throw new Error(`BASE_PATH must be a URL path without a query string or fragment: ${trimmed}`);
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
}

// Returns the path the app should route on. A proxy that strips the prefix
// before forwarding is also supported: unprefixed paths pass through unchanged.
export function mountPath(pathname, basePath = '') {
  if (!basePath) return { pathname, redirectTo: '' };
  if (pathname === basePath) return { pathname: '/', redirectTo: `${basePath}/` };
  if (pathname.startsWith(`${basePath}/`)) {
    return { pathname: pathname.slice(basePath.length), redirectTo: '' };
  }
  return { pathname, redirectTo: '' };
}
