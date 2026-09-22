import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { buildIndex } from '../src/indexing/indexer.js';
import { createServer } from '../src/server.js';

const fixtureRoot = new URL('./fixtures/i18n-mini/', import.meta.url).pathname;

function fixtureConfig(overrides = {}) {
  return {
    enableDebug: true,
    modelProvider: 'local',
    publicBaseUrl: 'https://www.w3.org/International',
    sourceMode: 'local',
    sourceRef: 'fixture',
    sourceRepoUrl: '',
    sourceCommit: 'fixture-sha',
    queryLogPath: '/private/tmp/i18n-drafts-assistant-api-test-query-log.jsonl',
    rateLimitWindowMs: 60_000,
    rateLimitMax: 20,
    ...overrides
  };
}

test('HTTP API serves health, retrieval, and cited answers without fetching sources on ask', async () => {
  const index = await buildIndex({
    sourceRoot: fixtureRoot,
    publicBaseUrl: 'https://www.w3.org/International',
    sourceMode: 'local',
    sourceRef: 'fixture',
    sourceCommit: 'fixture-sha',
    write: false
  });
  const app = createServer({
    index,
    config: {
      enableDebug: true,
      modelProvider: 'local',
      publicBaseUrl: 'https://www.w3.org/International',
      sourceMode: 'local',
      sourceRef: 'fixture',
      sourceRepoUrl: '',
      sourceCommit: 'fixture-sha',
      rateLimitWindowMs: 60_000,
      rateLimitMax: 20
    }
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const { port } = app.address();

  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    assert.equal(health.is_pull_request, false);
    assert.equal(health.indexed_documents, 4);

    const markdownModule = await fetch(`http://127.0.0.1:${port}/markdown.js`);
    assert.equal(markdownModule.status, 200);
    assert.match(await markdownModule.text(), /markdownToHtml/);

    const syntaxHighlightModule = await fetch(`http://127.0.0.1:${port}/syntax-highlight.js`);
    assert.equal(syntaxHighlightModule.status, 200);
    assert.match(await syntaxHighlightModule.text(), /highlightCode/);

    const i18nModule = await fetch(`http://127.0.0.1:${port}/i18n.js`);
    assert.equal(i18nModule.status, 200);
    assert.match(await i18nModule.text(), /applyUILanguage/);

    const retrieved = await fetch(`http://127.0.0.1:${port}/api/retrieve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'declare UTF-8 character encoding', language: 'en', statuses: ['published', 'review', 'draft'] })
    }).then((response) => response.json());
    assert.equal(retrieved.results[0].source_path, 'articles/http-charset/index.en.html');

    const answer = await fetch(`http://127.0.0.1:${port}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'How should I declare UTF-8 character encoding?', language: 'en', statuses: ['published', 'review', 'draft'], includeObsolete: false })
    }).then((response) => response.json());
    assert.equal(answer.evidence_status, 'supported');
    assert(answer.citations.length > 0);
    assert.equal(answer.debug.retrieved_after_ranking[0].source_path, 'articles/http-charset/index.en.html');
  } finally {
    app.close();
  }
});

