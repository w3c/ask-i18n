import test from 'node:test';
import assert from 'node:assert/strict';
import { mountPath, normalizeBasePath } from '../src/base-path.js';

test('normalizeBasePath accepts common mount path spellings', () => {
  assert.equal(normalizeBasePath(''), '');
  assert.equal(normalizeBasePath('/'), '');
  assert.equal(normalizeBasePath('ask-i18n'), '/ask-i18n');
  assert.equal(normalizeBasePath('/ask-i18n/'), '/ask-i18n');
  assert.equal(normalizeBasePath('  /w3c//ask-i18n//  '), '/w3c/ask-i18n');
});

test('normalizeBasePath rejects a query string or fragment', () => {
  assert.throws(() => normalizeBasePath('/ask-i18n?x=1'), /BASE_PATH/);
  assert.throws(() => normalizeBasePath('/ask-i18n#top'), /BASE_PATH/);
});

test('mountPath strips the configured prefix', () => {
  assert.deepEqual(mountPath('/', '/ask-i18n'), { pathname: '/', redirectTo: '' });
  assert.deepEqual(mountPath('/ask-i18n/', '/ask-i18n'), { pathname: '/', redirectTo: '' });
  assert.deepEqual(mountPath('/ask-i18n/app.js', '/ask-i18n'), { pathname: '/app.js', redirectTo: '' });
  assert.deepEqual(
    mountPath('/ask-i18n/api/v1/health', '/ask-i18n'),
    { pathname: '/api/v1/health', redirectTo: '' }
  );
});

test('mountPath redirects the bare mount point so relative URLs resolve', () => {
  assert.deepEqual(
    mountPath('/ask-i18n', '/ask-i18n'),
    { pathname: '/', redirectTo: '/ask-i18n/' }
  );
});

test('mountPath keeps working when a proxy already strips the prefix', () => {
  assert.deepEqual(mountPath('/api/health', '/ask-i18n'), { pathname: '/api/health', redirectTo: '' });
  assert.deepEqual(mountPath('/', '/ask-i18n'), { pathname: '/', redirectTo: '' });
});

test('mountPath does not strip a path that only shares a prefix', () => {
  assert.deepEqual(
    mountPath('/ask-i18n-drafts/app.js', '/ask-i18n'),
    { pathname: '/ask-i18n-drafts/app.js', redirectTo: '' }
  );
});

test('mountPath is a no-op without a configured base path', () => {
  assert.deepEqual(mountPath('/api/health', ''), { pathname: '/api/health', redirectTo: '' });
  assert.deepEqual(mountPath('/api/health'), { pathname: '/api/health', redirectTo: '' });
});
