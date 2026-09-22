import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getConfig } from './config.js';
import { mountPath } from './base-path.js';
import { loadIndex, appendQueryLog } from './db/store.js';
import { retrieve } from './retrieval/hybrid.js';
import { answerFromRetrieval } from './generation/answer.js';
import { runIndexer } from './indexing/indexer.js';
import { createRateLimiter } from './rate-limit.js';
import {
  assertCommunityIndexReady,
  communityAnswerPayload,
  communityCorsHeaders,
  communityErrorPayload,
  communityHealthPayload,
  communitySearchPayload,
  isCommunityApiPath,
  openApiDocument,
  parseCommunityAnswerRequest,
  parseCommunitySearchRequest,
  publicApiError
} from './api/community.js';

const PUBLIC_DIR = new URL('../public/', import.meta.url).pathname;

export function createServer({ index = null, config = getConfig(), indexer = runIndexer } = {}) {
  const state = { index };
  const rateLimiter = createRateLimiter(config.rateLimitWindowMs, config.rateLimitMax, {
    trustedProxies: config.trustedProxies,
    sendLimitExceeded: (limitedRequest, limitedResponse) => {
      const limitedUrl = new URL(limitedRequest.url, `http://${limitedRequest.headers.host || 'localhost'}`);
      const limitedPath = mountPath(limitedUrl.pathname, config.basePath).pathname;
      if (isCommunityApiPath(limitedPath)) {
        sendJson(
          limitedResponse,
          429,
          communityErrorPayload(publicApiError(429, 'rate_limit_exceeded', 'Rate limit exceeded.'), state.index, config),
          communityCorsHeaders()
        );
        return;
      }

      sendJson(limitedResponse, 429, { evidence_status: 'error', error: 'Rate limit exceeded.' });
    }
  });

  return http.createServer(async (request, response) => {
    let url;
    try {
      url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

      const mounted = mountPath(url.pathname, config.basePath);
      if (mounted.redirectTo) {
        response.writeHead(308, { location: `${mounted.redirectTo}${url.search}` });
        response.end();
        return;
      }
      url.pathname = mounted.pathname;

      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'OPTIONS' && isCommunityApiPath(url.pathname)) {
          response.writeHead(204, communityCorsHeaders());
          response.end();
          return;
        }

        if (!rateLimiter(request, response)) return;
        await handleApi({ request, response, url, state, config, indexer });
        return;
      }

      await serveStatic(request, response, url);
    } catch (error) {
      if (url && isCommunityApiPath(url.pathname)) {
        sendJson(response, httpErrorStatus(error), communityErrorPayload(error, state.index, config), communityCorsHeaders());
      } else {
        sendJson(response, httpErrorStatus(error), {
          evidence_status: 'error',
          error: error.message
        });
      }
    }
  });
}

