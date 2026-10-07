import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieve } from '../src/retrieval/hybrid.js';

const chunks = [
  {
    chunk_id: 'articles/http-charset/index.en.html#charset',
    source_path: 'articles/http-charset/index.en.html',
    section_url: 'https://www.w3.org/International/articles/http-charset/#charset',
    title: 'Declaring character encoding in HTML',
    heading_path: ['The charset parameter'],
    language: 'en',
    status: 'published',
    translation_state: 'current',
    text: 'For HTML pages, use UTF-8 and declare the character encoding early in the document.'
  },
  {
    chunk_id: 'articles/http-charset/index.zh-hans.html#charset',
    source_path: 'articles/http-charset/index.zh-hans.html',
    section_url: 'https://www.w3.org/International/articles/http-charset/#charset',
    title: '在 HTML 中声明字符编码',
    heading_path: ['charset 参数'],
    language: 'zh-hans',
    status: 'published',
    translation_state: 'out_of_date',
    text: 'HTML 页面应使用 UTF-8，并在文档开头声明字符编码。'
  },
  {
    chunk_id: 'questions/qa-link-lang.en.html#link-language',
    source_path: 'questions/qa-link-lang.en.html',
    section_url: 'https://www.w3.org/International/questions/qa-link-lang#link-language',
    title: 'Link language declarations',
    heading_path: ['Use hreflang for linked resources'],
    language: 'en',
    status: 'review',
    translation_state: 'unknown',
    text: 'The hreflang attribute indicates the language of a linked resource.'
  },
  {
    chunk_id: 'questions/qa-obsolete.en.html#old-advice',
    source_path: 'questions/qa-obsolete.en.html',
    section_url: 'https://www.w3.org/International/questions/qa-obsolete#old-advice',
    title: 'Obsolete example page',
    heading_path: ['Old advice'],
    language: 'en',
    status: 'obsolete',
    translation_state: 'unknown',
    text: 'This obsolete guidance should not appear unless obsolete content is explicitly included.'
  }
];

test('definition queries prefer the topic heading over repeated related mentions', () => {
  const definition = {
    ...chunks[0],
    chunk_id: 'articles/ruby/index.en.html#definition',
    source_path: 'articles/ruby/index.en.html',
    title: 'Ruby annotations',
    heading_path: ['What is ruby?'],
    text: 'Ruby is a short annotation alongside base text to provide pronunciation or other information.'
  };
  const related = {
    ...definition,
    chunk_id: 'articles/ruby/index.en.html#examples',
    heading_path: ['Ruby examples'],
    text: 'Ruby examples show ruby layout, ruby alignment, ruby positioning, ruby styling, and ruby markup.'
  };
  const result = retrieve({ query: 'What is ruby?', chunks: [related, definition] });

  assert.equal(result.results[0].chunk_id, definition.chunk_id);
});

test('a heading answering the definition question outranks a broader topic section', () => {
  const definition = {
    ...chunks[0],
    chunk_id: 'nav/about.html#what',
    source_path: 'nav/about.html',
    title: 'About W3C Internationalization (i18n)',
    heading_path: ['What is Internationalization?'],
    text: 'Internationalization means designing content for users from any culture, region, or language. Unicode, text direction, names, addresses, time zones, currencies, dates, and cultural expectations need attention.'
  };
  const broader = {
    ...definition,
    chunk_id: 'questions/qa-i18n.en.html#i18n',
    source_path: 'questions/qa-i18n.en.html',
    title: 'Localization vs. Internationalization',
    heading_path: ['Internationalization'],
    text: 'Definitions of internationalization vary. Internationalization enables localization. Internationalization is often written i18n. Internationalization entails removing barriers to localization.'
  };
  const result = retrieve({ query: 'what is i18n', chunks: [broader, definition] });

  assert.equal(result.results[0].chunk_id, definition.chunk_id);
});

