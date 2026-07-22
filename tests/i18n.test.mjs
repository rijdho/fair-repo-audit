// Locale parity tests — these are the contract that keeps a translation from
// silently degrading the UI. Run with:  node --test tests/
//
// A missing key is survivable (it falls back to English). A key whose
// placeholders don't match, or whose structural markers were dropped in
// translation, is not: it renders as a literal "{count}" or breaks a caller
// that parses the string. Those are the cases worth failing a build over.

import test from 'node:test';
import assert from 'node:assert/strict';
import { LOCALES, LANGS, t, tn, setLang, resolveLang, missingKeys, has } from '../src/i18n/index.js';

const CODES = Object.keys(LOCALES);
const EN = LOCALES.en;
const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test.afterEach(() => setLang('en'));

test('every declared language has a catalogue, and vice versa', () => {
  assert.deepEqual(LANGS.map(l => l.code).sort(), CODES.sort());
  for (const { code, label } of LANGS) {
    assert.ok(label && label.trim(), `${code} needs a display label`);
  }
});

test('every locale covers every English key', () => {
  // Aggregate across locales before asserting. A per-locale assert would abort on
  // the first gap and hide the state of the rest — unhelpful when several
  // translations are in flight and you want to know which ones are actually done.
  const gaps = CODES
    .map(code => [code, missingKeys(code)])
    .filter(([, missing]) => missing.length > 0);
  const report = gaps
    .map(([code, missing]) =>
      `${code}: ${missing.length} missing (${missing.slice(0, 6).join(', ')}${missing.length > 6 ? '…' : ''})`)
    .join('\n  ');
  assert.equal(gaps.length, 0, `incomplete locale(s):\n  ${report}`);
});

test('no locale defines keys English does not have (catches typo\'d keys)', () => {
  for (const code of CODES) {
    const extra = Object.keys(LOCALES[code]).filter(k => EN[k] == null);
    assert.equal(extra.length, 0, `${code} has orphan key(s): ${extra.join(', ')}`);
  }
});

test('placeholders survive translation identically', () => {
  for (const code of CODES) {
    for (const [key, value] of Object.entries(LOCALES[code])) {
      if (EN[key] == null) continue;
      assert.deepEqual(placeholders(value), placeholders(EN[key]),
        `${code} / ${key}: placeholder set differs from English`);
    }
  }
});

test('embedded HTML survives translation tag-for-tag', () => {
  // 11 strings carry markup (links in the footer and lede, <b> in verdicts,
  // <span class> legends). A translator dropping or mangling a tag produces
  // visible garbage or a dead link, which no other check would catch.
  const tags = (s) => (String(s).match(/<[^>]+>/g) || []).map(x => x.replace(/\s+/g, ' ')).sort();
  for (const code of CODES) {
    for (const [key, value] of Object.entries(LOCALES[code])) {
      if (EN[key] == null) continue;
      assert.deepEqual(tags(value), tags(EN[key]), `${code} / ${key}: HTML tags differ from English`);
    }
  }
});

