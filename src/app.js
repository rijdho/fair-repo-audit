import { assessDataCiteWork, assessOaiRecord, aggregateAssessments, generateRecommendations, generateTextReport } from './fair.js?v=24';
import { fetchWorks, fetchAllWorks, fetchYearHistogram, suggestClients } from './datacite.js?v=24';
import { dataCiteConcepts, oaiConcepts, GLOSS, PRINCIPLE_GLOSS } from './concepts.js?v=24';
import { renderHeatmap, renderTemporal, renderRadar, renderYearPicker } from './charts.js?v=24';
import { temporalSeries, findDuplicates } from './analysis.js?v=24';
import * as oai from './oaipmh.js?v=24';
import { t, tn, n, applyDom, setLang, resolveLang, LANGS } from './i18n/index.js?v=24';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Floating tooltip shared by the interactive charts
const tooltip = el('div', 'chart-tip');
tooltip.style.display = 'none';
document.body.appendChild(tooltip);
function tip(e, text) {
  if (!e) { tooltip.style.display = 'none'; return; }
  tooltip.textContent = text;
  tooltip.style.display = 'block';
  const r = tooltip.getBoundingClientRect();
  let x = e.clientX + 14, y = e.clientY + 14;
  if (x + r.width > innerWidth) x = e.clientX - r.width - 14;
  if (y + r.height > innerHeight) y = e.clientY - r.height - 14;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';
}

// Reusable three-level legend (completeness / quality) — the thresholds are
// numerals in every locale, so nothing here needs translating.
const LEGEND = '<span class="lgnd"><i class="sw lvl-hi"></i>≥75% <i class="sw lvl-mid"></i>25–75% <i class="sw lvl-lo"></i>&lt;25%</span>';
// Full / Partial / Not met swatches — the words DO travel, the classes don't.
const scoreLegend = () => `<span class="lgnd"><i class="sw hm-pass"></i>${t('level.full')} <i class="sw hm-partial"></i>${t('level.partial')} <i class="sw hm-fail"></i>${t('level.notMet')}</span>`;
const lvlOf = (pct) => pct >= 75 ? 'hi' : pct >= 25 ? 'mid' : 'lo';
const shortId = (id) => String(id).replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^oai:/, '').slice(0, 32);
// Shareable deep-links: reflect the current query in the URL so a result can be bookmarked/shared.
const setUrl = (params) => { try { history.replaceState(null, '', location.pathname + '?' + new URLSearchParams(params).toString()); } catch { /* ignore */ } };

const seriesColors = () => { const cs = getComputedStyle(document.documentElement); return { a: cs.getPropertyValue('--f-F').trim(), b: cs.getPropertyValue('--f-A').trim() }; };

// A labelled % meter (name · level-coloured bar · value) with an explanatory tooltip
function meterRow(name, pct, help) {
  const row = el('div', 'concept-row');
  row.innerHTML = `<span class="concept-name">${esc(name)}</span>
    <div class="bar"><div class="bar-fill lvl-${lvlOf(pct)}" style="width:${Math.max(pct, 1.5)}%"></div></div>
    <span class="concept-val">${pct}%</span>`;
  row.addEventListener('mouseenter', e => tip(e, `${name} — ${pct}%\n${help}`));
  row.addEventListener('mouseleave', () => tip(null));
  return row;
}

// Reusability synthesis card — the "can others reuse this?" story (repo-metaudits framing)
function reusabilityCard(a) {
  const meters = [];
  if (a.licenseProfile) {
    const lp = a.licenseProfile;
    meters.push([t('reuse.openLicence'), lp.total ? Math.round((lp.classes.open || 0) / lp.total * 100) : 0, t('reuse.openLicence.help')]);
    meters.push([t('reuse.machineReadable'), Math.round(lp.machineReadablePct), t('reuse.machineReadable.help')]);
    meters.push([t('reuse.vocabAnchored'), Math.round(lp.spdxDeclaredPct), t('reuse.vocabAnchored.help')]);
  } else if (a.license) {
    meters.push([t('reuse.openLicence'), a.license.class === 'open' ? 100 : 0, t('reuse.openLicence.help1')]);
    meters.push([t('reuse.machineReadable'), a.license.machineReadable ? 100 : 0, t('reuse.machineReadable.help1')]);
    meters.push([t('reuse.vocabAnchored'), a.license.spdxDeclared ? 100 : 0, t('reuse.vocabAnchored.help1')]);
  }
  const cp = a.connectivityProfile;
  if (cp) {
    const pct = (o) => o.total ? Math.round(o.identified / o.total * 100) : 0;
    meters.push([t('reuse.creatorsOrcid'), pct(cp.creators), t('reuse.creatorsOrcid.help')]);
    if (cp.affiliations.total) meters.push([t('reuse.affiliationsRor'), pct(cp.affiliations), t('reuse.affiliationsRor.help')]);
    if (cp.funders.total) meters.push([t('reuse.fundingIdentified'), pct(cp.funders), t('reuse.fundingIdentified.help')]);
  } else if (a.connectivity) {
    const c = a.connectivity, pc = (tot, i) => tot ? Math.round(i / tot * 100) : 0;
    meters.push([t('reuse.creatorsOrcid'), pc(c.creators, c.creatorsId), t('reuse.creatorsOrcid.help1')]);
    if (c.affiliations) meters.push([t('reuse.affiliationsRor'), pc(c.affiliations, c.affiliationsId), t('reuse.affiliationsRor.help1')]);
  }
  // rawMean is the aggregate's unrounded mean; single records carry it in score directly.
  const r13 = a.principles[3].checks.find(c => c.id === 'R1.3');
  if (r13) meters.push([t('reuse.communityStandards'), Math.round((r13.rawMean ?? r13.score) * 100), t('reuse.communityStandards.help')]);
  if (!meters.length) return null;

  const card = el('div', 'card');
  card.innerHTML = `<h3>${esc(t('reuse.title'))} ${LEGEND}</h3>
    <p class="muted" style="margin-top:-6px">${esc(t('reuse.desc'))}</p>`;
  for (const [name, p, h] of meters) card.appendChild(meterRow(name, p, h));
  const weakest = meters.reduce((m, x) => x[1] < m[1] ? x : m);
  const verdict = el('div', 'verdict');
  verdict.innerHTML = meters.every(m => m[1] >= 75)
    ? t('reuse.verdict.strong')
    : t('reuse.verdict.gap', { name: esc(weakest[0]), pct: weakest[1], help: esc(weakest[2]) });
  card.appendChild(verdict);
  return card;
}

let lastAggregate = null, lastAssessments = [], lastMeta = {}, lastConcepts = null, lastTemporal = null, lastDuplicates = null;
// The two sides of the last Compare run, so a language switch can re-render it.
let lastCompare = null;

