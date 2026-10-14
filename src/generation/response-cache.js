import { answerFromRetrieval } from './answer.js';

const MAX_ENTRIES = 256;
const TTL_MS = 15 * 60_000;

export function createCachedAnswerer() {
  // Each loaded index object is a distinct version, including local rebuilds
  // whose source commit and timestamp may be unchanged.
  const indexes = new WeakMap();

  return async function cachedAnswer({ index, limit, ...options }) {
    let cache = indexes.get(index);
    if (!cache) {
      cache = new Map();
      indexes.set(index, cache);
    }
    const key = JSON.stringify([
      options.question,
      options.language,
      [...options.retrieval.filters.statuses].sort(),
      options.retrieval.filters.includeObsolete,
      limit,
      options.enableDebug,
      options.modelProvider,
      options.generationModel,
      options.modelBaseUrl,
      options.modelTimeoutMs
    ]);
    const now = Date.now();
    for (const [cachedKey, entry] of cache) {
      if (entry.expiresAt <= now) cache.delete(cachedKey);
    }
    const cached = cache.get(key);
    if (cached) return cached.promise;

    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
    const entry = { expiresAt: now + TTL_MS, promise: null };
    entry.promise = answerFromRetrieval(options).then((answer) => {
      if (answer.evidence_status === 'error' && cache.get(key) === entry) cache.delete(key);
      return answer;
    }, (error) => {
      if (cache.get(key) === entry) cache.delete(key);
      throw error;
    });
    cache.set(key, entry);
    return entry.promise;
  };
}
