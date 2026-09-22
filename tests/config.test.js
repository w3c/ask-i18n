import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getConfig, parseEnvFileContent } from '../src/config.js';
import { parseArgs } from '../src/indexing/indexer.js';

const touchedKeys = [
  'PORT',
  'BASE_PATH',
  'QUERY_LOG_MAX_BYTES',
  'QUERY_LOG_BACKUPS',
  'SOURCE_MODE',
  'SOURCE_REPO_PATH',
  'SOURCE_REF',
  'SOURCES',
  'ENABLE_DEBUG',
  'MODEL_PROVIDER',
  'MODEL_API_KEY',
  'MODEL_TIMEOUT_MS',
  'IS_PULL_REQUEST',
  'TRUSTED_PROXIES'
];

test('getConfig loads values from a .env file', async () => {
  const envFilePath = await writeTempEnv([
    '# local configuration',
    'PORT=4123',
    'BASE_PATH=/ask-i18n',
    'SOURCE_MODE=local',
    'SOURCE_REPO_PATH="/tmp/i18n drafts"',
    'export SOURCE_REF=fixture-ref',
    'ENABLE_DEBUG=true',
    'MODEL_PROVIDER=openai-compatible',
    'MODEL_API_KEY=server-side-secret',
    'MODEL_TIMEOUT_MS=12345',
    'QUERY_LOG_MAX_BYTES=5242880',
    'QUERY_LOG_BACKUPS=5',
    'IS_PULL_REQUEST=true',
    'TRUSTED_PROXIES=127.0.0.1/32, ::1'
  ].join('\n'));

  await withCleanEnv(async () => {
    const config = getConfig({ envFilePath });

    assert.equal(config.port, 4123);
    assert.equal(config.basePath, '/ask-i18n');
    assert.equal(config.sourceMode, 'local');
    assert.equal(config.sourceRepoPath, '/tmp/i18n drafts');
    assert.equal(config.sourceRef, 'fixture-ref');
    assert.equal(config.enableDebug, true);
    assert.equal(config.modelProvider, 'openai-compatible');
    assert.equal(config.modelApiKey, 'server-side-secret');
    assert.equal(config.modelTimeoutMs, 12345);
    assert.equal(config.queryLogMaxBytes, 5242880);
    assert.equal(config.queryLogBackups, 5);
    assert.equal(config.isPullRequest, true);
    assert.deepEqual(config.trustedProxies, ['127.0.0.1/32', '::1']);
  });
});

test('BASE_PATH defaults to the site root and normalizes override values', async () => {
  const envFilePath = await writeTempEnv('SOURCE_MODE=local\n');

  await withCleanEnv(async () => {
    assert.equal(getConfig({ envFilePath }).basePath, '');
    assert.equal(getConfig({ envFilePath, basePath: 'ask-i18n/' }).basePath, '/ask-i18n');
  });
});

test('process.env overrides .env values and explicit overrides win last', async () => {
  const envFilePath = await writeTempEnv('PORT=4123\nSOURCE_MODE=git\nENABLE_DEBUG=false\n');

  await withCleanEnv(async () => {
    process.env.PORT = '5555';
    process.env.SOURCE_MODE = 'local';
    const config = getConfig({ envFilePath, port: 7777 });

    assert.equal(config.port, 7777);
    assert.equal(config.sourceMode, 'local');
    assert.equal(config.enableDebug, false);
  });
});

test('parseEnvFileContent ignores comments and supports inline comments outside quotes', () => {
  const parsed = parseEnvFileContent([
    'PLAIN=value # comment',
    'QUOTED="value # not comment"',
    "SINGLE='another # value'",
    'EMPTY=',
    'export SPACED = spaced value'
  ].join('\n'));

  assert.deepEqual(parsed, {
    PLAIN: 'value',
    QUOTED: 'value # not comment',
    SINGLE: 'another # value',
    EMPTY: '',
    SPACED: 'spaced value'
  });
});

