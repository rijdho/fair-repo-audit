// Replaying a DataCite audit log is the kind of code that fails silently: a
// wrong field name or a mishandled [before, after] tuple still produces a
// plausible-looking record. These tests pin the two things that would be wrong
// without being obviously wrong.
//
// Run with:  node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { reconstructVersions, bareDoi, describeChange } from '../src/recuration.js';

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

// ── What an edit actually did ──────────────────────────────────────────────
// Cases from a real record, 10.34894/y0q89u (DataverseNL), whose log showed
// only field names before: the reader could not tell what any revision did.

test('a single value reports its before and after', () => {
  assert.deepEqual(describeChange('version', '2.0', '2.1'), { field: 'version', kind: 'set', before: '2.0', after: '2.1' });
  assert.deepEqual(describeChange('url', null, 'https://x.org'), { field: 'url', kind: 'set', before: null, after: 'https://x.org' });
});

test('a list reports what was added and removed, by label', () => {
  const d = describeChange('rightsList',
    [{ rightsUri: 'info:eu-repo/semantics/restrictedAccess' }, { rights: 'CC BY 4.0' }],
    [{ rightsUri: 'info:eu-repo/semantics/closedAccess' }, { rights: 'CC BY 4.0' }]);
  assert.deepEqual(d.added, ['info:eu-repo/semantics/closedAccess']);
  assert.deepEqual(d.removed, ['info:eu-repo/semantics/restrictedAccess']);
  assert.deepEqual(d.count, [2, 2]);
  assert.deepEqual(d.edited, [], 'the unchanged licence is not reported');
});

test('an item kept under the same label but changed inside is edited, with the values', () => {
  const before = [{ name: 'Nweke, I. C.', affiliation: [{ name: '(leidenuniv.nl)' }], nameIdentifiers: [{ nameIdentifier: 'https://orcid.org/0000-0002-4582-8384' }] }];
  const after = [{ name: 'Nweke, I. C.', affiliation: [{ name: 'leidenuniv.nl' }], nameIdentifiers: [] }];
  const d = describeChange('creators', before, after);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, []);
  assert.deepEqual(d.edited, [{ label: 'Nweke, I. C.', keys: ['affiliation', 'nameIdentifiers'], values: [
    { key: 'affiliation', before: '(leidenuniv.nl)', after: 'leidenuniv.nl' },
    { key: 'nameIdentifiers', before: 'https://orcid.org/0000-0002-4582-8384', after: null },
  ] }], 'an ORCID dropped from a creator must be visible, not hidden in a field name');
});

test('repeated items are matched one for one, not as a set', () => {
  // A second file of a format already present is an addition: a set would see none.
  const d = describeChange('formats', ['application/zip', 'application/pdf'], ['application/zip', 'application/pdf', 'application/zip']);
  assert.deepEqual(d.added, ['application/zip']);
  assert.deepEqual(d.removed, []);
});

test('a rewrite with identical content says so', () => {
  assert.deepEqual(describeChange('titles', [{ title: 'A' }], [{ title: 'A' }]), { field: 'titles', kind: 'same' });
});

test('every update carries its diffs; the create carries none', () => {
  const { versions } = reconstructVersions('10.1/x', [
    act(1, 'create', { version_info: '1.0' }, 1),
    act(2, 'update', { version_info: ['1.0', '2.0'] }, 2),
  ]);
  assert.deepEqual(versions[0].diffs, []);
  assert.deepEqual(versions[1].diffs, [{ field: 'version', kind: 'set', before: '1.0', after: '2.0' }]);
});

test('a long text that changed is cut, never reported as removed', () => {
  // The abstract of 10.34894/y0q89u was rewritten at v4; the long new text was once
  // shown as "none", which reads as a deletion.
  const long = 'This dataset contains research data on Nigerian security politics, focusing on Amotekun, the security outfit.';
  const d = describeChange('descriptions', [{ description: 'Terrorism and Political Violence', descriptionType: 'Abstract' }],
    [{ description: long, descriptionType: 'Abstract' }]);
  const v = d.edited[0].values[0];
  assert.equal(v.before, 'Terrorism and Political Violence');
  assert.ok(v.after && v.after.endsWith('…'), 'cut, with an ellipsis');
  assert.ok(v.after.startsWith('This dataset'), 'the texts differ from the start, so the cut starts there too');
});

test('two long texts are cut where they differ, so the edit is visible', () => {
  const a = 'This dataset contains research data on Nigerian security politics, focusing on Amotekun, the security outfit in Southwest Nigeria.';
  const b = 'This dataset contains research data on Nigerian security politics, focusing on Amotekun, the security outfit in Southwestern Nigeria. Contact the author.';
  const v = describeChange('descriptions', [{ description: a, descriptionType: 'Abstract' }], [{ description: b, descriptionType: 'Abstract' }]).edited[0].values[0];
  assert.notEqual(v.before, v.after, 'identical snippets would hide the edit');
  assert.ok(v.before.startsWith('…') && v.before.includes('Southwest Nigeria'));
  assert.ok(v.after.includes('Southwestern Nigeria'));
});
