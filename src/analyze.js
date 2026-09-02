// Source vs published, run entirely in the browser.
//
// Every other mode here reads the record a repository PUBLISHES. This one also
// reads what the repository itself holds, scores both sides with the same
// rubric, and reports what does not survive the crossing.
//
// ── Why there is no service any more ──
// This ran in a Cloudflare Worker until September 2026, for two reasons that
// both turned out to be wrong. The first was CORS: R2R answers
// `Access-Control-Allow-Origin: *` on GET and on preflight, and DataCite
// answers with the page's own origin, so a browser can read both directly and
// no relay is needed. The second was the scoring engine, which the worker
// reached by service binding: this repository already carries the same rubric
// in src/fair.js, kept in parity by shared fixtures, so calling out for a score
// was duplicating what was already here.
//
// What forced the question was a ceiling, not a principle. A Worker on the free
// plan may make 50 subrequests per invocation, and this analysis costs about
// five per cruise: 46 at a sample of 8, 51 at 9, 131 at 25. The default sample
// of 10 was therefore failing in production with a 502 while the same code
// passed its end-to-end test in Node, where no such ceiling exists. Moving the
// work into the browser removes the ceiling rather than raising it, and takes
// the last exception out of "everything runs in your browser".
//
// ── What was given up, and what replaces it ──
// The worker held a shared cache: ten people analysing the same vessel cost R2R
// one round of reads. In a browser there is no shared anything, so the same ten
// people cost ten rounds. R2R is a public API funded by a research programme,
// not a CDN, so the politeness the worker enforced is kept here deliberately:
// detail reads go three cruises at a time, DOI lookups five, and a result is
// cached per browser for six hours. That is weaker than a shared cache and it
// is the honest cost of the move.

import { assessDataCiteWork, aggregateAssessments } from './fair.js?v=33';

const R2R = 'https://service.rvdata.us/api';
const DATACITE = 'https://api.datacite.org/dois';

const TIMEOUT_MS = 8000;
const MAX_BYTES = 4 * 1024 * 1024;
const CRUISE_BATCH = 3;          // detail reads in flight at once
const DOI_BATCH = 5;             // DataCite lookups in flight at once
const CACHE_TTL_MS = 6 * 3600 * 1000;
const MAX_SAMPLE = 25;
const DEFAULT_SAMPLE = 10;

const arr = (v) => Array.isArray(v) ? v : (v == null ? [] : [v]);
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const unwrap = (j) => (j && Array.isArray(j.data)) ? j.data : (Array.isArray(j) ? j : []);

