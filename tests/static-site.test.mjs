import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const index = JSON.parse(await read('data/index.json'));
const script = await read('assets/app.js');
const extract = name => script.match(new RegExp(`  (?:async )?function ${name}\\([^]*?\\n  }`))?.[0];

test('the page uses the shared theme and the reader controls', async () => {
  const html = await read('index.html');
  assert.match(html, /<title>Omniscient Reader’s Viewpoint · jehlp\.net<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/jehlp\.net\/omniscient-readers-viewpoint\/">/);
  assert.match(html, /site-theme\/v2\/base\.css/);
  assert.match(html, /site-theme\/v2\/reader\.css/);
  assert.match(html, /site-theme\/v2\/theme\.js/);
  assert.match(html, /<img class="site-mark" src="https:\/\/jehlp\.net\/site-theme\/v2\/marks\/omniscient-readers-viewpoint\.png" width="32" height="32" alt="">/);
  assert.match(html, /favicons\/omniscient-readers-viewpoint\.png/);
  for (const id of ['chapter-menu-button', 'previous-chapter', 'next-chapter', 'script-search', 'script-lines', 'english-mode', 'parallel-mode']) assert.match(html, new RegExp(`id="${id}"`));
  assert.match(html, /<body class="english-reader-mode"/);
  assert.match(html, /<nav class="view-switcher" id="view-switcher"[^>]*hidden>/);
});

test('the public data has every chapter once, in reading order, with contiguous paragraphs', async () => {
  const files = (await readdir(new URL('data/chapters/', root))).sort();
  assert.equal(index.chapterCount, 107);
  assert.equal(index.lineCount, 105312);
  assert.equal(index.edition, 42);
  assert.deepEqual(index.chapters.map(chapter => `${chapter.slug}.json`).sort(), files);
  assert.deepEqual(index.parts.flatMap(part => part.chapters), index.chapters.map(chapter => chapter.slug));
  assert.deepEqual(index.parts.map(part => part.label), ['Prologue', 'Novel', 'Author’s note', 'Epilogue', 'Author’s closing note']);
  let dividers = 0;
  for (const meta of index.chapters) {
    const chapter = JSON.parse(await read(`data/chapters/${meta.slug}.json`));
    assert.equal(chapter.lines.length, meta.lineCount, meta.slug);
    chapter.lines.forEach((line, position) => {
      assert.equal(line.i, position + 1);
      assert.equal(line.id, `${meta.slug}:${position + 1}`);
      assert.ok(line.en.trim(), line.id);
      assert.ok(line.t === undefined || line.t === 'system' || line.t === 'break', line.id);
      dividers += line.div ? 1 : 0;
    });
  }
  assert.equal(dividers, 417);
});

test('the Korean text stays out of the public site and the repository', async () => {
  assert.match(await read('.gitignore'), /^data\/source\/$/m);
  for (const file of ['data/index.json', 'index.html', 'assets/app.js', 'assets/styles.css']) assert.doesNotMatch(await read(file), /[가-힣]/, file);
  for (const meta of index.chapters) assert.doesNotMatch(await read(`data/chapters/${meta.slug}.json`), /[가-힣]/, meta.slug);
  const tracked = execFileSync('git', ['ls-files', 'data/source'], { cwd: new URL('.', root), encoding: 'utf8' });
  assert.equal(tracked, '');
});

test('each note is placed in its text and leaves out the private evidence', async () => {
  assert.deepEqual(Object.keys(index.notes).sort(), ['chapter-023-bloodshed-source-wording', 'chuunibyou', 'dokja-reader']);
  assert.doesNotMatch(JSON.stringify(index.notes), /evidence/);
  const found = [];
  for (const meta of index.chapters) {
    const chapter = JSON.parse(await read(`data/chapters/${meta.slug}.json`));
    for (const line of chapter.lines) {
      if (!line.note) continue;
      found.push(`${line.id} ${line.note.term}`);
      assert.ok(line.en.includes(line.note.text), line.id);
    }
  }
  assert.deepEqual(found, ['prologue:69 dokja-reader', 'chapter-001:669 chuunibyou', 'chapter-023:367 chapter-023-bloodshed-source-wording']);
});

test('the chapter menu lists every chapter once, in groups of at most ten', () => {
  const meta = slug => index.chapters.find(chapter => chapter.slug === slug);
  const context = { state: { index }, MENU_GROUP_SIZE: 10, chapterMeta: meta };
  vm.createContext(context);
  vm.runInContext(extract('menuGroups'), context);
  // The VM has its own Array, so copy its results before a strict comparison.
  const groups = Array.from(context.menuGroups());
  assert.deepEqual(groups.flatMap(group => Array.from(group.chapters)), index.chapters.map(chapter => chapter.slug));
  assert.ok(groups.every(group => group.chapters.length <= 10));
  assert.deepEqual(groups.map(group => group.label).slice(0, 3), ['Prologue', '1–10', '11–20']);
  assert.equal(groups.find(group => group.label === '91–99').chapters.length, 9);
});

test('chapter labels name the chapter without its internal ID', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(extract('chapterLabel'), context);
  const label = slug => context.chapterLabel(index.chapters.find(chapter => chapter.slug === slug));
  assert.equal(label('chapter-001'), '1. Paid Service Begins');
  assert.equal(label('epilogue-1'), 'Epilogue 1. The World of Zero');
  assert.equal(label('author-note-1'), 'Author’s note');
  for (const meta of index.chapters) assert.doesNotMatch(context.chapterLabel(meta), /chapter-\d|epilogue-\d|author-note/);
});

test('printed angle brackets stay in the text and in the search', () => {
  const appended = [];
  const element = { append(node) { appended.push(node.textContent); } };
  const context = { document: { createTextNode: textContent => ({ textContent }) } };
  vm.createContext(context);
  vm.runInContext(extract('appendHighlighted'), context);
  context.appendHighlighted(element, '<Star Stream>', []);
  assert.deepEqual(appended, ['<Star Stream>']);
  const search = {};
  vm.createContext(search);
  vm.runInContext(extract('searchableText'), search);
  assert.match(search.searchableText({ id: 'a:1', en: '<Star Stream>' }), /<star stream>/);
});
