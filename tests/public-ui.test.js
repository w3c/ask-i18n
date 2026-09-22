import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { defaultAnswerLanguageForUI, isEnglishLanguage, isSendShortcut, speechRecognitionLanguage } from '../public/app.js';

test('the default answer language follows the interface language', () => {
  assert.equal(defaultAnswerLanguageForUI('en'), 'en');
  assert.equal(defaultAnswerLanguageForUI('zh-hans'), 'zh-hans');
  assert.equal(defaultAnswerLanguageForUI('fr'), null);
});

test('speech recognition language follows the interface language', () => {
  assert.equal(speechRecognitionLanguage('en'), 'en-US');
  assert.equal(speechRecognitionLanguage('zh-hans'), 'zh-CN');
  assert.equal(speechRecognitionLanguage('fr'), 'en-US');
});

test('public UI offers voice input for the question field', async () => {
  const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.match(page, /<button id="voice-input"[^>]*type="button"[^>]*hidden>/);
  assert.match(page, /aria-pressed="false"/);
  assert.match(page, /data-i18n="voiceInputStart"/);
});

test('voice input hides itself when speech recognition is unsupported', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(app, /window\.SpeechRecognition \|\| window\.webkitSpeechRecognition/);
  assert.match(app, /onUILanguageChange\(\(\) => renderVoiceInputButton\(\)\)/);
});

test('public UI omits the retired retrieved-sources panel', async () => {
  const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.doesNotMatch(page, /source-panel/);
  assert.doesNotMatch(page, /id="sources"/);
  assert.doesNotMatch(page, /source-count/);
  assert.doesNotMatch(page, /Inspect retrieval/);
});

test('public UI loads its assets and API relative to its mount path', async () => {
  const [page, app] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  ]);

  assert.doesNotMatch(page, /(?:href|src|action)="\/[^/]/);
  assert.match(page, /<link rel="stylesheet" href="styles\.css">/);
  assert.match(page, /<script type="module" src="app\.js"><\/script>/);
  assert.match(page, /<form id="ask-form" action="api\/ask" method="post">/);
  assert.match(app, /new URL\('\.\/', import\.meta\.url\)/);
  assert.doesNotMatch(app, /fetchJson\('\/api/);
});

test('public UI keeps the main ask flow accessible', async () => {
  const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.match(page, /class="skip-link" href="#content"/);
  assert.match(page, /<main id="content" class="app-shell" tabindex="-1">/);
  assert.match(page, /aria-describedby="question-help"/);
  assert.match(page, /<section id="message-area" class="message-area" aria-live="polite" aria-atomic="true"><\/section>/);
  assert.match(page, /<ol id="citations" class="citation-list" role="list"[^>]*aria-label="Cited sources"><\/ol>/);
  assert.doesNotMatch(page, /aria-labelledby="ask-heading"/);
});

test('public UI defaults the answer language to English', async () => {
  const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const options = page.match(/<select id="language" name="language">(?<options>[\s\S]*?)<\/select>/)?.groups.options || '';
  const optionTags = [...options.matchAll(/<option\b[^>]*>/g)].map((match) => match[0]);
  const defaultOption = optionTags.find((option) => /\bselected\b/.test(option)) || optionTags[0] || '';

  assert.match(defaultOption, /\bvalue="en"/);
});

test('public UI links the W3C i18n icon to the W3C Internationalization site', async () => {
  const [page, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8')
  ]);

  assert.match(page, /<a\s+class="header-link"[^>]*href="https:\/\/www\.w3\.org\/International\/"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/s);
  assert.match(page, /data-i18n-aria-label="headerLink"[^>]*aria-label="W3C i18n"/s);
  assert.match(page, /<img\s+src="https:\/\/www\.w3\.org\/assets\/logos\/w3c-2025\/png\/w3c\.png"[^>]*alt=""[^>]*width="120"[^>]*height="120"/s);
  assert.match(page, /<div class="app-header__icon-links">[\s\S]*class="header-link"[\s\S]*class="github-link"[\s\S]*<\/div>/);
  assert.match(css, /\.app-header__icon-links\s*{[^}]*gap:\s*0\.2rem;/s);
});

test('public UI links its GitHub icon to the project repository', async () => {
  const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.match(page, /<a\s+class="github-link"[^>]*href="https:\/\/github\.com\/w3c\/ask-i18n"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/s);
  assert.match(page, /data-i18n-aria-label="githubLinkLabel"[^>]*aria-label="View project on GitHub"/s);
  assert.match(page, /<svg aria-hidden="true"[^>]*>[\s\S]*?<path fill="currentColor"/);
});

