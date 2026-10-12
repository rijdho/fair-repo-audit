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

// ── What an edit actually did ───────────────────────────────────────────
// The log says a field changed; a reader needs to know how. Each list field is
// reduced to item labels so the diff can say what was added or removed, and an
// item whose label stayed but whose content moved is reported as edited, with
// the keys that differ (an affiliation, an ORCID). Labels are data, not prose:
// the page words them in the visitor's language.

const txt = (v) => String(v ?? '').trim();
const LABEL = {
  titles: (x) => txt(x.title),
  creators: (x) => txt(x.name || [x.givenName, x.familyName].filter(Boolean).join(' ')),
  contributors: (x) => txt(x.name || [x.givenName, x.familyName].filter(Boolean).join(' ')),
  subjects: (x) => txt(x.subject),
  dates: (x) => `${txt(x.dateType)} ${txt(x.date)}`.trim(),
  rightsList: (x) => txt(x.rights || x.rightsIdentifier || x.rightsUri),
  descriptions: (x) => txt(x.descriptionType) || 'description',
  relatedIdentifiers: (x) => `${txt(x.relationType)} ${txt(x.relatedIdentifier)}`.trim(),
  identifiers: (x) => txt(x.identifier),
  fundingReferences: (x) => txt(x.funderName || x.funderIdentifier),
  geoLocations: (x) => txt(x.geoLocationPlace) || 'geoLocation',
};
const labelOf = (field, x) => (typeof x === 'object' && x !== null
  ? (LABEL[field]?.(x) || JSON.stringify(x)) : txt(x));
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * A sub-field value in print: names for affiliations, ids for identifiers, text cut
 * to 80 characters. null means ABSENT and is shown as such; undefined means present
 * but not printable (a long structure), and only the key is named. Conflating the two
 * once reported a rewritten abstract as deleted.
 */
function brief(key, v) {
  if (v == null || (Array.isArray(v) && !v.length) || v === '') return null;
  if (key === 'affiliation') return [].concat(v).map((x) => txt(x?.name ?? x)).join('; ');
  if (key === 'nameIdentifiers') return [].concat(v).map((x) => txt(x?.nameIdentifier ?? x)).join('; ');
  if (typeof v === 'object') { const s = JSON.stringify(v); return s.length > 80 ? undefined : s; }
  const s = txt(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

/**
 * Both values of a moved key. Two long texts are cut where they first differ, not
 * at their start: an abstract edited in its second sentence otherwise prints as two
 * identical 77-character openings, which reads as no change at all.
 */
function around(key, before, after) {
  if (typeof before === 'string' && typeof after === 'string' && (before.length > 80 || after.length > 80)) {
    let i = 0;
    while (i < before.length && i < after.length && before[i] === after[i]) i++;
    let from = Math.max(0, i - 25);
    // Start on a word, not inside one, when a space is near.
    if (from > 0) { const sp = before.lastIndexOf(' ', from); if (sp >= 0 && from - sp < 15) from = sp + 1; }
    const cut = (t) => `${from > 0 ? '…' : ''}${t.slice(from, from + 70)}${t.length > from + 70 ? '…' : ''}`;
    return { key, before: cut(before), after: cut(after) };
  }
  return { key, before: brief(key, before), after: brief(key, after) };
}

/** Remove from `from` one occurrence of each label in `take`, keeping order. */
function minus(from, take) {
  const left = [...take], out = [];
  for (const x of from) { const i = left.indexOf(x); if (i >= 0) left.splice(i, 1); else out.push(x); }
  return out;
}

/**
 * Describe one field's change from `before` to `after`.
 *   { field, kind: 'same' }                         rewritten with identical content
 *   { field, kind: 'set', before, after }           a single value (null = absent)
 *   { field, kind: 'list', count: [b, a], added, removed, edited }
 * `edited` is [{ label, keys, values }]: items present on both sides whose content
 * differs, matched in order among the items that share a label; `values` carries each
 * moved key's before and after, or null where it is too long to print.
 */
export function describeChange(field, before, after) {
  if (same(before, after)) return { field, kind: 'same' };
  if (!Array.isArray(before) && !Array.isArray(after)) {
    const show = (v) => (v == null || v === '' ? null : typeof v === 'object' ? JSON.stringify(v) : txt(v));
    return { field, kind: 'set', before: show(before), after: show(after) };
  }
  const b = Array.isArray(before) ? before : [], a = Array.isArray(after) ? after : [];
  const lb = b.map((x) => labelOf(field, x)), la = a.map((x) => labelOf(field, x));
  const added = minus(la, lb), removed = minus(lb, la);
  const edited = [];
  const used = new Set();
  b.forEach((x, i) => {
    const j = la.findIndex((l, k) => !used.has(k) && l === lb[i]);
    if (j < 0) return;
    used.add(j);
    const y = a[j];
    if (same(x, y)) return;
    const keys = typeof x === 'object' && x && typeof y === 'object' && y
      ? [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => !same(x[k], y[k]))
      : [];
    // Each moved key, with both values when they are short enough to read.
    edited.push({ label: lb[i], keys, values: keys.map((k) => around(k, x[k], y[k])) });
  });
  return { field, kind: 'list', count: [b.length, a.length], added, removed, edited };
}

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
    const diffs = [];
    for (const [key, raw] of Object.entries(act.changes || {})) {
      if (IGNORE.has(key)) continue;
      const mapped = FIELD_MAP[key];
      if (!mapped) { unmapped.push(key); continue; }
      // create carries the plain value; update carries [before, after].
      const pair = !isCreate && Array.isArray(raw) && raw.length === 2;
      const prior = pair ? raw[0] : state[mapped];
      state[mapped] = isCreate ? raw : (pair ? raw[1] : raw);
      changed.push(mapped);
      if (!isCreate) diffs.push(describeChange(mapped, prior, state[mapped]));
    }
    const ts = act['prov:generatedAtTime'] || '';
    out.push({
      version: act.version,
      timestamp: ts,
      action: act.action || 'update',
      changed,
      diffs,
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
