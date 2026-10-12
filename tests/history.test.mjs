// History's three readings over the cohort samples. Each one guards against a
// way the plain cohort score was misread, so each test pins the case that
// prompted it, with numbers from DataverseNL (dans.dataversenl), 2026-10-12.
//
// Run with:  node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { bulkCandidates, cohortMoves, cohortConcepts, HX_CONCEPTS } from '../src/history.js';

const work = (updated, attributes = {}) => ({ attributes: { updated, ...attributes } });

test('a burst over two days is found as one window', () => {
  // DataverseNL re-sent its records on 2025-07-02 and 03 (3,868 + 4,415 of 9,676).
  const works = [
    ...Array.from({ length: 4 }, () => work('2025-07-02T10:00:00Z')),
    ...Array.from({ length: 4 }, () => work('2025-07-03T09:00:00Z')),
    work('2025-03-11T00:00:00Z'), work('2025-11-20T00:00:00Z'),
  ];
  assert.deepEqual(bulkCandidates(works), [{ year: 2025, from: '2025-07-01', to: '2025-07-03' }]);
});

test('edits spread over the year are not a burst', () => {
  const works = ['01', '02', '03', '04', '05', '06', '07', '08'].map((m) => work(`2024-${m}-15T00:00:00Z`));
  assert.deepEqual(bulkCandidates(works), []);
});

test('two records on one day are too few to call a burst', () => {
  assert.deepEqual(bulkCandidates([work('2023-05-01T00:00:00Z'), work('2023-05-01T00:00:00Z')]), []);
});

test('a missing or malformed date is skipped, not counted', () => {
  const works = [work(null), work('garbage'), ...Array.from({ length: 3 }, () => work('2022-02-02T00:00:00Z'))];
  assert.deepEqual(bulkCandidates(works), [{ year: 2022, from: '2022-02-01', to: '2022-02-03' }]);
});

const agg = (checks) => ({ principles: [{ letter: 'R', checks }] });

test('the moves between cohorts use unrounded means and keep the largest first', () => {
  const a = agg([
    { id: 'R1.1', name: 'Licence', score: 0.5, rawMean: 0.2 },
    { id: 'R1.2', name: 'Provenance', score: 0.5, rawMean: 0.5 },
    { id: 'R1', name: 'Attributes', score: 1, rawMean: 0.9 },
  ]);
  const b = agg([
    { id: 'R1.1', name: 'Licence', score: 1, rawMean: 1 },
    { id: 'R1.2', name: 'Provenance', score: 0.5, rawMean: 0.2 },
    { id: 'R1', name: 'Attributes', score: 1, rawMean: 1 },
  ]);
  const m = cohortMoves(a, b);
  assert.deepEqual(m.map((x) => x.id), ['R1.1', 'R1.2'], 'R1 moved by 0.1, under the quarter-point floor');
  assert.equal(m[0].from, 0.2, 'the rounded band (0.5) would have hidden most of the move');
});

test('identifier shares tell a written affiliation from a ROR id', () => {
  // The Leiden dataset's creators carry "leidenuniv.nl" as an affiliation, no ROR.
  const named = { creators: [{ name: 'A', affiliation: [{ name: 'leidenuniv.nl' }] }] };
  const ror = { creators: [{ name: 'B', affiliation: [{ name: 'Leiden University', affiliationIdentifier: 'https://ror.org/027bh9e22', affiliationIdentifierScheme: 'ROR' }] }] };
  const c = cohortConcepts([{ attributes: named }, { attributes: named }, { attributes: ror }, { attributes: {} }]);
  assert.deepEqual(Object.keys(c), HX_CONCEPTS);
  assert.equal(c.authorAffiliation, 75);
  assert.equal(c.affiliationRor, 25);
  assert.deepEqual(cohortConcepts([]), Object.fromEntries(HX_CONCEPTS.map((k) => [k, null])));
});

test('a cohort is a random sample of its year, not its last weeks', async () => {
  // sort=-created returned DataverseNL's ten newest 2021 records, all from 2021-12,
  // out of 4,225 minted that year.
  const { fetchRegisteredCohort } = await import('../src/datacite.js');
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => { seen.push(String(url)); return new Response(JSON.stringify({ data: [], meta: { total: 0 } })); };
  try { await fetchRegisteredCohort('clientId', 'dans.dataversenl', 2021, { pageSize: 10 }); }
  finally { globalThis.fetch = real; }
  const q = new URL(seen[0]).searchParams;
  assert.equal(q.get('random'), 'true');
  assert.equal(q.get('sort'), null);
  assert.equal(q.get('page[size]'), '10');
});

test('a bar lists its own records: the right field, newest first, and the full list offered', async () => {
  const { fetchYearRecords } = await import('../src/datacite.js');
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => { seen.push(String(url)); return new Response(JSON.stringify({ data: [{ id: '10.1/a' }], meta: { total: 9676 } })); };
  let r;
  try { r = await fetchYearRecords('clientId', 'dans.dataversenl', 'updated', 2025); }
  finally { globalThis.fetch = real; }
  const q = new URL(seen[0]).searchParams;
  assert.equal(q.get('query'), 'updated:[2025-01-01 TO 2025-12-31]', 'an "updated" bar lists by updated, not by registered');
  assert.equal(q.get('sort'), '-updated');
  assert.equal(q.get('client-id'), 'dans.dataversenl');
  assert.equal(r.total, 9676);
  assert.equal(r.url, seen[0], 'the URL offered is the one that produced the list');
});

test('a flagged burst is listed by its own window, not by the whole year', async () => {
  const { fetchYearRecords } = await import('../src/datacite.js');
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url) => { seen.push(String(url)); return new Response(JSON.stringify({ data: [], meta: { total: 8284 } })); };
  try { await fetchYearRecords('clientId', 'dans.dataversenl', 'updated', 2025, { from: '2025-07-02', to: '2025-07-04' }); }
  finally { globalThis.fetch = real; }
  assert.equal(new URL(seen[0]).searchParams.get('query'), 'updated:[2025-07-02 TO 2025-07-04]');
});
