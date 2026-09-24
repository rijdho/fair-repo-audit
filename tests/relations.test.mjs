import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOtherWork } from '../src/relations.js';

test('a dataset\'s own files and versions are not another work', () => {
  const ds = '10.34691/FK2/3MKG5N';
  assert.equal(isOtherWork({ relationType: 'HasPart', relatedIdentifier: '10.34691/FK2/3MKG5N/TLNN4B' }, ds), false);
  assert.equal(isOtherWork({ relationType: 'IsPartOf', relatedIdentifier: 'https://doi.org/10.34691/fk2/3mkg5n' }, ds + '/TLNN4B'), false);
  assert.equal(isOtherWork({ relationType: 'IsVersionOf', relatedIdentifier: '10.5281/zenodo.21492530' }, '10.5281/zenodo.22933593'), false);
  assert.equal(isOtherWork({ relationType: 'References', relatedIdentifier: '' }, ds), false);
});

test('a paper, another dataset or a collection is another work', () => {
  const ds = '10.34691/FK2/3MKG5N';
  assert.equal(isOtherWork({ relationType: 'IsSupplementTo', relatedIdentifier: '10.1038/sdata.2016.18' }, ds), true);
  assert.equal(isOtherWork({ relationType: 'IsPartOf', relatedIdentifier: '10.34691/FK2/COLLECTION' }, ds), true);
  assert.equal(isOtherWork({ relationType: 'References', relatedIdentifier: 'https://github.com/rijdho/fair-repo-audit' }, ds), true);
});
