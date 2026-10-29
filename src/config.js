import { existsSync, readFileSync } from 'node:fs';
import { normalizeBasePath } from './base-path.js';

export function getConfig(overrides = {}) {
  const fileEnv = loadEnvFile(overrides.envFilePath || '.env');
  const env = { ...fileEnv, ...process.env };
  const config = {
    port: Number(firstDefined(overrides.port, env.PORT, 3000)),
    basePath: normalizeBasePath(firstDefined(overrides.basePath, env.BASE_PATH, '')),
    indexPath: firstDefined(overrides.indexPath, env.INDEX_PATH, '.data/index.json'),
    queryLogPath: firstDefined(overrides.queryLogPath, env.QUERY_LOG_PATH, '.data/query-log.jsonl'),
    queryLogMaxBytes: Number(firstDefined(overrides.queryLogMaxBytes, env.QUERY_LOG_MAX_BYTES, 10 * 1024 * 1024)),
    queryLogBackups: Number(firstDefined(overrides.queryLogBackups, env.QUERY_LOG_BACKUPS, 3)),
    sourceMode: firstDefined(overrides.sourceMode, env.SOURCE_MODE, 'git'),
    sourceRepoPath: firstDefined(overrides.sourceRepoPath, env.SOURCE_REPO_PATH, ''),
    sourceRepoUrl: firstDefined(overrides.sourceRepoUrl, env.SOURCE_REPO_URL, 'https://github.com/w3c/i18n-drafts.git'),
    sourceRef: firstDefined(overrides.sourceRef, env.SOURCE_REF, 'gh-pages'),
    sourceCacheDir: firstDefined(overrides.sourceCacheDir, env.SOURCE_CACHE_DIR, '.cache/source/i18n-drafts'),
    sourceFetchDepth: Number(firstDefined(overrides.sourceFetchDepth, env.SOURCE_FETCH_DEPTH, 1)),
    sourceRefreshMode: firstDefined(overrides.sourceRefreshMode, env.SOURCE_REFRESH_MODE, 'manual'),
    sourceCommit: firstDefined(overrides.sourceCommit, env.SOURCE_COMMIT, ''),
    publicBaseUrl: firstDefined(overrides.publicBaseUrl, env.PUBLIC_BASE_URL, 'https://www.w3.org/International'),
    sources: parseSources(overrides, env),
    modelProvider: firstDefined(overrides.modelProvider, env.MODEL_PROVIDER, 'local'),
    modelApiKey: firstDefined(overrides.modelApiKey, env.MODEL_API_KEY, ''),
    modelBaseUrl: firstDefined(overrides.modelBaseUrl, env.MODEL_BASE_URL, ''),
    modelTimeoutMs: Number(firstDefined(overrides.modelTimeoutMs, env.MODEL_TIMEOUT_MS, 30_000)),
    generationModel: firstDefined(overrides.generationModel, env.GENERATION_MODEL, ''),
    databaseUrl: firstDefined(overrides.databaseUrl, env.DATABASE_URL, '.data/index.json'),
    enableDebug: parseBoolean(overrides.enableDebug ?? env.ENABLE_DEBUG ?? false),
    adminToken: firstDefined(overrides.adminToken, env.ADMIN_TOKEN, ''),
    isPullRequest: parseBoolean(overrides.isPullRequest ?? env.IS_PULL_REQUEST ?? false),
    rateLimitWindowMs: Number(firstDefined(overrides.rateLimitWindowMs, env.RATE_LIMIT_WINDOW_MS, 60_000)),
    rateLimitMax: Number(firstDefined(overrides.rateLimitMax, env.RATE_LIMIT_MAX, 30)),
    trustedProxies: parseList(firstDefined(overrides.trustedProxies, env.TRUSTED_PROXIES, ''))
  };

  return config;
}

function parseSources(overrides, env) {
  const hasExplicitSingleSourceOverride =
    overrides.sourceMode !== undefined ||
    overrides.sourceRepoPath !== undefined ||
    overrides.sourceRepoUrl !== undefined ||
    overrides.sourceRef !== undefined;

  const raw = overrides.sources !== undefined
    ? overrides.sources
    : (hasExplicitSingleSourceOverride ? '' : (env.SOURCES || ''));

  if (raw) {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((source, index) => normalizeSource(source, index));
      }
    } catch {
      // fall through to legacy single-source
    }
  }

  const requireMetadata = overrides.requireMetadata !== undefined
    ? parseBoolean(overrides.requireMetadata)
    : true;

  const repoUrl = firstDefined(overrides.sourceRepoUrl, env.SOURCE_REPO_URL, 'https://github.com/w3c/i18n-drafts.git');

  return [
    {
      id: 'i18n-drafts',
      mode: firstDefined(overrides.sourceMode, env.SOURCE_MODE, 'git'),
      repoUrl,
      ref: firstDefined(overrides.sourceRef, env.SOURCE_REF, 'gh-pages'),
      cacheDir: firstDefined(overrides.sourceCacheDir, env.SOURCE_CACHE_DIR, '.cache/source/i18n-drafts'),
      fetchDepth: Number(firstDefined(overrides.sourceFetchDepth, env.SOURCE_FETCH_DEPTH, 1)),
      repoPath: firstDefined(overrides.sourceRepoPath, env.SOURCE_REPO_PATH, ''),
      publicBaseUrl: firstDefined(overrides.publicBaseUrl, env.PUBLIC_BASE_URL, 'https://www.w3.org/International'),
      githubPagesBaseUrl: firstDefined(overrides.githubPagesBaseUrl, deriveGithubPagesBaseUrl(repoUrl)),
      contentRoots: null,
      contentFiles: null,
      requireMetadata,
      defaultStatus: overrides.defaultStatus || (requireMetadata ? '' : 'published'),
      statusOverride: overrides.statusOverride || ''
    }
  ];
}

