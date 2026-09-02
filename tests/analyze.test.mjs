// The source-vs-published crossing, which runs in the browser like everything
// else since September 2026. What is worth testing here is what silently
// produces a plausible wrong number: the mapping from R2R's shape into the
// DataCite one, the two elements that are counted by identity rather than by
// count, and the arithmetic of the ledger. Synthetic fixtures throughout, so
// recalibrating against real data cannot break a test that is about the maths.
//
// The politeness tests exist because the shared server-side cache was given up
// when this moved into the browser: batching is now the only thing standing
// between a public research API and one visitor's ten cruises.
//
// Run with:  node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bareDoi, r2rToWork, r2rFetch, fetchPublished, buildLedger, fieldMap, analyze,
} from '../src/analyze.js?v=33';

// ── Fixtures ──

const cruise = {
  cruise_id: 'AT26-13',
  cruise_name: 'Deep methane seeps',
  cruise_doi: 'https://doi.org/10.7284/903000',
  operator_name: 'Woods Hole Oceanographic Institution',
  vessel_name: 'RV Atlantis',
  depart_date: '2014-05-01', arrive_date: '2014-05-20',
  depart_port_fullname: 'Woods Hole', arrive_port_fullname: 'Bermuda',
  waterbody_name: 'North Atlantic',
  longitude_min: '-71.0', longitude_max: '-64.0',
  latitude_min: '30.0', latitude_max: '41.5',
};
const persons = [
  { person_name: 'Ada Chief', roletype_id: 'chief_scientist', institution_name: 'WHOI',
    person_url: 'https://orcid.org/0000-0002-1825-0097' },
  { person_name: 'Bo Crew', roletype_id: 'technician', institution_name: 'URI',
    person_url: 'https://orcid.org/0000-0001-5058-9309' },
];
const filesets = [
  { abstract: 'Multibeam survey.', device_type: 'multibeam', format_name: 'MB-System', total_bytes: '1000' },
  { abstract: 'CTD casts.', device_type: 'ctd', format_name: 'NetCDF', total_bytes: '2000' },
];
const rec = { cruise, persons, filesets, articles: [{ doi: '10.1000/paper-one' }], qa: [{ rating: 'A' }, { rating: 'B' }] };

/** The published record: a title replaced by the cruise ID, one ORCID of two kept. */
const published = {
  id: '10.7284/903000', type: 'dois',
  attributes: {
    doi: '10.7284/903000',
    titles: [{ title: 'AT26-13' }],
    descriptions: [],
    creators: [{ name: 'Ada Chief', nameType: 'Personal', affiliation: [],
      nameIdentifiers: [{ nameIdentifier: '0000-0002-1825-0097', nameIdentifierScheme: 'ORCID' }] }],
    contributors: [],
    subjects: [{ subject: 'oceanography' }, { subject: 'methane' }],
    formats: [], sizes: [],
    geoLocations: [{ geoLocationBox: { westBoundLongitude: -71, eastBoundLongitude: -64,
      southBoundLatitude: 30, northBoundLatitude: 41.5 } }],
    dates: [{ date: '2014-05-01', dateType: 'Collected' }],
    relatedIdentifiers: [],
    rightsList: [{ rights: 'CC0 1.0' }],
    fundingReferences: [],
  },
};

// ── DOIs ──

test('bareDoi strips every URL form a DOI arrives in', () => {
  for (const form of ['10.7284/903000', 'https://doi.org/10.7284/903000',
                      'http://dx.doi.org/10.7284/903000', '  10.7284/903000  ']) {
    assert.equal(bareDoi(form), '10.7284/903000');
  }
  assert.equal(bareDoi(null), '');
});

// ── The mapping ──

