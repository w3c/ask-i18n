import { cosineSimilarity, definitionTopic, hashedVector, keywordMatchStats, normalizeQuery, tokenize } from './text.js';

const DEFAULT_STATUSES = ['published', 'review', 'draft'];
const FIELD_WEIGHTS = {
  title: 3,
  heading: 2,
  source: 0.5,
  text: 1
};
const FIELD_LENGTH_NORMALIZATION = {
  title: 0.2,
  heading: 0.3,
  source: 0.2,
  text: 0.8
};

export function retrieve({
  query,
  language = 'en',
  statuses = DEFAULT_STATUSES,
  includeObsolete = false,
  chunks = [],
  limit = 10
}) {
  const normalizedQuery = normalizeQuery(query);
  const topic = definitionTopic(normalizedQuery);
  const queryTokens = tokenize(topic || normalizedQuery);
  const queryVector = hashedVector(queryTokens);
  const allowedStatuses = new Set((statuses?.length ? statuses : DEFAULT_STATUSES).map((status) => String(status).toLowerCase()));
  const requestedLanguage = String(language || 'en').toLowerCase();

  const candidates = chunks
    .filter((chunk) => statusAllowed(chunk.status, allowedStatuses, includeObsolete))
    .map(prepareCandidate);
  const corpusStats = buildCorpusStats(candidates, queryTokens);

  const beforeRanking = candidates
    .map((candidate) => {
      const keywordStats = keywordMatchStats(queryTokens, candidate.searchable);
      const keyword = bm25FieldScore(queryTokens, candidate.fields, corpusStats) +
        titleCoverageBoost(queryTokens, candidate.fields.title) +
        sectionIntentBoost(candidate.chunk.heading_path, topic);
      // Hash-bucket vector similarity catches broader token overlap while the
      // keyword gate below keeps weak accidental hash collisions from ranking.
      const vector = cosineSimilarity(queryVector, hashedVector(candidate.allTokens));
      const relaxedCoverage = hasCjk(normalizedQuery) || isComparisonQuery(normalizedQuery);
      const score = isMeaningfulCandidate(keywordStats, queryTokens, relaxedCoverage) ? (keyword * 0.85) + (vector * 0.15) : 0;

      return {
        ...publicChunk(candidate.chunk),
        keyword_score: round(keyword),
        vector_score: round(vector),
        matched_tokens: keywordStats.matched_tokens,
        base_score: round(score),
        score: round(score)
      };
    })
    .filter((chunk) => chunk.score > 0);

  const afterRanking = beforeRanking
   .map((chunk) => ({
     ...chunk,
     score: round(chunk.base_score + languageBoost(chunk, requestedLanguage) + statusBoost(chunk.status) + translationBoost(chunk))
   }))
   .sort((a, b) => b.score - a.score);

  const withTranslations = addTranslationCounterparts(afterRanking, chunks, requestedLanguage, limit, allowedStatuses, includeObsolete);

  const finalResults = withTranslations
   .slice(0, limit)
   .map((chunk, index) => ({ ...chunk, rank: index + 1 }));

  return {
    query,
    normalized_query: normalizedQuery,
    filters: {
      language: requestedLanguage,
      statuses: [...allowedStatuses],
      includeObsolete
    },
    results: finalResults,
    debug: {
      raw_query: query,
      normalized_query: normalizedQuery,
      selected_filters: {
        language: requestedLanguage,
        statuses: [...allowedStatuses],
        includeObsolete
      },
      retrieved_before_ranking: beforeRanking,
      retrieved_after_ranking: finalResults
    }
  };
}

function prepareCandidate(chunk) {
  const sourceText = String(chunk.source_path || '').replace(/\.html\b/gi, '');
  const fields = {
    title: tokenize(chunk.title),
    heading: tokenize(chunk.heading_path?.join(' ')),
    source: tokenize(sourceText),
    text: tokenize(chunk.text)
  };

  return {
    chunk,
    fields,
    allTokens: Object.values(fields).flat(),
    searchable: [
      chunk.title,
      chunk.heading_path?.join(' '),
      sourceText,
      chunk.text
    ].join(' ')
  };
}

