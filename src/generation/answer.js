import { buildCitations, validateCitationsForEvidence } from './citations.js';
import { buildPrompt } from './prompt.js';
import { generateWithModel } from './model-client.js';
import { definitionTopic, tokenize } from '../retrieval/text.js';

const INSUFFICIENT = 'I could not find enough support for that in the indexed sources.';

export async function answerFromRetrieval({
  question,
  language = 'en',
  retrieval,
  chunks = [],
  enableDebug = false,
  modelProvider = 'local',
  modelApiKey = '',
  modelBaseUrl = '',
  generationModel = '',
  modelTimeoutMs = 30_000
}) {
  const results = retrieval?.results || [];
  const localMode = modelProvider === 'local' || modelProvider === 'none';
  const conflictIntent = asksAboutConflict(question);
  const selectedChunks = selectChunks(results, { localMode, conflictIntent, chunks });
  const topScore = selectedChunks[0]?.score ?? 0;

  if (selectedChunks.length === 0 || topScore < 0.03) {
    return {
      answer: INSUFFICIENT,
      citations: [],
      warnings: [],
      evidence_status: 'insufficient_evidence',
      debug: enableDebug ? debugPayload({ question, retrieval, selectedChunks, answer: INSUFFICIENT, warnings: [] }) : null
    };
  }

  const citations = buildCitations(selectedChunks);
  const warnings = buildWarnings(citations, language);
  const prompt = buildPrompt({ question, language, chunks: selectedChunks });
  const conflictQuestion = conflictIntent && hasMixedPublishedAndProvisional(citations);
  let answer;

  try {
    if (conflictQuestion) {
      answer = localConflictAnswer(selectedChunks, citations);
    } else if (localMode) {
      answer = localExtractiveAnswer(question, selectedChunks, citations);
    } else {
      const generated = await generateWithModel({
        provider: modelProvider,
        prompt,
        apiKey: modelApiKey,
        baseUrl: modelBaseUrl,
        model: generationModel,
        timeoutMs: modelTimeoutMs
      });
      answer = generated.text || localExtractiveAnswer(question, selectedChunks, citations);
    }
  } catch (error) {
    return {
      answer: '',
      citations: [],
      warnings: [],
      evidence_status: 'error',
      error: `Model provider error: ${error.message}`,
      debug: enableDebug ? debugPayload({ question, retrieval, selectedChunks, answer: '', warnings, prompt }) : null
    };
  }

  const response = validateCitationsForEvidence({
    answer,
    citations,
    warnings,
    evidence_status: conflictQuestion ? 'partially_supported' : (topScore >= 0.18 ? 'supported' : 'partially_supported'),
    debug: enableDebug ? debugPayload({ question, retrieval, selectedChunks, answer, warnings, prompt, citations }) : null
  });

  return response;
}

export function buildWarnings(citations, selectedLanguage) {
  const warnings = [];
  const provisional = citations.filter((citation) => ['review', 'draft'].includes(citation.status));

  if (provisional.length > 0) {
    warnings.push({
      type: 'uses_draft_or_review',
      message: 'This answer includes material from draft or review-stage W3C i18n content. Draft/review material may change before publication.'
    });
  }

  if (provisional.length > citations.length / 2) {
    warnings.push({
      type: 'primarily_draft_or_review',
      message: 'This answer relies primarily on draft or review-stage W3C i18n content. Treat it as provisional guidance.'
    });
  }

  const language = String(selectedLanguage || 'en').toLowerCase();
  if (language !== 'en' && citations.length > 0 && !citations.some((citation) => citation.language === language) && citations.some((citation) => citation.language === 'en')) {
    warnings.push({
      type: 'english_fallback',
      message: `No sufficiently relevant ${language} source was found, so this answer uses English W3C i18n sources.`
    });
  }

  return warnings;
}