async function handleApi({ request, response, url, state, config, indexer }) {
  const index = state.index;

  if (request.method === 'GET' && url.pathname === '/api/openapi.json') {
    sendJson(response, 200, openApiDocument(), communityCorsHeaders());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/health') {
    sendJson(response, 200, communityHealthPayload(index, config), communityCorsHeaders());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/v1/search') {
    const searchRequest = parseCommunitySearchRequest(url);
    assertCommunityIndexReady(index);
    const retrieval = retrieve({
      query: searchRequest.query,
      language: searchRequest.language,
      statuses: searchRequest.statuses,
      includeObsolete: searchRequest.includeObsolete,
      chunks: index.chunks,
      limit: searchRequest.limit
    });
    sendJson(response, 200, communitySearchPayload({ retrieval, index, config }), communityCorsHeaders());
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/v1/answer') {
    const started = Date.now();
    const answerRequest = parseCommunityAnswerRequest(await readJson(request));
    assertCommunityIndexReady(index);
    const retrieval = retrieve({
      query: answerRequest.question,
      language: answerRequest.language,
      statuses: answerRequest.statuses,
      includeObsolete: answerRequest.includeObsolete,
      chunks: index.chunks,
      limit: answerRequest.limit
    });
    const answer = await answerFromRetrieval({
      question: answerRequest.question,
      language: answerRequest.language,
      retrieval,
      chunks: index.chunks,
      enableDebug: false,
      modelProvider: config.modelProvider,
      modelApiKey: config.modelApiKey,
      modelBaseUrl: config.modelBaseUrl,
      generationModel: config.generationModel,
      modelTimeoutMs: config.modelTimeoutMs
    });

    appendQueryLog({
      question: answerRequest.question,
      language: answerRequest.language,
      statuses: answerRequest.statuses,
      retrieved_source_ids: retrieval.results.map((chunk) => chunk.chunk_id),
      evidence_status: answer.evidence_status,
      latency_ms: Date.now() - started,
      error_type: answer.evidence_status === 'error' ? 'generation' : ''
    }, config.queryLogPath, {
      maxBytes: config.queryLogMaxBytes,
      backups: config.queryLogBackups
    }).catch(() => {});

    if (answer.evidence_status === 'error') {
      throw publicApiError(502, 'generation_error', answer.error || 'Answer generation failed.');
    }

    sendJson(response, 200, communityAnswerPayload({
      question: answerRequest.question,
      language: answerRequest.language,
      answer,
      index,
      config
    }), communityCorsHeaders());
    return;
  }

  if (request.method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, healthPayload(index, config));
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/retrieve') {
    const body = await readJson(request);
    assertIndexReady(index);
    const result = retrieve({
      query: body.query || body.question || '',
      language: body.language || 'en',
      statuses: body.statuses,
      includeObsolete: Boolean(body.includeObsolete),
      chunks: index.chunks,
      limit: Number(body.limit || 10)
    });
    sendJson(response, 200, config.enableDebug ? result : { results: result.results });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/ask') {
    const started = Date.now();
    const body = await readJson(request);
    const question = String(body.question || '').trim();
    if (!question) {
      sendJson(response, 400, { evidence_status: 'error', error: 'Question is required.' });
      return;
    }
    assertIndexReady(index);
    const retrieval = retrieve({
      query: question,
      language: body.language || 'en',
      statuses: body.statuses,
      includeObsolete: Boolean(body.includeObsolete),
      chunks: index.chunks,
      limit: 8
    });
    const answer = await answerFromRetrieval({
      question,
      language: body.language || 'en',
      retrieval,
      chunks: index.chunks,
      enableDebug: config.enableDebug,
      modelProvider: config.modelProvider,
      modelApiKey: config.modelApiKey,
      modelBaseUrl: config.modelBaseUrl,
      generationModel: config.generationModel,
      modelTimeoutMs: config.modelTimeoutMs
    });

    appendQueryLog({
      question,
      language: body.language || 'en',
      statuses: body.statuses || ['published', 'review', 'draft'],
      retrieved_source_ids: retrieval.results.map((chunk) => chunk.chunk_id),
      evidence_status: answer.evidence_status,
      latency_ms: Date.now() - started,
      error_type: answer.evidence_status === 'error' ? 'generation' : ''
    }, config.queryLogPath, {
      maxBytes: config.queryLogMaxBytes,
      backups: config.queryLogBackups
    }).catch(() => {});

    sendJson(response, answer.evidence_status === 'error' ? 502 : 200, answer);
    return;
  }

  if (request.method === 'POST' && url.pathname === '/api/admin/reindex') {
    if (!config.adminToken) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }
    if (request.headers['x-admin-token'] !== config.adminToken) {
      sendJson(response, 403, { error: 'Forbidden.' });
      return;
    }
    const newIndex = await indexer(config);
    state.index = newIndex;
    sendJson(response, 200, healthPayload(newIndex, config));
    return;
  }

  if (isCommunityApiPath(url.pathname)) {
    throw publicApiError(404, 'not_found', 'Not found.');
  }

  sendJson(response, 404, { error: 'Not found.' });
}

function healthPayload(index, config) {
  const payload = {
    ok: Boolean(index),
    source_mode: index?.source?.mode || config.sourceMode,
    source_repo_url: config.sourceRepoUrl,
    source_ref: index?.source?.ref || config.sourceRef,
    source_commit: index?.source?.commit || config.sourceCommit || '',
    is_pull_request: Boolean(config.isPullRequest),
    indexed_documents: index?.documents?.length || 0,
    indexed_chunks: index?.chunks?.length || 0,
    last_indexed_at: index?.summary?.finished_at || null
  };

  if (index?.sources?.length > 1) {
    payload.sources = index.sources;
    payload.source_mode = 'multi';
  }

  return payload;
}

function assertIndexReady(index) {
  if (!index?.chunks?.length) {
    const error = new Error('No search index is available. Run npm run index first.');
    error.statusCode = 503;
    throw error;
  }
}

async function serveStatic(request, response, url) {
  if (request.method !== 'GET') {
    response.writeHead(405);
    response.end();
    return;
  }

  const path = url.pathname === '/' ? '/index.html' : url.pathname;
  if (!['/index.html', '/styles.css', '/app.js', '/i18n.js', '/markdown.js', '/syntax-highlight.js'].includes(path)) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }

  const content = await readFile(join(PUBLIC_DIR, path));
  response.writeHead(200, { 'content-type': mimeType(path) });
  response.end(content);
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 16_384) {
      const error = new Error('Request body is too large.');
      error.statusCode = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  if (!chunks.length) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    const error = new Error('Request body must be valid JSON.');
    error.statusCode = 400;
    throw error;
  }
}

function sendJson(response, statusCode, body, headers = {}) {
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...headers
  });
  response.end(JSON.stringify(body));
}

function httpErrorStatus(error) {
  const statusCode = Number(error?.statusCode || error?.status);
  return Number.isInteger(statusCode) && statusCode >= 400 && statusCode <= 599 ? statusCode : 500;
}

function mimeType(path) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8'
  }[extname(path)] || 'application/octet-stream';
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] === currentFile) {
  const config = getConfig();
  let index = null;
  try {
    if (config.sourceRefreshMode === 'startup') {
      index = await runIndexer(config);
    } else {
      index = await loadIndex(config.indexPath);
    }
  } catch (error) {
    console.error(`Index unavailable: ${error.message}`);
  }

  const server = createServer({ index, config });
  server.listen(config.port, () => {
    console.log(`Ask W3C i18n listening at http://127.0.0.1:${config.port}`);
  });
}
