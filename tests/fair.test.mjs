// Unit tests for the FAIR engine (src/fair.js) — pure functions, no DOM needed.
// Run with:  node --test tests/
//
// These double as the parity fixture against the server-side engine in
// Repo MetAudits: any change that flips an expected score here should be
// mirrored there (or consciously documented as a divergence).

import test from 'node:test';
import assert from 'node:assert/strict';
import { assessDataCiteWork, assessOaiRecord, aggregateAssessments } from '../src/fair.js';

// ── helpers ──

const scoreOf = (assessment, checkId) => {
  for (const p of assessment.principles) {
    const c = p.checks.find(c => c.id === checkId);
    if (c) return c.score;
  }
  throw new Error(`check ${checkId} not found`);
};

const work = (attributes) => ({ id: 'x', type: 'dois', attributes: { doi: '10.1234/test', ...attributes } });

const oaiRecord = (metadata, header = {}) => ({
  header: { identifier: 'oai:example.org:1', datestamp: '2024-01-01', setSpec: [], ...header },
  metadata,
});

// ── DataCite: F1 / F3 ──

test('DataCite F1/F3: DOI present scores full, absent scores zero', () => {
  const withDoi = assessDataCiteWork(work({}));
  assert.equal(scoreOf(withDoi, 'F1'), 1);
  assert.equal(scoreOf(withDoi, 'F3'), 1);
  const noDoi = assessDataCiteWork({ id: 'x', type: 'dois', attributes: {} });
  assert.equal(scoreOf(noDoi, 'F1'), 0);
  assert.equal(scoreOf(noDoi, 'F3'), 0);
});

// ── DataCite: I3 (typed vs untyped relations) ──

test('DataCite I3: no relatedIdentifiers scores zero', () => {
  const a = assessDataCiteWork(work({ relatedIdentifiers: [] }));
  assert.equal(scoreOf(a, 'I3'), 0);
});

test('DataCite I3: relations WITHOUT relationType score partial, not full', () => {
  const a = assessDataCiteWork(work({
    relatedIdentifiers: [{ relatedIdentifier: '10.1/abc', relatedIdentifierType: 'DOI' }],
  }));
  assert.equal(scoreOf(a, 'I3'), 0.5);
});

test('DataCite I3: typed relations score full', () => {
  const a = assessDataCiteWork(work({
    relatedIdentifiers: [{ relatedIdentifier: '10.1/abc', relatedIdentifierType: 'DOI', relationType: 'References' }],
  }));
  assert.equal(scoreOf(a, 'I3'), 1);
});

// ── DataCite: R1.1 (license tiers) ──

test('DataCite R1.1: no rightsList → 0, free text → 0.5, URI → 1', () => {
  assert.equal(scoreOf(assessDataCiteWork(work({})), 'R1.1'), 0);
  assert.equal(scoreOf(assessDataCiteWork(work({
    rightsList: [{ rights: 'Creative Commons Attribution 4.0' }],
  })), 'R1.1'), 0.5);
  assert.equal(scoreOf(assessDataCiteWork(work({
    rightsList: [{ rights: 'CC BY 4.0', rightsUri: 'https://creativecommons.org/licenses/by/4.0/' }],
  })), 'R1.1'), 1);
});

test('license: SPDX identifier + scheme marks spdxDeclared', () => {
  const a = assessDataCiteWork(work({
    rightsList: [{ rights: 'MIT', rightsIdentifier: 'MIT', rightsIdentifierScheme: 'SPDX' }],
  }));
  assert.equal(a.license.spdxDeclared, true);
  assert.equal(a.license.primaryName, 'MIT License');
  assert.equal(a.license.class, 'open');
});

test('license: "MIT" as university name is NOT classified as MIT License', () => {
  const a = assessDataCiteWork(work({
    rightsList: [{ rights: '© Massachusetts Institute of Technology (MIT). All rights reserved.' }],
  }));
  assert.notEqual(a.license.primaryName, 'MIT License');
  assert.notEqual(a.license.class, 'open');
});

test('license: "MIT License" free text still recognized as open', () => {
  const a = assessDataCiteWork(work({ rightsList: [{ rights: 'Released under the MIT License' }] }));
  assert.equal(a.license.primaryName, 'MIT License');
  assert.equal(a.license.class, 'open');
});

test('license: SPDX MIT WITH a rightsUri classifies open (structured id beats blob regex)', () => {
  const a = assessDataCiteWork(work({
    rightsList: [{ rights: 'MIT', rightsUri: 'https://spdx.org/licenses/MIT.html', rightsIdentifier: 'MIT', rightsIdentifierScheme: 'SPDX' }],
  }));
  assert.equal(a.license.primaryName, 'MIT License');
  assert.equal(a.license.class, 'open');
  assert.equal(a.license.machineReadable, true);
});