function localExtractiveAnswer(question, chunks, citations) {
  const chunk = chunks[0];
  if (!chunk || citations.length === 0) return INSUFFICIENT;

  const availableSentences = usefulSentences(chunk);
  const quickAnswer = isQuickAnswerChunk(chunk);
  const sentences = (quickAnswer
    ? availableSentences.slice(0, 2).map((sentence, index) => ({ sentence, index }))
    : availableSentences
      .map((sentence, index) => ({
        sentence,
        index,
        score: sentenceScore(question, sentence)
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, 2)
      .sort((a, b) => a.index - b.index))
    .map((candidate) => protectInlineMarkup(candidate.sentence));
  const example = quickAnswer ? preferredInlineExample(chunk.text) : '';
  if (example && !sentences.some((sentence) => sentence.includes(example))) {
    sentences.push(`Example: \`${example}\`.`);
  }
  const selected = sentences.length > 0 ? sentences : [firstUsefulSentence(chunk.text)];
  const prefix = ['review', 'draft'].includes(chunk.status) ? `${statusLabel(chunk.status)}: ` : '';

  return `${prefix}${selected.join(' ')} [1]`;
}

function isQuickAnswerChunk(chunk) {
  const heading = String(chunk.heading_path?.[chunk.heading_path.length - 1] || '').trim().toLowerCase();
  if (heading === 'quick answer') return true;
  // Section ids come from the page anchors and stay stable across
  // translations, unlike the heading text (e.g. "快速回答").
  return ['nutshell', 'quickanswer'].includes(sectionId(chunk));
}

function selectChunks(results, { localMode, conflictIntent, chunks = [] }) {
  const limit = localMode && !conflictIntent ? 1 : 4;
  if (conflictIntent || results.length === 0) return results.slice(0, limit);

  const topResult = results[0];
  if (!isQuestionChunk(topResult)) return results.slice(0, limit);

  const quickAnswer = findQuickAnswer(topResult, results, chunks);
  if (!quickAnswer) return results.slice(0, limit);

  return [quickAnswer, ...results.filter((chunk) => chunk !== quickAnswer)].slice(0, limit);
}

function isQuestionChunk(chunk) {
  const heading = String(chunk.heading_path?.[chunk.heading_path.length - 1] || '').trim().toLowerCase();
  if (heading === 'question') return true;
  return sectionId(chunk) === 'question';
}

function sectionId(chunk) {
  return String(chunk.chunk_id || '').split('#')[1] || '';
}

function findQuickAnswer(topResult, results, chunks) {
  const inResults = results.find((chunk) => isQuickAnswerChunk(chunk) && sameSource(chunk, topResult));
  if (inResults) return inResults;

  // The quick-answer section often ranks far below the question echo for
  // lexical retrieval, so look it up in the full corpus when available.
  for (const chunk of Array.isArray(chunks) ? chunks : []) {
    if (isQuickAnswerChunk(chunk) && sameSource(chunk, topResult)) {
      // The corpus chunk was not retrieved, so it has no retrieval score;
      // inherit the score of the question chunk it answers.
      return { ...chunk, score: topResult.score ?? chunk.score };
    }
  }
  return null;
}

function sameSource(left, right) {
  return left.source_path === right.source_path &&
    String(left.source_id || '') === String(right.source_id || '');
}

function preferredInlineExample(text) {
  return String(text || '').match(/<meta\s+charset\s*=\s*["'][^"']+["'][^>]*>/i)?.[0] || '';
}

function localConflictAnswer(chunks, citations) {
  const publishedIndex = citations.findIndex((citation) => citation.status === 'published');
  const provisionalIndex = citations.findIndex((citation) => ['review', 'draft'].includes(citation.status));
  const parts = ['The retrieved sources could not confirm a direct conflict.'];

  if (publishedIndex >= 0) {
    parts.push(`Published: ${firstUsefulSentence(chunks[publishedIndex].text)} [${publishedIndex + 1}]`);
  }
  if (provisionalIndex >= 0) {
    parts.push(`${statusLabel(citations[provisionalIndex].status)}: ${firstUsefulSentence(chunks[provisionalIndex].text)} [${provisionalIndex + 1}] Treat draft/review material as provisional until it is published.`);
  }

  return parts.join(' ');
}

function asksAboutConflict(question) {
  return /\b(conflict|contradict|contradiction|contradicts|disagree|differs?)\b/i.test(question);
}

function hasMixedPublishedAndProvisional(citations) {
  return citations.some((citation) => citation.status === 'published') &&
    citations.some((citation) => ['review', 'draft'].includes(citation.status));
}

function firstUsefulSentence(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const sentence = clean.match(/[^.!?。！？]+[.!?。！？]/u)?.[0] || clean;
  return sentence.trim();
}

function usefulSentences(chunk) {
  const heading = String(chunk.heading_path?.[chunk.heading_path.length - 1] || '').trim();
  let clean = String(chunk.text || '').replace(/\s+/g, ' ').trim();
  if (heading && clean.toLowerCase().startsWith(heading.toLowerCase())) {
    clean = clean.slice(heading.length).trim();
  }
  return clean.match(/[^.!?。！？]+(?:[.!?。！？]+|$)/gu)?.map((sentence) => sentence.trim()).filter(Boolean) || [];
}

function sentenceScore(question, sentence) {
  const topic = definitionTopic(question);
  if (topic) {
    const sentenceTokens = new Set(tokenize(sentence));
    return [...new Set(tokenize(topic))].reduce((sum, token) => sum + (sentenceTokens.has(token) ? 1 : 0), 0);
  }
  const questionTokens = tokenizeForAnswer(question);
  const sentenceTokens = new Set(tokenizeForAnswer(sentence));
  let score = questionTokens.reduce((sum, token) => sum + (sentenceTokens.has(token) ? 1 : 0), 0);
  if (/<meta\b[^>]*charset/i.test(sentence)) score += 3;
  if (/\b(always|should|recommend|use)\b/i.test(sentence)) score += 0.25;
  return score;
}

function tokenizeForAnswer(value) {
  return String(value || '').normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) || [];
}

function protectInlineMarkup(sentence) {
  return sentence.replace(/<[^>]+>/g, (markup) => `\`${markup}\``);
}

function statusLabel(status) {
  return status === 'draft' ? 'Draft' : 'Review-stage';
}

function debugPayload({ question, retrieval, selectedChunks, answer, warnings, prompt, citations = [] }) {
  return {
    raw_query: question,
    normalized_query: retrieval?.normalized_query || '',
    selected_filters: retrieval?.filters || {},
    retrieved_before_ranking: retrieval?.debug?.retrieved_before_ranking || [],
    retrieved_after_ranking: retrieval?.debug?.retrieved_after_ranking || retrieval?.results || [],
    final_context: prompt?.context || selectedChunks.map((chunk) => chunk.text).join('\n\n'),
    model_answer: answer,
    citation_mapping: citations,
    warnings_triggered: warnings
  };
}