// ── Tabs (rail nav) ──
const updateCmdTitle = () => { const a = $('.tab.active .nav-lbl'); if (a) $('#cmd-title').textContent = a.textContent; };
$$('.tab').forEach(tab => tab.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === tab));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === `panel-${tab.dataset.mode}`));
  // Results belong to the analysis that produced them — clear them when switching tabs.
  const r = $('#results'); r.innerHTML = ''; r.style.display = 'none';
  status('');
  updateCmdTitle();
  $('#app').classList.remove('rail-open'); // mobile: picking a source closes the drawer
}));

// ── Mobile rail drawer ──
$('#menu').addEventListener('click', () => $('#app').classList.add('rail-open'));
$('#rail-backdrop').addEventListener('click', () => $('#app').classList.remove('rail-open'));

// ── Theme ──
const themeBtn = $('#theme');
const SUN_SVG = '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>';
const MOON_SVG = '<svg viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const setTheme = (mode) => { document.documentElement.dataset.theme = mode; localStorage.setItem('fra-theme', mode); themeBtn.innerHTML = mode === 'dark' ? SUN_SVG : MOON_SVG; };
setTheme(localStorage.getItem('fra-theme')
  || (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
themeBtn.addEventListener('click', () => {
  setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  rerender(); // charts bake CSS-var colors into SVG attributes, so redraw for the new mode
});

// ── Language ──
// Same shape as the theme switch above: read once at boot, persist on change,
// and reflect the choice in the shareable URL. Precedence:
//   ?lang=  >  localStorage  >  navigator.languages  >  'en'
const langBox = $('#lang');
let currentLang = resolveLang(
  new URLSearchParams(location.search).get('lang') || localStorage.getItem('fra-lang'),
  navigator.languages || [navigator.language].filter(Boolean),
);
langBox.innerHTML = LANGS.map(l =>
  `<button type="button" data-code="${l.code}" title="${l.label}">${l.code.toUpperCase()}</button>`).join('');
const reflectLang = () => {
  document.documentElement.lang = currentLang;
  $$('button[data-code]', langBox).forEach(b => b.setAttribute('aria-current', b.dataset.code === currentLang ? 'true' : 'false'));
  applyDom();
  updateCmdTitle();
};
setLang(currentLang);
reflectLang();

langBox.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-code]');
  if (!btn || btn.dataset.code === currentLang) return;
  currentLang = setLang(btn.dataset.code);
  localStorage.setItem('fra-lang', currentLang);
  // Keep the language in the deep-link — but only once there is a link to keep,
  // so a fresh page load doesn't grow a query string just from a menu click.
  const p = new URLSearchParams(location.search);
  if ([...p.keys()].length) { p.set('lang', currentLang); setUrl(Object.fromEntries(p)); }
  reflectLang();
  populateYears();
  rerender();
});

// Re-run the render path of whatever is currently on screen, with no re-fetch.
// Compare results carry their own pair of sides; single audits use the module
// globals captured by finish().
function rerender() {
  if (lastYearHist) drawYearPicker();
  if (lastCompare) { renderCompare(lastCompare.a, lastCompare.b); return; }
  if (lastAggregate && lastAssessments.length) render(lastAggregate, lastMeta);
}

// ── Status / progress ──
function status(msg, kind = 'info', pct = null) {
  const s = $('#status');
  s.className = `status ${kind}`;
  if (msg && pct != null) {
    s.innerHTML = `<div class="status-msg">${esc(msg)}</div><div class="status-bar"><div class="status-fill" style="width:${Math.max(0, Math.min(100, pct))}%"></div></div>`;
  } else {
    s.textContent = msg || '';
  }
  s.style.display = msg ? 'block' : 'none';
}

// One busy-guard for every async action button: ignores re-entry while running,
// reports errors via status, and ALWAYS re-enables — so no handler can be left
// with a permanently disabled button by an early return.
const busy = (sel, fn, errKey = 'status.error') => async () => {
  const btn = $(sel);
  if (btn.disabled) return;
  btn.disabled = true;
  try { await fn(); }
  catch (e) { status(`${t(errKey)}: ${e.message}`, 'error'); }
  finally { btn.disabled = false; }
};

// ── DataCite examples ──
$$('#panel-datacite .example').forEach(b => b.addEventListener('click', () => {
  $(`#dc-mode input[value="${b.dataset.mode}"]`).checked = true;
  $('#dc-input').value = b.dataset.value;
}));

// ── OAI examples ──
$$('#panel-oai .example').forEach(b => b.addEventListener('click', () => { $('#oai-input').value = b.dataset.value; }));

// ── Year focus (DataCite): from/until selects + a "Suggest years" histogram ──
let lastYearHist = null;
function populateYears() {
  const now = new Date().getFullYear();
  let opts = `<option value="">${esc(t('ui.year.any'))}</option>`;
  for (let y = now; y >= 2000; y--) opts += `<option value="${y}">${y}</option>`;
  // Repopulating wipes the selection, so carry it across a language switch.
  ['#dc-from', '#dc-until', '#oai-from', '#oai-until'].forEach(id => {
    const sel = $(id), keep = sel.value;
    sel.innerHTML = opts;
    sel.value = keep;
  });
}
populateYears();
const readYears = () => {
  const f = parseInt($('#dc-from').value, 10), u = parseInt($('#dc-until').value, 10);
  return { fromYear: Number.isFinite(f) ? f : null, untilYear: Number.isFinite(u) ? u : null };
};
const yearsActive = () => { const { fromYear, untilYear } = readYears(); return fromYear != null || untilYear != null; };
const yearLabel = () => { const { fromYear, untilYear } = readYears(); if (fromYear == null && untilYear == null) return ''; return ` · ${fromYear ?? '…'}–${untilYear ?? '…'}`; };
function yearPickerOpts() {
  const cs = getComputedStyle(document.documentElement), v = (n) => cs.getPropertyValue(n).trim();
  return { accent: v('--accent'), muted: v('--muted'), axis: v('--muted'), grid: v('--border'), tip };
}
function drawYearPicker() {
  const box = $('#dc-yearviz'); box.innerHTML = '';
  if (!lastYearHist || !lastYearHist.length) { box.hidden = true; return; }
  const total = lastYearHist.reduce((s, d) => s + d.count, 0);
  const peak = lastYearHist.reduce((m, d) => d.count > m.count ? d : m, lastYearHist[0]);
  const span = `${lastYearHist[0].year}–${lastYearHist[lastYearHist.length - 1].year}`;
  const { fromYear, untilYear } = readYears();
  box.appendChild(el('p', 'yearviz-cap', t('yearviz.caption', {
    total: `<b>${n(total)}</b>`, span: `<b>${span}</b>`, peak: `<b>${peak.year}</b>`, peakCount: n(peak.count),
  })));
  renderYearPicker(box, lastYearHist, { ...yearPickerOpts(), selected: [fromYear, untilYear], onPick: (f, t) => setYears(f, t) });
  box.hidden = false;
}
function syncYearUI() { $('#dc-year-clear').hidden = !yearsActive(); if (lastYearHist) drawYearPicker(); }
function setYears(from, until) {
  $('#dc-from').value = from != null ? String(from) : '';
  $('#dc-until').value = until != null ? String(until) : '';
  syncYearUI();
}
function resetYearViz() { lastYearHist = null; const b = $('#dc-yearviz'); b.hidden = true; b.innerHTML = ''; }
['#dc-from', '#dc-until'].forEach(id => $(id).addEventListener('change', syncYearUI));
$('#dc-year-clear').addEventListener('click', () => setYears(null, null));
// The histogram is repo-specific — drop it when the query target changes (keep the year selection).
$('#dc-input').addEventListener('input', resetYearViz);
$$('#dc-mode input').forEach(r => r.addEventListener('change', resetYearViz));
$$('#panel-datacite .example').forEach(b => b.addEventListener('click', resetYearViz));