/** Strip every URL form a DOI arrives in, leaving the bare 10.x/y. */
export const bareDoi = (d) => String(d || '').replace(/^https?:\/\/(dx\.)?doi\.org\//i, '').trim();

// Every upstream read is bounded. A hung origin must not leave the tab spinning
// with no way out, and an unexpectedly huge body must not be parsed.
async function readJson(url) {
  try {
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    if (parseInt(res.headers.get('content-length') || '0', 10) > MAX_BYTES) return null;
    const text = await res.text();
    if (text.length > MAX_BYTES) return null;
    return JSON.parse(text);
  } catch {
    // A failed read is a missing record, not a crash: one unreachable detail
    // endpoint must not lose the other nine cruises.
    return null;
  }
}
const r2rGet = async (path) => unwrap(await readJson(R2R + path));

/** Run `jobs` `width` at a time, in order. The politeness the worker used to enforce. */
async function inBatches(jobs, width) {
  const out = [];
  for (let i = 0; i < jobs.length; i += width) {
    out.push(...await Promise.all(jobs.slice(i, i + width).map(j => j())));
  }
  return out;
}

// ── The source side: R2R ──

/** Cruises plus their detail records, newest first, bounded by `sample`. */
export async function r2rFetch(value, sample) {
  const v = encodeURIComponent(String(value).trim());
  let cruises = await r2rGet(`/cruise/?cruise_id=${v}`);
  if (!cruises.length) cruises = await r2rGet(`/cruise/?vessel_shortname=${v}`);
  if (!cruises.length) return [];

  cruises.sort((a, b) => String(b.depart_date || '').localeCompare(String(a.depart_date || '')));
  const picked = cruises.slice(0, sample);

  return inBatches(picked.map((c) => async () => {
    const id = encodeURIComponent(c.cruise_id || '');
    if (!id) return { cruise: c, persons: [], filesets: [], articles: [], qa: [] };
    const [persons, filesets, articles, qa] = await Promise.all([
      r2rGet(`/person/?cruise_id=${id}`), r2rGet(`/fileset/?cruise_id=${id}`),
      r2rGet(`/article/?cruise_id=${id}`), r2rGet(`/qa_info/?cruise_id=${id}`),
    ]);
    return { cruise: c, persons, filesets, articles, qa };
  }), CRUISE_BATCH);
}

/**
 * Map one enriched cruise into the DataCite attributes shape.
 *
 * Deliberately generous: wherever the source API holds something a DataCite
 * element could carry, it is carried. This side answers "what COULD the
 * published record say", so any gap against the real DOI is a gap in
 * publication and not an artefact of a stingy mapping.
 *
 * rightsList and fundingReferences stay empty because R2R genuinely holds
 * neither: no licence is exposed anywhere, and /award/ returns no awards.
 * Leaving them empty keeps the comparison honest, since they then read as gaps
 * on BOTH sides, which is new work rather than a transfer loss.
 */
export function r2rToWork(rec) {
  const { cruise: c, persons = [], filesets = [], articles = [] } = rec;
  const doi = bareDoi(c.cruise_doi);

  const orcidOf = (p) => (String(p.person_url || '').match(/orcid\.org\/([0-9-]{9,}[0-9X])/i) || [])[1] || null;
  const agent = (p, extra = {}) => {
    const o = orcidOf(p);
    return {
      name: p.person_name || 'Unknown', nameType: 'Personal',
      nameIdentifiers: o ? [{ nameIdentifier: o, nameIdentifierScheme: 'ORCID', schemeUri: 'https://orcid.org' }] : [],
      affiliation: p.institution_name ? [{ name: p.institution_name }] : [],
      ...extra,
    };
  };

  const leads = persons.filter(p => /chief|pi|principal/i.test(p.roletype_id || ''));
  const creators = (leads.length ? leads : persons.slice(0, 1)).map(p => agent(p));
  if (!creators.length && c.chief_scientist) {
    creators.push({ name: c.chief_scientist, nameType: 'Personal', nameIdentifiers: [], affiliation: [] });
  }

  const abstracts = uniq(filesets.map(f => f.abstract));
  const geo = [];
  const place = uniq([c.depart_port_fullname, c.arrive_port_fullname, c.waterbody_name]).join(' / ');
  if (place) geo.push({ geoLocationPlace: place });
  const west = num(c.longitude_min), east = num(c.longitude_max);
  const south = num(c.latitude_min), north = num(c.latitude_max);
  if (west !== null && east !== null && south !== null && north !== null) {
    geo.push({ geoLocationBox: { westBoundLongitude: west, eastBoundLongitude: east,
      southBoundLatitude: south, northBoundLatitude: north } });
  }

  const dates = [];
  if (c.depart_date) dates.push({ date: c.depart_date, dateType: 'Collected' });
  if (c.arrive_date) dates.push({ date: c.arrive_date, dateType: 'Collected' });

  return {
    id: doi || c.cruise_id, type: 'dois',
    attributes: {
      doi,
      identifiers: c.cruise_id ? [{ identifier: c.cruise_id, identifierType: 'Cruise ID' }] : [],
      titles: [{ title: c.cruise_name || `Cruise ${c.cruise_id}` }],
      creators,
      contributors: persons.map(p => agent(p, { contributorType: 'Other' })),
      publisher: c.operator_name || 'Rolling Deck to Repository',
      publicationYear: c.depart_date ? parseInt(String(c.depart_date).slice(0, 4), 10) : null,
      descriptions: abstracts.length
        ? [{ description: abstracts.slice(0, 6).join(' '), descriptionType: 'Abstract' }] : [],
      subjects: uniq(filesets.map(f => f.device_type)).map(sub => ({ subject: sub })),
      formats: uniq(filesets.map(f => f.format_name)),
      sizes: filesets.length
        ? [`${filesets.reduce((a, f) => a + (parseInt(f.total_bytes || '0', 10) || 0), 0)} bytes`] : [],
      types: { resourceTypeGeneral: 'Dataset', resourceType: 'Cruise' },
      dates, geoLocations: geo, language: 'en',
      relatedIdentifiers: uniq(articles.map(a => bareDoi(a.doi))).map(d => ({
        relatedIdentifier: d, relatedIdentifierType: 'DOI', relationType: 'IsReferencedBy' })),
      rightsList: [], fundingReferences: [], version: null,
    },
    label: c.cruise_id,
    context: {
      vessel: c.vessel_name, operator: c.operator_name, departDate: c.depart_date, doi,
      qaDevices: (rec.qa || []).length,
      qaRatings: (rec.qa || []).map(q => q.rating).join(''),
    },
  };
}

/** The published side: the real DataCite record for each DOI the source names. */
export async function fetchPublished(dois) {
  const out = new Map();
  await inBatches(dois.map((d) => async () => {
    const j = await readJson(`${DATACITE}/${encodeURIComponent(d)}`);
    if (j?.data?.attributes) out.set(d, { id: d, type: 'dois', attributes: j.data.attributes });
  }), DOI_BATCH);
  return out;
}

// ── The crossing ──
//
// Two numbers per element: how much the source holds, and how much of it
// reaches the published record. Both are counted in VALUES, not records,
// because a record can publish "an ORCID" while dropping four of the five it
// holds.
//
// The DataCite pointer is part of every row on purpose. The audience for this
// is people who will have to change a minting template, and a percentage they
// cannot locate in their own schema is not something they can act on.

const agents = (a) => [...arr(a.creators), ...arr(a.contributors)];
const orcidSet = (a) => new Set(agents(a).flatMap(e => arr(e.nameIdentifiers)
  .filter(ni => /orcid/i.test(ni.nameIdentifierScheme || '') || /orcid\.org/i.test(ni.nameIdentifier || ''))
  .map(ni => String(ni.nameIdentifier).toLowerCase().split('orcid.org/').pop().replace(/\/+$/, ''))));

export const ELEMENTS = [
  { key: 'title', pointer: 'titles[].title', fair: ['F2'],
    count: a => arr(a.titles).filter(t => t.title).length,
    // A title is never "missing" in these records, it is SUBSTITUTED, so a bare
    // count would score a template string as a full carry. Identity matters here
    // and nowhere else, which is why this is the only element with a matcher.
    match: (s, p) => {
      const st = arr(s.titles)[0]?.title || '', pt = arr(p.titles)[0]?.title || '';
      return st && pt && st.trim().toLowerCase() === pt.trim().toLowerCase() ? 1 : 0;
    } },
  { key: 'abstract', pointer: 'descriptions[descriptionType=Abstract]', fair: ['F2', 'R1'],
    count: a => arr(a.descriptions).filter(d => d.description).length },
  { key: 'people', pointer: 'contributors[nameType=Personal].name', fair: ['R1.2'],
    count: a => agents(a).filter(e => e.nameType === 'Personal').length },
  { key: 'orcid', pointer: 'creators/contributors[].nameIdentifiers[scheme=ORCID]', fair: ['R1.2', 'I3'],
    count: a => orcidSet(a).size,
    match: (s, p) => { const S = orcidSet(s), P = orcidSet(p); return [...S].filter(x => P.has(x)).length; } },
  { key: 'affiliation', pointer: 'creators/contributors[].affiliation[].name', fair: ['R1.2'],
    count: a => agents(a).filter(e => arr(e.affiliation).length).length },
  { key: 'geoBox', pointer: 'geoLocations[].geoLocationBox', fair: ['F2', 'R1'],
    count: a => arr(a.geoLocations).filter(g => g.geoLocationBox).length },
  { key: 'geoPlace', pointer: 'geoLocations[].geoLocationPlace', fair: ['F2'],
    count: a => arr(a.geoLocations).filter(g => g.geoLocationPlace).length },
  { key: 'subjects', pointer: 'subjects[].subject', fair: ['F2', 'I2'],
    count: a => arr(a.subjects).filter(s => s.subject).length },
  { key: 'formats', pointer: 'formats[]', fair: ['R1'], count: a => arr(a.formats).length },
  { key: 'sizes', pointer: 'sizes[]', fair: ['R1'], count: a => arr(a.sizes).length },
  { key: 'related', pointer: 'relatedIdentifiers[].relatedIdentifier', fair: ['I3'],
    count: a => arr(a.relatedIdentifiers).length },
  { key: 'dates', pointer: 'dates[].date', fair: ['R1'], count: a => arr(a.dates).filter(d => d.date).length },
  { key: 'funding', pointer: 'fundingReferences[].funderName', fair: ['R1.2'],
    count: a => arr(a.fundingReferences).length },
  { key: 'licence', pointer: 'rightsList[].{rights,rightsUri}', fair: ['R1.1'],
    count: a => arr(a.rightsList).filter(r => r.rights || r.rightsUri).length },
];

export function buildLedger(pairs) {
  return ELEMENTS.map(e => {
    let srcCruises = 0, pubCruises = 0, srcValues = 0, pubValues = 0, carried = 0;
    for (const { source, published } of pairs) {
      const s = e.count(source.attributes), p = e.count(published.attributes);
      if (s > 0) srcCruises++;
      if (p > 0) pubCruises++;
      srcValues += s; pubValues += p;
      // Where identity can be established, count true carriage. Otherwise the
      // published count capped at the held count is the honest upper bound, and
      // `exact` says which of the two a row is.
      carried += e.match ? e.match(source.attributes, published.attributes) : Math.min(s, p);
    }
    return {
      element: e.key, pointer: e.pointer, fair: e.fair,
      srcCruises, pubCruises, srcValues, pubValues, carried,
      carryRate: srcValues ? Math.round(1000 * carried / srcValues) / 10 : null,
      lost: Math.max(0, srcValues - carried),
      exact: !!e.match,
    };
  });
}

/** Per-record crossing for ONE record: element by element, what happened to it. */
export function fieldMap(pair) {
  const { source: s, published: p } = pair;
  const show = (a, e) => { const n = e.count(a); return n === 0 ? null : n; };
  return ELEMENTS.map(e => {
    const sN = show(s.attributes, e), pN = show(p.attributes, e);
    return {
      element: e.key, pointer: e.pointer, fair: e.fair,
      sourceCount: sN, publishedCount: pN,
      status: sN && pN ? (e.match && e.match(s.attributes, p.attributes) === 0 ? 'replaced'
             : (pN >= sN ? 'carried' : 'partial'))
             : sN && !pN ? 'dropped'
             : !sN && pN ? 'added'
             : 'absent',
    };
  });
}

// ── Scoring, with the rubric that is already here ──
// The same assessDataCiteWork every other mode uses, so a score read in this
// view and a score read in the DataCite view cannot disagree.
function score(works) {
  const assessments = works.map(assessDataCiteWork);
  return { assessments, aggregate: aggregateAssessments(assessments) };
}

const viewOf = (agg) => ({
  percent: agg.overallPercent,
  score: agg.overallScore, max: agg.overallMax,
  principles: (agg.principles || []).map(p => ({
    letter: p.letter, name: p.name, score: p.score, max: p.maxScore,
    checks: (p.checks || []).map(c => ({ id: c.id, score: c.score })),
  })),
});

// ── Per-browser cache ──
// Six hours, the TTL the shared cache used, so a second look at the same vessel
// costs R2R nothing. Every access is guarded: localStorage throws outright in
// some privacy modes, and a cache that cannot be read is not a reason to fail.

const cacheKey = (source, value, n) => `fra:cx:v1:${source}:${String(value).toLowerCase()}:${n}`;

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { at, data } = JSON.parse(raw);
    if (!at || Date.now() - at > CACHE_TTL_MS) { localStorage.removeItem(key); return null; }
    return data;
  } catch { return null; }
}

