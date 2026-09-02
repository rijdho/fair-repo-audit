// Dead code: exports nobody imports, i18n keys nobody asks for, CSS classes
// nothing ever wears.
//
// ── Why this is a test and not a one-off script ──
// The sweep is easy to run and easy to get WRONG, and wrong here is expensive
// in a specific way: it produces a long, confident list of things to delete.
// Run naively on 2026-09-02 it reported 91 dead i18n keys and 31 dead CSS
// classes. The real numbers were 0 and 4. Acting on either list would have
// deleted half the interface's colour, because `rating-excellent`,
// `cls-open`, `f-ink-F`, `chk-pass` and the rest are never written down: they
// are assembled at render time from a prefix and a value.
//
// So the knowledge that makes the sweep correct lives here, once, instead of
// being rediscovered by whoever next wonders whether a rule is still used:
//
//   1. A name built at runtime is used, even though it appears nowhere.
//      `class="rating-${rec.rating.toLowerCase()}"` uses five CSS classes.
//   2. A plural key is reached through its base: `tn('dups.title', n)` uses
//      `dups.title.one` and `dups.title.other`, neither of which is written.
//   3. `data-i18n-attr="title:ui.x;aria-label:ui.y"` packs two keys into one
//      attribute value, so a search for a quoted key finds neither.
//   4. `.woff2` in a font URL is not a class, and `#f7f6fb` is not an id.
//
// Every one of those was a false positive in the first attempt. A guard that
// cries wolf gets switched off, so the bar here is zero false positives
// against a tree known to be clean, which is also why each check asserts that
// it scanned a plausible amount before it asserts that it found nothing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { en } from '../src/i18n/en.js';

const root = new URL('../', import.meta.url);
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, root)), 'utf8');
const listJs = (dir) => readdirSync(fileURLToPath(new URL(dir, root)))
  .filter((f) => f.endsWith('.js')).map((f) => `${dir}${f}`);

const SRC_FILES = [...listJs('src/'), ...listJs('src/i18n/')];
const SOURCES = Object.fromEntries(SRC_FILES.map((f) => [f, read(f)]));
const HTML = read('index.html');
const TESTS = readdirSync(fileURLToPath(new URL('tests/', root)))
  .filter((f) => f.endsWith('.mjs')).map((f) => read(`tests/${f}`)).join('\n');
const SCRIPTS = readdirSync(fileURLToPath(new URL('scripts/', root)))
  .filter((f) => f.endsWith('.mjs')).map((f) => read(`scripts/${f}`)).join('\n');

/** Everything that could refer to a name: the app, the markup, the scorer. */
const APP = [...Object.values(SOURCES), HTML, SCRIPTS].join('\n');
/**
 * The same, minus the locale catalogues, for asking who USES a key.
 * Leaving them in makes the check vacuous: every key appears in its own
 * definition, so every key looks used and the test can never fail. That is
 * exactly how it passed a deliberately orphaned key on 2026-09-02, and it is
 * the mirror of the first mistake, which excluded src/i18n/ entirely and
 * reported 91 keys as dead. One file belongs in the corpus (index.js, which
 * names meta.title); three do not.
 */
const LOCALES = new Set(['src/i18n/en.js', 'src/i18n/es.js', 'src/i18n/de.js']);
const KEY_CONSUMERS = [...Object.entries(SOURCES).filter(([f]) => !LOCALES.has(f)).map(([, c]) => c),
                       HTML, SCRIPTS].join('\n');

/**
 * Prefixes the code assembles names from: `rating-${x}`, 'cls-' + x, `lede.${m}`.
 * Anything starting with one of these is reachable even though it is never written.
 */
