import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const home = '<a class="site-home" href="https://jehlp.net/" aria-label="Home — jehlp.net" title="Home — jehlp.net"><span aria-hidden="true">✳</span></a>';

test('index.html keeps one native Home link beside its theme control', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const header = html.match(/<header\b[^>]*>[\s\S]*?<\/header>/)?.[0];
  assert.ok(header?.includes(home), 'Home stays in the header without JavaScript');
  const pair = header.match(/<span class="site-utility-pair">[\s\S]*?<\/button>\s*<\/span>/)?.[0];
  assert.ok(pair?.includes(home), 'Home and theme share one utility group');
  assert.match(pair.slice(pair.indexOf(home) + home.length), /^\s*<button\b[^>]*data-theme-toggle\b/);
  assert.equal(html.split(home).length - 1, 1);
  assert.doesNotMatch(html, /site-home-dock|site-home-clearance/);
});
