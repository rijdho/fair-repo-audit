// OAI-PMH client — parses XML in the browser with DOMParser (no dependencies).
// OAI-PMH endpoints rarely send CORS headers, so requests go through a thin
// CORS relay (a "dumb" byte proxy — it holds NO scoring logic). The proxy URL is
// configurable: deploy your own from ./cors-proxy or point at any relay you trust.

const DEFAULT_PROXY = 'https://oai-proxy.ricnomas-ba7.workers.dev/?url=';
let proxyBase = DEFAULT_PROXY;
export function setProxy(url) { proxyBase = url || DEFAULT_PROXY; }
export function getProxy() { return proxyBase; }

async function oaiFetch(baseUrl, params) {
  const oaiUrl = `${baseUrl}?${new URLSearchParams(params)}`;
  const res = await fetch(proxyBase + encodeURIComponent(oaiUrl));
  if (!res.ok) throw new Error(`Proxy/OAI returned ${res.status}`);
  const doc = new DOMParser().parseFromString(await res.text(), 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Malformed OAI-PMH XML response');
  const err = doc.querySelector('error');
  if (err) throw new Error(`OAI error [${err.getAttribute('code')}]: ${err.textContent}`);
  return doc;
}

const txt = (el, sel) => el?.querySelector(sel)?.textContent?.trim() || '';

export async function identify(baseUrl) {
  const doc = await oaiFetch(baseUrl, { verb: 'Identify' });
  return {
    name: txt(doc, 'repositoryName'),
    baseURL: txt(doc, 'baseURL'),
    protocol: txt(doc, 'protocolVersion'),
    admin: txt(doc, 'adminEmail'),
    granularity: txt(doc, 'granularity'),
  };
}

// Turn one <record> element into the shape assessOaiRecord expects.
function parseRecord(recEl) {
  const header = recEl.querySelector('header');
  const meta = {};
  const md = recEl.querySelector('metadata');
  if (md) {
    for (const el of md.querySelectorAll('*')) {
      const ln = el.localName;
      if (ln === 'dc' || ln === 'metadata' || el.children.length > 0) continue;
      const v = el.textContent.trim();
      if (v) (meta[ln] ??= []).push(v);
    }
  }
  return {
    header: {
      identifier: txt(header, 'identifier'),
      datestamp: txt(header, 'datestamp'),
      setSpec: [...(header?.querySelectorAll('setSpec') || [])].map(s => s.textContent.trim()),
      status: header?.getAttribute('status') || undefined,
    },
    metadata: meta,
  };
}

// Harvest up to `max` records (follows resumptionToken as needed).
// `from`/`until` are OAI-PMH selective-harvesting bounds on the record DATESTAMP
// (when it was added/updated in the repo — NOT the publication year). Use the
// universally-accepted YYYY-MM-DD form. Per spec they're only sent on the FIRST
// request; a resumptionToken carries the bounds forward on its own.
export async function fetchRecords(baseUrl, { max = 50, from = null, until = null, onProgress } = {}) {
  const records = [];
  let token = null;
  const firstParams = { verb: 'ListRecords', metadataPrefix: 'oai_dc' };
  if (from) firstParams.from = from;
  if (until) firstParams.until = until;
  do {
    let doc;
    try {
      doc = token
        ? await oaiFetch(baseUrl, { verb: 'ListRecords', resumptionToken: token })
        : await oaiFetch(baseUrl, firstParams);
    } catch (e) {
      // An empty datestamp window is a normal outcome, not an error.
      if (/noRecordsMatch/.test(e.message)) return records;
      throw e;
    }
    for (const recEl of doc.querySelectorAll('record')) {
      // skip deleted records with no metadata? keep them — A2 scoring handles status.
      records.push(parseRecord(recEl));
      onProgress?.(records.length, max);
      if (records.length >= max) return records;
    }
    token = txt(doc, 'resumptionToken') || null;
  } while (token && records.length < max);
  return records;
}
