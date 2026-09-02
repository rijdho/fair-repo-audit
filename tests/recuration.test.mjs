// Replaying a DataCite audit log is the kind of code that fails silently: a
// wrong field name or a mishandled [before, after] tuple still produces a
// plausible-looking record. These tests pin the two things that would be wrong
// without being obviously wrong.
//
// Run with:  node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructVersions, bareDoi } from '../src/recuration.js';

const act = (version, action, changes, day) => ({
  version, action, changes, 'prov:generatedAtTime': `2020-0${day}-01T00:00:00Z`,
});

test('bareDoi strips every URL form a DOI arrives in', () => {
  for (const s of ['10.7284/900421', 'https://doi.org/10.7284/900421',
                   'http://dx.doi.org/10.7284/900421', '  10.7284/900421  ']) {
    assert.equal(bareDoi(s), '10.7284/900421');
  }
});

test('a create snapshot becomes the base state, and updates layer onto it', () => {
  const { complete, versions } = reconstructVersions('10.1/x', [
    act(1, 'create', { titles: [{ title: 'First' }], publication_year: 2019, rights_list: [] }, 1),
    // update entries are [before, after]: taking [0] would silently rewind the record.
    act(2, 'update', { titles: [[{ title: 'First' }], [{ title: 'Second' }]] }, 2),
    act(3, 'update', { rights_list: [[], [{ rights: 'CC0' }]] }, 3),
  ]);
  assert.equal(complete, true);
  assert.equal(versions.length, 3);
  assert.equal(versions[0].work.attributes.titles[0].title, 'First');
  assert.equal(versions[1].work.attributes.titles[0].title, 'Second');
  // State accumulates: v3 must still carry the title set at v2.
  assert.equal(versions[2].work.attributes.titles[0].title, 'Second');
  assert.equal(versions[2].work.attributes.rightsList[0].rights, 'CC0');
  // publicationYear was set once at create and never touched again.
  assert.equal(versions[2].work.attributes.publicationYear, 2019);
});

test('snake_case log fields map onto the camelCase attributes the rubric reads', () => {
  const { versions } = reconstructVersions('10.1/x', [
    act(1, 'create', {
      related_identifiers: [{ relatedIdentifier: '10.1/y' }],
      funding_references: [{ funderName: 'NSF' }],
      geo_locations: [{ geoLocationPlace: 'Gulf' }],
      version_info: '2.0',
    }, 1),
  ]);
  const a = versions[0].work.attributes;
  assert.equal(a.relatedIdentifiers[0].relatedIdentifier, '10.1/y');
  assert.equal(a.fundingReferences[0].funderName, 'NSF');
  assert.equal(a.geoLocations[0].geoLocationPlace, 'Gulf');
  assert.equal(a.version, '2.0');
  assert.deepEqual(versions[0].changed.sort(),
    ['fundingReferences', 'geoLocations', 'relatedIdentifiers', 'version']);
});

test('a log that never reaches creation is marked incomplete and offers no work to score', () => {
  // This is the case that matters. DataCite does not always retain the create
  // entry; scoring what is left would report a fine record as a terrible one,
  // and the number would look entirely plausible.
  const { complete, firstVersion, versions } = reconstructVersions('10.1/x', [
    act(8, 'update', { identifiers: [[], [{ identifier: 'x' }]] }, 4),
  ]);
  assert.equal(complete, false);
  assert.equal(firstVersion, 8);
  assert.equal(versions[0].work, null);
  // The change history itself is still exact and still worth showing.
  assert.deepEqual(versions[0].changed, ['identifiers']);
});

test('bookkeeping fields are ignored, and unknown fields are surfaced not swallowed', () => {
  const { versions } = reconstructVersions('10.1/x', [
    act(1, 'create', { titles: [{ title: 'T' }], aasm_state: 'findable', source: 'api',
                       some_new_datacite_field: 'value' }, 1),
  ]);
  assert.deepEqual(versions[0].changed, ['titles']);
  assert.ok(!('aasm_state' in versions[0].work.attributes));
  // An unmapped field is reported rather than dropped: silence here would hide
  // a schema change until someone noticed the numbers had drifted.
  assert.deepEqual(versions[0].unmapped, ['some_new_datacite_field']);
});

test('revisions are ordered by version, whatever order the API returned them in', () => {
  const { versions } = reconstructVersions('10.1/x', [
    act(3, 'update', { titles: [[{ title: 'B' }], [{ title: 'C' }]] }, 3),
    act(1, 'create', { titles: [{ title: 'A' }] }, 1),
    act(2, 'update', { titles: [[{ title: 'A' }], [{ title: 'B' }]] }, 2),
  ]);
  assert.deepEqual(versions.map(v => v.version), [1, 2, 3]);
  assert.deepEqual(versions.map(v => v.work.attributes.titles[0].title), ['A', 'B', 'C']);
});
