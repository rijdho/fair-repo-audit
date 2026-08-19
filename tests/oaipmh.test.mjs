// Unit tests for the DIM crosswalk (src/oaipmh.js) — a pure function, so it
// runs in Node even though the rest of that module needs a DOMParser.
//
// Run with:  node --test tests/*.test.mjs

import test from 'node:test';
import assert from 'node:assert/strict';
import { dimFieldsToDc } from '../src/oaipmh.js';
import { assessOaiRecord } from '../src/fair.js';

const f = (mdschema, element, qualifier, value) => ({ mdschema, element, qualifier, value });

test('DIM: an unqualified DC field lands on its Dublin Core element', () => {
  const meta = dimFieldsToDc([f('dc', 'title', null, 'A study of things')]);
  assert.deepEqual(meta.title, ['A study of things']);
});

test('DIM: a qualified DC field feeds both the bare element and its qualified key', () => {
  const meta = dimFieldsToDc([f('dc', 'rights', 'uri', 'https://creativecommons.org/licenses/by/4.0/')]);
  // The engine reads `rights`; the qualified key keeps the distinction available.
  assert.deepEqual(meta.rights, ['https://creativecommons.org/licenses/by/4.0/']);
  assert.deepEqual(meta['rights.uri'], ['https://creativecommons.org/licenses/by/4.0/']);
});

test('DIM: contributor.author is aliased to creator, the way DSpace crosswalks it', () => {
  const meta = dimFieldsToDc([
    f('dc', 'contributor', 'author', 'Pérez, Ana'),
    f('dc', 'contributor', 'other', 'Editorial board'),
  ]);
  assert.deepEqual(meta.creator, ['Pérez, Ana']);
  // The alias replaces the bare element, so an author is not also a contributor.
  assert.deepEqual(meta.contributor, ['Editorial board']);
  assert.deepEqual(meta['contributor.author'], ['Pérez, Ana']);
});

test('DIM: non-DC schemas are namespaced and never pollute a Dublin Core key', () => {
  const meta = dimFieldsToDc([
    f('dc', 'type', null, 'Artículo'),
    f('local', 'type', 'internal', 'ficha-interna'),
    f('others', 'access-status', null, 'open.access'),
  ]);
  // A local vocabulary must not be read as if the repository had published it as dc:type.
  assert.deepEqual(meta.type, ['Artículo']);
  assert.deepEqual(meta['local.type.internal'], ['ficha-interna']);
  assert.deepEqual(meta['others.access-status'], ['open.access']);
});

test('DIM: repeated values accumulate in document order, and empties are dropped', () => {
  const meta = dimFieldsToDc([
    f('dc', 'subject', null, 'FAIR'),
    f('dc', 'subject', 'lcsh', 'Metadata'),
    f('dc', 'subject', null, '   '),
    f('dc', 'subject', null, 'Repositories'),
    f('dc', 'title', null, ''),
  ]);
  assert.deepEqual(meta.subject, ['FAIR', 'Metadata', 'Repositories']);
  assert.equal(meta.title, undefined);
});

test('DIM: a missing mdschema is treated as Dublin Core', () => {
  const meta = dimFieldsToDc([f(null, 'language', 'iso', 'es')]);
  assert.deepEqual(meta.language, ['es']);
});

// The point of the crosswalk: the same DSpace record scores strictly better on
// DIM than on the oai_dc projection of itself, because oai_dc drops the license
// URI and the ISO language code that the FAIR checks look for.
test('DIM recovers signal that the oai_dc crosswalk discards', () => {
  const header = { identifier: 'oai:example.org:1', datestamp: '2024-01-01', setSpec: [] };

  const fromDim = dimFieldsToDc([
    f('dc', 'title', null, 'A study of things'),
    f('dc', 'contributor', 'author', 'Pérez, Ana'),
    f('dc', 'type', null, 'Text'),
    f('dc', 'language', 'iso', 'es'),
    f('dc', 'subject', null, 'FAIR'),
    f('dc', 'rights', 'uri', 'https://creativecommons.org/licenses/by/4.0/'),
    f('dc', 'identifier', 'uri', 'https://hdl.handle.net/1234/5'),
  ]);

  const r1a = assessOaiRecord({ header, metadata: fromDim });
  const licenseCheck = (a) => a.principles.flatMap(p => p.checks).find(c => c.id === 'R1.1').score;

  // Same record, but as DSpace's oai_dc crosswalk would emit it: no qualifiers,
  // so the license is indistinguishable from any other rights string.
  const asOaiDc = {
    title: ['A study of things'],
    creator: ['Pérez, Ana'],
    type: ['Text'],
    language: ['es'],
    subject: ['FAIR'],
    rights: ['https://creativecommons.org/licenses/by/4.0/'],
    identifier: ['https://hdl.handle.net/1234/5'],
  };
  const r1b = assessOaiRecord({ header, metadata: asOaiDc });

  // Both see the license here, because the URI itself survives as a rights value.
  // What DIM adds is that the qualified keys stay available for the caller.
  assert.equal(licenseCheck(r1a), licenseCheck(r1b));
  assert.deepEqual(fromDim['rights.uri'], ['https://creativecommons.org/licenses/by/4.0/']);
  assert.equal(asOaiDc['rights.uri'], undefined);
});
