/* Run the production async functions with controlled network completion.
   This covers state and DOM behavior. Browser layout is reviewed separately. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
function extract(name) {
  const value = source.match(new RegExp(`  (?:async )?function ${name}\\([^]*?\\n  }`))?.[0];
  assert.ok(value, `production ${name} function exists`);
  return value;
}
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

function cacheHarness(hasKorean = false) {
  const requests = [];
  const context = { Promise, encodeURIComponent, state: { cache: new Map(), hasKorean, index: { generatedAt: 'version' } }, fetchJson: path => { const r = deferred(); requests.push({ ...r, path }); return r.promise; } };
  vm.createContext(context);
  vm.runInContext(extract('loadChapter'), context);
  return { ...context, requests };
}

test('concurrent chapter loads share one request and successful content stays cached', async () => {
  const h = cacheHarness();
  const first = h.loadChapter('one'), second = h.loadChapter('one');
  assert.equal(h.requests.length, 1);
  assert.match(h.requests[0].path, /^data\/chapters\/one\.json\?v=version$/);
  const data = { slug: 'one', lines: [] };
  h.requests[0].resolve(data);
  assert.equal(await first, data);
  assert.equal(await second, data);
  assert.equal(await h.loadChapter('one'), data);
  assert.equal(h.requests.length, 1);
});

test('a failed chapter load is evicted so the next interaction can retry', async () => {
  const h = cacheHarness();
  const first = h.loadChapter('one');
  h.requests[0].reject(new Error('Temporary network failure'));
  await assert.rejects(first, /Temporary network failure/);
  assert.equal(h.state.cache.has('one'), false);
  const retry = h.loadChapter('one');
  assert.equal(h.requests.length, 2);
  const data = { slug: 'one', lines: [] };
  h.requests[1].resolve(data);
  assert.equal(await retry, data);
});

test('the local Korean rows join the English by position', async () => {
  const h = cacheHarness(true);
  const load = h.loadChapter('one');
  assert.deepEqual(h.requests.map(request => request.path), ['data/chapters/one.json?v=version', 'data/source/one.json?v=version']);
  h.requests[0].resolve({ slug: 'one', lines: [{ en: 'first' }, { en: 'second' }] });
  h.requests[1].resolve({ slug: 'one', ko: ['A', 'B'] });
  assert.deepEqual((await load).lines.map(line => line.ko), ['A', 'B']);
});

test('the reader never asks for the Korean text on the public site', async () => {
  const requests = [];
  const context = { window: { location: { hostname: 'jehlp.net' } }, fetch: async path => { requests.push(path); return { ok: true }; } };
  vm.createContext(context);
  vm.runInContext(extract('detectKorean'), context);
  assert.equal(await context.detectKorean(), false);
  assert.deepEqual(requests, []);
  context.window.location.hostname = '127.0.0.1';
  assert.equal(await context.detectKorean(), true);
  assert.deepEqual(requests, ['data/source/index.json']);
  context.fetch = async () => ({ ok: false });
  assert.equal(await context.detectKorean(), false);
});

function renderHarness() {
  const requests = new Map(), parts = { h2: { textContent: 'No matching paragraphs' }, p: { textContent: 'Try a broader search or another chapter.' } };
  const element = () => ({ hidden: false, textContent: '', value: '', children: [], replaceChildren(...children) { this.children = children; } });
  const elements = Object.fromEntries(['resultStatus', 'chapterTitle', 'chapterProgress', 'scriptLines', 'emptyState', 'clearSearch', 'search'].map(key => [key, element()]));
  elements.emptyState.querySelector = name => parts[name];
  const meta = id => ({ slug: id, title: id, lineCount: 1 });
  const state = { chapter: 'a', searchToken: 0, scope: 'chapter', query: '', index: { chapters: [meta('a'), meta('b')] } };
  const context = {
    state, elements, Promise, MAX_RESULTS: 500, number: new Intl.NumberFormat('en-US'),
    chapterMeta: (id = state.chapter) => meta(id), chapterLabel: chapter => chapter.title,
    queryTerms: () => state.query ? [state.query] : [], matches: () => true,
    loadChapter: id => { const r = deferred(); requests.set(id, r); return r.promise; },
    makeLineArticle: line => line, makeDivider: () => 'divider',
    updateChapterControls() {}, fragmentTarget: () => null, console: { error() {} },
  };
  vm.createContext(context);
  vm.runInContext(extract('renderCurrentChapter'), context);
  return { ...context, requests, parts };
}

test('a stale chapter failure cannot clear a more recently loaded chapter', async () => {
  const h = renderHarness();
  const first = h.renderCurrentChapter();
  h.state.chapter = 'b';
  const latest = h.renderCurrentChapter();
  const line = { id: 'b:1', en: 'Current chapter' };
  h.requests.get('b').resolve({ slug: 'b', lines: [line] });
  await latest;
  h.requests.get('a').reject(new Error('Old interrupted request'));
  await first;
  assert.deepEqual(h.elements.scriptLines.children, [line]);
  assert.equal(h.elements.emptyState.hidden, true);
});

test('a successful empty search restores its normal message after a load failure', async () => {
  const h = renderHarness();
  const first = h.renderCurrentChapter();
  h.requests.get('a').reject(new Error('Temporary failure'));
  await first;
  assert.equal(h.parts.h2.textContent, 'The text could not be loaded');
  h.state.query = 'unmatched';
  const retry = h.renderCurrentChapter();
  h.requests.get('a').resolve({ slug: 'a', lines: [] });
  await retry;
  assert.equal(h.elements.emptyState.hidden, false);
  assert.equal(h.parts.h2.textContent, 'No matching paragraphs');
});

test('a long chapter shows in full, and only search results have a limit', async () => {
  const h = renderHarness();
  const lines = Array.from({ length: 600 }, (_, position) => ({ id: `a:${position + 1}`, en: 'Text' }));
  const full = h.renderCurrentChapter();
  h.requests.get('a').resolve({ slug: 'a', lines });
  await full;
  assert.equal(h.elements.scriptLines.children.length, 600);
  h.state.query = 'text';
  const search = h.renderCurrentChapter();
  h.requests.get('a').resolve({ slug: 'a', lines });
  await search;
  assert.equal(h.elements.scriptLines.children.length, 500);
  assert.equal(h.elements.resultStatus.textContent, 'Showing first 500 of 600');
});

test('scene dividers show in the full text and not between search results', async () => {
  const h = renderHarness();
  const lines = [{ id: 'a:1', en: 'One' }, { id: 'a:2', div: 1, en: 'Two' }];
  const full = h.renderCurrentChapter();
  h.requests.get('a').resolve({ slug: 'a', lines });
  await full;
  assert.deepEqual(h.elements.scriptLines.children, [lines[0], 'divider', lines[1]]);
  h.state.query = 'two';
  const search = h.renderCurrentChapter();
  h.requests.get('a').resolve({ slug: 'a', lines });
  await search;
  assert.deepEqual(h.elements.scriptLines.children, lines);
});
