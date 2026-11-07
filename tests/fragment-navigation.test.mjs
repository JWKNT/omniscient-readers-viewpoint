import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const extract = name => {
  const fn = source.match(new RegExp(`  (?:async )?function ${name}\\([^]*?\\n  }`))?.[0];
  assert.ok(fn, `${name} exists`);
  return fn;
};

test('URL fragments are IDs, and a malformed fragment is ignored', () => {
  const target = {};
  const context = { window: { location: { hash: '' } }, document: { getElementById: id => id === 'line-chapter-001-5' ? target : null } };
  vm.createContext(context);
  vm.runInContext(extract('fragmentTarget'), context);
  for (const hash of ['', '#[', '#%', '#missing']) {
    context.window.location.hash = hash;
    assert.equal(context.fragmentTarget(), null, hash);
  }
  for (const hash of ['#line-chapter-001-5', '#line%2Dchapter%2D001%2D5']) {
    context.window.location.hash = hash;
    assert.equal(context.fragmentTarget(), target, hash);
  }
  assert.doesNotMatch(source, /querySelector\(window\.location\.hash\)/);
});

test('URL updates keep a current paragraph link and remove a previous chapter fragment', () => {
  const state = { chapter: 'chapter-001', query: '', scope: 'chapter', mode: 'english', hasKorean: false };
  let replaced;
  const context = { state, URL, window: { location: { href: 'https://example.test/?chapter=chapter-001#line-chapter-001-5' } }, history: { replaceState: (_state, _title, href) => { replaced = href; } } };
  vm.createContext(context);
  vm.runInContext(extract('updateUrl'), context);
  context.updateUrl();
  assert.equal(new URL(replaced, 'https://example.test/').hash, '#line-chapter-001-5');
  state.chapter = 'chapter-002';
  context.updateUrl();
  assert.equal(new URL(replaced, 'https://example.test/').hash, '');
  assert.doesNotMatch(replaced, /mode=/, 'the mode parameter needs the side-by-side view');
  state.hasKorean = true;
  context.updateUrl();
  assert.match(replaced, /mode=en/);
});
