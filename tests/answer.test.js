import test from 'node:test';
import assert from 'node:assert/strict';
import { answerFromRetrieval } from '../src/generation/answer.js';
import { validateCitationsForEvidence } from '../src/generation/citations.js';
import { buildPrompt } from '../src/generation/prompt.js';
import { retrieve } from '../src/retrieval/hybrid.js';
import { buildIndex } from '../src/indexing/indexer.js';

test('i18n definition answers cite the indexed about page definition section', async () => {
  const index = await buildIndex({
    sourceRoot: new URL('./fixtures/i18n-mini/', import.meta.url).pathname,
    write: false
  });

  for (const question of ['what is i18n', 'What is i18n?', 'What is internationalization?']) {
    const retrieval = retrieve({ query: question, chunks: index.chunks, limit: 8 });
    const response = await answerFromRetrieval({ question, retrieval, chunks: index.chunks });

    assert.equal(response.evidence_status, 'supported', question);
    assert.equal(response.citations[0]?.url, 'https://www.w3.org/International/i18n-drafts/nav/about#what', question);
    assert.match(response.answer, /design or develop/);
    assert.doesNotMatch(response.answer, /Surprised|Let me explain|Active groups/);
  }
});

test('external-model context supplies the i18n definition as the first citation', async () => {
  const index = await buildIndex({
    sourceRoot: new URL('./fixtures/i18n-mini/', import.meta.url).pathname,
    write: false
  });
  const question = 'what is i18n';
  const retrieval = retrieve({ query: question, chunks: index.chunks });
  const previousFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'Internationalization means designing content for users from any culture, region, or language. [1]' } }] })
    };
  };

  try {
    const response = await answerFromRetrieval({
      question,
      retrieval,
      chunks: index.chunks,
      modelProvider: 'openai-compatible',
      modelApiKey: 'fixture-key',
      modelBaseUrl: 'https://example.invalid/v1'
    });
    const context = requestBody.messages.find((message) => message.role === 'user').content;
    assert.match(context, /\[1\][\s\S]*?Section: What is Internationalization\?[\s\S]*?URL: https:\/\/www\.w3\.org\/International\/i18n-drafts\/nav\/about#what/);
    assert.match(context, /design or develop/);
    assert.equal(response.citations[0]?.url, 'https://www.w3.org/International/i18n-drafts/nav/about#what');
  } finally {
    globalThis.fetch = previousFetch;
  }
});

const reviewChunk = {
  chunk_id: 'questions/qa-link-lang.en.html#link-language',
  source_path: 'questions/qa-link-lang.en.html',
  section_url: 'https://www.w3.org/International/questions/qa-link-lang#link-language',
  title: 'Link language declarations',
  heading_path: ['Use hreflang for linked resources'],
  language: 'en',
  status: 'review',
  translation_state: 'unknown',
  text: 'The hreflang attribute indicates the language of a linked resource. Review-stage guidance may change before publication.',
  score: 0.74,
  rank: 1
};

const publishedChunk = {
  chunk_id: 'articles/http-charset/index.en.html#charset',
  source_path: 'articles/http-charset/index.en.html',
  section_url: 'https://www.w3.org/International/articles/http-charset/#charset',
  title: 'Declaring character encoding in HTML',
  heading_path: ['The charset parameter'],
  language: 'en',
  status: 'published',
  translation_state: 'current',
  text: 'For HTML pages, use UTF-8 and declare the character encoding early in the document.',
  score: 0.52,
  rank: 2
};

test('supported answers include citations and draft/review warnings', async () => {
  const response = await answerFromRetrieval({
    question: 'What does hreflang indicate?',
    language: 'en',
    retrieval: { results: [reviewChunk], debug: { query: 'What does hreflang indicate?' } },
    enableDebug: true,
    modelProvider: 'local'
  });

  assert.equal(response.evidence_status, 'supported');
  assert.match(response.answer, /\[1\]/);
  assert.equal(response.citations.length, 1);
  assert.equal(response.citations[0].status, 'review');
  assert(response.warnings.some((warning) => warning.type === 'uses_draft_or_review'));
  assert(response.debug.final_context.includes('hreflang'));
});

