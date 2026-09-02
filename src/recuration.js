// Re-curation: what changed in a record, and when.
//
// DataCite keeps a PROV audit log for every DOI at /dois/{doi}/activities. The
// `create` entry carries the full initial snapshot; each `update` entry carries
// per-field [before, after] tuples. Walking them in order reconstructs the
// record as it stood at every revision, which means each revision can be scored
// with the same rubric as a live record.
//
// Why this is worth a view of its own. Metadata curation is invisible work: it
// leaves no trace in the record you see today, so it goes unrecognised and
// unbudgeted. This makes it visible, and it also catches the other case, where
// an edit made a record worse and nobody noticed.
//
// Everything here runs in the browser against a public endpoint.

const DATACITE = 'https://api.datacite.org';

// The audit log is snake_case; the REST `attributes` are camelCase.
const FIELD_MAP = {
  titles: 'titles', creators: 'creators', publisher: 'publisher',
  publication_year: 'publicationYear', types: 'types', subjects: 'subjects',
  dates: 'dates', related_identifiers: 'relatedIdentifiers', rights_list: 'rightsList',
  descriptions: 'descriptions', language: 'language', formats: 'formats',
  sizes: 'sizes', version_info: 'version', funding_references: 'fundingReferences',
  geo_locations: 'geoLocations', identifiers: 'identifiers', contributors: 'contributors',
  schema_version: 'schemaVersion', url: 'url', doi: 'doi',
};

// Bookkeeping fields in the log that are not metadata. Listing them explicitly
// rather than filtering by FIELD_MAP alone keeps an unknown NEW field visible as
// a change rather than silently dropped.
const IGNORE = new Set([
  'aasm_state', 'source', 'reason', 'regenerate', 'content_url', 'landing_page',
  'only_validate', 'should_validate', 'container', 'related_items', 'updated', 'created',
]);

export const bareDoi = (d) => String(d || '').trim().replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');

async function fetchActivities(doi) {
  const id = bareDoi(doi);
  if (!id) throw new Error('empty');
  const res = await fetch(`${DATACITE}/dois/${encodeURIComponent(id)}/activities?page[size]=1000`);
  if (res.status === 404) throw new Error('notfound');
  if (!res.ok) throw new Error(`DataCite activities returned ${res.status}`);
  const json = await res.json();
  return (json.data || []).map(a => a.attributes).filter(Boolean);
}

/**
 * Walk revisions oldest to newest, accumulating state, emitting one version each.
 *
 * Returns { complete, firstVersion, versions }. `complete` is the flag that
 * matters: DataCite's log does not always reach back to the `create` entry, and
 * for those DOIs the reconstruction starts from whatever the first retained
 * revision happened to touch. The change history is still exact; the
 * reconstructed RECORD is not, so it must never be FAIR-scored. Scoring a
 * partial reconstruction would report a repository as far worse than it is, and
 * the number would look plausible, which is the dangerous kind of wrong.
 */
export function reconstructVersions(doi, activities) {
  const id = bareDoi(doi);
  const sorted = [...activities].sort((a, b) =>
    (a.version - b.version) ||
    (new Date(a['prov:generatedAtTime']) - new Date(b['prov:generatedAtTime'])));

  const complete = sorted.some(a => a.action === 'create');
  const state = {};
  const out = [];
  const firstTs = sorted[0]?.['prov:generatedAtTime'] || '';

  for (const act of sorted) {
    const isCreate = act.action === 'create';
    const changed = [], unmapped = [];
    for (const [key, raw] of Object.entries(act.changes || {})) {
      if (IGNORE.has(key)) continue;
      const mapped = FIELD_MAP[key];
      if (!mapped) { unmapped.push(key); continue; }
      // create carries the plain value; update carries [before, after].
      state[mapped] = isCreate ? raw : (Array.isArray(raw) ? raw[1] : raw);
      changed.push(mapped);
    }
    const ts = act['prov:generatedAtTime'] || '';
    out.push({
      version: act.version,
      timestamp: ts,
      action: act.action || 'update',
      changed,
      unmapped,
      // Only offered when the walk began at `create`; otherwise there is no
      // honest record to score and the caller is told so instead.
      work: complete ? {
        id, type: 'dois',
        attributes: { ...structuredClone(state), doi: id, created: firstTs, updated: ts },
      } : null,
    });
  }
  return { complete, firstVersion: sorted[0]?.version ?? null, versions: out };
}

export async function fetchHistory(doi) {
  return reconstructVersions(doi, await fetchActivities(doi));
}
