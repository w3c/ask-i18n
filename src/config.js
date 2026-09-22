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

  return [
    {
      id: 'i18n-drafts',
      mode: firstDefined(overrides.sourceMode, env.SOURCE_MODE, 'git'),
      repoUrl: firstDefined(overrides.sourceRepoUrl, env.SOURCE_REPO_URL, 'https://github.com/w3c/i18n-drafts.git'),
      ref: firstDefined(overrides.sourceRef, env.SOURCE_REF, 'gh-pages'),
      cacheDir: firstDefined(overrides.sourceCacheDir, env.SOURCE_CACHE_DIR, '.cache/source/i18n-drafts'),
      fetchDepth: Number(firstDefined(overrides.sourceFetchDepth, env.SOURCE_FETCH_DEPTH, 1)),
      repoPath: firstDefined(overrides.sourceRepoPath, env.SOURCE_REPO_PATH, ''),
      publicBaseUrl: firstDefined(overrides.publicBaseUrl, env.PUBLIC_BASE_URL, 'https://www.w3.org/International'),
      contentRoots: null,
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
    contentRoots: Array.isArray(source.contentRoots || source.content_roots)
      ? (source.contentRoots || source.content_roots)
      : null,
    requireMetadata,
    defaultStatus: source.defaultStatus || source.default_status || (requireMetadata ? '' : 'published'),
    statusOverride: source.statusOverride || source.status_override || ''
  };
}

export function loadEnvFile(envFilePath = '.env') {
  if (!envFilePath || !existsSync(envFilePath)) return {};
  return parseEnvFileContent(readFileSync(envFilePath, 'utf8'));
}

export function parseEnvFileContent(content = '') {
  const parsed = {};

  for (const rawLine of String(content).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const assignment = line.replace(/^export\s+/, '');
    const separatorIndex = assignment.indexOf('=');
    if (separatorIndex < 0) continue;

    const key = assignment.slice(0, separatorIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;

    const rawValue = stripInlineComment(assignment.slice(separatorIndex + 1)).trim();
    parsed[key] = unquoteValue(rawValue);
  }

  return parsed;
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
