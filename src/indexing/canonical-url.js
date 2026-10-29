// The W3C site only carries pages that have been published there. Draft and
// review pages exist only in the source repository, so their citations have to
// point at the GitHub Pages preview instead of the w3.org layout.
const GITHUB_PAGES_STATUSES = new Set(['draft', 'review']);

export function canonicalUrlForSourcePath(sourcePath, publicBaseUrl, sectionId = '') {
  let base = String(publicBaseUrl || 'https://www.w3.org/International').replace(/\/+$/, '');
  const normalizedPath = String(sourcePath || '').replace(/^\/+/, '');
  // The nav pages are hosted in the repository tree, outside the published
  // article/question URL layout used by the rest of this source.
  if (base === 'https://www.w3.org/International' && normalizedPath.startsWith('nav/')) {
    base += '/i18n-drafts';
  }
  const withoutLanguage = normalizedPath.replace(/\.([a-z]{2,3}(?:-[a-z0-9]+)*)\.html$/i, '.html');
  let canonicalPath;

  if (/^index\.html$/i.test(withoutLanguage)) {
    // A root index.html is the source's landing page, not a child named "index".
    canonicalPath = '';
  } else if (/\/index\.html$/i.test(withoutLanguage)) {
    canonicalPath = withoutLanguage.replace(/index\.html$/i, '');
  } else {
    canonicalPath = withoutLanguage.replace(/\.html$/i, '');
  }

  return withSectionId(`${base}/${canonicalPath}`, sectionId);
}

export function githubPagesUrlForSourcePath(sourcePath, githubPagesBaseUrl) {
  const base = String(githubPagesBaseUrl || '').replace(/\/+$/, '');
  const normalizedPath = String(sourcePath || '').replace(/^\/+/, '');
  if (!base || !normalizedPath) return '';
  // GitHub Pages serves the file as it is checked in, including the language
  // suffix, and does no language negotiation.
  return `${base}/${normalizedPath}`;
}

export function citationUrlForSourcePath({
  sourcePath,
  publicBaseUrl,
  githubPagesBaseUrl = '',
  status = '',
  sectionId = ''
}) {
  const githubPagesUrl = GITHUB_PAGES_STATUSES.has(String(status || '').trim().toLowerCase())
    ? githubPagesUrlForSourcePath(sourcePath, githubPagesBaseUrl)
    : '';
  const url = githubPagesUrl || canonicalUrlForSourcePath(sourcePath, publicBaseUrl);
  return withSectionId(url, sectionId);
}

export function withSectionId(url, sectionId) {
  return sectionId ? `${url}#${encodeURIComponent(sectionId)}` : url;
}

export function sourcePathWithoutLanguage(sourcePath) {
  return String(sourcePath || '').replace(/\.([a-z]{2,3}(?:-[a-z0-9]+)*)\.html$/i, '.html');
}

export function translationDataPathForSourcePath(sourcePath) {
  const withoutLanguage = sourcePathWithoutLanguage(sourcePath);
  const htmlRemoved = withoutLanguage.replace(/\.html$/i, '');
  return `${htmlRemoved}-data/translations.js`;
}