// ── Repository name typeahead ─────────────────────────────────────────────
// As you type, search DataCite's /clients so a partial or mistyped name (e.g.
// "scielo chile") surfaces the real repository + its Client ID. Reused by the
// main DataCite box and both Compare inputs; `onPick` handles the per-context
// mode switch, `enabled()` gates it off (e.g. when a Compare side is OAI-PMH).
function attachRepoTypeahead({ input, list, onPick, enabled = () => true, idPrefix }) {
  let items = [], active = -1, seq = 0, hideT = null, debT = null;

  const close = () => { list.hidden = true; list.innerHTML = ''; items = []; active = -1; input.setAttribute('aria-expanded', 'false'); };
  const setActive = (i) => {
    active = i;
    $$('.suggest-item', list).forEach((li, n) => li.classList.toggle('active', n === active));
    if (active >= 0) $$('.suggest-item', list)[active]?.scrollIntoView({ block: 'nearest' });
  };
  const choose = (it) => {
    input.value = it.id;
    close(); input.focus();
    onPick(it);
    status(t('status.selectedRepo', { name: it.name, id: it.id }), 'info');
  };
  const render = () => {
    if (!items.length) { close(); return; }
    list.innerHTML = items.map((it, i) =>
      `<li class="suggest-item${i === active ? ' active' : ''}" role="option" data-i="${i}" id="${idPrefix}-${i}">
         <span class="suggest-name">${esc(it.name)}</span><span class="suggest-id">${esc(it.id)}</span>
       </li>`).join('');
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
  };

  input.addEventListener('input', () => {
    clearTimeout(debT);
    const q = input.value.trim();
    if (q.length < 2 || !enabled()) { close(); return; }
    debT = setTimeout(async () => {
      const my = ++seq;
      const hits = await suggestClients(q, { limit: 8 });
      if (my !== seq) return;            // a newer keystroke already superseded this
      if (input.value.trim().length < 2 || !enabled()) return;
      items = hits; active = -1; render();
    }, 220);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden || !items.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % items.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((active - 1 + items.length) % items.length); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(items[active]); }
    else if (e.key === 'Escape') { close(); }
  });
  list.addEventListener('mousedown', (e) => {          // mousedown beats input blur
    const li = e.target.closest('.suggest-item'); if (!li) return;
    e.preventDefault(); choose(items[Number(li.dataset.i)]);
  });
  input.addEventListener('blur', () => { hideT = setTimeout(close, 120); });
  input.addEventListener('focus', () => { clearTimeout(hideT); if (items.length) render(); });
}

// Main DataCite box: pick → switch to Client-ID mode and drop the year histogram.
attachRepoTypeahead({
  input: $('#dc-input'), list: $('#dc-suggest-list'), idPrefix: 'dc-sugg',
  onPick: () => { $('#dc-mode input[value="clientId"]').checked = true; resetYearViz(); },
});
// Compare A/B: pick → set that side's kind select to Client ID. Suppressed when
// the side is set to OAI-PMH (an OAI URL, not a DataCite repository name).
for (const s of ['a', 'b']) {
  attachRepoTypeahead({
    input: $(`#cmp-${s}-input`), list: $(`#cmp-${s}-suggest-list`), idPrefix: `cmp-${s}-sugg`,
    enabled: () => $(`#cmp-${s}-kind`).value !== 'oai',
    onPick: () => { $(`#cmp-${s}-kind`).value = 'clientId'; },
  });
}

$('#dc-suggest').addEventListener('click', busy('#dc-suggest', async () => {
  const mode = $('#dc-mode input:checked').value, value = $('#dc-input').value.trim();
  if (!value) return status(t('err.enterQueryFirst'), 'error');
  const hist = await fetchYearHistogram(mode, value, { onProgress: (d, tot) => status(t('status.samplingYears', { done: d, total: tot }), 'info', d / tot * 100) });
  status('');
  if (!hist.length) { resetYearViz(); return status(t('err.noDatedRecords'), 'error'); }
  lastYearHist = hist; drawYearPicker();
}, 'err.couldNotSampleYears'));

// ── Analyze: DataCite ──
$('#dc-analyze').addEventListener('click', busy('#dc-analyze', async () => {
  const mode = $('#dc-mode input:checked').value;
  const value = $('#dc-input').value.trim();
  if (!value) return status(t('err.enterQuery'), 'error');
  const sample = $('#dc-sample').value;
  const { fromYear, untilYear } = readYears();
  const urlp = { tab: 'datacite', kind: mode, q: value, n: sample, lang: currentLang };
  if (fromYear != null) urlp.y0 = fromYear;
  if (untilYear != null) urlp.y1 = untilYear;
  status(t('status.queryingDataCite'));
  let works, total, capped = false;
  if (sample === 'all') {
    const r = await fetchAllWorks(mode, value, { fromYear, untilYear, onProgress: (d, tot) => status(t('status.fetchingDois', { done: n(d), total: n(tot) }), 'info', tot ? d / tot * 100 : null) });
    works = r.works; total = r.total; capped = r.capped;
  } else {
    const r = await fetchWorks(mode, value, { pageSize: parseInt(sample, 10), page: 1, fromYear, untilYear });
    works = r.works; total = r.total;
  }
  if (!works.length) return status(t('err.noDois', { kind: mode, query: value, years: yearLabel() }), 'error');
  setUrl(urlp);   // only a successful analysis earns the shareable URL
  status(tn('status.scoring', works.length, { count: n(works.length) }));
  const assessments = works.map(w => assessDataCiteWork({ id: w.id, type: w.type, attributes: w.attributes }));
  const years = works.map(w => parseInt(w.attributes?.publicationYear, 10) || null);
  const titled = works.map(w => ({ id: w.attributes?.doi || w.id, title: w.attributes?.titles?.[0]?.title }));
  finish(assessments, { source: 'DataCite', query: `${mode}: ${value}${yearLabel()}`, total, shown: works.length, capped },
    dataCiteConcepts(works), temporalSeries(years, assessments), findDuplicates(titled));
}));