test('answer instructions avoid naming the site corpus as the speaker', async () => {
  const prompt = buildPrompt({
    question: 'How should I declare UTF-8 character encoding in HTML?',
    language: 'en',
    chunks: [publishedChunk]
  });

  assert.match(prompt.system, /Do not introduce answers by naming W3C i18n content or sources as the speaker/i);

  const response = await answerFromRetrieval({
    question: 'How should I declare UTF-8 character encoding in HTML?',
    language: 'en',
    retrieval: { results: [publishedChunk] },
    modelProvider: 'local'
  });

  assert.doesNotMatch(response.answer, /From the indexed W3C i18n content/i);
  assert.doesNotMatch(response.answer, /W3C i18n (?:content|sources) (?:says|say|could)/i);
  assert.match(response.answer, /UTF-8.*\[1\]/i);
});

test('mostly draft or review evidence uses stronger warning', async () => {
  const response = await answerFromRetrieval({
    question: 'What does hreflang indicate?',
    language: 'en',
    retrieval: { results: [reviewChunk, { ...reviewChunk, chunk_id: 'draft#x', status: 'draft', rank: 2 }] },
    modelProvider: 'local'
  });

  assert(response.warnings.some((warning) => warning.type === 'primarily_draft_or_review'));
});

test('selected non-English answer discloses English fallback when no selected-language citation is used', async () => {
  const response = await answerFromRetrieval({
    question: 'hreflang 表示什么？',
    language: 'zh-hans',
    retrieval: { results: [reviewChunk] },
    modelProvider: 'local'
  });

  assert(response.warnings.some((warning) => warning.type === 'english_fallback'));
});

test('citation validation fails closed for supported answers without citations', () => {
  const validated = validateCitationsForEvidence({
    answer: 'Use UTF-8.',
    citations: [],
    evidence_status: 'supported',
    warnings: []
  });

  assert.equal(validated.evidence_status, 'insufficient_evidence');
  assert.equal(validated.citations.length, 0);
});

test('citation validation keeps answer references aligned with returned citations', () => {
  const citations = [
    { chunk_id: 'source-1', label: 'Source 1' },
    { chunk_id: 'source-2', label: 'Source 2' },
    { chunk_id: 'source-3', label: 'Source 3' },
    { chunk_id: 'source-4', label: 'Source 4' }
  ];

  const validated = validateCitationsForEvidence({
    answer: 'Use quick tips for concise guidance [3]. Use Unicode design guidance for implementation details [4].',
    citations,
    evidence_status: 'supported',
    warnings: []
  });

  assert.equal(validated.answer, 'Use quick tips for concise guidance [1]. Use Unicode design guidance for implementation details [2].');
  assert.deepEqual(validated.citations.map((citation) => citation.chunk_id), ['source-3', 'source-4']);
});

test('local answer citations are limited to the evidence actually used', async () => {
  const response = await answerFromRetrieval({
    question: 'How should I declare UTF-8 character encoding in HTML?',
    language: 'en',
    retrieval: {
      results: [
        publishedChunk,
        { ...publishedChunk, chunk_id: 'source-2', source_path: 'source-2.html', rank: 2 },
        { ...publishedChunk, chunk_id: 'source-3', source_path: 'source-3.html', rank: 3 },
        { ...publishedChunk, chunk_id: 'source-4', source_path: 'source-4.html', rank: 4 }
      ]
    },
    modelProvider: 'local'
  });

  assert.equal(response.citations.length, 1);
  assert.equal(response.citations[0].chunk_id, publishedChunk.chunk_id);
});

test('conflict questions with mixed published and review evidence are treated as partial', async () => {
  const response = await answerFromRetrieval({
    question: 'Is there a conflict between published charset guidance and review hreflang guidance?',
    language: 'en',
    retrieval: { results: [reviewChunk, publishedChunk] },
    modelProvider: 'local'
  });

  assert.equal(response.evidence_status, 'partially_supported');
  assert.match(response.answer, /could not confirm a direct conflict/i);
  assert(response.warnings.some((warning) => warning.type === 'uses_draft_or_review'));
});