test('citation source links open in a new window', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(app, /link\.target = '_blank';/);
});

test('public UI states the project is an experimental W3C i18n working group tool', async () => {
  const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.match(page, /<aside class="project-notice"[^>]*aria-label="Project status">/);
  assert.match(page, /Experimental tool\./);
  assert.match(page, /experimental tool from the W3C Internationalization Activity/i);
});

test('project notice uses a shorter centered max width', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');

  assert.match(css, /\.project-notice\s*{[^}]*inline-size:\s*min\(calc\(100% - 2rem\), 860px\);/s);
  assert.doesNotMatch(css, /\.project-notice\s*{[^}]*inline-size:\s*min\(calc\(100% - 2rem\), 1080px\);/s);
});

test('answer citation references use lighter type with micro spacing', async () => {
  const css = await readFile(new URL('../public/styles.css', import.meta.url), 'utf8');
  const citationRefRule = css.match(/\.answer-text \.citation-ref\s*{(?<body>[^}]*)}/s)?.groups.body || '';

  assert.match(citationRefRule, /font-weight:\s*620;/);
  assert.match(citationRefRule, /letter-spacing:\s*0\.02em;/);
});

test('English citations omit the translation-state badge', async () => {
  const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.equal(isEnglishLanguage('en'), true);
  assert.equal(isEnglishLanguage('en-US'), true);
  assert.equal(isEnglishLanguage('zh-hans'), false);
  assert.equal(isEnglishLanguage(''), false);
  assert.match(app, /if \(!isEnglishLanguage\(citation\.language\)\)\s*\{[^}]*translationLabel/);
});

test('answer text automatically follows right-to-left content direction', async () => {
  const [page, css] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8')
  ]);
  const answerRule = css.match(/\.answer-text\s*{(?<body>[^}]*)}/s)?.groups.body || '';

  assert.match(page, /<div id="answer" class="answer-text" dir="auto" aria-busy="false">/);
  assert.match(answerRule, /text-align:\s*start;/);
  assert.match(answerRule, /margin-inline:\s*0 auto;/);
});

test('public UI includes a bottom notice for pull request previews', async () => {
  const [page, css, app] = await Promise.all([
    readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/app.js', import.meta.url), 'utf8')
  ]);

  assert.match(page, /<footer id="preview-notice" class="preview-notice"[^>]* hidden>/);
  assert.match(page, /This is a PR preview\./);
  assert.match(css, /\.preview-notice\s*{[^}]*position:\s*fixed;[^}]*inset-block-end:\s*0;/s);
  assert.match(app, /previewNotice\.hidden\s*=\s*!health\.is_pull_request;/);
});

test('public UI exposes discoverable keyboard shortcuts', async () => {
  const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

  assert.match(page, /aria-keyshortcuts="Control\+Enter Meta\+Enter"/);
  assert.match(page, /<span dir="ltr" class="shortcut-keys"><kbd>Ctrl<\/kbd>\/<kbd>⌘<\/kbd> \+ <kbd>Enter<\/kbd><\/span>/);
  assert.match(page, /data-i18n="shortcutHintAfter"> to ask\./);
  assert.doesNotMatch(page, /to focus this field/);
});

test('public UI offers an interface language selector covering all UI languages', async () => {
  const page = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const options = page.match(/<select id="ui-language"[^>]*>(?<options>[\s\S]*?)<\/select>/)?.groups.options || '';

  assert.match(options, /\bvalue="en" selected/);
  for (const value of ['en', 'zh-hans']) {
    assert.match(options, new RegExp(`value="${value}"`));
  }
});

test('send shortcut requires Ctrl or Command plus Enter outside composition', () => {
  assert.equal(isSendShortcut(keyEvent({ key: 'Enter', ctrlKey: true })), true);
  assert.equal(isSendShortcut(keyEvent({ key: 'Enter', metaKey: true })), true);
  assert.equal(isSendShortcut(keyEvent({ key: 'Enter' })), false);
  assert.equal(isSendShortcut(keyEvent({ key: 'Enter', ctrlKey: true, defaultPrevented: true })), false);
  assert.equal(isSendShortcut(keyEvent({ key: 'Enter', ctrlKey: true, shiftKey: true })), false);
  assert.equal(isSendShortcut(keyEvent({ key: 'Enter', ctrlKey: true, isComposing: true })), false);
});

function keyEvent(overrides = {}) {
  return {
    key: '',
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    defaultPrevented: false,
    target: null,
    ...overrides
  };
}
