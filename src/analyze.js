// Client for the source-vs-published analysis service.
//
// This module is deliberately thin, and it is the whole of what this repository
// knows about that analysis: it posts a source name and a value, and renders
// whatever comes back. The connectors and the comparison logic run in a service
// (see the note in README under "What runs where"), not here.
//
// That split is stated rather than hidden. Every other mode in this tool runs
// entirely in the browser and uploads nothing, and those claims stay true
// because this mode is separate and says so.

// The service address is NOT baked into this repository. It is read from a meta
// tag that ships empty here and is filled at deploy time, so a fork gets a
// working checkout that simply has this one mode switched off, and no
// deployment's infrastructure hostname is published in source.
//
//   <meta name="fair-analyze-endpoint" content="" />
//
// Point it at your own deployment to enable the mode. With no endpoint the tab
// says so rather than failing at the first click.
const fromDocument = () => (typeof document === 'undefined' ? ''
  : document.querySelector('meta[name="fair-analyze-endpoint"]')?.content || '');

let endpoint = null;
export const setEndpoint = (url) => { endpoint = String(url ?? '').trim().replace(/\/+$/, ''); };
export const getEndpoint = () => (endpoint ?? fromDocument().trim().replace(/\/+$/, ''));
export const isConfigured = () => !!getEndpoint();

async function call(path, init) {
  const base = getEndpoint();
  if (!base) throw new Error('unconfigured');
  let res;
  try {
    res = await fetch(base + path, init);
  } catch {
    // A network-level failure here is almost always the service being
    // unreachable, which is a different problem from a bad request and needs a
    // different message.
    throw new Error('unreachable');
  }
  let body = null;
  try { body = await res.json(); } catch { /* fall through to the status check */ }
  if (!res.ok) throw new Error(body?.error || `service returned ${res.status}`);
  return body;
}

/** Vessels available as an analysis target, most cruises first. */
export const vessels = () => call('/vessels', { method: 'GET' });

/** Run the analysis. Returns aggregate views, the ledger and per-record scores. */
export const analyze = (source, value, n) => call('/', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ source, value, n }),
});