test('license: any SPDX open identifier classifies open, even without a text pattern', () => {
  for (const id of ['BSD-3-Clause', 'MPL-2.0', 'Unlicense', '0BSD', 'GPL-3.0-or-later', 'CC-BY-4.0']) {
    const a = assessDataCiteWork(work({
      rightsList: [{ rights: id, rightsIdentifier: id, rightsIdentifierScheme: 'SPDX' }],
    }));
    assert.equal(a.license.class, 'open', `${id} should be open, got ${a.license.class} (${a.license.primaryName})`);
  }
});

test('license: SPDX non-commercial CC identifiers classify restricted, not open', () => {
  const a = assessDataCiteWork(work({
    rightsList: [{ rights: 'CC BY-NC 4.0', rightsIdentifier: 'CC-BY-NC-4.0', rightsIdentifierScheme: 'SPDX' }],
  }));
  assert.equal(a.license.class, 'restricted');
});

test('license: OSI license URIs classify open in both URL forms (plural and current singular)', () => {
  for (const uri of ['https://opensource.org/licenses/MIT', 'https://opensource.org/license/mit']) {
    const a = assessDataCiteWork(work({ rightsList: [{ rights: 'See license', rightsUri: uri }] }));
    assert.equal(a.license.primaryName, 'MIT License', uri);
    assert.equal(a.license.class, 'open', uri);
  }
});

test('license: free-text MIT phrasings recognized ("Licensed under MIT", "MIT-licensed", bare "MIT-0")', () => {
  for (const text of ['Licensed under MIT', 'This dataset is MIT-licensed', 'MIT-0']) {
    const a = assessDataCiteWork(work({ rightsList: [{ rights: text }] }));
    assert.equal(a.license.class, 'open', text);
  }
});

test('license: proper nouns no longer false-positive (Open Access repository, Apache Point)', () => {
  for (const text of [
    'Deposited in the Open Access repository of the university',
    'Apache Point Observatory data v2.0',
  ]) {
    const a = assessDataCiteWork(work({ rightsList: [{ rights: text }] }));
    assert.notEqual(a.license.class, 'open', text);
  }
});

test('license: real open-access and Apache declarations still recognized', () => {
  const euRepo = assessDataCiteWork(work({ rightsList: [{ rights: 'info:eu-repo/semantics/openAccess' }] }));
  assert.equal(euRepo.license.class, 'open');
  const bare = assessDataCiteWork(work({ rightsList: [{ rights: 'Open Access' }] }));
  assert.equal(bare.license.class, 'open');
  const apache = assessDataCiteWork(work({ rightsList: [{ rights: 'Apache License, Version 2.0' }] }));
  assert.equal(apache.license.primaryName, 'Apache 2.0');
  const gnu = assessDataCiteWork(work({ rightsList: [{ rights: 'GNU General Public License v3.0' }] }));
  assert.equal(gnu.license.primaryName, 'GPL');
});

// ── DataCite: R1.2 (provenance) ──

test('DataCite R1.2: ORCID → 1, affiliation only → 0.5, bare creator → 0.5, none → 0', () => {
  const orcid = work({ creators: [{ name: 'A', nameIdentifiers: [{ nameIdentifierScheme: 'ORCID', nameIdentifier: 'https://orcid.org/0000-0001-2345-6789' }] }] });
  assert.equal(scoreOf(assessDataCiteWork(orcid), 'R1.2'), 1);
  const affil = work({ creators: [{ name: 'A', affiliation: [{ name: 'Uni' }] }] });
  assert.equal(scoreOf(assessDataCiteWork(affil), 'R1.2'), 0.5);
  const bare = work({ creators: [{ name: 'A' }] });
  assert.equal(scoreOf(assessDataCiteWork(bare), 'R1.2'), 0.5);
  assert.equal(scoreOf(assessDataCiteWork(work({})), 'R1.2'), 0);
});

// ── DataCite: connectivity counts ──

test('DataCite connectivity: ORCID/ROR/funder identifiers are counted', () => {
  const a = assessDataCiteWork(work({
    creators: [
      { name: 'A', nameIdentifiers: [{ nameIdentifierScheme: 'ORCID', nameIdentifier: 'x' }], affiliation: [{ name: 'U', affiliationIdentifier: 'https://ror.org/x' }] },
      { name: 'B', affiliation: [{ name: 'V' }] },
    ],
    fundingReferences: [{ funderName: 'F', funderIdentifier: 'https://doi.org/10.13039/1' }, { funderName: 'G' }],
  }));
  assert.deepEqual(a.connectivity, {
    creators: 2, creatorsId: 1,
    affiliations: 2, affiliationsId: 1,
    funders: 2, fundersId: 1,
    contributors: 0, contributorsId: 0,
  });
});

// ── OAI-PMH: F1 (identifier classes) ──

