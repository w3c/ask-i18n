import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { canonicalUrlForSourcePath, citationUrlForSourcePath } from '../src/indexing/canonical-url.js';
import { parseTranslationsFile, translationStateForLanguage } from '../src/indexing/parse-translations.js';
import { parseHtmlPage, isLikelyContentPage } from '../src/indexing/parse-html.js';

const fixtureRoot = new URL('./fixtures/i18n-mini/', import.meta.url);

test('canonical URLs remove language suffixes and preserve index directories', () => {
  assert.equal(
    canonicalUrlForSourcePath('articles/http-charset/index.en.html', 'https://www.w3.org/International'),
    'https://www.w3.org/International/articles/http-charset/'
  );
  assert.equal(
    canonicalUrlForSourcePath('questions/qa-link-lang.en.html', 'https://www.w3.org/International/'),
    'https://www.w3.org/International/questions/qa-link-lang'
  );
  assert.equal(
    canonicalUrlForSourcePath('articles/http-charset/index.en.html', 'https://www.w3.org/International', 'charset'),
    'https://www.w3.org/International/articles/http-charset/#charset'
  );
  assert.equal(
    canonicalUrlForSourcePath('index.html', 'https://w3c.github.io/string-meta', 'introduction'),
    'https://w3c.github.io/string-meta/#introduction'
  );
  assert.equal(
    canonicalUrlForSourcePath('index.en.html', 'https://w3c.github.io/bp-i18n-specdev', 'char-encoding'),
    'https://w3c.github.io/bp-i18n-specdev/#char-encoding'
  );
});

test('draft and review citations use the GitHub Pages source URL', () => {
  const githubPagesBaseUrl = 'https://w3c.github.io/i18n-drafts';

  assert.equal(
    citationUrlForSourcePath({
      sourcePath: 'questions/qa-bidi-localization.en.html',
      publicBaseUrl: 'https://www.w3.org/International',
      githubPagesBaseUrl,
      status: 'draft'
    }),
    'https://w3c.github.io/i18n-drafts/questions/qa-bidi-localization.en.html'
  );
  assert.equal(
    citationUrlForSourcePath({
      sourcePath: 'questions/qa-bidi-localization.en.html',
      publicBaseUrl: 'https://www.w3.org/International',
      githubPagesBaseUrl,
      status: 'review',
      sectionId: 'answer'
    }),
    'https://w3c.github.io/i18n-drafts/questions/qa-bidi-localization.en.html#answer'
  );
});

test('published and obsolete citations keep the w3.org canonical URL', () => {
  for (const status of ['published', 'obsolete', 'notreviewed']) {
    assert.equal(
      citationUrlForSourcePath({
        sourcePath: 'articles/http-charset/index.en.html',
        publicBaseUrl: 'https://www.w3.org/International',
        githubPagesBaseUrl: 'https://w3c.github.io/i18n-drafts',
        status,
        sectionId: 'charset'
      }),
      'https://www.w3.org/International/articles/http-charset/#charset'
    );
  }
});

test('draft citations fall back to the w3.org URL without a GitHub Pages base', () => {
  assert.equal(
    citationUrlForSourcePath({
      sourcePath: 'questions/qa-bidi-localization.en.html',
      publicBaseUrl: 'https://www.w3.org/International',
      status: 'draft'
    }),
    'https://www.w3.org/International/questions/qa-bidi-localization'
  );
});

test('W3C navigation citations use the hosted i18n-drafts path', () => {
  for (const sourcePath of ['nav/about.html', 'nav/about.zh-hans.html']) {
    assert.equal(
      canonicalUrlForSourcePath(sourcePath, 'https://www.w3.org/International/', 'what'),
      'https://www.w3.org/International/i18n-drafts/nav/about#what'
    );
  }
  assert.equal(
    canonicalUrlForSourcePath('nav/about.html', 'https://www.w3.org/International/i18n-drafts', 'what'),
    'https://www.w3.org/International/i18n-drafts/nav/about#what'
  );
  assert.equal(
    canonicalUrlForSourcePath('nav/about.html', 'https://example.org/custom', 'what'),
    'https://example.org/custom/nav/about#what'
  );
});

test('translation metadata maps language states from companion translations.js', async () => {
  const file = await readFile(join(fixtureRoot.pathname, 'articles/http-charset/index-data/translations.js'), 'utf8');
  const translations = parseTranslationsFile(file);

  assert.equal(translationStateForLanguage(translations, 'en'), 'current');
  assert.equal(translationStateForLanguage(translations, 'zh-hans'), 'out_of_date');
  assert.equal(translationStateForLanguage(translations, 'ja'), 'updated');
  assert.equal(translationStateForLanguage(translations, 'ar'), 'unlinked');
  assert.equal(translationStateForLanguage(translations, 'ko'), 'unknown');
});