function buildCorpusStats(candidates, queryTokens) {
  const averageLengths = Object.fromEntries(Object.keys(FIELD_WEIGHTS).map((field) => {
    const total = candidates.reduce((sum, candidate) => sum + candidate.fields[field].length, 0);
    return [field, candidates.length > 0 ? total / candidates.length : 1];
  }));
  const documentFrequencies = new Map();

  for (const token of new Set(queryTokens)) {
    const frequency = candidates.reduce((count, candidate) => {
      return count + (candidate.allTokens.includes(token) ? 1 : 0);
    }, 0);
    documentFrequencies.set(token, frequency);
  }

  return {
    averageLengths,
    documentFrequencies,
    documentCount: candidates.length
  };
}

function bm25FieldScore(queryTokens, fields, corpusStats) {
  const uniqueQueryTokens = [...new Set(queryTokens)];
  if (uniqueQueryTokens.length === 0 || corpusStats.documentCount === 0) return 0;

  let score = 0;
  for (const token of uniqueQueryTokens) {
    let weightedTermFrequency = 0;

    for (const field of Object.keys(FIELD_WEIGHTS)) {
      const tokens = fields[field];
      const termFrequency = countToken(tokens, token);
      if (termFrequency === 0) continue;
      const averageLength = Math.max(1, corpusStats.averageLengths[field]);
      const lengthRatio = tokens.length / averageLength;
      const normalization = 1 - FIELD_LENGTH_NORMALIZATION[field] + (FIELD_LENGTH_NORMALIZATION[field] * lengthRatio);
      weightedTermFrequency += FIELD_WEIGHTS[field] * (termFrequency / normalization);
    }

    if (weightedTermFrequency === 0) continue;
    const documentFrequency = corpusStats.documentFrequencies.get(token) || 0;
    const inverseDocumentFrequency = Math.log(1 + ((corpusStats.documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5)));
    const saturation = (weightedTermFrequency * 2.2) / (weightedTermFrequency + 1.2);
    score += inverseDocumentFrequency * saturation;
  }

  return score / uniqueQueryTokens.length;
}

function countToken(tokens, expected) {
  let count = 0;
  for (const token of tokens) {
    if (token === expected) count += 1;
  }
  return count;
}

function titleCoverageBoost(queryTokens, titleTokens) {
  const uniqueQueryTokens = [...new Set(queryTokens)];
  if (uniqueQueryTokens.length === 0) return 0;
  const titleSet = new Set(titleTokens);
  const matches = uniqueQueryTokens.filter((token) => titleSet.has(token)).length;
  return (matches / uniqueQueryTokens.length) * 0.75;
}

function sectionIntentBoost(headingPath = [], topic = '') {
  const heading = String(headingPath[headingPath.length - 1] || '').trim().toLowerCase();
  if (topic) {
    const topicTokens = new Set(tokenize(topic));
    const headingTokens = new Set(tokenize(heading));
    if (topicTokens.size > 0 && topicTokens.size === headingTokens.size &&
      [...topicTokens].every((token) => headingTokens.has(token))) {
      return definitionTopic(heading) ? 2 : 1;
    }
  }
  if (heading === 'quick answer') return 0.6;
  if (heading === 'answer') return 0.15;
  return 0;
}

function isMeaningfulCandidate(keywordStats, queryTokens, relaxedCoverage = false) {
  const uniqueQueryCount = new Set(queryTokens).size;
  if (uniqueQueryCount === 0) return false;
  if (relaxedCoverage && keywordStats.technical_matches > 0) return true;
  if (uniqueQueryCount === 1) return keywordStats.unique_matches === 1;

  const requiredMatches = Math.min(3, uniqueQueryCount);
  if (keywordStats.unique_matches < requiredMatches) return false;
  return keywordStats.technical_matches > 0 || keywordStats.unique_matches >= 2;
}

