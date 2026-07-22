// Concept completeness — the "share of records that carry each concept", grouped
// into Habermann's four FAIR use cases (Text / Identifiers / Connections / Contacts).
// This is the actionable layer, complementary to the abstract FAIR-14 score.
// Inspired by Metadata Game Changers' completeness tool (metadatagamechangers.com).
//
// Display text is NOT stored here — `key` indexes the i18n catalogue, which is the
// single source of truth for every label and gloss. Keeping an English `name:`
// alongside the key would just be a second place to forget to update.

// Aliased: this module already has a local `has()` for Dublin Core field presence,
// and an unaliased import would be shadowed by it — silently, since the arities differ.
import { t, has as hasKey } from './i18n/index.js?v=24';

const arr = (x) => Array.isArray(x) ? x : [];
const some = (a, pred) => arr(a).some(pred);

// ── DataCite concepts (operate on work.attributes) ──
const DATACITE_GROUPS = [
  { gkey: 'dc.text', concepts: [
    { key: 'abstract',            present: a => some(a.descriptions, d => d.descriptionType === 'Abstract' && d.description) },
    { key: 'methods',             present: a => some(a.descriptions, d => d.descriptionType === 'Methods' && d.description) },
    { key: 'keywords',            present: a => some(a.subjects, s => s.subject) },
    { key: 'keywordVocabulary',   present: a => some(a.subjects, s => s.subjectScheme) },
    { key: 'resourceType',        present: a => !!a.types?.resourceTypeGeneral },
    { key: 'language',            present: a => !!a.language },
    { key: 'rightsStatement',     present: a => some(a.rightsList, r => r.rights) },
    { key: 'licenseUri',          present: a => some(a.rightsList, r => r.rightsUri) },
    { key: 'licenseSpdx',         present: a => some(a.rightsList, r => r.rightsIdentifier) },
  ] },
  { gkey: 'dc.identifiers', concepts: [
    { key: 'doi',                 present: a => !!a.doi },
    { key: 'alternateIdentifier', present: a => arr(a.identifiers).length > 0 },
    { key: 'version',             present: a => !!a.version },
  ] },
  { gkey: 'dc.connections', concepts: [
    { key: 'relatedIdentifier',   present: a => arr(a.relatedIdentifiers).length > 0 },
    { key: 'typedRelation',       present: a => some(a.relatedIdentifiers, r => r.relationType) },
    { key: 'relatedPidScheme',    present: a => some(a.relatedIdentifiers, r => r.relatedIdentifierType) },
    { key: 'geoLocation',         present: a => arr(a.geoLocations).length > 0 },
  ] },
  { gkey: 'dc.contacts', concepts: [
    { key: 'author',              present: a => some(a.creators, c => c.name) },
    { key: 'authorOrcid',         present: a => some(a.creators, c => some(c.nameIdentifiers, n => n.nameIdentifierScheme === 'ORCID')) },
    { key: 'authorAffiliation',   present: a => some(a.creators, c => some(c.affiliation, af => af.name)) },
    { key: 'affiliationRor',      present: a => some(a.creators, c => some(c.affiliation, af => af.affiliationIdentifier)) },
    { key: 'contactPerson',       present: a => some(a.contributors, c => c.contributorType === 'ContactPerson') },
    { key: 'funder',              present: a => some(a.fundingReferences, f => f.funderName) },
    { key: 'funderId',            present: a => some(a.fundingReferences, f => f.funderIdentifier) },
    { key: 'awardNumber',         present: a => some(a.fundingReferences, f => f.awardNumber) },
  ] },
];

// ── OAI-PMH / Dublin Core concepts (operate on record.metadata) ──
const has = (m, k) => arr(m[k]).length > 0;
// These map 1:1 onto the 15 Dublin Core elements, which DCMI itself publishes
// translated labels for — so localising them follows the standard, not away from it.
const OAI_GROUPS = [
  { gkey: 'oai.text', concepts: [
    { key: 'title',       present: m => has(m, 'title') },
    { key: 'description', present: m => has(m, 'description') },
    { key: 'subject',     present: m => has(m, 'subject') },
    { key: 'type',        present: m => has(m, 'type') },
    { key: 'language',    present: m => has(m, 'language') },
    { key: 'rights',      present: m => has(m, 'rights') },
    { key: 'format',      present: m => has(m, 'format') },
  ] },
  { gkey: 'oai.identifiers', concepts: [
    { key: 'identifier',  present: m => has(m, 'identifier') },
    { key: 'relation',    present: m => has(m, 'relation') },
    { key: 'source',      present: m => has(m, 'source') },
  ] },
  { gkey: 'oai.contacts', concepts: [
    { key: 'creator',     present: m => has(m, 'creator') },
    { key: 'contributor', present: m => has(m, 'contributor') },
    { key: 'publisher',   present: m => has(m, 'publisher') },
    { key: 'date',        present: m => has(m, 'date') },
  ] },
];

function tally(groups, items, pick) {
  const n = items.length || 1;
  // `name` / `group` / `desc` are lazy getters rather than baked-in strings: the
  // tally is computed once per analysis but read on every render, so switching
  // language re-labels existing results without re-fetching from the API.
  // They stay enumerable so JSON.stringify (the export path) still sees them.
  const live = (obj, prop, key) =>
    Object.defineProperty(obj, prop, { get: () => t(key), enumerable: true });

  return groups.map(g => {
    const group = {
      gkey: g.gkey,
      concepts: g.concepts.map(c => {
        const count = items.reduce((s, it) => s + (c.present(pick(it)) ? 1 : 0), 0);
        const out = { key: c.key, count, pct: Math.round((count / n) * 1000) / 10 };
        return live(out, 'name', `concept.${c.key}`);
      }),
    };
    // Group display names are shared across sources (both have a "Text" group),
    // but the one-line descriptions differ, so those stay keyed by gkey.
    live(group, 'group', `group.${g.gkey.split('.')[1]}`);
    live(group, 'desc', `groupDesc.${g.gkey}`);
    return group;
  });
}

// Plain-language help: what each concept is and why it matters for reuse.
// Surfaced on hover. Backed by the i18n catalogue under `concept.<key>.gloss`,
// but exposed as a plain-object-shaped Proxy so existing `GLOSS[key]` call sites
// keep working — including the `GLOSS[k] ? … : ''` presence checks, which is why
// a miss must return undefined rather than t()'s echo-the-key fallback.
const glossProxy = (prefix) => new Proxy({}, {
  get: (_, key) => {
    if (typeof key !== 'string') return undefined;
    const full = `${prefix}${key}.gloss`;
    return hasKey(full) ? t(full) : undefined;
  },
  has: (_, key) => typeof key === 'string' && hasKey(`${prefix}${key}.gloss`),
});

export const GLOSS = glossProxy('concept.');

// One-line meaning for each FAIR principle (gauge hover).
// NOTE: app.js splits this on ' \u2014 ' to peel off the leading principle name,
// so every translation must keep the "Name \u2014 explanation" shape.
export const PRINCIPLE_GLOSS = glossProxy('principle.');

export function dataCiteConcepts(works) {
  return tally(DATACITE_GROUPS, works, w => w.attributes || {});
}
export function oaiConcepts(records) {
  return tally(OAI_GROUPS, records, r => r.metadata || {});
}
