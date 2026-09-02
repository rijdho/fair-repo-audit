// Asset versioning. There is no bundler here, so nothing content-hashes the
// files: the only thing that reaches a browser holding an old copy is the ?v=
// on the URL. The failure is silent and total. A browser can serve a cached
// module against a fresh one that imports a symbol the cached copy does not
// export, and the whole graph aborts with no visible error: a blank tool that
// looks deployed. orcid-finder shipped exactly that in September 2026, and this
// repository had drifted the same way, running four versions at once (the
// stylesheet at 31, the entry at 30, the modules at 28, the locales unversioned).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), 'utf8');
const jsIn = (dir) =>
  readdirSync(fileURLToPath(new URL(dir, root))).filter((f) => f.endsWith('.js')).map((f) => `${dir}${f}`);

const srcFiles = [...jsIn('src/'), ...jsIn('src/i18n/')];

/** Every relative import in the source tree, with the version it carries. */
function imports() {
  const found = [];
  for (const file of srcFiles)
    for (const m of read(file).matchAll(/(?:^|\n)\s*(?:import|export)[^\n]*?from\s+'(\.[^']+)'/g))
      found.push({ file, specifier: m[1], version: /\?v=(\d+)$/.exec(m[1])?.[1] ?? null });
  return found;
}

test('the source tree actually has relative imports to check', () => {
  assert.ok(imports().length >= 10, 'the scan found suspiciously few imports');
});

test('every relative import carries a version', () => {
  for (const i of imports())
    assert.ok(i.version, `${i.file} imports '${i.specifier}' with no ?v=, so a cached copy can be served`);
});

test('every version in the app is the same number', () => {
  const html = read('index.html');
  const style = /style\.css\?v=(\d+)/.exec(html)?.[1];
  const entry = /src\/app\.js\?v=(\d+)/.exec(html)?.[1];
  assert.ok(style, 'index.html does not version the stylesheet');
  assert.ok(entry, 'index.html does not version the entry module');
  const versions = new Set([style, entry, ...imports().map((i) => i.version)]);
  assert.equal(
    versions.size, 1,
    `versions disagree (${[...versions].sort().join(', ')}): bump them together or a mixed set of files is served`,
  );
});