test('r2rToWork carries every element the source actually holds', () => {
  const w = r2rToWork(rec);
  const a = w.attributes;
  assert.equal(a.doi, '10.7284/903000');
  assert.equal(a.titles[0].title, 'Deep methane seeps');
  assert.equal(a.publicationYear, 2014);
  // The chief scientist becomes the creator; everyone stays as a contributor.
  assert.equal(a.creators.length, 1);
  assert.equal(a.creators[0].name, 'Ada Chief');
  assert.equal(a.contributors.length, 2);
  assert.equal(a.descriptions.length, 1);
  assert.equal(a.subjects.length, 2);
  assert.deepEqual(a.formats, ['MB-System', 'NetCDF']);
  assert.deepEqual(a.sizes, ['3000 bytes']);
  assert.equal(a.geoLocations.length, 2);        // place and box
  assert.equal(a.dates.length, 2);               // depart and arrive
  assert.equal(a.relatedIdentifiers.length, 1);
  assert.equal(w.context.qaRatings, 'AB');
  assert.equal(w.label, 'AT26-13');
});

test('rightsList and fundingReferences stay empty, because R2R holds neither', () => {
  // Inventing them would turn "nobody has this" into "publication lost it",
  // which is the difference between new work and a transfer failure.
  const a = r2rToWork(rec).attributes;
  assert.deepEqual(a.rightsList, []);
  assert.deepEqual(a.fundingReferences, []);
});

test('a cruise with no people at all still names its chief scientist', () => {
  const w = r2rToWork({ cruise: { ...cruise, chief_scientist: 'Solo Lead' }, persons: [], filesets: [], articles: [] });
  assert.equal(w.attributes.creators.length, 1);
  assert.equal(w.attributes.creators[0].name, 'Solo Lead');
});

test('a partial bounding box is not a bounding box', () => {
  // Three of four edges is not a box, and emitting one would score geoBox as
  // held on the source side and lost on the published side: a false gap.
  const w = r2rToWork({ cruise: { ...cruise, latitude_max: null }, persons: [], filesets: [], articles: [] });
  assert.equal(w.attributes.geoLocations.filter(g => g.geoLocationBox).length, 0);
  assert.equal(w.attributes.geoLocations.filter(g => g.geoLocationPlace).length, 1);
});

// ── The ledger ──

const pair = () => ({ source: r2rToWork(rec), published, label: 'AT26-13', context: r2rToWork(rec).context });
const row = (ledger, key) => ledger.find(r => r.element === key);

test('the ledger counts values, not records, and reports what did not survive', () => {
  const l = buildLedger([pair()]);

  // A title is replaced, not dropped: counted by identity, so carriage is zero
  // even though both sides hold exactly one title.
  assert.deepEqual(row(l, 'title'), {
    element: 'title', pointer: 'titles[].title', fair: ['F2'],
    srcCruises: 1, pubCruises: 1, srcValues: 1, pubValues: 1,
    carried: 0, carryRate: 0, lost: 1, exact: true,
  });

  // Two ORCIDs held, one published, and it is one of the two: true carriage.
  const orcid = row(l, 'orcid');
  assert.deepEqual([orcid.srcValues, orcid.pubValues, orcid.carried, orcid.carryRate, orcid.exact],
    [2, 1, 1, 50, true]);

  // No matcher: the published count capped at the held count, flagged inexact.
  const subjects = row(l, 'subjects');
  assert.deepEqual([subjects.srcValues, subjects.pubValues, subjects.carried, subjects.carryRate, subjects.exact],
    [2, 2, 2, 100, false]);

  // Held and not published at all.
  assert.deepEqual([row(l, 'formats').srcValues, row(l, 'formats').carried, row(l, 'formats').lost], [2, 0, 0 + 2]);

  // Held by neither side reads as a gap on both, never as a loss.
  assert.deepEqual([row(l, 'licence').srcValues, row(l, 'licence').carryRate], [0, null]);
});

test('carryRate is null rather than zero when the source holds nothing', () => {
  // Zero would read as "everything was lost" on a row where there was nothing
  // to lose, and that row is exactly where a reader looks for work to do.
  const l = buildLedger([pair()]);
  assert.equal(row(l, 'funding').carryRate, null);
  assert.equal(row(l, 'funding').lost, 0);
});

test('the ledger adds up across records rather than averaging percentages', () => {
  const l = buildLedger([pair(), pair()]);
  assert.equal(row(l, 'orcid').srcValues, 4);
  assert.equal(row(l, 'orcid').carried, 2);
  assert.equal(row(l, 'orcid').srcCruises, 2);
});