// ── Record-datestamp years (OAI-PMH): from/until selective harvesting ──
const readOaiYears = () => {
  const f = parseInt($('#oai-from').value, 10), u = parseInt($('#oai-until').value, 10);
  return { fromYear: Number.isFinite(f) ? f : null, untilYear: Number.isFinite(u) ? u : null };
};
const oaiYearLabel = () => { const { fromYear, untilYear } = readOaiYears(); if (fromYear == null && untilYear == null) return ''; return ` · ${fromYear ?? '…'}–${untilYear ?? '…'}`; };
function syncOaiYearUI() { const { fromYear, untilYear } = readOaiYears(); $('#oai-year-clear').hidden = fromYear == null && untilYear == null; }
['#oai-from', '#oai-until'].forEach(id => $(id).addEventListener('change', syncOaiYearUI));
$('#oai-year-clear').addEventListener('click', () => { $('#oai-from').value = ''; $('#oai-until').value = ''; syncOaiYearUI(); });

// ── Analyze: OAI-PMH ──
$('#oai-analyze').addEventListener('click', busy('#oai-analyze', async () => {
  const base = $('#oai-input').value.trim();
  if (!base) return status(t('err.enterOaiUrl'), 'error');
  const proxy = $('#oai-proxy').value.trim();
  if (proxy) oai.setProxy(proxy);
  const max = parseInt($('#oai-sample').value, 10);
  const { fromYear, untilYear } = readOaiYears();
  const urlp = { tab: 'oai', q: base, n: $('#oai-sample').value, lang: currentLang };
  if (fromYear != null) urlp.y0 = fromYear;
  if (untilYear != null) urlp.y1 = untilYear;
  if (proxy) urlp.px = proxy;   // custom relay travels in the link so it reproduces
  // OAI from/until act on the record datestamp; use the universally-safe YYYY-MM-DD form.
  const from = fromYear != null ? `${fromYear}-01-01` : null;
  const until = untilYear != null ? `${untilYear}-12-31` : null;
  status(t('status.identify'));
  let repoName = '';
  try { repoName = (await oai.identify(base)).name; } catch { /* some repos block Identify */ }
  status(t('status.harvesting'));
  const records = await oai.fetchRecords(base, { max, from, until, onProgress: (d, tot) => status(t('status.harvested', { done: n(d), total: n(tot) }), 'info', tot ? d / tot * 100 : null) });
  if (!records.length) return status(t(oaiYearLabel() ? 'err.noRecordsInWindow' : 'err.noRecordsFromEndpoint'), 'error');
  setUrl(urlp);
  status(tn('status.scoring', records.length, { count: n(records.length) }));
  const assessments = records.map(r => assessOaiRecord(r));
  const years = records.map(r => { const m = String((r.metadata.date || [])[0] || '').match(/\b(19|20)\d{2}\b/); return m ? +m[0] : null; });
  const titled = records.map(r => ({ id: r.header.identifier, title: (r.metadata.title || [])[0] }));
  finish(assessments, { source: 'OAI-PMH', query: `${repoName || base}${oaiYearLabel()}`, total: records.length, shown: records.length },
    oaiConcepts(records), temporalSeries(years, assessments), findDuplicates(titled));
}));

