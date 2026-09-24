// A related identifier that points to another work, not to the record's own files or versions.
//
// DataCite accepts any relation, and Dataverse registers one DOI per file, so a dataset lists
// its files (HasPart) and every file its dataset (IsPartOf). A record can therefore carry
// related identifiers and still link to nothing beyond itself: Universidad de Chile's 100 most
// recent records all carry one and none points to another work (2026-09-24). Same lesson as
// pids.js: a declared field is not a connection.

const VERSION = new Set(['HasVersion', 'IsVersionOf', 'IsNewVersionOf', 'IsPreviousVersionOf', 'IsIdenticalTo']);

const bare = (v) => String(v ?? '').trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, '');

/** True when `rel` points to another work: not empty, not a version of the record, not one of its own parts. */
export function isOtherWork(rel, ownDoi) {
  const v = bare(rel?.relatedIdentifier);
  if (!v || VERSION.has(rel.relationType)) return false;
  const own = bare(ownDoi);
  if (own && (rel.relationType === 'HasPart' || rel.relationType === 'IsPartOf')
      && (v === own || v.startsWith(own + '/') || own.startsWith(v + '/'))) return false;
  return true;
}