test('retrieval ranks exact technical terms and excludes obsolete by default', () => {
  const result = retrieve({
    query: 'How should I declare UTF-8 character encoding?',
    language: 'en',
    statuses: ['published', 'review', 'draft'],
    includeObsolete: false,
    chunks,
    limit: 5
  });

  assert.equal(result.results[0].chunk_id, 'articles/http-charset/index.en.html#charset');
  assert(!result.results.some((item) => item.status === 'obsolete'));
  assert(result.results[0].score > 0);
});

test('retrieval prefers selected language but keeps stronger current English fallback visible', () => {
  const result = retrieve({
    query: 'UTF-8 字符编码',
    language: 'zh-hans',
    statuses: ['published', 'review', 'draft'],
    includeObsolete: false,
    chunks,
    limit: 3
  });

  assert.equal(result.results[0].language, 'zh-hans');
  assert(result.results.some((item) => item.language === 'en'));
});

test('retrieval respects status filters', () => {
  const result = retrieve({
    query: 'hreflang linked resource language',
    language: 'en',
    statuses: ['published'],
    includeObsolete: false,
    chunks,
    limit: 5
  });

  assert(!result.results.some((item) => item.status === 'review'));
});

test('retrieval does not treat stopword overlap as enough evidence', () => {
  const result = retrieve({
    query: 'What payment API should I use for subscriptions?',
    language: 'en',
    statuses: ['published', 'review', 'draft'],
    includeObsolete: false,
    chunks,
    limit: 5
  });

  assert.equal(result.results.length, 0);
});

test('retrieval rejects chunks that only match one broad non-technical term', () => {
  const result = retrieve({
    query: 'How do I configure payment processing for subscriptions?',
    language: 'en',
    statuses: ['published', 'review', 'draft'],
    includeObsolete: false,
    chunks,
    limit: 5
  });

  assert.equal(result.results.length, 0);
});

test('retrieval matches inflected forms via stemming', () => {
  const result = retrieve({
    query: 'How should I declare the encoding of my document?',
    language: 'en',
    statuses: ['published', 'review', 'draft'],
    includeObsolete: false,
    chunks,
    limit: 5
  });

  assert(result.results.length > 0);
  assert.equal(result.results[0].chunk_id, 'articles/http-charset/index.en.html#charset');
});

test('retrieval matches hyphenated and spaced variants of the same term', () => {
  const hyphenated = retrieve({
    query: 'utf-8 encoding',
    language: 'en',
    statuses: ['published', 'review', 'draft'],
    includeObsolete: false,
    chunks,
    limit: 5
  });

  const spaced = retrieve({
    query: 'utf 8 encoding',
    language: 'en',
    statuses: ['published', 'review', 'draft'],
    includeObsolete: false,
    chunks,
    limit: 5
  });

  assert.equal(hyphenated.results[0].chunk_id, 'articles/http-charset/index.en.html#charset');
  assert.equal(spaced.results[0].chunk_id, 'articles/http-charset/index.en.html#charset');
});

test('retrieval does not leak published answers through excluded status filters', () => {
  const result = retrieve({
    query: 'How should I declare UTF-8 character encoding in HTML?',
    language: 'en',
    statuses: ['review'],
    includeObsolete: false,
    chunks,
    limit: 5
  });

  assert.equal(result.results.length, 0);
});

test('retrieval rejects related content that does not cover the full short-query concept', () => {
  const result = retrieve({
    query: 'How should I declare the language of an HTML page?',
    language: 'en',
    statuses: ['published', 'review', 'draft'],
    includeObsolete: false,
    chunks,
    limit: 5
  });

  assert.equal(result.results.length, 0);
});