test('UI, static assets, and API are served under a configured base path', async () => {
  const index = await buildIndex({
    sourceRoot: fixtureRoot,
    publicBaseUrl: 'https://www.w3.org/International',
    sourceMode: 'local',
    sourceRef: 'fixture',
    sourceCommit: 'fixture-sha',
    write: false
  });
  const app = createServer({
    index,
    config: fixtureConfig({ basePath: '/ask-i18n' })
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const { port } = app.address();
  const origin = `http://127.0.0.1:${port}`;

  try {
    const page = await fetch(`${origin}/ask-i18n/`).then((response) => response.text());
    assert.match(page, /<title>Ask W3C i18n<\/title>/);

    const script = await fetch(`${origin}/ask-i18n/app.js`);
    assert.equal(script.status, 200);

    const health = await fetch(`${origin}/ask-i18n/api/v1/health`).then((response) => response.json());
    assert.equal(health.ok, true);
    assert.equal(health.index.indexed_documents, 4);

    const answer = await fetch(`${origin}/ask-i18n/api/v1/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'How should I declare UTF-8 character encoding?', language: 'en' })
    }).then((response) => response.json());
    assert.equal(answer.evidence_status, 'supported');

    const redirect = await fetch(`${origin}/ask-i18n`, { redirect: 'manual' });
    assert.equal(redirect.status, 308);
    assert.equal(redirect.headers.get('location'), '/ask-i18n/');
  } finally {
    app.close();
  }
});

test('a proxy that strips the base path still reaches the unprefixed routes', async () => {
  const app = createServer({
    index: null,
    config: fixtureConfig({ basePath: '/ask-i18n' })
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const { port } = app.address();

  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
    assert.equal(health.ok, false);

    const page = await fetch(`http://127.0.0.1:${port}/`).then((response) => response.text());
    assert.match(page, /<title>Ask W3C i18n<\/title>/);
  } finally {
    app.close();
  }
});

test('community API exposes versioned health, search, answer, and OpenAPI contracts', async () => {
  const index = await buildIndex({
    sourceRoot: fixtureRoot,
    publicBaseUrl: 'https://www.w3.org/International',
    sourceMode: 'local',
    sourceRef: 'fixture',
    sourceCommit: 'fixture-sha',
    write: false
  });
  const app = createServer({
    index,
    config: fixtureConfig()
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const { port } = app.address();

  try {
    const openApi = await fetch(`http://127.0.0.1:${port}/api/openapi.json`).then((response) => response.json());
    assert.equal(openApi.openapi, '3.1.0');
    assert(openApi.paths['/api/v1/search']);
    assert(openApi.paths['/api/v1/answer']);

    const healthResponse = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    const health = await healthResponse.json();
    assert.equal(healthResponse.headers.get('access-control-allow-origin'), '*');
    assert.equal(health.api_version, 'v1');
    assert.equal(health.index.indexed_documents, 4);

    const searchResponse = await fetch(`http://127.0.0.1:${port}/api/v1/search?q=declare%20UTF-8&language=en&status=published&limit=2`);
    const search = await searchResponse.json();
    assert.equal(searchResponse.status, 200);
    assert.equal(searchResponse.headers.get('access-control-allow-origin'), '*');
    assert.equal(search.filters.language, 'en');
    assert(search.results.length > 0);
    assert(search.results.length <= 2);
    assert.equal(search.results[0].source_path, 'articles/http-charset/index.en.html');
    assert.match(search.results[0].snippet, /UTF-8/i);
    assert.equal('text' in search.results[0], false);

    const answerResponse = await fetch(`http://127.0.0.1:${port}/api/v1/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'How should I declare UTF-8 character encoding?', language: 'en', statuses: ['published'] })
    });
    const answer = await answerResponse.json();
    assert.equal(answerResponse.status, 200);
    assert.equal(answer.evidence_status, 'supported');
    assert.match(answer.answer, /UTF-8/i);
    assert(answer.citations.length > 0);
    assert.equal(answer.citations[0].source_path, 'articles/http-charset/index.en.html');
    assert.equal(answer.index.source_ref, 'fixture');
    assert.equal('debug' in answer, false);

    const optionsResponse = await fetch(`http://127.0.0.1:${port}/api/v1/answer`, {
      method: 'OPTIONS'
    });
    assert.equal(optionsResponse.status, 204);
    assert.equal(optionsResponse.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  } finally {
    app.close();
  }
});

test('community API returns stable error objects', async () => {
  const app = createServer({
    index: null,
    config: fixtureConfig()
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const { port } = app.address();

  try {
    const missingQuery = await fetch(`http://127.0.0.1:${port}/api/v1/search`);
    const missingQueryBody = await missingQuery.json();
    assert.equal(missingQuery.status, 400);
    assert.equal(missingQueryBody.error.code, 'missing_query');
    assert.equal(missingQueryBody.error.language, 'en');
    assert.equal(missingQueryBody.error.direction, 'ltr');

    const noIndex = await fetch(`http://127.0.0.1:${port}/api/v1/search?q=utf-8`);
    const noIndexBody = await noIndex.json();
    assert.equal(noIndex.status, 503);
    assert.equal(noIndexBody.error.code, 'index_unavailable');
    assert.equal(noIndexBody.error.language, 'en');
    assert.equal(noIndexBody.error.direction, 'ltr');

    const invalidJson = await fetch(`http://127.0.0.1:${port}/api/v1/answer`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{'
    });
    const invalidJsonBody = await invalidJson.json();
    assert.equal(invalidJson.status, 400);
    assert.equal(invalidJsonBody.error.code, 'bad_request');
    assert.equal(invalidJsonBody.error.language, 'en');
    assert.equal(invalidJsonBody.error.direction, 'ltr');
  } finally {
    app.close();
  }
});

test('community API rate limit errors use the community envelope', async () => {
  const app = createServer({
    index: null,
    config: fixtureConfig({ rateLimitMax: 1 })
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const { port } = app.address();

  try {
    const first = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    const limited = await fetch(`http://127.0.0.1:${port}/api/v1/health`);
    const body = await limited.json();

    assert.equal(first.status, 200);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('access-control-allow-origin'), '*');
    assert.equal(body.error.code, 'rate_limit_exceeded');
    assert.equal(body.error.language, 'en');
    assert.equal(body.error.direction, 'ltr');
  } finally {
    app.close();
  }
});

test('community API rate limit errors still use the community envelope under a base path', async () => {
  const app = createServer({
    index: null,
    config: fixtureConfig({ rateLimitMax: 1, basePath: '/ask-i18n' })
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const { port } = app.address();

  try {
    const first = await fetch(`http://127.0.0.1:${port}/ask-i18n/api/v1/health`);
    const limited = await fetch(`http://127.0.0.1:${port}/ask-i18n/api/v1/health`);
    const body = await limited.json();

    assert.equal(first.status, 200);
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get('access-control-allow-origin'), '*');
    assert.equal(body.error.code, 'rate_limit_exceeded');
  } finally {
    app.close();
  }
});

test('HTTP API preserves expected API error status codes', async () => {
  const app = createServer({
    index: null,
    config: {
      enableDebug: true,
      modelProvider: 'local',
      publicBaseUrl: 'https://www.w3.org/International',
      sourceMode: 'local',
      sourceRef: 'fixture',
      sourceRepoUrl: '',
      sourceCommit: 'fixture-sha',
      rateLimitWindowMs: 60_000,
      rateLimitMax: 20
    }
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const { port } = app.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/retrieve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'declare UTF-8 character encoding' })
    });
    const body = await response.json();

    assert.equal(response.status, 503);
    assert.equal(body.evidence_status, 'error');
    assert.match(body.error, /No search index is available/);
  } finally {
    app.close();
  }
});

test('HTTP API exposes whether the app is running as a pull request preview', async () => {
  const app = createServer({
    index: null,
    config: {
      enableDebug: true,
      modelProvider: 'local',
      publicBaseUrl: 'https://www.w3.org/International',
      sourceMode: 'local',
      sourceRef: 'fixture',
      sourceRepoUrl: '',
      sourceCommit: 'fixture-sha',
      isPullRequest: true,
      rateLimitWindowMs: 60_000,
      rateLimitMax: 20
    }
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const { port } = app.address();

  try {
    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());

    assert.equal(health.is_pull_request, true);
  } finally {
    app.close();
  }
});

test('admin reindex replaces the index used by subsequent API requests', async () => {
  const initialIndex = {
    source: { mode: 'local', ref: 'old-ref', commit: 'old-sha' },
    summary: { finished_at: '2026-01-01T00:00:00.000Z' },
    documents: [{ id: 'old-document' }],
    chunks: [
      {
        chunk_id: 'old.html#old',
        source_path: 'old.html',
        section_url: 'https://example.test/old#old',
        title: 'Old guidance',
        heading_path: ['Old'],
        language: 'en',
        status: 'published',
        translation_state: 'current',
        text: 'old marker'
      }
    ]
  };
  const rebuiltIndex = {
    source: { mode: 'local', ref: 'new-ref', commit: 'new-sha' },
    summary: { finished_at: '2026-02-01T00:00:00.000Z' },
    documents: [{ id: 'new-document-1' }, { id: 'new-document-2' }],
    chunks: [
      {
        chunk_id: 'new.html#new',
        source_path: 'new.html',
        section_url: 'https://example.test/new#new',
        title: 'New guidance',
        heading_path: ['New'],
        language: 'en',
        status: 'published',
        translation_state: 'current',
        text: 'new marker'
      }
    ]
  };
  let reindexCalls = 0;
  const app = createServer({
    index: initialIndex,
    config: fixtureConfig({ adminToken: 'test-admin-token' }),
    indexer: async (config) => {
      reindexCalls += 1;
      assert.equal(config.adminToken, 'test-admin-token');
      return rebuiltIndex;
    }
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const { port } = app.address();

  try {
    const reindexResponse = await fetch(`http://127.0.0.1:${port}/api/admin/reindex`, {
      method: 'POST',
      headers: { 'x-admin-token': 'test-admin-token' }
    });
    const reindexHealth = await reindexResponse.json();

    assert.equal(reindexResponse.status, 200);
    assert.equal(reindexCalls, 1);
    assert.equal(reindexHealth.source_commit, 'new-sha');
    assert.equal(reindexHealth.indexed_documents, 2);

    const health = await fetch(`http://127.0.0.1:${port}/api/health`).then((response) => response.json());
    assert.equal(health.source_commit, 'new-sha');
    assert.equal(health.indexed_documents, 2);

    const retrieval = await fetch(`http://127.0.0.1:${port}/api/retrieve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'new marker', language: 'en', statuses: ['published'] })
    }).then((response) => response.json());
    assert.equal(retrieval.results[0].source_path, 'new.html');
  } finally {
    app.close();
  }
});

test('HTTP API ask returns when the model provider times out', async () => {
  const index = await buildIndex({
    sourceRoot: fixtureRoot,
    publicBaseUrl: 'https://www.w3.org/International',
    sourceMode: 'local',
    sourceRef: 'fixture',
    sourceCommit: 'fixture-sha',
    write: false
  });
  const app = createServer({
    index,
    config: {
      enableDebug: true,
      modelProvider: 'openai-compatible',
      modelApiKey: 'test-key',
      modelBaseUrl: 'https://model.test/v1',
      modelTimeoutMs: 5,
      generationModel: 'gpt-5.5',
      publicBaseUrl: 'https://www.w3.org/International',
      sourceMode: 'local',
      sourceRef: 'fixture',
      sourceRepoUrl: '',
      sourceCommit: 'fixture-sha',
      rateLimitWindowMs: 60_000,
      rateLimitMax: 20
    }
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const { port } = app.address();
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    if (String(url).startsWith(`http://127.0.0.1:${port}`)) {
      return previousFetch(url, options);
    }

    const signal = options.signal;
    assert(signal, 'Expected provider fetch to receive an AbortSignal');
    return new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => {
        reject(signal.reason || new DOMException('The operation was aborted.', 'AbortError'));
      }, { once: true });
    });
  };

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/ask`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: 'How should I declare UTF-8 character encoding?', language: 'en' })
    });
    const body = await response.json();

    assert.equal(response.status, 502);
    assert.equal(body.evidence_status, 'error');
    assert.match(body.error, /Model provider request timed out after 5ms/);
  } finally {
    globalThis.fetch = previousFetch;
    app.close();
  }
});

test('HTTP API rate limiter keys requests by forwarded client only from trusted proxies', async () => {
  const app = createServer({
    index: null,
    config: {
      enableDebug: true,
      modelProvider: 'local',
      publicBaseUrl: 'https://www.w3.org/International',
      sourceMode: 'local',
      sourceRef: 'fixture',
      sourceRepoUrl: '',
      sourceCommit: 'fixture-sha',
      rateLimitWindowMs: 60_000,
      rateLimitMax: 1,
      trustedProxies: ['127.0.0.1/32']
    }
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const { port } = app.address();

  try {
    const first = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { 'x-forwarded-for': '198.51.100.10' }
    });
    const sameClient = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { 'x-forwarded-for': '198.51.100.10' }
    });
    const differentClient = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { 'x-forwarded-for': '198.51.100.11' }
    });

    assert.equal(first.status, 200);
    assert.equal(sameClient.status, 429);
    assert.equal(differentClient.status, 200);
  } finally {
    app.close();
  }
});

test('HTTP API rate limiter uses the nearest untrusted forwarded hop', async () => {
  const app = createServer({
    index: null,
    config: {
      enableDebug: true,
      modelProvider: 'local',
      publicBaseUrl: 'https://www.w3.org/International',
      sourceMode: 'local',
      sourceRef: 'fixture',
      sourceRepoUrl: '',
      sourceCommit: 'fixture-sha',
      rateLimitWindowMs: 60_000,
      rateLimitMax: 1,
      trustedProxies: ['127.0.0.1/32']
    }
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const { port } = app.address();

  try {
    const first = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.20' }
    });
    const spoofedLeftmost = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { 'x-forwarded-for': '203.0.113.2, 198.51.100.20' }
    });
    const differentClient = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { 'x-forwarded-for': '203.0.113.3, 198.51.100.21' }
    });

    assert.equal(first.status, 200);
    assert.equal(spoofedLeftmost.status, 429);
    assert.equal(differentClient.status, 200);
  } finally {
    app.close();
  }
});

test('HTTP API rate limiter ignores forwarded headers from untrusted peers', async () => {
  const app = createServer({
    index: null,
    config: {
      enableDebug: true,
      modelProvider: 'local',
      publicBaseUrl: 'https://www.w3.org/International',
      sourceMode: 'local',
      sourceRef: 'fixture',
      sourceRepoUrl: '',
      sourceCommit: 'fixture-sha',
      rateLimitWindowMs: 60_000,
      rateLimitMax: 1,
      trustedProxies: []
    }
  });
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  const { port } = app.address();

  try {
    const first = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { 'x-forwarded-for': '198.51.100.30' }
    });
    const spoofed = await fetch(`http://127.0.0.1:${port}/api/health`, {
      headers: { 'x-forwarded-for': '198.51.100.31' }
    });

    assert.equal(first.status, 200);
    assert.equal(spoofed.status, 429);
  } finally {
    app.close();
  }
});
