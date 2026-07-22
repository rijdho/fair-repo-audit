// Minimal i18n — no dependencies, no build step, matching the rest of the app.
//
// Design notes:
//  · Flat, dotted keys in a single object per locale. Easy to diff, easy to lint
//    for gaps (see `missingKeys` below), and cheap to look up.
//  · `t()` is DOM-free so the FAIR engine and the Node test runner can both use it.
//  · English is the fallback for any key a locale hasn't translated yet, so a
//    partial locale degrades to mixed language rather than to blank UI.
//  · Schema-literal terms (rightsURI, subjectScheme, dc:title, SPDX ids, DCMI
//    types) are NEVER keys here — they are data the user types into their
//    metadata editor, and they stay in English in every locale.

import { en } from './en.js';
import { es } from './es.js';
import { fr } from './fr.js';
import { de } from './de.js';

export const LOCALES = { en, es, fr, de };

// `label` is deliberately the endonym — a reader looking for their own language
// scans for "Deutsch", not for "German".
export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'fr', label: 'Français' },
  { code: 'de', label: 'Deutsch' },
];

export const DEFAULT_LANG = 'en';
const isSupported = (code) => Object.prototype.hasOwnProperty.call(LOCALES, code);

// The selected language lives on a global slot rather than in a module-local
// `let`. ES modules are cached per resolved URL, so importing this file as
// './i18n/index.js' from one module and './i18n/index.js?v=24' from another
// yields TWO instances with independent state — the engine would keep rendering
// English while the UI switched to German. Sharing through globalThis makes the
// language a single fact no matter how the graph resolves.
const state = (globalThis.__fraI18n ??= { lang: DEFAULT_LANG });

export const getLang = () => state.lang;

export function setLang(code) {
  if (isSupported(code)) state.lang = code;
  return state.lang;
}

/** Resolve a preferred language from an explicit code, then the browser, then English. */
export function resolveLang(preferred, navigatorLangs = []) {
  if (preferred && isSupported(preferred)) return preferred;
  for (const raw of navigatorLangs) {
    const base = String(raw).toLowerCase().split('-')[0];
    if (isSupported(base)) return base;
  }
  return DEFAULT_LANG;
}

// {placeholder} substitution. Values are inserted verbatim: callers that build
// HTML are responsible for escaping, exactly as they were before i18n existed.
function interpolate(str, vars) {
  if (!vars) return str;
  return String(str).replace(/\{(\w+)\}/g, (whole, name) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole);
}

/**
 * Translate `key`. Falls back to English, then to the key itself — a missing
 * string shows up as a visible `check.F1.name` rather than an empty element,
 * which is what you want to catch it in review.
 */
export function t(key, vars) {
  const table = LOCALES[state.lang] || LOCALES[DEFAULT_LANG];
  const str = table[key] ?? LOCALES[DEFAULT_LANG][key];
  return str == null ? key : interpolate(str, vars);
}

/**
 * Does a key exist in any catalogue? Callers that branch on presence
 * (`GLOSS[k] ? … : ''`) need this, because t() deliberately returns the key
 * itself when it misses, which would otherwise read as truthy.
 */
export function has(key) {
  const table = LOCALES[state.lang] || LOCALES[DEFAULT_LANG];
  return table[key] != null || LOCALES[DEFAULT_LANG][key] != null;
}

/**
 * Plural-aware lookup: expects `<key>.one` and `<key>.other`. The four locales
 * here all share the one/other split, so Intl.PluralRules is overkill — but
 * routing through it keeps the door open for locales that need more forms.
 */
export function tn(key, count, vars) {
  const rules = new Intl.PluralRules(state.lang);
  const form = rules.select(Number(count) || 0);
  const table = LOCALES[state.lang] || LOCALES[DEFAULT_LANG];
  const candidate = `${key}.${form}`;
  const chosen = (table[candidate] ?? LOCALES[DEFAULT_LANG][candidate]) != null
    ? candidate
    : `${key}.other`;
  return t(chosen, { count, ...vars });
}

/** Locale-aware number formatting — 1,234 in en, 1.234 in es/de, 1 234 in fr. */
export const n = (value) => new Intl.NumberFormat(state.lang).format(value);

/**
 * Apply the current locale to a DOM tree.
 *   <h1 data-i18n="ui.title">           → textContent
 *   <input data-i18n-attr="placeholder:ui.dc.ph;aria-label:ui.dc.aria">
 *   <p data-i18n-html="ui.lede">        → innerHTML, for strings carrying <a>/<b>
 */
export function applyDom(root = document) {
  for (const node of root.querySelectorAll('[data-i18n]')) {
    node.textContent = t(node.dataset.i18n);
  }
  for (const node of root.querySelectorAll('[data-i18n-html]')) {
    node.innerHTML = t(node.dataset.i18nHtml);
  }
  for (const node of root.querySelectorAll('[data-i18n-attr]')) {
    for (const pair of node.dataset.i18nAttr.split(';')) {
      const idx = pair.indexOf(':');
      if (idx < 0) continue;
      const attr = pair.slice(0, idx).trim();
      const key = pair.slice(idx + 1).trim();
      if (attr && key) node.setAttribute(attr, t(key));
    }
  }
  if (root === document || root === document.documentElement) {
    document.documentElement.lang = state.lang;
    const title = LOCALES[state.lang]?.['meta.title'] ?? LOCALES[DEFAULT_LANG]['meta.title'];
    if (title) document.title = title;
  }
}

/** Keys present in English but absent from `code` — used by the locale-parity test. */
export function missingKeys(code) {
  const table = LOCALES[code];
  if (!table) return Object.keys(LOCALES[DEFAULT_LANG]);
  return Object.keys(LOCALES[DEFAULT_LANG]).filter(k => table[k] == null);
}