function normalizeSource(source, index) {
  const requireMetadata = source.requireMetadata ?? source.require_metadata ?? true;
  return {
    id: source.id || `source-${index}`,
    mode: source.mode || 'git',
    repoUrl: source.repoUrl || source.repo_url || '',
    ref: source.ref || 'gh-pages',
    cacheDir: source.cacheDir || source.cache_dir || `.cache/source/${source.id || `source-${index}`}`,
    fetchDepth: Number(source.fetchDepth ?? source.fetch_depth ?? 1),
    repoPath: source.repoPath || source.repo_path || '',
    publicBaseUrl: source.publicBaseUrl || source.public_base_url || source.baseUrl || '',
    githubPagesBaseUrl: source.githubPagesBaseUrl || source.github_pages_base_url ||
      deriveGithubPagesBaseUrl(source.repoUrl || source.repo_url || ''),
    contentRoots: Array.isArray(source.contentRoots || source.content_roots)
      ? (source.contentRoots || source.content_roots)
      : null,
    contentFiles: normalizeContentFiles(source.contentFiles ?? source.content_files),
    requireMetadata,
    defaultStatus: source.defaultStatus || source.default_status || (requireMetadata ? '' : 'published'),
    statusOverride: source.statusOverride || source.status_override || ''
  };
}

// GitHub Pages serves the repository at <owner>.github.io/<repo>. Draft and
// review pages are not published on w3.org, so their citations need this base.
export function deriveGithubPagesBaseUrl(repoUrl = '') {
  const match = String(repoUrl).match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!match) return '';
  return `https://${match[1].toLowerCase()}.github.io/${match[2]}`;
}

function normalizeContentFiles(value) {
  if (!Array.isArray(value)) return null;
  const files = value
    .map((file) => String(file || '').trim())
    .filter(Boolean);
  return files.length > 0 ? files : null;
}

export function loadEnvFile(envFilePath = '.env') {
  if (!envFilePath || !existsSync(envFilePath)) return {};
  return parseEnvFileContent(readFileSync(envFilePath, 'utf8'));
}

export function parseEnvFileContent(content = '') {
  const parsed = {};
  const lines = String(content).replace(/^\uFEFF/, '').split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!line || line.startsWith('#')) continue;

    const assignment = line.replace(/^export\s+/, '');
    const separatorIndex = assignment.indexOf('=');
    if (separatorIndex < 0) continue;

    const key = assignment.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    const valueSource = assignment.slice(separatorIndex + 1).trim();
    const multiline = collectMultilineValue(valueSource, lines, index);
    const rawValue = stripInlineComment(multiline ? multiline.value : valueSource).trim();
    parsed[key] = unquoteValue(rawValue);
    if (multiline) index = multiline.endIndex;
  }

  return parsed;
}

/**
 * Joins a quoted value that continues onto following lines, so long JSON values
 * (for example SOURCES) can be written indented instead of on a single line.
 * Returns null when the value fits on one line or the opening quote is never closed.
 *
 * @param {string} valueSource Trimmed text after the "=", including its opening quote.
 * @param {string[]} lines All raw lines of the env file.
 * @param {number} startIndex Index of the line the value starts on.
 * @returns {{ value: string, endIndex: number } | null}
 */
function collectMultilineValue(valueSource, lines, startIndex) {
  const quote = valueSource[0];
  if (quote !== '"' && quote !== "'") return null;

  const firstLineBody = valueSource.slice(1);
  if (findClosingQuote(firstLineBody, quote) >= 0) return null;

  const parts = [firstLineBody];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const closingIndex = findClosingQuote(rawLine, quote);
    if (closingIndex < 0) {
      parts.push(rawLine);
      continue;
    }
    parts.push(rawLine.slice(0, closingIndex + 1));
    return { value: quote + parts.join('\n'), endIndex: index };
  }

  return null;
}

/**
 * @param {string} text Text to scan, starting after the opening quote.
 * @param {string} quote The quote character that terminates the value.
 * @returns {number} Index of the unescaped closing quote, or -1 when absent.
 */
function findClosingQuote(text, quote) {
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== quote) continue;
    if (quote === '"' && isEscaped(text, index)) continue;
    return index;
  }
  return -1;
}

/**
 * @param {string} text Text containing the candidate quote.
 * @param {number} index Index of the quote character.
 * @returns {boolean} True when the quote is preceded by an odd number of backslashes.
 */
function isEscaped(text, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === '\\'; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function stripInlineComment(value) {
  let singleQuoted = false;
  let doubleQuoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    const previous = value[index - 1];

    if (char === "'" && !doubleQuoted) singleQuoted = !singleQuoted;
    if (char === '"' && !singleQuoted) doubleQuoted = !doubleQuoted;
    if (char === '#' && !singleQuoted && !doubleQuoted && (!previous || /\s/.test(previous))) {
      return value.slice(0, index);
    }
  }

  return value;
}

function unquoteValue(value) {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    const unquoted = value.slice(1, -1);
    if (value.startsWith('"')) {
      return unquoted
        .replaceAll('\\n', '\n')
        .replaceAll('\\r', '\r')
        .replaceAll('\\t', '\t')
        .replaceAll('\\"', '"')
        .replaceAll('\\\\', '\\');
    }
    return unquoted;
  }

  return value;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null);
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseList(value) {
  if (Array.isArray(value)) return value.flatMap(parseList);
  return String(value || '')
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}