test('HTML parser extracts W3C i18n metadata and cleaned main text', async () => {
  const file = await readFile(join(fixtureRoot.pathname, 'articles/http-charset/index.en.html'), 'utf8');
  const parsed = parseHtmlPage({
    html: file,
    sourcePath: 'articles/http-charset/index.en.html',
    publicBaseUrl: 'https://www.w3.org/International',
    translations: { versions: [{ lang: 'en' }], out_of_date_translations: [], updated_translations: [], unlinked_translations: [] }
  });

  assert.equal(parsed.language, 'en');
  assert.equal(parsed.title, 'Declaring character encoding in HTML');
  assert.equal(parsed.h1, 'Declaring character encoding in HTML');
  assert.equal(parsed.status, 'published');
  assert.equal(parsed.translation_state, 'current');
  assert.equal(parsed.canonical_url, 'https://www.w3.org/International/articles/http-charset/');
  assert.equal(parsed.metadata.f.status, 'published');
  assert.match(parsed.text, /use UTF-8/i);
  assert.doesNotMatch(parsed.text, /Boilerplate footer/);
});

test('isLikelyContentPage requires f-metadata by default but accepts pages without it when requireMetadata is false', async () => {
  const withMetadata = '<html lang="en"><body><h1>Title</h1><script>var f = { status: "published" };</script></body></html>';
  const withoutMetadata = '<html lang="en"><body><h1>Title</h1><p>Content only.</p></body></html>';
  const noLang = '<html><body><h1>Title</h1></body></html>';

  assert.equal(isLikelyContentPage(withMetadata), true);
  assert.equal(isLikelyContentPage(withoutMetadata), false);
  assert.equal(isLikelyContentPage(noLang), false);

  assert.equal(isLikelyContentPage(withMetadata, { requireMetadata: false }), true);
  assert.equal(isLikelyContentPage(withoutMetadata, { requireMetadata: false }), true);
  assert.equal(isLikelyContentPage(noLang, { requireMetadata: false }), false);
});

test('parseHtmlPage uses defaultStatus when no f metadata is present', () => {
  const html = '<html lang="en"><head><title>Spec Title</title></head><body><h2>Introduction</h2><p>Content.</p></body></html>';
  const withDefault = parseHtmlPage({ html, sourcePath: 'index.en.html', publicBaseUrl: 'https://example.com', defaultStatus: 'published' });
  const withoutDefault = parseHtmlPage({ html, sourcePath: 'index.en.html', publicBaseUrl: 'https://example.com' });

  assert.equal(withDefault.status, 'published');
  assert.equal(withoutDefault.status, 'notreviewed');
});

test('parseHtmlPage prefers f.status over defaultStatus', () => {
  const html = '<html lang="en"><head><title>T</title></head><body><h1>T</h1><script>var f = { status: "published" };</script></body></html>';
  const parsed = parseHtmlPage({ html, sourcePath: 'index.en.html', publicBaseUrl: 'https://example.com', defaultStatus: 'draft' });

  assert.equal(parsed.status, 'published');
});

test('parseHtmlPage lets a source status override take precedence over page metadata', () => {
  const html = '<html lang="en"><head><title>T</title></head><body><h1>T</h1><script>var f = { status: "notreviewed" };</script></body></html>';
  const parsed = parseHtmlPage({
    html,
    sourcePath: 'index.en.html',
    publicBaseUrl: 'https://example.com',
    defaultStatus: 'draft',
    statusOverride: 'published'
  });

  assert.equal(parsed.status, 'published');
});

test('parseHtmlPage cites draft pages through their GitHub Pages source file', () => {
  const html = '<html lang="en"><head><title>Draft</title></head><body><h1>Draft</h1><script>var f = { status: "draft" };</script></body></html>';
  const githubPagesBaseUrl = 'https://w3c.github.io/i18n-drafts';
  const draft = parseHtmlPage({
    html,
    sourcePath: 'questions/qa-bidi-localization.en.html',
    publicBaseUrl: 'https://www.w3.org/International',
    githubPagesBaseUrl
  });
  const published = parseHtmlPage({
    html: html.replace('"draft"', '"published"'),
    sourcePath: 'questions/qa-bidi-localization.en.html',
    publicBaseUrl: 'https://www.w3.org/International',
    githubPagesBaseUrl
  });

  assert.equal(draft.status, 'draft');
  assert.equal(draft.canonical_url, 'https://w3c.github.io/i18n-drafts/questions/qa-bidi-localization.en.html');
  assert.equal(draft.github_pages_url, 'https://w3c.github.io/i18n-drafts/questions/qa-bidi-localization.en.html');
  assert.equal(published.canonical_url, 'https://www.w3.org/International/questions/qa-bidi-localization');
  assert.equal(published.github_pages_url, 'https://w3c.github.io/i18n-drafts/questions/qa-bidi-localization.en.html');
});

test('isLikelyContentPage accepts pages without h1 when they have h2 or title and requireMetadata is false', () => {
  const withH2Only = '<html lang="en"><head><title>Spec Title</title></head><body><h2>Introduction</h2></body></html>';
  const withTitleOnly = '<html lang="en"><head><title>Spec Title</title></head><body><p>Content.</p></body></html>';
  const noHeading = '<html lang="en"><body><p>Content only.</p></body></html>';
  const h2WithMetadata = '<html lang="en"><body><h2>Intro</h2><script>var f = { status: "draft" };</script></body></html>';

  assert.equal(isLikelyContentPage(withH2Only, { requireMetadata: false }), true);
  assert.equal(isLikelyContentPage(withTitleOnly, { requireMetadata: false }), true);
  assert.equal(isLikelyContentPage(noHeading, { requireMetadata: false }), false);

  assert.equal(isLikelyContentPage(withH2Only), false);
  assert.equal(isLikelyContentPage(h2WithMetadata), false);
});
