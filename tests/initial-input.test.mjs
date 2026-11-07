/* Browser input can change while the initial JSON requests are still pending. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../assets/app.js', import.meta.url), 'utf8');
const initSource = source.match(/  async function initialize\([^]*?\n  }/)[0];

for (const query of ['typed before loading', '']) {
  test(`${query ? 'a typed query' : 'a cleared URL query'} survives the initial loading`, async () => {
    const search = { value: '' };
    const element = () => ({ textContent: '', hidden: false });
    const state = {};
    const elements = new Proxy({ search }, { get(target, key) { return target[key] ??= element(); } });
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const index = { generatedAt: '2026-01-01', chapters: [{ slug: 'a' }], chapterCount: 1, lineCount: 1 };
    const context = {
      state, elements, URLSearchParams, Date, Intl, Map, Promise,
      window: { location: { search: '?q=original&chapter=a' } },
      fetchJson: async () => { await pending; return index; },
      detectKorean: async () => false,
      savedMode: () => null,
      number: new Intl.NumberFormat(),
      chapterMeta: () => index.chapters[0],
      document: { querySelector: () => ({ checked: false }) },
      buildChapterMenu() {}, updateChapterControls() {}, updateSearchPlaceholder() {}, updateReadingMode() {}, bindEvents() {}, updateUrl() {},
      renderCurrentChapter: async () => {},
      console: { error(error) { throw error; } },
    };
    vm.createContext(context);
    vm.runInContext(initSource, context);
    const loading = context.initialize();
    assert.equal(search.value, 'original', 'the shared URL applies before loading');
    search.value = query;
    release();
    await loading;
    assert.equal(search.value, query);
    assert.equal(state.query, query);
    assert.equal(state.mode, 'english', 'without the Korean text the reader stays in English');
  });
}