test('OAI F1: DOI → 1, bare URL → 0.5, nothing → 0', () => {
  const base = { title: ['T'], creator: ['C'] };
  assert.equal(scoreOf(assessOaiRecord(oaiRecord({ ...base, identifier: ['10.1234/abc'] })), 'F1'), 1);
  assert.equal(scoreOf(assessOaiRecord(oaiRecord({ ...base, identifier: ['https://doi.org/10.1/x'] })), 'F1'), 1);
  assert.equal(scoreOf(assessOaiRecord(oaiRecord({ ...base, identifier: ['https://example.org/item/1'] })), 'F1'), 0.5);
  assert.equal(scoreOf(assessOaiRecord(oaiRecord(base)), 'F1'), 0);
});

// ── OAI-PMH: A2 (deleted records) ──

test('OAI A2: active record → 1, deleted record → 0.5', () => {
  assert.equal(scoreOf(assessOaiRecord(oaiRecord({ title: ['T'] })), 'A2'), 1);
  assert.equal(scoreOf(assessOaiRecord(oaiRecord({}, { status: 'deleted' })), 'A2'), 0.5);
});

// ── OAI-PMH: I2 (controlled vocabularies) ──

test('OAI I2: DCMI type + ISO language → 1, only one signal → 0.5, none → 0', () => {
  const both = oaiRecord({ type: ['Dataset'], language: ['en'] });
  assert.equal(scoreOf(assessOaiRecord(both), 'I2'), 1);
  const one = oaiRecord({ type: ['Dataset'], language: ['English'] });
  assert.equal(scoreOf(assessOaiRecord(one), 'I2'), 0.5);
  const none = oaiRecord({ type: ['journal article'], language: ['English'] });
  assert.equal(scoreOf(assessOaiRecord(none), 'I2'), 0);
});

// ── OAI-PMH: a fully-populated record scores full on the content checks ──

test('OAI: rich Dublin Core record hits full marks across the rubric', () => {
  const a = assessOaiRecord(oaiRecord({
    title: ['A study'], creator: ['Doe, J.'], subject: ['610'], description: ['An abstract.'],
    publisher: ['Uni Press'], contributor: ['Roe, R.'], date: ['2023-05-01'], type: ['Dataset'],
    format: ['text/csv'], identifier: ['10.1234/abc'], source: ['Survey 2022'],
    language: ['en'], relation: ['https://doi.org/10.1/rel'], coverage: ['Chile'],
    rights: ['CC BY 4.0 https://creativecommons.org/licenses/by/4.0/'],
  }));
  assert.equal(a.overallPercent, 100);
});

// ── Aggregation ──

test('aggregate: mean of per-check scores rounds to 0 / 0.5 / 1 bands', () => {
  const full = assessOaiRecord(oaiRecord({
    title: ['T'], creator: ['C'], subject: ['610'], description: ['D'], publisher: ['P'],
    contributor: ['X'], date: ['2023-01-01'], type: ['Dataset'], identifier: ['10.1234/a'],
    language: ['en'], rights: ['CC BY 4.0 https://creativecommons.org/licenses/by/4.0/'],
    relation: ['https://doi.org/10.1/r'],
  }));
  const empty = assessOaiRecord(oaiRecord({}));
  const agg = aggregateAssessments([full, full, full, empty]);   // avg 0.75 on the varying checks → rounds to 1
  assert.equal(scoreOf(agg, 'F1'), 1);
  const agg2 = aggregateAssessments([full, empty]);              // avg 0.5 → stays 0.5
  assert.equal(scoreOf(agg2, 'F1'), 0.5);
  assert.equal(agg.identifier, 'Aggregate (4 records)');
});

test('aggregate: each check carries rawMean (unrounded), alongside the banded score', () => {
  const full = assessOaiRecord(oaiRecord({
    title: ['T'], creator: ['C'], subject: ['610'], description: ['D'], publisher: ['P'],
    contributor: ['X'], date: ['2023-01-01'], type: ['Dataset'], identifier: ['10.1234/a'],
    language: ['en'], rights: ['CC BY 4.0 https://creativecommons.org/licenses/by/4.0/'],
    relation: ['https://doi.org/10.1/r'],
  }));
  const empty = assessOaiRecord(oaiRecord({}));
  const agg = aggregateAssessments([full, full, full, empty]);
  const f1 = agg.principles[0].checks.find(c => c.id === 'F1');
  assert.equal(f1.score, 1);          // rounded band
  assert.equal(f1.rawMean, 0.75);     // true mean preserved for meters
});

test('aggregate: license profile counts classes and machine-readability', () => {
  const open = assessDataCiteWork(work({ rightsList: [{ rights: 'CC BY 4.0', rightsUri: 'https://creativecommons.org/licenses/by/4.0/' }] }));
  const none = assessDataCiteWork(work({}));
  const agg = aggregateAssessments([open, open, none]);
  assert.equal(agg.licenseProfile.total, 3);
  assert.equal(agg.licenseProfile.classes.open, 2);
  assert.equal(agg.licenseProfile.classes.none, 1);
  assert.equal(agg.licenseProfile.machineReadablePct, 66.7);
});