function cachePut(key, data) {
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })); } catch { /* full or blocked */ }
}

// ── The public API of this module ──

/** Kept so app.js reads the same way it did: the mode no longer needs configuring. */
export const isConfigured = () => true;

/**
 * Cross one repository's own records against what it published.
 *
 * Throws 'no-records' / 'no-doi' / 'no-pairs' rather than returning an empty
 * shape, because each is a different thing to tell the user: nothing matched
 * the query, nothing the source holds is minted, or nothing minted is
 * retrievable from DataCite.
 */
export async function analyze(source, value, n = DEFAULT_SAMPLE) {
  if (source !== 'rvdata') throw new Error('unknown-source');
  const sample = Math.min(Math.max(parseInt(n, 10) || DEFAULT_SAMPLE, 1), MAX_SAMPLE);

  const key = cacheKey(source, value, sample);
  const hit = cacheGet(key);
  if (hit) return { ...hit, meta: { ...hit.meta, cached: true } };

  const recs = await r2rFetch(value, sample);
  if (!recs.length) throw new Error('no-records');

  const sourceWorks = recs.map(r2rToWork).filter(w => w.attributes.doi);
  if (!sourceWorks.length) throw new Error('no-doi');

  const published = await fetchPublished(sourceWorks.map(w => w.attributes.doi));
  const pairs = sourceWorks
    .filter(w => published.has(w.attributes.doi))
    .map(w => ({ source: w, published: published.get(w.attributes.doi), label: w.label, context: w.context }));
  if (!pairs.length) throw new Error('no-pairs');

  const A = score(pairs.map(p => p.source));
  const B = score(pairs.map(p => p.published));

  const out = {
    meta: {
      source, value, requested: sample, paired: pairs.length,
      generated: new Date().toISOString(),
      sourceApi: 'https://service.rvdata.us/', publishedApi: 'https://api.datacite.org/dois/',
    },
    views: { source: viewOf(A.aggregate), published: viewOf(B.aggregate) },
    ledger: buildLedger(pairs),
    records: pairs.map((p, i) => ({
      label: p.label, doi: p.source.attributes.doi,
      vessel: p.context.vessel, departDate: p.context.departDate,
      qaDevices: p.context.qaDevices, qaRatings: p.context.qaRatings,
      sourcePercent: A.assessments[i]?.overallPercent ?? null,
      publishedPercent: B.assessments[i]?.overallPercent ?? null,
      links: {
        doi: `https://doi.org/${p.source.attributes.doi}`,
        datacite: `${DATACITE}/${p.source.attributes.doi}`,
        cruise: `${R2R}/cruise/?cruise_id=${encodeURIComponent(p.label)}`,
        qa: `${R2R}/qa_info/?cruise_id=${encodeURIComponent(p.label)}`,
      },
    })),
    fieldMap: { record: pairs[0].label, rows: fieldMap(pairs[0]) },
  };

  cachePut(key, out);
  return out;
}
