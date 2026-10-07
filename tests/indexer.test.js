import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { discoverContentFiles } from '../src/indexing/discover.js';
import { chunkHtmlPage } from '../src/indexing/chunk.js';
import { buildIndex } from '../src/indexing/indexer.js';

const fixtureRoot = new URL('./fixtures/i18n-mini/', import.meta.url).pathname;
const specdevRoot = new URL('./fixtures/specdev-mini/', import.meta.url).pathname;
const activityRoot = new URL('./fixtures/i18n-activity-mini/', import.meta.url).pathname;

test('content discovery indexes primary content roots and skips support data HTML', async () => {
  const files = await discoverContentFiles(fixtureRoot);

  assert(files.includes('articles/http-charset/index.en.html'));
  assert(files.includes('questions/qa-link-lang.en.html'));
  assert(files.includes('nav/about.html'));
  assert(!files.includes('articles/http-charset/index-data/example.html'));
});

test('chunker creates section citations with heading paths and anchors', () => {
  const page = {
    source_path: 'articles/http-charset/index.en.html',
    canonical_url: 'https://www.w3.org/International/articles/http-charset/',
    language: 'en',
    status: 'published',
    translation_state: 'current',
    title: 'Declaring character encoding in HTML',
    html: '<main><h1>Declaring character encoding in HTML</h1><section id="charset"><h2>The charset parameter</h2><p>Use UTF-8.</p></section></main>'
  };

  const chunks = chunkHtmlPage(page);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].chunk_id, 'articles/http-charset/index.en.html#charset');
  assert.equal(chunks[0].section_url, 'https://www.w3.org/International/articles/http-charset/#charset');
  assert.deepEqual(chunks[0].heading_path, ['The charset parameter']);
  assert.equal(chunks[0].text, 'The charset parameter Use UTF-8.');
});

test('chunker emits separate chunks for nested sections', () => {
  const page = {
    source_path: 'articles/nested/index.en.html',
    canonical_url: 'https://www.w3.org/International/articles/nested/',
    language: 'en',
    status: 'published',
    translation_state: 'current',
    title: 'Nested sections test',
    html: [
      '<main><h1>Nested sections test</h1>',
      '<section id="outer">',
      '<h2>Outer heading</h2>',
      '<section id="inner">',
      '<h3>Inner heading</h3>',
      '<p>Inner content.</p>',
      '</section>',
      '<p>Outer trailing content.</p>',
      '</section>',
      '<section id="sibling">',
      '<h2>Sibling heading</h2>',
      '<p>Sibling content.</p>',
      '</section>',
      '</main>'
    ].join('')
  };

  const chunks = chunkHtmlPage(page);
  const ids = chunks.map((c) => c.section_id);

  assert(ids.includes('outer'), 'outer section should be chunked');
  assert(ids.includes('inner'), 'nested section should be chunked');
  assert(ids.includes('sibling'), 'sibling section should be chunked');

  const outer = chunks.find((c) => c.section_id === 'outer');
  const inner = chunks.find((c) => c.section_id === 'inner');
  const sibling = chunks.find((c) => c.section_id === 'sibling');

  assert.match(outer.text, /Outer heading/);
  assert.match(outer.text, /Inner content/);
  assert.match(outer.text, /Outer trailing content/);
  assert.match(inner.text, /Inner heading/);
  assert.match(inner.text, /Inner content/);
  assert.match(sibling.text, /Sibling heading/);
  assert.match(sibling.text, /Sibling content/);
});

test('indexer builds documents and chunks with source metadata', async () => {
  const index = await buildIndex({
    sourceRoot: fixtureRoot,
    publicBaseUrl: 'https://www.w3.org/International',
    sourceMode: 'local',
    sourceRef: 'fixture',
    sourceCommit: 'fixture-sha',
    write: false
  });

  assert.equal(index.source.mode, 'local');
  assert.equal(index.source.ref, 'fixture');
  assert.equal(index.source.commit, 'fixture-sha');
  assert.equal(index.documents.length, 5);
  assert(index.chunks.some((chunk) => chunk.chunk_id === 'articles/http-charset/index.en.html#charset'));
  assert(index.documents.some((doc) => doc.translation_state === 'out_of_date'));
  assert.equal(index.summary.skipped, 1);
});

test('discovery with custom contentRoots and requireMetadata finds specdev pages', async () => {
  const files = await discoverContentFiles(specdevRoot, { contentRoots: [''], requireMetadata: false });

  assert(files.includes('index.en.html'));
  assert(files.includes('text-direction.en.html'));
  assert.equal(files.length, 2);
});

test('discovery with default contentRoots skips specdev root-level files', async () => {
  const files = await discoverContentFiles(specdevRoot);
  assert.equal(files.length, 0);
});

test('activity discovery indexes only the configured WG and IG folders', async () => {
  const index = await buildIndex({
    sourceRoot: activityRoot,
    publicBaseUrl: 'https://w3c.github.io/i18n-activity',
    sourceMode: 'local',
    sourceRef: 'fixture',
    sourceCommit: 'fixture-sha',
    sourceId: 'i18n-activity',
    contentRoots: ['i18n-wg', 'i18n-ig'],
    requireMetadata: false,
    defaultStatus: 'draft',
    statusOverride: 'published',
    write: false
  });

  assert.deepEqual(index.documents.map((document) => document.source_path), [
    'i18n-ig/index.html',
    'i18n-wg/index.html'
  ]);
  assert(index.documents.every((document) => document.source_id === 'i18n-activity'));
  assert(index.documents.every((document) => document.status === 'published'));
  assert(index.documents.every((document) => document.canonical_url.startsWith('https://w3c.github.io/i18n-activity/')));
});

test('indexer builds per-source index with source_id on documents and chunks', async () => {
  const index = await buildIndex({
    sourceRoot: specdevRoot,
    publicBaseUrl: 'https://w3c.github.io/bp-i18n-specdev',
    sourceMode: 'local',
    sourceRef: 'fixture',
    sourceCommit: 'fixture-sha',
    sourceId: 'bp-i18n-specdev',
    contentRoots: [''],
    requireMetadata: false,
    defaultStatus: 'published',
    write: false
  });

  assert.equal(index.documents.length, 2);
  assert(index.documents.every((doc) => doc.source_id === 'bp-i18n-specdev'));
  assert(index.chunks.every((chunk) => chunk.source_id === 'bp-i18n-specdev'));
  assert(index.chunks.some((chunk) => chunk.chunk_id === 'index.en.html#char-encoding'));
  assert(index.chunks.some((chunk) => chunk.chunk_id === 'text-direction.en.html#bidi-basics'));
  assert(index.documents.every((doc) => doc.status === 'published'), 'specdev docs should use defaultStatus when no f metadata is present');
  assert(index.chunks.every((chunk) => chunk.status === 'published'), 'specdev chunks should inherit the published status');
});
