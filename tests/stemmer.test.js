import test from 'node:test';
import assert from 'node:assert/strict';
import { stem } from '../src/retrieval/stemmer.js';
import { tokenize } from '../src/retrieval/text.js';

test('stemmer normalizes plurals', () => {
  assert.equal(stem('encodings'), stem('encoding'));
  assert.equal(stem('pages'), stem('page'));
  assert.equal(stem('documents'), stem('document'));
  assert.equal(stem('attributes'), stem('attribute'));
});

test('stemmer normalizes verb forms', () => {
  assert.equal(stem('declaring'), stem('declare'));
  assert.equal(stem('declared'), stem('declare'));
  assert.equal(stem('encoded'), stem('encode'));
  assert.equal(stem('encoding'), stem('encode'));
  assert.equal(stem('indicates'), stem('indicate'));
  assert.equal(stem('linked'), stem('link'));
});

test('stemmer normalizes derivational suffixes', () => {
  assert.equal(stem('characterization'), stem('characterize'));
  assert.equal(stem('normalization'), stem('normalize'));
  assert.equal(stem('accessibility'), 'access');
});

test('stemmer preserves short words', () => {
  assert.equal(stem('a'), 'a');
  assert.equal(stem('an'), 'an');
  assert.equal(stem('is'), 'is');
});

test('tokenize expands hyphenated tokens into stemmed parts', () => {
  const tokens = tokenize('right-to-left text direction');
  assert(tokens.includes(stem('right')));
  assert(tokens.includes(stem('left')));
  assert(tokens.includes(stem('text')));
  assert(tokens.includes(stem('direct')));
});

test('tokenize stems inflected forms to the same token', () => {
  const plural = tokenize('encodings');
  const singular = tokenize('encoding');
  assert.equal(plural[0], singular[0]);

  const verb = tokenize('declaring');
  const base = tokenize('declare');
  assert.equal(verb[0], base[0]);
});

test('tokenize preserves CJK tokens without stemming', () => {
  const tokens = tokenize('字符编码');
  assert.deepEqual(tokens, ['字', '符', '编', '码']);
});

test('tokenize does not merge Latin runs with adjacent CJK characters', () => {
  const tokens = tokenize('如何在HTML中设置内容的语言？');
  assert.deepEqual(tokens, ['如', '何', '在', 'html', '中', '设', '置', '内', '容', '的', '语', '言']);
  assert(!tokens.includes('html中设置内容的语言'));
});

test('tokenize drops first- and second-person filler words', () => {
  assert.deepEqual(tokenize('my site'), ['site']);
  assert.deepEqual(tokenize('our users keep asking us'), ['user', 'keep', 'ask']);
  assert.deepEqual(tokenize('your page'), []);
});