test('local mode answers an HTML UTF-8 declaration question from the direct quick-answer section', async () => {
  const repeatedEncodingTerms = 'UTF-8 character encoding declarations describe encoded characters and declare an encoding. '.repeat(12);
  const chunks = [
    {
      chunk_id: 'questions/qa-html-encoding-declarations.en.html#quickanswer',
      source_path: 'questions/qa-html-encoding-declarations.en.html',
      section_url: 'https://www.w3.org/International/questions/qa-html-encoding-declarations#quickanswer',
      title: 'Declaring character encodings in HTML',
      heading_path: ['Quick answer'],
      language: 'en',
      status: 'published',
      translation_state: 'current',
      text: 'Quick answer Always declare the encoding of your document using a meta element with a charset attribute. The declaration should appear immediately after the opening head tag. <meta charset="utf-8"> You should always use the UTF-8 character encoding.'
    },
    {
      chunk_id: 'questions/qa-byte-order-mark.en.html#answer',
      source_path: 'questions/qa-byte-order-mark.en.html',
      section_url: 'https://www.w3.org/International/questions/qa-byte-order-mark#answer',
      title: 'The byte-order mark (BOM) in HTML',
      heading_path: ['Answer'],
      language: 'en',
      status: 'published',
      translation_state: 'current',
      text: `Answer What is a byte-order mark? ${repeatedEncodingTerms}`
    },
    {
      chunk_id: 'index.html#characters',
      source_path: 'index.html',
      section_url: 'https://www.w3.org/International/#characters',
      title: 'Internationalization Best Practices for Spec Developers',
      heading_path: ['Characters'],
      language: 'en',
      status: 'published',
      translation_state: 'current',
      text: `Characters Characters and character encoding basics. ${repeatedEncodingTerms}`
    },
    {
      chunk_id: 'articles/unicode-migration/index.en.html#designing',
      source_path: 'articles/unicode-migration/index.en.html',
      section_url: 'https://www.w3.org/International/articles/unicode-migration/#designing',
      title: 'Migrating to Unicode',
      heading_path: ['Designing for Unicode'],
      language: 'en',
      status: 'published',
      translation_state: 'current',
      text: `Designing for Unicode Character encoding specifications. ${repeatedEncodingTerms}`
    },
    {
      chunk_id: 'articles/unicode-migration/index.en.html#migrating',
      source_path: 'articles/unicode-migration/index.en.html',
      section_url: 'https://www.w3.org/International/articles/unicode-migration/#migrating',
      title: 'Migrating to Unicode',
      heading_path: ['Migrating Data'],
      language: 'en',
      status: 'published',
      translation_state: 'current',
      text: `Migrating Data Converting product data to Unicode. ${repeatedEncodingTerms}`
    }
  ];
  const question = 'How should I declare UTF-8 character encoding in HTML?';
  const retrieval = retrieve({ query: question, language: 'en', chunks, limit: 5 });
  const response = await answerFromRetrieval({ question, language: 'en', retrieval, modelProvider: 'local' });

  assert.equal(retrieval.results[0].chunk_id, 'questions/qa-html-encoding-declarations.en.html#quickanswer');
  assert.match(response.answer, /always declare/i);
  assert.match(response.answer, /opening head tag/i);
  assert.match(response.answer, /<meta charset=["']utf-8["']>/i);
  assert.doesNotMatch(response.answer, /byte-order mark|migrating data/i);
});

test('model context promotes a same-page quick answer over a question echo', async () => {
  const question = 'How should I set the language of the content in my HTML page?';
  const questionChunk = {
    chunk_id: 'questions/qa-html-language-declarations.en.html#question',
    source_path: 'questions/qa-html-language-declarations.en.html',
    section_url: 'https://www.w3.org/International/questions/qa-html-language-declarations#question',
    title: 'Declaring language in HTML',
    heading_path: ['Question'],
    language: 'en',
    status: 'published',
    translation_state: 'current',
    text: `Question ${question} This page describes how to mark up an HTML page so that it gives information about the language of the page.`,
    score: 3.9,
    rank: 1
  };
  const quickAnswerChunk = {
    ...questionChunk,
    chunk_id: 'questions/qa-html-language-declarations.en.html#nutshell',
    section_url: 'https://www.w3.org/International/questions/qa-html-language-declarations#nutshell',
    heading_path: ['Quick answer'],
    text: 'Quick answer Always use a language attribute on the html tag to declare the default language of the text in the page. For example: <html lang="en">',
    score: 2.5,
    rank: 8
  };
  const unrelatedChunks = Array.from({ length: 6 }, (_, index) => ({
    ...questionChunk,
    chunk_id: `questions/unrelated-${index}.en.html#section`,
    source_path: `questions/unrelated-${index}.en.html`,
    section_url: `https://www.w3.org/International/questions/unrelated-${index}#section`,
    title: 'Related language guidance',
    heading_path: ['Additional information'],
    text: 'Additional information about language negotiation and translated pages.',
    score: 3.5 - (index * 0.1),
    rank: index + 2
  }));
  const previousFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: 'Use the page language declaration. [1]' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    await answerFromRetrieval({
      question,
      language: 'en',
      retrieval: { results: [questionChunk, ...unrelatedChunks, quickAnswerChunk] },
      modelProvider: 'openai-compatible',
      modelApiKey: 'test-key',
      modelBaseUrl: 'https://model.test/v1',
      generationModel: 'test-model'
    });

    assert.match(requestBody.messages[1].content, /<html lang="en">/i);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('model context pulls a translated quick answer from the corpus when it is not in retrieved results', async () => {
  const question = '如何在HTML中设置内容的语言？';
  const questionChunk = {
    chunk_id: 'questions/qa-html-language-declarations.zh-hans.html#question',
    source_path: 'questions/qa-html-language-declarations.zh-hans.html',
    section_url: 'https://www.w3.org/International/questions/qa-html-language-declarations.zh-hans.html#question',
    title: '在HTML中声明语言',
    heading_path: ['问题'],
    language: 'zh-hans',
    status: 'published',
    translation_state: 'current',
    text: `问题 ${question} 本文描述了如何通过标记HTML页面来提供有关页面语言的信息。`,
    score: 4.5,
    rank: 1
  };
  const quickAnswerChunk = {
    ...questionChunk,
    chunk_id: 'questions/qa-html-language-declarations.zh-hans.html#nutshell',
    section_url: 'https://www.w3.org/International/questions/qa-html-language-declarations.zh-hans.html#nutshell',
    heading_path: ['快速回答'],
    text: '快速回答 始终在 html 标签上使用语言属性来声明页面中文本的默认语言。例如： <html lang="zh-Hans">',
    score: 0,
    rank: 99
  };
  const unrelatedChunks = Array.from({ length: 5 }, (_, index) => ({
    ...questionChunk,
    chunk_id: `questions/unrelated-${index}.zh-hans.html#section`,
    source_path: `questions/unrelated-${index}.zh-hans.html`,
    section_url: `https://www.w3.org/International/questions/unrelated-${index}#section`,
    title: '相关语言指南',
    heading_path: ['附加信息'],
    text: '附加信息 关于语言协商和翻译页面的说明。',
    score: 4 - (index * 0.1),
    rank: index + 2
  }));
  const previousFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: '始终在 html 标签上使用语言属性。 [1]' } }] }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  try {
    await answerFromRetrieval({
      question,
      language: 'zh-hans',
      retrieval: { results: [questionChunk, ...unrelatedChunks] },
      chunks: [...unrelatedChunks, quickAnswerChunk],
      modelProvider: 'openai-compatible',
      modelApiKey: 'test-key',
      modelBaseUrl: 'https://model.test/v1',
      generationModel: 'test-model'
    });

    assert.match(requestBody.messages[1].content, /<html lang="zh-Hans">/i);
  } finally {
    globalThis.fetch = previousFetch;
  }
});
