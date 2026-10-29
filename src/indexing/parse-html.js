import vm from 'node:vm';
import { createHash } from 'node:crypto';
import {
  citationUrlForSourcePath,
  githubPagesUrlForSourcePath,
  sourcePathWithoutLanguage
} from './canonical-url.js';
import { normalizeLanguage, translationStateForLanguage, EMPTY_TRANSLATIONS } from './parse-translations.js';

export function parseHtmlPage({
  html,
  sourcePath,
  publicBaseUrl,
  translations = EMPTY_TRANSLATIONS,
  sourceMode = 'local',
  sourceRef = '',
  sourceCommit = '',
  defaultStatus = '',
  statusOverride = '',
  githubPagesBaseUrl = ''
}) {
  const f = extractFMetadata(html);
  const htmlLang = normalizeLanguage(firstMatch(html, /<html\b[^>]*\blang=["']?([^"'\s>]+)/i));
  const sourceLanguage = languageFromSourcePath(sourcePath);
  const language = htmlLang || sourceLanguage || normalizeLanguage(f.lang || f.language);
  const title = cleanText(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i)) ||
    cleanText(f.title) ||
    cleanText(firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i));
  const h1 = cleanText(firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i)) || title;
  const description = cleanText(
    firstMatch(html, /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    firstMatch(html, /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i)
  );
  const status = statusOverride
    ? normalizeStatus(statusOverride)
    : (f.status ? normalizeStatus(f.status) : (defaultStatus || normalizeStatus(f.status)));
  const canonicalUrl = citationUrlForSourcePath({ sourcePath, publicBaseUrl, githubPagesBaseUrl, status });
  const githubPagesUrl = githubPagesUrlForSourcePath(sourcePath, githubPagesBaseUrl);
  const text = htmlToCleanText(html);
  const indexedAt = new Date().toISOString();

  return {
    id: sourcePath,
    source_mode: sourceMode,
    source_ref: sourceRef,
    source_commit: sourceCommit,
    source_path: sourcePath,
    canonical_url: canonicalUrl,
    github_pages_url: githubPagesUrl || canonicalUrl,
    root: sourcePath.split('/')[0] || '',
    language,
    html_lang: htmlLang,
    title,
    description,
    meta_description: description,
    h1,
    status,
    translation_group_id: sourcePathWithoutLanguage(sourcePath).replace(/\.html$/i, ''),
    translation_state: translationStateForLanguage(translations, language),
    metadata: { f },
    metadata_json: { f },
    content_hash: sha256(html),
    indexed_at: indexedAt,
    html,
    text
  };
}

export function isLikelyContentPage(html, options = {}) {
  const requireMetadata = options.requireMetadata !== false;
  const hasLang = /<html\b[^>]*\blang=/i.test(html);
  if (!hasLang) return false;
  const hasH1 = /<h1\b/i.test(html);
  if (!requireMetadata) return hasH1 || /<h2\b/i.test(html) || /<title\b/i.test(html);
  if (!hasH1) return false;
  return /\bf\.status\b/i.test(html) || /\bvar\s+f\s*=/i.test(html) || /\bf\s*=\s*\{/i.test(html);
}

export function extractFMetadata(html = '') {
  const sandbox = { f: {} };
  const scripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((script) => /\bf\b/.test(script));

  for (const script of scripts) {
    try {
      vm.runInNewContext(script, sandbox, {
        timeout: 100,
        displayErrors: false,
        contextName: 'page-metadata'
      });
    } catch {
      continue;
    }
  }

  return sanitizeMetadataObject(sandbox.f || {});
}

function sanitizeMetadataObject(value) {
  if (!value || typeof value !== 'object') return {};

  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw == null) continue;
    if (typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean') {
      result[key] = String(raw);
    } else if (Array.isArray(raw)) {
      result[key] = raw.map((item) => sanitizeMetadataValue(item));
    } else if (typeof raw === 'object') {
      result[key] = sanitizeMetadataValue(raw);
    }
  }
  return result;
}

function sanitizeMetadataValue(value) {
  if (value == null) return value;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizeMetadataValue(item));
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeMetadataValue(item)]));
  }
  return String(value);
}

export function htmlToCleanText(html = '') {
  return cleanText(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|li|tr|h1|h2|h3|h4|section|div|table)>/gi, ' ')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  );
}

export function cleanText(value = '') {
  return decodeHtmlEntities(String(value).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

export function firstMatch(value, pattern) {
  const match = String(value || '').match(pattern);
  return match ? match[1] : '';
}

export function languageFromSourcePath(sourcePath = '') {
  return normalizeLanguage(firstMatch(sourcePath, /\.([a-z]{2,3}(?:-[a-z0-9]+)*)\.html$/i));
}

export function normalizeStatus(status = '') {
  const normalized = String(status || 'notreviewed').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (normalized === 'published' || normalized === 'review' || normalized === 'draft' || normalized === 'obsolete') {
    return normalized;
  }
  if (normalized === 'notreviewed' || normalized === 'notreview') return 'notreviewed';
  return normalized || 'notreviewed';
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function decodeHtmlEntities(value) {
  const named = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' '
  };

  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (entity, code) => {
    if (code[0] === '#') {
      const numeric = code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(numeric) ? String.fromCodePoint(numeric) : entity;
    }
    return named[code.toLowerCase()] ?? entity;
  });
}