test('getConfig parses SOURCES JSON array and normalizes source entries', async () => {
  const sources = JSON.stringify([
    {
      id: 'i18n-drafts',
      repoUrl: 'https://github.com/w3c/i18n-drafts.git',
      ref: 'gh-pages',
      publicBaseUrl: 'https://www.w3.org/International'
    },
    {
      id: 'bp-i18n-specdev',
      repo_url: 'https://github.com/w3c/bp-i18n-specdev.git',
      ref: 'gh-pages',
      public_base_url: 'https://w3c.github.io/bp-i18n-specdev',
      content_roots: [''],
      require_metadata: false
    }
  ]);
  const envFilePath = await writeTempEnv(`SOURCES=${sources}`);

  await withCleanEnv(async () => {
    const config = getConfig({ envFilePath });

    assert.equal(config.sources.length, 2);
    assert.equal(config.sources[0].id, 'i18n-drafts');
    assert.equal(config.sources[0].repoUrl, 'https://github.com/w3c/i18n-drafts.git');
    assert.equal(config.sources[0].publicBaseUrl, 'https://www.w3.org/International');
    assert.equal(config.sources[0].requireMetadata, true);
    assert.equal(config.sources[1].id, 'bp-i18n-specdev');
    assert.equal(config.sources[1].repoUrl, 'https://github.com/w3c/bp-i18n-specdev.git');
    assert.equal(config.sources[1].publicBaseUrl, 'https://w3c.github.io/bp-i18n-specdev');
    assert.deepEqual(config.sources[1].contentRoots, ['']);
    assert.equal(config.sources[1].requireMetadata, false);
    assert.equal(config.sources[0].defaultStatus, '');
    assert.equal(config.sources[1].defaultStatus, 'published');
  });
});

test('example configuration indexes the i18n activity group pages', async () => {
  const envFilePath = new URL('../.env.example', import.meta.url).pathname;

  await withCleanEnv(async () => {
    const config = getConfig({ envFilePath });
    const activitySource = config.sources.find((source) => source.id === 'i18n-activity');

    assert(activitySource);
    assert.equal(activitySource.repoUrl, 'https://github.com/w3c/i18n-activity.git');
    assert.equal(activitySource.ref, 'gh-pages');
    assert.equal(activitySource.publicBaseUrl, 'https://w3c.github.io/i18n-activity');
    assert.deepEqual(activitySource.contentRoots, ['i18n-wg', 'i18n-ig']);
    assert.equal(activitySource.requireMetadata, false);
    assert.equal(activitySource.defaultStatus, 'published');
    assert.equal(activitySource.statusOverride, 'published');
  });
});

test('getConfig falls back to legacy single-source when SOURCES is not set', async () => {
  const envFilePath = await writeTempEnv('SOURCE_MODE=git\nSOURCE_REF=main\n');

  await withCleanEnv(async () => {
    const config = getConfig({ envFilePath });

    assert.equal(config.sources.length, 1);
    assert.equal(config.sources[0].id, 'i18n-drafts');
    assert.equal(config.sources[0].mode, 'git');
    assert.equal(config.sources[0].ref, 'main');
    assert.equal(config.sources[0].requireMetadata, true);
  });
});

test('getConfig falls back to legacy single-source on invalid SOURCES JSON', async () => {
  const envFilePath = await writeTempEnv('SOURCES=not-valid-json\n');

  await withCleanEnv(async () => {
    const config = getConfig({ envFilePath });

    assert.equal(config.sources.length, 1);
    assert.equal(config.sources[0].id, 'i18n-drafts');
  });
});

test('explicit single-source overrides take precedence over SOURCES in .env', async () => {
  const sources = JSON.stringify([
    {
      id: 'i18n-drafts',
      repoUrl: 'https://github.com/w3c/i18n-drafts.git',
      ref: 'gh-pages'
    },
    {
      id: 'bp-i18n-specdev',
      repoUrl: 'https://github.com/w3c/bp-i18n-specdev.git',
      ref: 'gh-pages'
    }
  ]);
  const envFilePath = await writeTempEnv(`SOURCES=${sources}`);

  await withCleanEnv(async () => {
    const config = getConfig({
      envFilePath,
      sourceMode: 'local',
      sourceRepoPath: 'tests/fixtures/i18n-mini'
    });

    assert.equal(config.sources.length, 1);
    assert.equal(config.sources[0].id, 'i18n-drafts');
    assert.equal(config.sources[0].mode, 'local');
    assert.equal(config.sources[0].repoPath, 'tests/fixtures/i18n-mini');
  });
});

test('parseArgs parses CLI flags with equals and space separators', () => {
  const args = parseArgs([
    '--source-mode=local',
    '--source-repo-path',
    'tests/fixtures/i18n-mini',
    '--require-metadata=false',
    '--enable-debug'
  ]);

  assert.deepEqual(args, {
    sourceMode: 'local',
    sourceRepoPath: 'tests/fixtures/i18n-mini',
    requireMetadata: 'false',
    enableDebug: 'true'
  });
});

async function writeTempEnv(content) {
  const directory = await mkdtemp(join(tmpdir(), 'i18n-env-'));
  const envFilePath = join(directory, '.env');
  await writeFile(envFilePath, content, 'utf8');
  return envFilePath;
}

async function withCleanEnv(callback) {
  const previous = Object.fromEntries(touchedKeys.map((key) => [key, process.env[key]]));
  for (const key of touchedKeys) delete process.env[key];

  try {
    await callback();
  } finally {
    for (const key of touchedKeys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}
