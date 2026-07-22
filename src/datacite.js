// DataCite REST client — runs entirely in the browser (DataCite sends CORS headers).
// Returns works shaped as { id, type, attributes } — exactly what fair.js expects.
// `affiliation=true` is REQUIRED: without it DataCite flattens creators[].affiliation
// to bare strings and strips the ROR affiliationIdentifier (false 0% ROR otherwise).

const DATACITE = 'https://api.datacite.org/dois';
const DATACITE_CLIENTS = 'https://api.datacite.org/clients';

// Repository name typeahead. DataCite's `/clients` endpoint is free-text
// searchable and CORS-enabled (same host as /dois — no proxy), and each hit
// carries the canonical `id` that feeds Client-ID mode plus a human `name`.
// DataCite ANDs the query terms, so an over-specified or mistyped string like
// "scielo chile" scores 0 hits. We relax progressively: search the whole string
// first, and only if that is empty retry token-by-token (most distinctive token
// first), merging until we have enough — so a partial name still surfaces the
// real repository. Returns [{ id, name }], most-relevant first.
export async function suggestClients(term, { limit = 8, signal } = {}) {
  const q = String(term || '').trim();
  if (q.length < 2) return [];
  const fetchQ = async (query) => {
    const p = new URLSearchParams({ query, 'page[size]': String(limit) });
    try {
      const res = await fetch(`${DATACITE_CLIENTS}?${p}`, { signal });
      if (!res.ok) return [];
      return ((await res.json()).data || [])
        .map(c => ({ id: c.id, name: c.attributes?.name || c.id }));
    } catch { return []; }
  };
  let hits = await fetchQ(q);
  if (!hits.length) {
    const tokens = [...new Set(q.toLowerCase().split(/\s+/).filter(t => t.length >= 3))]
      .sort((a, b) => b.length - a.length);          // most distinctive token first
    const byId = new Map();
    for (const t of tokens) {
      for (const c of await fetchQ(t)) if (!byId.has(c.id)) byId.set(c.id, c);
      if (byId.size >= limit) break;
    }
    hits = [...byId.values()];
  }
  return hits.slice(0, limit);
}

// Lucene clause for a publication-year window. Either end may be open (`*`).
function yearClause(fromYear, untilYear) {
  const a = Number.isFinite(fromYear) ? fromYear : null;
  const b = Number.isFinite(untilYear) ? untilYear : null;
  if (a == null && b == null) return '';
  return `publicationYear:[${a ?? '*'} TO ${b ?? '*'}]`;
}

function buildParams({ clientId, prefix, publisher, pageSize, page, fromYear, untilYear }) {
  const p = new URLSearchParams();
  p.set('affiliation', 'true');
  p.set('page[size]', String(pageSize));
  p.set('page[number]', String(page));
  p.set('sort', '-created');
  const yc = yearClause(fromYear, untilYear);
  if (clientId) p.set('client-id', clientId.trim());
  else if (prefix) p.set('prefix', prefix.trim());
  else if (publisher) {
    // publisher already rides in the query param — AND the year window in there.
    p.set('query', `publisher:"${publisher.trim()}"${yc ? ` AND ${yc}` : ''}`);
    return p;
  }
  // client-id / prefix are their own params, so the year window is a standalone query.
  if (yc) p.set('query', yc);
  return p;
}

// One page of works. `mode` is 'clientId' | 'prefix' | 'publisher'.
export async function fetchWorks(mode, value, { pageSize = 25, page = 1, fromYear = null, untilYear = null } = {}) {
  const opts = { pageSize, page, fromYear, untilYear };
  opts[mode] = value;
  const res = await fetch(`${DATACITE}?${buildParams(opts)}`);
  if (!res.ok) throw new Error(`DataCite API returned ${res.status}`);
  const json = await res.json();
  return {
    works: json.data || [],
    total: json.meta?.total ?? 0,
    resourceTypes: json.meta?.resourceTypes ?? [],
  };
}

// Full population fetch, capped at DataCite's hard 10,000-record paging limit.
export async function fetchAllWorks(mode, value, { onProgress, fromYear = null, untilYear = null } = {}) {
  const PAGE = 250, MAX = 10000;
  const first = await fetchWorks(mode, value, { pageSize: PAGE, page: 1, fromYear, untilYear });
  const total = Math.min(first.total, MAX);
  let works = [...first.works];
  onProgress?.(works.length, total);
  const pages = Math.ceil(total / PAGE);
  for (let pg = 2; pg <= pages; pg++) {
    const r = await fetchWorks(mode, value, { pageSize: PAGE, page: pg, fromYear, untilYear });
    works.push(...r.works);
    onProgress?.(works.length, total);
    if (r.works.length === 0) break;
  }
  return { works, total: first.total, capped: first.total > MAX };
}

// Records-per-publication-year, built from count-only queries (page[size]=0 → no
// records travel, just meta.total). DataCite no longer returns a `published` facet,
// so this reconstructs the distribution so the UI can SUGGEST a year window.
// Trims leading/trailing empty years so the picker spans only where data exists.
export async function fetchYearHistogram(mode, value, { from = 2000, to = new Date().getFullYear(), onProgress, concurrency = 6 } = {}) {
  const years = [];
  for (let y = from; y <= to; y++) years.push(y);
  const counts = new Map();
  let done = 0;
  const queue = [...years];
  const worker = async () => {
    while (queue.length) {
      const y = queue.shift();
      const opts = { pageSize: 0, page: 1, fromYear: y, untilYear: y };
      opts[mode] = value;
      let count = 0;
      try {
        const res = await fetch(`${DATACITE}?${buildParams(opts)}`);
        if (res.ok) count = (await res.json()).meta?.total ?? 0;
      } catch { /* leave 0 */ }
      counts.set(y, count);
      onProgress?.(++done, years.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, years.length) }, worker));
  let rows = years.map(y => ({ year: y, count: counts.get(y) || 0 }));
  const firstHit = rows.findIndex(r => r.count > 0);
  const lastHit = rows.length - 1 - [...rows].reverse().findIndex(r => r.count > 0);
  if (firstHit === -1) return [];               // repo has no dated records in range
  return rows.slice(firstHit, lastHit + 1);     // span only the populated years
}