function hasCjk(value) {
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(value);
}

function isComparisonQuery(value) {
  return /\b(conflict|contradict|disagree|differ|versus|compare)\b/i.test(value);
}

function statusAllowed(status, allowedStatuses, includeObsolete) {
  const normalized = String(status || 'notreviewed').toLowerCase();
  if (normalized === 'obsolete') return includeObsolete;
  return allowedStatuses.has(normalized);
}

function languageBoost(chunk, requestedLanguage) {
  if (chunk.language === requestedLanguage) return 0.12;
  if (chunk.language === 'en') return 0.06;
  return 0;
}

function statusBoost(status) {
  return {
    published: 0.05,
    review: 0.025,
    draft: 0.01,
    notreviewed: 0,
    obsolete: -0.2
  }[status] ?? 0;
}

function translationBoost(chunk) {
  if (chunk.translation_state === 'current') return 0.02;
  if (chunk.translation_state === 'out_of_date') return -0.02;
  if (chunk.translation_state === 'unlinked') return -0.03;
  return 0;
}

function publicChunk(chunk) {
  const result = {
    chunk_id: chunk.chunk_id,
    source_path: chunk.source_path,
    section_url: chunk.section_url,
    title: chunk.title,
    heading_path: chunk.heading_path || [],
    language: chunk.language,
    status: chunk.status,
    translation_state: chunk.translation_state,
    translation_group_id: chunk.translation_group_id,
    text: chunk.text
  };
  if (chunk.source_id) result.source_id = chunk.source_id;
  return result;
}

function addTranslationCounterparts(afterRanking, allChunks, requestedLanguage, limit, allowedStatuses, includeObsolete) {
  if (requestedLanguage === 'en') return afterRanking;

  // Only check top results — low-scoring translated chunks in the tail
  // of afterRanking (from shared technical terms like “utf-8”) don't count.
  const topResults = afterRanking.slice(0, limit);
  if (topResults.some((chunk) => chunk.language === requestedLanguage)) return afterRanking;

  const englishResults = afterRanking.filter((chunk) => chunk.language === 'en');
  if (englishResults.length === 0) return afterRanking;

  const groups = new Map();
  for (const result of englishResults) {
    const gid = result.translation_group_id;
    if (gid && (!groups.has(gid) || result.score > groups.get(gid))) {
      groups.set(gid, result.score);
    }
  }

  if (groups.size === 0) return afterRanking;

  const translated = [];
  const groupCounts = new Map();
  for (const chunk of allChunks) {
    const gid = chunk.translation_group_id;
    if (!gid || !groups.has(gid) || chunk.language !== requestedLanguage) continue;
    if (!statusAllowed(chunk.status, allowedStatuses, includeObsolete)) continue;

    // Cap per-group translated chunks so one page does not dominate
    // the results. The cap matches the number of English chunks from
    // that same group already present in the ranked list, or 4,
    // whichever is smaller.
    const groupCap = Math.min(
      afterRanking.filter((r) => r.translation_group_id === gid && r.language === 'en').length || 3,
      4
    );
    const used = groupCounts.get(gid) || 0;
    if (used >= groupCap) continue;
    groupCounts.set(gid, used + 1);

    translated.push({
      ...publicChunk(chunk),
      keyword_score: 0,
      vector_score: 0,
      matched_tokens: [],
      base_score: round(groups.get(gid) - 0.01),
      score: round(groups.get(gid) - 0.01 + languageBoost(chunk, requestedLanguage) + statusBoost(chunk.status) + translationBoost(chunk))
    });
  }

  // Remove low-scoring existing versions of these chunks from afterRanking,
  // then add the higher-scoring translated counterparts.
  const translatedIds = new Set(translated.map((chunk) => chunk.chunk_id));
  const filtered = afterRanking.filter((chunk) => !translatedIds.has(chunk.chunk_id));

  if (translated.length === 0) return afterRanking;

  return [...filtered, ...translated].sort((a, b) => b.score - a.score);
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}
