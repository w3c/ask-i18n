import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeQuery } from '../src/retrieval/query-understanding.js';
import { retrieve } from '../src/retrieval/hybrid.js';
import { answerFromRetrieval } from '../src/generation/answer.js';

const chunks = [
  {
    chunk_id: 'articles/inline-bidi-markup/index.en.html#dir',
    source_path: 'articles/inline-bidi-markup/index.en.html',
    section_url: 'https://www.w3.org/International/articles/inline-bidi-markup/#dir',
    title: 'Inline bidi markup',
    heading_path: ['Using the dir attribute'],
    language: 'en',
    status: 'published',
    translation_state: 'current',
    text: 'Arabic text mixed with Latin words needs right-to-left isolation around inline runs.'
  },
  {
    chunk_id: 'questions/qa-egypt.en.html#answer',
    source_path: 'questions/qa-egypt.en.html',
    section_url: 'https://www.w3.org/International/questions/qa-egypt#answer',
    title: 'Layout in Egypt',
    heading_path: ['Answer'],
    language: 'en',
    status: 'published',
    translation_state: 'current',
    text: 'Users in Egypt report layout problems when the page assumes right-to-left text flows the wrong way.'
  },
  {
    chunk_id: 'questions/qa-site.en.html#problem',
    source_path: 'questions/qa-site.en.html',
    section_url: 'https://www.w3.org/International/questions/qa-site#problem',
    title: 'Site feedback',
    heading_path: ['Problems'],
    language: 'en',
    status: 'published',
    translation_state: 'current',
    text: 'Users can report problems with a site to the support desk.'
  }
];

test('a country name resolves through likely subtags to a script and direction', () => {
  const analysis = analyzeQuery('users from Egypt are reporting problems');

  assert.deepEqual(analysis.detections.map((item) => item.kind), ['region']);
  assert.equal(analysis.detections[0].locale, 'ar-Arab-EG');
  assert.equal(analysis.detections[0].language, 'ar');
  assert.equal(analysis.detections[0].direction, 'rtl');
  assert.deepEqual(analysis.terms.map((term) => term.token), ['arab', 'right-to-left', 'rtl', 'bidi']);
  assert(analysis.terms.every((term) => term.weight > 0 && term.weight < 1));
});

test('a language name expands to its own vocabulary and direction terms', () => {
  const analysis = analyzeQuery('the text order is wrong when I mix Hebrew and numbers');

  assert.equal(analysis.detections[0].language, 'he');
  assert.equal(analysis.detections[0].direction, 'rtl');
  assert(analysis.terms.some((term) => term.token === 'hebrew'));
});

test('a Chinese place name resolves the same way as the English one', () => {
  const analysis = analyzeQuery('网页上的埃及用户看不到内容');

  assert.equal(analysis.detections[0].value, 'EG');
  assert.equal(analysis.detections[0].direction, 'rtl');
});

test('locales without a right-to-left script add no expansion terms', () => {
  const analysis = analyzeQuery('how do I write Japanese addresses');

  assert.equal(analysis.detections[0].language, 'ja');
  assert.equal(analysis.detections[0].direction, 'ltr');
  assert.deepEqual(analysis.terms, []);
});

test('queries without a locale, language, or script mention are left alone', () => {
  const analysis = analyzeQuery('How should I declare UTF-8 character encoding in HTML?');

  assert.deepEqual(analysis.detections, []);
  assert.deepEqual(analysis.terms, []);
});

test('aliases only match whole words', () => {
  assert.deepEqual(analyzeQuery('egyptology and iranian studies').terms, []);
});

test('expansion admits direction guidance the query never names', () => {
  const expanded = retrieve({ query: 'users in Egypt report layout problems', chunks, limit: 5 });
  const bidi = expanded.results.find((result) => result.chunk_id.startsWith('articles/inline-bidi-markup/'));

  assert(bidi, 'expected the bidi article to be retrieved');
  assert.equal(bidi.expansion_only, true);
  assert(bidi.expansion_matches.includes('right-to-left'));
});

test('expansion can be disabled for callers that want a pure lexical ranking', () => {
  const lexical = retrieve({ query: 'users in Egypt report layout problems', chunks, limit: 5, queryExpansion: false });

  assert(!lexical.results.some((result) => result.chunk_id.startsWith('articles/inline-bidi-markup/')));
  assert.equal(lexical.debug.query_expansion.terms.length, 0);
});

test('the locale-specific page outranks the generic site page', () => {
  const result = retrieve({ query: 'users in Egypt report layout problems', chunks, limit: 5 });
  const egyptRank = result.results.findIndex((item) => item.source_path === 'questions/qa-egypt.en.html');

  assert.equal(egyptRank, 0);
  assert(result.results.findIndex((item) => item.source_path === 'questions/qa-site.en.html') > egyptRank);
});

test('answers built only on expanded evidence are partially supported', async () => {
  const retrieval = {
    results: [
      {
        chunk_id: 'articles/inline-bidi-markup/index.en.html#dir',
        source_path: 'articles/inline-bidi-markup/index.en.html',
        section_url: 'https://www.w3.org/International/articles/inline-bidi-markup/#dir',
        title: 'Inline bidi markup',
        heading_path: ['Using the dir attribute'],
        language: 'en',
        status: 'published',
        translation_state: 'current',
        text: 'Arabic text mixed with Latin words needs right-to-left isolation around inline runs.',
        score: 1.4,
        rank: 1,
        matched_tokens: [],
        specific_matches: [],
        expansion_matches: ['arab', 'rtl'],
        expansion_only: true
      }
    ]
  };

  const response = await answerFromRetrieval({
    question: 'users in Egypt report layout problems',
    language: 'en',
    retrieval,
    modelProvider: 'local'
  });

  assert.equal(response.evidence_status, 'partially_supported');
});

test('answers on a specific term stay supported even when expansion also fired', async () => {
  const retrieval = {
    results: [
      {
        chunk_id: 'questions/qa-egypt.en.html#answer',
        source_path: 'questions/qa-egypt.en.html',
        section_url: 'https://www.w3.org/International/questions/qa-egypt#answer',
        title: 'Layout in Egypt',
        heading_path: ['Answer'],
        language: 'en',
        status: 'published',
        translation_state: 'current',
        text: 'Users in Egypt report layout problems caused by text direction.',
        score: 2.1,
        rank: 1,
        matched_tokens: ['user', 'egypt'],
        specific_matches: ['egypt'],
        expansion_matches: ['arab', 'rtl'],
        expansion_only: false
      }
    ]
  };

  const response = await answerFromRetrieval({
    question: 'users in Egypt report layout problems',
    language: 'en',
    retrieval,
    modelProvider: 'local'
  });

  assert.equal(response.evidence_status, 'supported');
});
