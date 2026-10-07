import { stem } from './stemmer.js';

const CJK_CLASS = '\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}';
const CJK_RE = new RegExp(`[${CJK_CLASS}]`, 'u');

// A Latin/number run must stop before a CJK character: Han characters are
// Unicode letters, so an unbounded [\p{L}\p{N}-]* would otherwise swallow
// adjacent CJK text into one token (e.g. "HTML中设置内容的语言").
const TOKEN_PATTERN = new RegExp(
  `[${CJK_CLASS}]|(?![${CJK_CLASS}])[\\p{L}\\p{N}](?:(?![${CJK_CLASS}])[\\p{L}\\p{N}-])*`,
  'gu'
);

export function normalizeQuery(query = '') {
  return String(query).normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function definitionTopic(query = '') {
  const match = normalizeQuery(query).match(/^(?:what (?:is|are)|define)\s+(.+?)[?!.]*$/);
  return match ? match[1].replace(/\bi18n\b/g, 'internationalization') : '';
}

export function tokenize(value = '') {
  const normalized = normalizeQuery(value);
  const tokens = [];
  let match;

  while ((match = TOKEN_PATTERN.exec(normalized))) {
    const raw = match[0];

    if (CJK_RE.test(raw)) {
      tokens.push(raw);
      continue;
    }

    if (raw.length <= 1) continue;

    if (raw.includes('-')) {
      const fullStem = stem(raw);
      if (!STEMMED_STOPWORDS.has(fullStem)) tokens.push(fullStem);
      for (const part of raw.split('-')) {
        if (part.length <= 1) continue;
        const partStem = stem(part);
        if (!STEMMED_STOPWORDS.has(partStem)) tokens.push(partStem);
      }
    } else {
      const stemmed = stem(raw);
      if (!STEMMED_STOPWORDS.has(stemmed)) tokens.push(stemmed);
    }
  }

  return tokens;
}

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'between',
  'by',
  'can',
  'could',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'in',
  'into',
  'is',
  'it',
  'me',
  'of',
  'on',
  'or',
  'should',
  'that',
  'the',
  'this',
  'to',
  'use',
  'what',
  'when',
  'where',
  'which',
  'with',
  'about',
  'content',
  'draft',
  'final',
  'guidance',
  'index',
  'page',
  'pages',
  'published',
  'review',
  'say',
  'tell',
  'show'
]);

const STEMMED_STOPWORDS = new Set([...STOPWORDS].map((w) => stem(w)));

export function keywordScore(queryTokens, text) {
  return keywordMatchStats(queryTokens, text).score;
}

export function keywordMatchStats(queryTokens, text) {
  const textTokens = tokenize(text);
  if (queryTokens.length === 0 || textTokens.length === 0) {
    return { score: 0, unique_matches: 0, technical_matches: 0, matched_tokens: [] };
  }

  const textCounts = new Map();
  for (const token of textTokens) textCounts.set(token, (textCounts.get(token) || 0) + 1);

  let matches = 0;
  const matchedTokens = new Set();
  let technicalMatches = 0;

  for (const token of new Set(queryTokens)) {
    if (textCounts.has(token)) {
      matchedTokens.add(token);
      if (isTechnicalToken(token)) technicalMatches += 1;
      matches += 1 + Math.log1p(textCounts.get(token));
    }
  }

  return {
    score: matches / queryTokens.length,
    unique_matches: matchedTokens.size,
    technical_matches: technicalMatches,
    matched_tokens: [...matchedTokens]
  };
}

export function hashedVector(tokens, dimensions = 128) {
  // Map arbitrary tokens into a fixed number of hash buckets. The result is a
  // compact count vector for local similarity scoring; it is not a learned
  // embedding, and different tokens may share a bucket.
  const vector = new Array(dimensions).fill(0);
  for (const token of tokens) {
    const hash = fnv1a(token);
    const index = hash % dimensions;
    vector[index] += 1;
  }
  return normalizeVector(vector);
}

export function cosineSimilarity(a, b) {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  for (let index = 0; index < length; index += 1) dot += a[index] * b[index];
  return dot;
}

const STEMMED_TECHNICAL_TERMS = new Set([
  'bidi',
  'charset',
  'dir',
  'encod',
  'hreflang',
  'lang',
  'ltr',
  'rtl',
  'utf-8'
]);

function isTechnicalToken(token) {
  return STEMMED_TECHNICAL_TERMS.has(token) ||
    /[\d-]/.test(token) ||
    CJK_RE.test(token);
}

function normalizeVector(vector) {
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

function fnv1a(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