test('URLs are never translated', () => {
  const urls = (s) => (String(s).match(/https?:\/\/[^\s"'<>)]+/g) || []).sort();
  for (const code of CODES) {
    for (const [key, value] of Object.entries(LOCALES[code])) {
      if (EN[key] == null) continue;
      assert.deepEqual(urls(value), urls(EN[key]), `${code} / ${key}: URLs differ from English`);
    }
  }
});

test('no locale left an untranslated value identical to a long English string', { skip: CODES.length < 2 }, () => {
  // Short strings legitimately match across languages (DOI, Format, Version…),
  // so only flag substantial prose, where identity means "not yet translated".
  for (const code of CODES.filter(c => c !== 'en')) {
    const untouched = Object.entries(LOCALES[code])
      .filter(([k, v]) => typeof v === 'string' && v.length > 60 && v === EN[k])
      .map(([k]) => k);
    assert.equal(untouched.length, 0,
      `${code} has ${untouched.length} long value(s) identical to English: ${untouched.slice(0, 8).join(', ')}`);
  }
});

test('French keeps its narrow no-break space before : ; ? !', () => {
  // French typography puts a no-break space before those four marks. It is easy to
  // destroy with a careless find-and-replace and invisible in a diff, so it is
  // pinned here. Tags, attributes and URLs are stripped first — a colon inside
  // style="color:…" or an HTTP header literal is not French punctuation.
  const NBSP = /[  ]/;
  const offenders = [];
  for (const [key, value] of Object.entries(LOCALES.fr)) {
    const bare = String(value)
      .replace(/<[^>]*>/g, ' ')
      .replace(/https?:\/\/\S+/g, ' ');
    for (const m of bare.matchAll(/(.)([;?!:])/g)) {
      if (m[1] === ' ' && !NBSP.test(m[1])) offenders.push(`${key} → "…${m[0]}…"`);
    }
  }
  assert.deepEqual(offenders, [], `plain space before French punctuation:\n  ${offenders.join('\n  ')}`);
});

test('principle glosses keep the "Name — explanation" shape app.js splits on', () => {
  for (const code of CODES) {
    for (const letter of ['F', 'A', 'I', 'R']) {
      const key = `principle.${letter}.gloss`;
      const value = LOCALES[code][key];
      if (value == null) continue;
      assert.ok(value.includes(' — '),
        `${code} / ${key} must contain " — " — app.js splits on it to peel off the principle name`);
      assert.ok(value.split(' — ')[1]?.trim(),
        `${code} / ${key} has nothing after the em dash`);
    }
  }
});

test('plural keys come in complete one/other pairs', () => {
  for (const code of CODES) {
    for (const key of Object.keys(LOCALES[code])) {
      if (!key.endsWith('.one')) continue;
      const base = key.slice(0, -4);
      assert.ok(LOCALES[code][`${base}.other`] != null,
        `${code} / ${base} has .one but no .other`);
    }
  }
});

test('t() falls back to English, then to the key itself', () => {
  setLang('es');
  const key = Object.keys(EN)[0];
  assert.equal(typeof t(key), 'string');
  assert.equal(t('no.such.key.exists'), 'no.such.key.exists');
  assert.equal(has('no.such.key.exists'), false);
});

test('t() interpolates named placeholders and leaves unknown ones intact', () => {
  // Exercised through the public API rather than a fixture catalogue, so this
  // also pins the {placeholder} syntax the translators are working against.
  const sample = Object.entries(EN).find(([, v]) => /\{\w+\}/.test(v));
  if (!sample) return;
  const [key, value] = sample;
  const name = placeholders(value)[0];
  const out = t(key, { [name]: 'XYZZY' });
  assert.ok(out.includes('XYZZY'), `${key} did not interpolate {${name}}`);
  assert.ok(!out.includes(`{${name}}`), `${key} left {${name}} unsubstituted`);
});

test('tn() selects a plural form and injects {count}', () => {
  for (const code of CODES) {
    setLang(code);
    const base = Object.keys(LOCALES[code]).find(k => k.endsWith('.one'))?.slice(0, -4);
    if (!base) continue;
    for (const count of [0, 1, 5]) {
      const out = tn(base, count);
      assert.equal(typeof out, 'string');
      assert.ok(!out.includes('{count}'), `${code} / ${base} left {count} unsubstituted at n=${count}`);
    }
  }
});

test('resolveLang: explicit code wins, then browser, then English', () => {
  assert.equal(resolveLang('de', ['fr-FR']), 'de');
  assert.equal(resolveLang(null, ['fr-FR', 'en']), 'fr');
  assert.equal(resolveLang(null, ['pt-BR']), 'en');
  assert.equal(resolveLang('klingon', ['es-MX']), 'es');
  assert.equal(resolveLang(undefined, []), 'en');
});