// ── Finish: aggregate + render ──
function finish(assessments, meta, concepts, temporal, duplicates) {
  lastCompare = null;             // a single-repo audit supersedes any Compare on screen
  lastAssessments = assessments;
  lastMeta = meta;
  lastConcepts = concepts || null;
  lastTemporal = temporal || null;
  lastDuplicates = duplicates || null;
  lastAggregate = assessments.length === 1 ? assessments[0] : aggregateAssessments(assessments);
  status('');
  render(lastAggregate, meta);
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const ICON = { 1: '●', 0.5: '◐', 0: '○' };
const clsFor = (s) => s === 1 ? 'pass' : s === 0.5 ? 'partial' : 'fail';

function render(a, meta) {
  const recs = generateRecommendations(a);
  const isAgg = lastAssessments.length > 1;
  const recMap = {};
  [...recs.critical, ...recs.improvement, ...recs.passing].forEach(c => { recMap[c.id] = c.recommendation; });

  // Build one check block (reused by the inline gauge panel and the full per-check section).
  const buildCheckItem = (c, li, ci) => {
    const state = clsFor(c.score);
    const scores = isAgg ? lastAssessments.map(x => x.principles[li].checks[ci].score) : [c.score];
    const nScores = scores.length;
    const full = scores.filter(s => s === 1).length, part = scores.filter(s => s === 0.5).length, none = scores.filter(s => s === 0).length;
    const avg = Math.round(scores.reduce((s, v) => s + v, 0) / nScores * 100);
    const item = el('div', `chk chk-${state}`);
    const h = el('div', 'chk-head');
    h.innerHTML = `<span class="chk-icon ${state}">${ICON[c.score] ?? '◐'}</span>
      <span class="chk-id">${esc(c.id)}</span>
      <span class="chk-name">${esc(c.name)}</span>
      <span class="chk-avg">${avg}%</span>`;
    item.appendChild(h);
    if (c.description) item.appendChild(el('p', 'chk-desc', esc(c.description)));
    if (isAgg) {
      const dist = t('chk.distribution', { full, partial: part, notMet: none });
      const bar = el('div', 'chk-dist');
      bar.title = dist;
      bar.innerHTML = `<div class="seg lvl-hi" style="width:${full / nScores * 100}%"></div><div class="seg lvl-mid" style="width:${part / nScores * 100}%"></div><div class="seg lvl-lo" style="width:${none / nScores * 100}%"></div>`;
      item.appendChild(bar);
      item.appendChild(el('div', 'chk-distlabel', esc(dist)));
    } else if (c.details) {
      item.appendChild(el('p', 'chk-detail', esc(c.details)));
    }
    if (c.score < 1 && recMap[c.id]) item.appendChild(el('div', 'chk-rec', `→ ${esc(recMap[c.id])}`));
    if (isAgg && (part + none) > 0) {
      const failing = lastAssessments
        .map(x => x.principles[li].checks[ci])
        .map((cc, k) => ({ id: lastAssessments[k].identifier, score: cc.score, detail: cc.details }))
        .filter(d => d.score < 1).sort((p, q) => p.score - q.score);
      const shown = failing.slice(0, 200);
      const belowFull = () => tn('chk.belowFull', failing.length, { count: n(failing.length) });
      const toggle = el('button', 'link-btn', `▸ ${esc(belowFull())}`);
      const list = el('div', 'agg-list'); list.style.display = 'none';
      list.innerHTML = shown.map(d =>
        `<div class="agg-row"><span class="${clsFor(d.score)}">${ICON[d.score] ?? '◐'}</span> <code>${esc(shortId(d.id))}</code> <span class="agg-detail">${esc((d.detail || '').replace(/^[◐●○].*?\.\s*/, '').slice(0, 90))}</span></div>`).join('')
        + (failing.length > 200 ? `<div class="agg-more">${esc(t('agg.more', { count: n(failing.length - 200) }))}</div>` : '');
      toggle.addEventListener('click', () => {
        const open = list.style.display === 'none';
        list.style.display = open ? 'block' : 'none';
        toggle.textContent = `${open ? '▾' : '▸'} ${belowFull()}`;
      });
      item.appendChild(toggle); item.appendChild(list);
    }
    return item;
  };
  const results = $('#results');
  results.innerHTML = '';
  results.style.display = 'block';

  // Hero readout: overall index + four FAIR gauges (letters carry identity, not colour alone)
  const gauges = a.principles.map(p => {
    const pct = Math.round((p.score / p.maxScore) * 100);
    return `<div class="gauge" style="--gc:var(--f-${p.letter})">
      <div class="gauge-letter">${p.letter}</div>
      <div class="gauge-name">${esc(p.name)}</div>
      <div class="gauge-track"><div class="gauge-fill" style="width:${pct}%"></div></div>
      <div class="gauge-val">${(+p.score.toFixed(1))}/${p.maxScore}</div>
    </div>`;
  }).join('');
  const head = el('div', 'card');
  head.innerHTML = `<div class="readout">
    <div class="readout-overall">
      <div class="readout-pct">${a.overallPercent}<span>%</span></div>
      <div class="readout-rating rating-${recs.rating.toLowerCase()}">${esc(recs.rating)}</div>
      <div class="readout-sub">${a.overallScore}/${a.overallMax} FAIR · ${esc(meta.source)}<br>${esc(meta.query)}<br>${esc(tn('readout.records', meta.shown, { count: n(meta.shown) }))}${meta.total && meta.total !== meta.shown ? ` ${esc(t('readout.ofTotal', { total: n(meta.total) }))}` : ''}${meta.capped ? ` · ${esc(t('readout.capped'))}` : ''}</div>
    </div>
    <div class="gauges">${gauges}</div>
  </div>`;
  results.appendChild(head);
  // Inline principle panel — clicking a gauge reveals its checks here, right under the readout (no scroll).
  const pdetail = el('div', 'pdetail'); pdetail.style.display = 'none';
  results.appendChild(pdetail);
  const gauges2 = [...head.querySelectorAll('.gauge')];
  let openLetter = null;
  gauges2.forEach((g, i) => {
    const p = a.principles[i];
    g.classList.add('clickable');
    g.setAttribute('role', 'button'); g.setAttribute('tabindex', '0');
    g.setAttribute('aria-expanded', 'false');
    g.addEventListener('mouseenter', e => tip(e, `${p.letter} · ${p.name}\n${PRINCIPLE_GLOSS[p.letter]}\n`
      + t('gauge.score', { score: (+p.score.toFixed(1)), max: p.maxScore })
      + `\n${t('gauge.openChecks', { count: p.checks.length })}`));
    g.addEventListener('mouseleave', () => tip(null));
    const toggle = () => {
      tip(null);
      const closing = openLetter === p.letter;
      gauges2.forEach(x => { x.classList.remove('gauge-active'); x.setAttribute('aria-expanded', 'false'); });
      if (closing) { pdetail.style.display = 'none'; pdetail.innerHTML = ''; openLetter = null; return; }
      openLetter = p.letter;
      pdetail.innerHTML = '';
      const hd = el('div', 'pdetail-head');
      hd.innerHTML = `<span class="cg-letter f-ink-${p.letter}">${p.letter}</span>
        <span class="cg-name">${esc(p.name)}</span>
        <span class="cg-gloss">${esc((PRINCIPLE_GLOSS[p.letter] || '').split(' — ')[1] || '')}</span>
        <span class="cg-score">${(+p.score.toFixed(1))}/${p.maxScore}</span>
        <button class="pdetail-close" aria-label="${esc(t('ui.close'))}">✕</button>`;
      hd.querySelector('.pdetail-close').addEventListener('click', toggle);
      pdetail.appendChild(hd);
      p.checks.forEach((c, ci) => pdetail.appendChild(buildCheckItem(c, i, ci)));
      pdetail.style.display = 'block';
      g.classList.add('gauge-active'); g.setAttribute('aria-expanded', 'true');
    };
    g.addEventListener('click', toggle);
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
  });

  // Concept completeness (share of records carrying each concept), grouped by use case
  if (lastConcepts?.length) {
    const flat = lastConcepts.flatMap(g => g.concepts);
    const index = flat.length ? Math.round(flat.reduce((s, c) => s + c.pct, 0) / flat.length * 10) / 10 : 0;
    const card = el('div', 'card');
    card.innerHTML = `<h3>${esc(t('concepts.title'))}
      <span class="index-badge" title="${esc(t('concepts.indexTitle'))}">${esc(t('concepts.indexBadge', { pct: index }))}</span></h3>
      <p class="muted" style="margin-top:-6px">${esc(t('concepts.desc', { count: n(meta.shown) }))} ${LEGEND}</p>`;
    for (const g of lastConcepts) {
      card.appendChild(el('div', 'principle-head', `${esc(g.group)} · ${esc(g.desc)}`));
      for (const c of g.concepts) {
        const lvl = c.pct >= 75 ? 'hi' : c.pct >= 25 ? 'mid' : 'lo';
        const row = el('div', 'concept-row');
        row.innerHTML = `<span class="concept-name">${esc(c.name)}</span>
          <div class="bar"><div class="bar-fill lvl-${lvl}" style="width:${Math.max(c.pct, 1.5)}%"></div></div>
          <span class="concept-val">${c.pct}%</span>`;
        const help = GLOSS[c.key] ? `\n${GLOSS[c.key]}` : '';
        row.addEventListener('mouseenter', e => tip(e, t('concepts.rowTip', { name: c.name, count: n(c.count), total: n(meta.shown), pct: c.pct }) + help));
        row.addEventListener('mouseleave', () => tip(null));
        card.appendChild(row);
      }
    }
    results.appendChild(card);
  }

  // Reusability synthesis — pulls licence + provenance + standards into one "can others reuse this?" readout
  { const rc = reusabilityCard(a); if (rc) results.appendChild(rc); }

  // Interactive — per-record heatmap (every record × every check)
  {
    const card = el('div', 'card');
    card.appendChild(el('h3', null, esc(t('heatmap.title'))));
    const hd = el('p', 'muted');
    hd.innerHTML = `${esc(t('heatmap.desc'))} ${scoreLegend()}`;
    card.appendChild(hd);
    const wrap = el('div', 'heatmap-wrap');
    card.appendChild(wrap);
    results.appendChild(card);
    renderHeatmap(wrap, lastAssessments, tip);
  }

  // FAIR profile radar — the repository's shape across all four principles (includes A)
  {
    const card = el('div', 'card');
    card.appendChild(el('h3', null, esc(t('radar.title'))));
    card.appendChild(el('p', 'muted', esc(t(isAgg ? 'radar.desc.agg' : 'radar.desc.single'))));
    const wrap = el('div'); card.appendChild(wrap); results.appendChild(card);
    const cs = getComputedStyle(document.documentElement); const v = (prop) => cs.getPropertyValue(prop).trim();
    renderRadar(wrap, [{ assessments: lastAssessments, label: t('radar.label.records') }], {
      colors: { hi: v('--lvl-hi'), mid: v('--lvl-mid'), lo: v('--lvl-lo') },
      fair: { F: v('--f-F'), A: v('--f-A'), I: v('--f-I'), R: v('--f-R') },
      grid: v('--border'), surface: v('--surface'), muted: v('--muted'), tip,
    });
  }

  // Temporal — mean FAIR% by publication year
  if (lastTemporal && lastTemporal.length >= 3) {
    const card = el('div', 'card');
    card.appendChild(el('h3', null, esc(t('temporal.title'))));
    card.appendChild(el('p', 'muted', esc(t('temporal.desc', { all: t('ui.sample.all') }))));
    const wrap = el('div'); card.appendChild(wrap); results.appendChild(card);
    const cs = getComputedStyle(document.documentElement);
    renderTemporal(wrap, lastTemporal, {
      colors: { hi: cs.getPropertyValue('--lvl-hi').trim(), mid: cs.getPropertyValue('--lvl-mid').trim(), lo: cs.getPropertyValue('--lvl-lo').trim() },
      axis: cs.getPropertyValue('--muted').trim(), grid: cs.getPropertyValue('--border').trim(), tip,
    });
    const first = lastTemporal[0], last = lastTemporal[lastTemporal.length - 1], delta = last.mean - first.mean;
    const tk = el('p', 'radar-takeaway');
    tk.innerHTML = t('temporal.takeaway', {
      from: `<b>${first.year}</b>`, fromPct: first.mean,
      to: `<b>${last.year}</b>`, toPct: last.mean,
      verdict: delta > 0 ? t('temporal.improved', { delta: `+${delta}` })
        : delta < 0 ? t('temporal.declined', { delta })
        : t('temporal.noChange'),
    });
    card.appendChild(tk);
  }

  // Duplicates — records sharing a normalized title
  if (lastDuplicates && lastDuplicates.length) {
    const totalDup = lastDuplicates.reduce((s, g) => s + g.ids.length, 0);
    const card = el('div', 'card');
    card.appendChild(el('h3', null, esc(tn('dups.title', lastDuplicates.length, { count: n(lastDuplicates.length) }))));
    card.appendChild(el('p', 'muted', esc(tn('dups.desc', totalDup, { count: n(totalDup) }))));
    for (const g of lastDuplicates.slice(0, 25)) {
      const item = el('div', 'dup');
      item.innerHTML = `<div class="dup-title">${esc((g.title || t('dups.untitled')).slice(0, 90))} <span class="dup-n">×${g.ids.length}</span></div>
        <div class="dup-ids">${g.ids.slice(0, 8).map(id => `<code>${esc(shortId(id))}</code>`).join(' ')}${g.ids.length > 8 ? ' …' : ''}</div>`;
      card.appendChild(item);
    }
    results.appendChild(card);
  }

  // ── Per-check detail — full list of all 14 checks (the gauges above reveal one principle inline) ──
  const checks = el('div', 'card');
  checks.appendChild(el('h3', null, esc(t('checks.title'))));
  checks.appendChild(el('p', 'muted', esc(isAgg
    ? t('checks.desc.agg', { count: n(meta.shown) })
    : t('checks.desc.single'))));

  a.principles.forEach((p, li) => {
    const grp = el('div', 'check-group'); grp.id = `cg-${p.letter}`;
    const ph = el('div', 'cg-head');
    ph.innerHTML = `<span class="cg-letter f-ink-${p.letter}">${p.letter}</span>
      <span class="cg-name">${esc(p.name)}</span>
      <span class="cg-gloss">${esc((PRINCIPLE_GLOSS[p.letter] || '').split(' — ')[1] || '')}</span>
      <span class="cg-score">${(+p.score.toFixed(1))}/${p.maxScore}</span>`;
    grp.appendChild(ph);
    p.checks.forEach((c, ci) => grp.appendChild(buildCheckItem(c, li, ci)));
    checks.appendChild(grp);
  });
  results.appendChild(checks);

  // License profile
  const lp = a.licenseProfile || (a.license ? { total: 1, withLicense: a.license.class === 'none' ? 0 : 1, classes: { [a.license.class]: 1 }, machineReadablePct: a.license.machineReadable ? 100 : 0, spdxDeclaredPct: a.license.spdxDeclared ? 100 : 0, multiPct: a.license.multi ? 100 : 0, distinct: a.license.primaryName ? [{ name: a.license.primaryName, count: 1, class: a.license.class }] : [] } : null);
  if (lp) {
    const card = el('div', 'card');
    card.appendChild(el('h3', null, esc(t('license.title'))));
    card.appendChild(el('p', 'muted', esc(isAgg ? t('license.desc.agg', { count: n(meta.shown) }) : t('license.desc.single'))));
    // class distribution (permit-to-reuse)
    const cls = lp.classes || {}, tot = lp.total || 1;
    const segs = [
      [t('license.class.open'), cls.open || 0, 'lvl-hi'],
      [t('license.class.restricted'), cls.restricted || 0, 'lvl-mid'],
      [t('license.class.allRightsReserved'), cls['all-rights-reserved'] || 0, 'lvl-lo'],
      [t('license.class.none'), cls.none || 0, 'seg-none'],
    ].filter(s => s[1] > 0);
    if (segs.length) {
      const bar = el('div', 'seg-bar');
      bar.innerHTML = segs.map(s => `<div class="seg ${s[2]}" style="width:${s[1] / tot * 100}%" title="${esc(s[0])}: ${s[1]}"></div>`).join('');
      card.appendChild(bar);
      const lg = el('div', 'chart-legend');
      lg.innerHTML = segs.map(s => `<span><i class="sw ${s[2]}"></i>${esc(s[0])} ${Math.round(s[1] / tot * 100)}%</span>`).join('');
      card.appendChild(lg);
    }
    // two-tier: present vs machine-actionable
    card.appendChild(meterRow(t('reuse.machineReadable'), Math.round(lp.machineReadablePct), t('reuse.machineReadable.help')));
    card.appendChild(meterRow(t('license.meter.vocabAnchored'), Math.round(lp.spdxDeclaredPct), t('license.meter.vocabAnchored.help')));
    if (lp.distinct?.length) {
      card.appendChild(el('div', 'subtle-label', esc(t('license.found'))));
      const dl = el('div', 'chips');
      dl.innerHTML = lp.distinct.map(d => `<span class="chip cls-${d.class}">${esc(d.name)} · ${d.count}</span>`).join('');
      card.appendChild(dl);
    }
    results.appendChild(card);
  }

  // Connectivity profile
  const cp = a.connectivityProfile || (a.connectivity ? {
    creators: { total: a.connectivity.creators, identified: a.connectivity.creatorsId },
    affiliations: { total: a.connectivity.affiliations, identified: a.connectivity.affiliationsId },
    funders: { total: a.connectivity.funders, identified: a.connectivity.fundersId },
    contributors: { total: a.connectivity.contributors, identified: a.connectivity.contributorsId },
  } : null);
  if (cp) {
    const card = el('div', 'card');
    card.appendChild(el('h3', null, esc(t('conn.title'))));
    card.appendChild(el('p', 'muted', esc(t('conn.desc'))));
    const rows = [
      [t('conn.creators'), cp.creators, t('conn.creators.help')],
      [t('conn.affiliations'), cp.affiliations, t('conn.affiliations.help')],
      [t('conn.funders'), cp.funders, t('conn.funders.help')],
      [t('conn.contributors'), cp.contributors, t('conn.contributors.help')],
    ].filter(([, v]) => v && v.total > 0);
    if (rows.length) {
      for (const [label, v, help] of rows) {
        const row = meterRow(label, Math.round(v.identified / v.total * 100), `${t('conn.ofTotal', { identified: n(v.identified), total: n(v.total) })} ${help}`);
        row.querySelector('.concept-val').textContent = `${v.identified}/${v.total}`;
        card.appendChild(row);
      }
    } else {
      card.appendChild(el('p', 'muted', esc(t('conn.none'))));
    }
    if (cp.recordsWithUnidentifiedCreators) {
      const v = el('div', 'verdict');
      v.innerHTML = tn('conn.quickWins', cp.recordsWithUnidentifiedCreators, { count: n(cp.recordsWithUnidentifiedCreators) });
      card.appendChild(v);
    }
    results.appendChild(card);
  }

  // Recommendations
  if (recs.critical.length || recs.improvement.length) {
    const card = el('div', 'card');
    card.appendChild(el('h3', null, esc(t('recs.title'))));
    const group = (title, arr, cls) => {
      if (!arr.length) return;
      card.appendChild(el('div', `rec-group ${cls}`, esc(title)));
      arr.forEach(c => card.appendChild(el('div', 'rec', `<b>${esc(c.id)}</b> ${esc(c.recommendation)}`)));
    };
    group(t('recs.critical'), recs.critical, 'fail');
    group(t('recs.improvement'), recs.improvement, 'partial');
    results.appendChild(card);
  }

  // Exports
  const ex = el('div', 'card export-card');
  ex.appendChild(el('h3', null, esc(t('export.title'))));
  const row = el('div', 'export-row');
  const mk = (label, fn) => { const b = el('button', 'btn ghost', esc(label)); b.addEventListener('click', fn); return b; };
  row.appendChild(mk('JSON', exportJSON));                 // format names, not prose
  row.appendChild(mk(t('export.textReport'), exportTXT));
  row.appendChild(mk('CSV', exportCSV));
  if (isAgg) row.appendChild(mk(t('export.actionList'), exportActionList));
  ex.appendChild(row);
  results.appendChild(ex);
}

// ── Exports ──
function download(content, filename, mime) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = el('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const slug = () => (lastMeta.query || 'audit').replace(/[^a-z0-9]+/gi, '-').slice(0, 40).toLowerCase();
function exportJSON() { download(JSON.stringify({ ...lastAggregate, conceptCompleteness: lastConcepts || undefined, temporal: lastTemporal || undefined, possibleDuplicates: lastDuplicates || undefined }, null, 2), `fair-${slug()}.json`, 'application/json'); }

// Actionable export: every record that isn't full on a check, with the reason — the re-curation to-do list.
function exportActionList() {
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = ['check_id,check_name,identifier,score,finding'];
  lastAggregate.principles.forEach((p, li) => p.checks.forEach((c, ci) => {
    lastAssessments.forEach(x => {
      const cc = x.principles[li].checks[ci];
      if (cc.score < 1) rows.push([c.id, q(c.name), q(x.identifier), cc.score, q((cc.details || '').replace(/^[◐●○].*?\.\s*/, '').slice(0, 240))].join(','));
    });
  }));
  download(rows.join('\n'), `fair-actions-${slug()}.csv`, 'text/csv');
}
function exportTXT() { download(generateTextReport(lastAggregate, lastMeta.query, { totalRecords: lastMeta.shown }), `fair-${slug()}.txt`, 'text/plain'); }
function exportCSV() {
  const ids = ['F1', 'F2', 'F3', 'F4', 'A1', 'A1.1', 'A2', 'I1', 'I2', 'I3', 'R1', 'R1.1', 'R1.2', 'R1.3'];
  const rows = [['identifier', 'overallPercent', ...ids].join(',')];
  for (const a of lastAssessments) {
    const flat = {};
    a.principles.forEach(p => p.checks.forEach(c => { flat[c.id] = c.score; }));
    rows.push([`"${(a.identifier || '').replace(/"/g, '""')}"`, a.overallPercent, ...ids.map(id => flat[id] ?? '')].join(','));
  }
  download(rows.join('\n'), `fair-${slug()}.csv`, 'text/csv');
}

// ── Compare (two repositories side by side) ──
async function fetchAndScore({ kind, value, sample }) {
  if (kind === 'oai') {
    const proxy = $('#oai-proxy')?.value.trim(); if (proxy) oai.setProxy(proxy);
    const records = await oai.fetchRecords(value, { max: sample });
    return { assessments: records.map(assessOaiRecord), concepts: oaiConcepts(records), source: 'OAI-PMH', query: value, shown: records.length };
  }
  const r = await fetchWorks(kind, value, { pageSize: sample, page: 1 });
  const assessments = r.works.map(w => assessDataCiteWork({ id: w.id, type: w.type, attributes: w.attributes }));
  return { assessments, concepts: dataCiteConcepts(r.works), source: 'DataCite', query: `${kind}: ${value}`, shown: r.works.length };
}

$('#cmp-analyze')?.addEventListener('click', busy('#cmp-analyze', async () => {
  const read = (s) => ({ kind: $(`#cmp-${s}-kind`).value, value: $(`#cmp-${s}-input`).value.trim(), sample: parseInt($('#cmp-sample').value, 10) });
  const A = read('a'), B = read('b');
  if (!A.value || !B.value) return status(t('err.enterBoth'), 'error');
  const urlp = { tab: 'compare', ak: A.kind, av: A.value, bk: B.kind, bv: B.value, n: String(A.sample), lang: currentLang };
  const proxy = $('#oai-proxy')?.value.trim();
  if (proxy && (A.kind === 'oai' || B.kind === 'oai')) urlp.px = proxy;
  status(t('status.queryingA')); const ra = await fetchAndScore(A);
  if (!ra.assessments.length) return status(t('err.noRecordsA'), 'error');
  status(t('status.queryingB')); const rb = await fetchAndScore(B);
  if (!rb.assessments.length) return status(t('err.noRecordsB'), 'error');
  setUrl(urlp);
  status(''); renderCompare(ra, rb);
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}));

const aggOf = (r) => r.assessments.length === 1 ? r.assessments[0] : aggregateAssessments(r.assessments);

function renderCompare(A, B) {
  lastCompare = { a: A, b: B };   // remember the pair so a language switch can redraw it
  const results = $('#results'); results.innerHTML = ''; results.style.display = 'block';
  const sc = seriesColors();
  const aggA = aggOf(A), aggB = aggOf(B);
  const recA = generateRecommendations(aggA), recB = generateRecommendations(aggB);
  const lgd = `<span class="chart-legend cmp-lgd"><span><i class="sw" style="background:${sc.a}"></i>A</span><span><i class="sw" style="background:${sc.b}"></i>B</span></span>`;

  const head = el('div', 'card');
  head.innerHTML = `<div class="cmp-heads">${cmpHead('A', A, aggA, recA, sc.a)}${cmpHead('B', B, aggB, recB, sc.b)}</div>`;
  results.appendChild(head);

  // FAIR principles A vs B
  const pcard = el('div', 'card');
  pcard.innerHTML = `<h3>${esc(t('cmp.principles.title'))} ${lgd}</h3>`;
  aggA.principles.forEach((p, i) => {
    const pa = Math.round(p.score / p.maxScore * 100), pb = Math.round(aggB.principles[i].score / aggB.principles[i].maxScore * 100);
    pcard.appendChild(cmpRow(`${p.letter} · ${p.name}`, pa, pb, sc, `${p.letter} · ${p.name}\nA ${pa}%  ·  B ${pb}%\n${PRINCIPLE_GLOSS[p.letter]}`));
  });
  results.appendChild(pcard);

  // Concept completeness A vs B (only when both sources share the concept set)
  if (A.source === B.source && A.concepts?.length) {
    const bMap = {}; B.concepts.forEach(g => g.concepts.forEach(c => { bMap[c.key] = c.pct; }));
    const ccard = el('div', 'card');
    ccard.innerHTML = `<h3>${esc(t('cmp.concepts.title'))} ${lgd}</h3>`;
    for (const g of A.concepts) {
      ccard.appendChild(el('div', 'principle-head', esc(g.group)));
      for (const c of g.concepts) {
        const pb = bMap[c.key] ?? 0;
        ccard.appendChild(cmpRow(c.name, c.pct, pb, sc, `${c.name}\nA ${c.pct}%  ·  B ${pb}%${GLOSS[c.key] ? '\n' + GLOSS[c.key] : ''}`));
      }
    }
    results.appendChild(ccard);
  }

  // Dual FAIR profile — both repositories' shapes overlaid on one radar
  {
    const card = el('div', 'card');
    card.appendChild(el('h3', null, esc(t('cmp.radar.title'))));
    const cap = el('p', 'muted');
    cap.innerHTML = t('cmp.radar.desc', { a: `<b style="color:${sc.a}">A</b>`, b: `<b style="color:${sc.b}">B</b>` });
    card.appendChild(cap);
    const wrap = el('div'); card.appendChild(wrap); results.appendChild(card);
    const cs = getComputedStyle(document.documentElement); const v = (prop) => cs.getPropertyValue(prop).trim();
    renderRadar(wrap, [
      { assessments: A.assessments, color: sc.a, label: `A · ${A.query}` },
      { assessments: B.assessments, color: sc.b, label: `B · ${B.query}` },
    ], {
      colors: { hi: v('--lvl-hi'), mid: v('--lvl-mid'), lo: v('--lvl-lo') },
      fair: { F: v('--f-F'), A: v('--f-A'), I: v('--f-I'), R: v('--f-R') },
      grid: v('--border'), surface: v('--surface'), muted: v('--muted'), tip,
    });
  }
}

function cmpHead(tag, r, agg, rec, color) {
  return `<div class="cmp-head">
    <div class="cmp-tag" style="color:${color}">${tag} · ${esc(r.source)}</div>
    <div class="cmp-pct" style="color:${color}">${agg.overallPercent}<span>%</span></div>
    <div class="readout-rating rating-${rec.rating.toLowerCase()}">${esc(rec.rating)}</div>
    <div class="cmp-q" title="${esc(r.query)}">${esc(r.query)}</div>
    <div class="muted">${esc(tn('readout.records', r.shown, { count: n(r.shown) }))}</div>
  </div>`;
}

function cmpRow(name, pa, pb, sc, tipText) {
  const row = el('div', 'cmp-prow');
  row.innerHTML = `<span class="cmp-plabel">${esc(name)}</span>
    <div class="cmp-bars">
      <div class="bar"><div class="bar-fill" style="width:${Math.max(pa, 1.5)}%;background:${sc.a}"></div></div>
      <div class="bar"><div class="bar-fill" style="width:${Math.max(pb, 1.5)}%;background:${sc.b}"></div></div>
    </div>
    <span class="concept-val">${pa} / ${pb}</span>`;
  row.addEventListener('mouseenter', e => tip(e, tipText));
  row.addEventListener('mouseleave', () => tip(null));
  return row;
}

// ── Deep-link bootstrap: run the analysis described by the URL on load ──
(function applyUrlParams() {
  const p = new URLSearchParams(location.search);
  const tab = p.get('tab');
  if (!tab) return;
  const tabBtn = $$('.tab').find(t => t.dataset.mode === tab);
  if (!tabBtn) return;
  tabBtn.click();
  if (tab === 'datacite') {
    const kind = p.get('kind') || 'clientId';
    const radio = $(`#dc-mode input[value="${kind}"]`); if (radio) radio.checked = true;
    $('#dc-input').value = p.get('q') || '';
    if (p.get('n')) $('#dc-sample').value = p.get('n');
    if (p.get('y0') || p.get('y1')) setYears(p.get('y0') ? +p.get('y0') : null, p.get('y1') ? +p.get('y1') : null);
    if (p.get('q')) $('#dc-analyze').click();
  } else if (tab === 'oai') {
    $('#oai-input').value = p.get('q') || '';
    if (p.get('px')) $('#oai-proxy').value = p.get('px');
    if (p.get('n')) $('#oai-sample').value = p.get('n');
    if (p.get('y0')) $('#oai-from').value = p.get('y0');
    if (p.get('y1')) $('#oai-until').value = p.get('y1');
    if (p.get('y0') || p.get('y1')) syncOaiYearUI();
    if (p.get('q')) $('#oai-analyze').click();
  } else if (tab === 'compare') {
    $('#cmp-a-kind').value = p.get('ak') || 'clientId'; $('#cmp-a-input').value = p.get('av') || '';
    $('#cmp-b-kind').value = p.get('bk') || 'clientId'; $('#cmp-b-input').value = p.get('bv') || '';
    if (p.get('px')) $('#oai-proxy').value = p.get('px');
    if (p.get('n')) $('#cmp-sample').value = p.get('n');
    if (p.get('av') && p.get('bv')) $('#cmp-analyze').click();
  }
})();