test('retrieval ranks the language-declaration page for a Chinese query with Latin adjacency', () => {
  const languageChunks = [
    {
      chunk_id: 'questions/qa-html-language-declarations.zh-hans.html#question',
      source_path: 'questions/qa-html-language-declarations.zh-hans.html',
      section_url: 'https://www.w3.org/International/questions/qa-html-language-declarations.zh-hans.html#question',
      title: '在HTML中声明语言',
      heading_path: ['问题'],
      language: 'zh-hans',
      status: 'published',
      translation_state: 'current',
      text: '问题 如何设置HTML页面的内容语言？ 本文描述了如何通过标记HTML页面来提供有关页面语言的信息。'
    },
    {
      chunk_id: 'questions/qa-html-language-declarations.zh-hans.html#nutshell',
      source_path: 'questions/qa-html-language-declarations.zh-hans.html',
      section_url: 'https://www.w3.org/International/questions/qa-html-language-declarations.zh-hans.html#nutshell',
      title: '在HTML中声明语言',
      heading_path: ['快速回答'],
      language: 'zh-hans',
      status: 'published',
      translation_state: 'current',
      text: '快速回答 始终在 html 标签上使用语言属性来声明页面中文本的默认语言。'
    },
    {
      chunk_id: 'questions/qa-bidi-unicode-controls.zh-hans.html#reasons',
      source_path: 'questions/qa-bidi-unicode-controls.zh-hans.html',
      section_url: 'https://www.w3.org/International/questions/qa-bidi-unicode-controls.zh-hans.html#reasons',
      title: 'Unicode 双向算法',
      heading_path: ['本文涵盖和不涵盖的内容'],
      language: 'zh-hans',
      status: 'published',
      translation_state: 'current',
      text: '本文涵盖和不涵盖的内容 本文说明如何在HTML中处理双向文本，以及如何使用Unicode控制字符。'
    },
    {
      chunk_id: 'questions/qa-htaccess-charset.zh-hans.html#question',
      source_path: 'questions/qa-htaccess-charset.zh-hans.html',
      section_url: 'https://www.w3.org/International/questions/qa-htaccess-charset.zh-hans.html#question',
      title: '在 Apache 中声明字符编码',
      heading_path: ['问题'],
      language: 'zh-hans',
      status: 'published',
      translation_state: 'current',
      text: '问题 如何设置Web服务器的字符编码？'
    }
  ];

  const result = retrieve({
    query: '如何在HTML中设置内容的语言？',
    language: 'zh-hans',
    statuses: ['published', 'review', 'draft'],
    includeObsolete: false,
    chunks: languageChunks,
    limit: 5
  });

  assert.equal(result.results[0].source_path, 'questions/qa-html-language-declarations.zh-hans.html');
  assert(result.results[0].matched_tokens.includes('设'));
  assert(result.results[0].matched_tokens.includes('语'));
  assert(result.results[0].matched_tokens.includes('言'));
});

test('translated counterpart promotion respects status filters and does not leak obsolete translations', () => {
  const testChunks = [
    {
      chunk_id: 'articles/test-article/index.en.html#section',
      source_path: 'articles/test-article/index.en.html',
      translation_group_id: 'articles/test-article/index',
      section_url: 'https://www.w3.org/International/articles/test-article/#section',
      title: 'Character encoding declaration in HTML',
      heading_path: ['Overview'],
      language: 'en',
      status: 'published',
      translation_state: 'current',
      text: 'Declare UTF-8 character encoding early in the document.'
    },
    {
      chunk_id: 'articles/test-article/index.zh-hans.html#section',
      source_path: 'articles/test-article/index.zh-hans.html',
      translation_group_id: 'articles/test-article/index',
      section_url: 'https://www.w3.org/International/articles/test-article/#section',
      title: 'HTML 字符编码声明',
      heading_path: ['概述'],
      language: 'zh-hans',
      status: 'obsolete',
      translation_state: 'out_of_date',
      text: '在文档开头声明字符编码。'
    }
  ];

  const result = retrieve({
    query: 'Declare UTF-8 character encoding',
    language: 'zh-hans',
    statuses: ['published'],
    includeObsolete: false,
    chunks: testChunks,
    limit: 5
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].language, 'en');
  assert.equal(result.results.some((item) => item.status === 'obsolete'), false);
});