function runtimePrefixes(code) {
  const out = new Set();
  for (const m of code.matchAll(/([\w.-]+?)\$\{/g)) {
    const tail = /([\w-]*[.-])$/.exec(m[1]);       // keep the trailing "rating-" / "lede."
    if (tail) out.add(tail[1]);
  }
  for (const m of code.matchAll(/['"`]([\w.-]+[.-])['"`]\s*\+/g)) out.add(m[1]);
  return [...out].filter((p) => p.length > 1);
}
const PREFIXES = runtimePrefixes(APP);

// ── Exports ──

test('no module exports a name nothing imports', () => {
  const exported = [];
  for (const [file, code] of Object.entries(SOURCES)) {
    for (const m of code.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)) exported.push([file, m[1]]);
    for (const m of code.matchAll(/export\s+(?:const|let)\s+(\w+)/g)) exported.push([file, m[1]]);
    for (const m of code.matchAll(/export\s*\{([^}]+)\}/g))
      for (const part of m[1].split(',')) exported.push([file, part.trim().split(/\s+as\s+/).pop()]);
  }
  assert.ok(exported.length > 30, `only ${exported.length} exports found: the scan is broken, not the tree`);

  const dead = exported.filter(([file, name]) => {
    const elsewhere = Object.entries(SOURCES).filter(([f]) => f !== file).map(([, c]) => c).join('\n')
      + `\n${HTML}\n${TESTS}\n${SCRIPTS}`;
    return !new RegExp(`\\b${name}\\b`).test(elsewhere);
  });
  assert.deepEqual(dead.map(([f, n]) => `${f}: ${n}`), [],
    'an export nothing imports reads as a supported entry point and is not one');
});

// ── i18n keys ──

test('every key in the catalogue is asked for somewhere', () => {
  // Bases passed to tn(), which reaches `${base}.one` and `${base}.other`.
  const plurals = new Set([...KEY_CONSUMERS.matchAll(/tn\(\s*['"`]([\w.]+)['"`]/g)].map((m) => m[1]));
  // Keys packed into a data-i18n-attr value: "title:ui.a;aria-label:ui.b".
  const packed = new Set();
  for (const m of HTML.matchAll(/data-i18n-attr="([^"]+)"/g))
    for (const pair of m[1].split(';')) {
      const key = pair.slice(pair.indexOf(':') + 1).trim();
      if (key) packed.add(key);
    }

  const asked = (key) =>
    KEY_CONSUMERS.includes(`'${key}'`) || KEY_CONSUMERS.includes(`"${key}"`)
    || KEY_CONSUMERS.includes(`\`${key}\``)
    || packed.has(key)
    || PREFIXES.some((p) => key.startsWith(p))
    || [...plurals].some((b) => key === `${b}.one` || key === `${b}.other`);

  const keys = Object.keys(en);
  assert.ok(keys.length > 200, `only ${keys.length} keys: the catalogue import is broken`);
  assert.deepEqual(keys.filter((k) => !asked(k)), [],
    'a key nothing asks for is either dead weight or a rename that lost its caller');
});

// ── CSS classes ──

test('every class the stylesheet dresses exists somewhere in the app', () => {
  const css = read('style.css');
  const classes = new Set();
  for (const m of css.matchAll(/\.(-?[a-zA-Z][\w-]*)\s*[{,:.\s>]/g)) classes.add(m[1]);
  // `.woff2` comes from a font URL, not from a selector.
  classes.delete('woff2');

  assert.ok(classes.size > 80, `only ${classes.size} classes parsed: the scan is broken`);
  const worn = (c) => APP.includes(c) || PREFIXES.some((p) => c.startsWith(p));
  assert.deepEqual([...classes].filter((c) => !worn(c)), [],
    'a class nothing wears is dead style: delete the rule, or find who was supposed to add it');
});

test('the runtime-prefix scan actually finds the prefixes this app builds', () => {
  // Without this, the two checks above pass by being blind rather than by
  // being right: every unknown name would look "reachable by prefix". These
  // six are the ones that made the naive sweep wrong, so they are the ones
  // worth pinning.
  for (const p of ['rating-', 'cls-', 'f-ink-', 'chk-', 'cx-', 'lede.']) {
    assert.ok(PREFIXES.includes(p), `the scan no longer sees the runtime prefix '${p}'`);
  }
  assert.ok(PREFIXES.length < 40, `${PREFIXES.length} prefixes is too many: the scan is matching noise and will hide real dead code`);
});