// ── The per-record field map ──

test('fieldMap names what happened to each element, not just whether it matched', () => {
  const rows = Object.fromEntries(fieldMap(pair()).map(r => [r.element, r.status]));
  assert.deepEqual(rows, {
    title: 'replaced',      // both sides hold one, and they are different
    abstract: 'dropped',
    people: 'partial',      // three agents held, one published
    orcid: 'partial',
    affiliation: 'dropped', // the published creator carries no affiliation
    geoBox: 'carried',
    geoPlace: 'dropped',
    subjects: 'carried',
    formats: 'dropped',
    sizes: 'dropped',
    related: 'dropped',
    dates: 'partial',
    funding: 'absent',      // neither side: a gap, not a loss
    licence: 'added',       // the published record knows something the source does not
  });
});

test('every field map row carries the DataCite pointer that locates it', () => {
  // The audience maintains a minting template. A percentage they cannot find in
  // their own schema is not something they can act on.
  for (const r of fieldMap(pair())) {
    assert.ok(r.pointer && /\[|\./.test(r.pointer), `${r.element} has no usable pointer`);
    assert.ok(Array.isArray(r.fair) && r.fair.length, `${r.element} names no FAIR sub-principle`);
  }
});

// ── Politeness towards a public research API ──

const withFetch = async (impl, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
};
const jsonRes = (body) => new Response(JSON.stringify(body), {
  status: 200, headers: { 'Content-Type': 'application/json' } });

test('cruise details are read three cruises at a time, not all at once', async () => {
  const cruises = Array.from({ length: 9 }, (_, i) => ({ ...cruise, cruise_id: `C${i}` }));
  let live = 0, peak = 0;
  await withFetch(async (url) => {
    if (url.includes('/cruise/?cruise_id=')) return jsonRes({ data: [] });
    if (url.includes('/cruise/?vessel_shortname=')) return jsonRes({ data: cruises });
    live++; peak = Math.max(peak, live);
    await new Promise(r => setTimeout(r, 5));
    live--;
    return jsonRes({ data: [] });
  }, () => r2rFetch('Atlantis', 9));
  // Four detail endpoints per cruise, three cruises in flight: twelve reads,
  // never thirty-six. Without batching this test sees 36.
  assert.equal(peak, 12, `peak concurrency was ${peak}`);
});

test('DataCite lookups are read five at a time', async () => {
  const dois = Array.from({ length: 12 }, (_, i) => `10.1000/d${i}`);
  let live = 0, peak = 0;
  await withFetch(async () => {
    live++; peak = Math.max(peak, live);
    await new Promise(r => setTimeout(r, 5));
    live--;
    return jsonRes({ data: { attributes: { doi: 'x' } } });
  }, () => fetchPublished(dois));
  assert.equal(peak, 5, `peak concurrency was ${peak}`);
});

test('one unreachable detail endpoint costs one field, not the whole run', async () => {
  const out = await withFetch(async (url) => {
    if (url.includes('/cruise/?cruise_id=')) return jsonRes({ data: [] });
    if (url.includes('/cruise/?vessel_shortname=')) return jsonRes({ data: [cruise] });
    if (url.includes('/person/')) throw new Error('network');
    return jsonRes({ data: [] });
  }, () => r2rFetch('Atlantis', 1));
  assert.equal(out.length, 1);
  assert.deepEqual(out[0].persons, []);
});

// ── The three empty outcomes ──

test('each way of finding nothing raises its own error', async () => {
  const noCruises = () => withFetch(async () => jsonRes({ data: [] }), () => analyze('rvdata', 'Nobody', 5));
  await assert.rejects(noCruises, /no-records/);

  const noDoi = () => withFetch(async (url) =>
    url.includes('/cruise/') ? jsonRes({ data: [{ ...cruise, cruise_doi: null }] }) : jsonRes({ data: [] }),
    () => analyze('rvdata', 'Atlantis', 1));
  await assert.rejects(noDoi, /no-doi/);

  const noPairs = () => withFetch(async (url) =>
    url.includes('api.datacite.org') ? new Response('{}', { status: 404 })
      : url.includes('/cruise/') ? jsonRes({ data: [cruise] }) : jsonRes({ data: [] }),
    () => analyze('rvdata', 'Atlantis', 1));
  await assert.rejects(noPairs, /no-pairs/);
});

test('an unknown source is refused before a single request is made', async () => {
  await withFetch(() => { throw new Error('should not fetch'); },
    () => assert.rejects(() => analyze('not-a-source', 'x', 1), /unknown-source/));
});

// ── The per-browser cache ──

const withStorage = async (fn) => {
  const real = globalThis.localStorage;
  const map = new Map();
  globalThis.localStorage = {
    getItem: (k) => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  try { return await fn(map); } finally { globalThis.localStorage = real; }
};

test('a repeated analysis is served from this browser, not from the research API', async () => {
  await withStorage(async () => {
    let calls = 0;
    const impl = async (url) => {
      calls++;
      if (url.includes('api.datacite.org')) return jsonRes({ data: { attributes: published.attributes } });
      if (url.includes('/cruise/?cruise_id=')) return jsonRes({ data: [] });
      if (url.includes('/cruise/?vessel_shortname=')) return jsonRes({ data: [cruise] });
      return jsonRes({ data: [] });
    };
    const first = await withFetch(impl, () => analyze('rvdata', 'Atlantis', 1));
    const after = calls;
    const second = await withFetch(impl, () => analyze('rvdata', 'Atlantis', 1));
    assert.equal(calls, after, 'the second call reached the network');
    assert.equal(second.meta.cached, true);
    assert.equal(first.meta.cached, undefined);
    assert.equal(second.ledger.length, first.ledger.length);
  });
});

test('a browser that refuses storage still returns an analysis', async () => {
  // Private modes throw on access rather than returning null, and a cache that
  // cannot be read is not a reason to fail an analysis.
  const real = globalThis.localStorage;
  globalThis.localStorage = { get getItem() { throw new Error('denied'); },
                              setItem() { throw new Error('denied'); }, removeItem() {} };
  try {
    const out = await withFetch(async (url) => {
      if (url.includes('api.datacite.org')) return jsonRes({ data: { attributes: published.attributes } });
      if (url.includes('/cruise/?cruise_id=')) return jsonRes({ data: [] });
      if (url.includes('/cruise/?vessel_shortname=')) return jsonRes({ data: [cruise] });
      return jsonRes({ data: [] });
    }, () => analyze('rvdata', 'Atlantis', 1));
    assert.equal(out.meta.paired, 1);
  } finally { globalThis.localStorage = real; }
});

// ── Parity with the rest of the tool ──

test('both sides are scored by the same rubric the other modes use', async () => {
  const { assessDataCiteWork } = await import('../src/fair.js?v=33');
  // The stub serves the whole fixture, details included, so the work built
  // inside analyze() is the same work the direct call scores. Serving a bare
  // cruise here would compare two different records and pass or fail for the
  // wrong reason.
  const out = await withStorage(() => withFetch(async (url) => {
    if (url.includes('api.datacite.org')) return jsonRes({ data: { attributes: published.attributes } });
    if (url.includes('/cruise/?cruise_id=')) return jsonRes({ data: [] });
    if (url.includes('/cruise/?vessel_shortname=')) return jsonRes({ data: [cruise] });
    if (url.includes('/person/')) return jsonRes({ data: persons });
    if (url.includes('/fileset/')) return jsonRes({ data: filesets });
    if (url.includes('/article/')) return jsonRes({ data: rec.articles });
    if (url.includes('/qa_info/')) return jsonRes({ data: rec.qa });
    return jsonRes({ data: [] });
  }, () => analyze('rvdata', 'Atlantis', 1)));

  assert.equal(out.records[0].sourcePercent, assessDataCiteWork(r2rToWork(rec)).overallPercent);
  assert.equal(out.records[0].publishedPercent, assessDataCiteWork(published).overallPercent);
  assert.equal(out.views.source.percent, out.records[0].sourcePercent);
});
