// OAI-PMH client — parses XML in the browser with DOMParser (no dependencies).
// OAI-PMH endpoints rarely send CORS headers, so requests go through a thin
// CORS relay (a "dumb" byte proxy — it holds NO scoring logic). The proxy URL is
// configurable: deploy your own from ./cors-proxy or point at any relay you trust.

// No relay is shipped as a default on purpose. Hardcoding one would point every
// visitor's OAI-PMH traffic at a single account and publish that account's
// hostname in this repo — the opposite of "depends on nobody else's
// infrastructure". Deploy ./cors-proxy and paste the URL into the app.
let proxyBase = '';
export function setProxy(url) { proxyBase = (url || '').trim(); }
export function getProxy() { return proxyBase; }

async function oaiFetch(baseUrl, params) {
  if (!proxyBase) {
    throw new Error(
      'No CORS proxy configured. OAI-PMH endpoints rarely send CORS headers, so the ' +
      'browser cannot reach them directly. Deploy the relay in cors-proxy/ and paste ' +
      'its URL into "CORS proxy (advanced)".',
    );
  }
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

// ── DIM (DSpace Intermediate Metadata) ──
// DSpace's own format, and the only lossless one it exposes. oai_dc flattens
// qualifiers away, so `rights.uri`, `identifier.orcid`, `identifier.ror` and
// `language.iso` all arrive as a bare `rights` / `identifier` / `language` — or
// not at all. Scoring a DSpace repository on oai_dc therefore reads as poorer
// than the repository actually is: a measurement artefact, not a metadata gap.
//
// DIM cannot go through the generic leaf-element walk in parseRecord(), because
// every value is carried by the SAME element name — <dim:field mdschema=
// element= qualifier=> — so that walk collapses an entire record into one
// `field` key. Hence this crosswalk.

// DSpace stores authors in contributor.author, and its own oai_dc crosswalk
// maps them onto dc:creator. Without this alias every DSpace record would score
// as having no creator at all.
const DIM_ALIAS = { 'contributor.author': 'creator' };

// Pure, and exported, so it can be unit-tested in Node where there is no
// DOMParser. `fields` is [{ mdschema, element, qualifier, value }, …].
export function dimFieldsToDc(fields) {
  const meta = {};
  const push = (key, value) => { if (key && value) (meta[key] ??= []).push(value); };

  for (const f of fields) {
    const element = (f.element || '').trim();
    const qualifier = (f.qualifier || '').trim();
    const schema = (f.mdschema || 'dc').trim();
    const value = (f.value || '').trim();
    if (!element || !value) continue;

    const dotted = qualifier ? `${element}.${qualifier}` : element;

    if (schema === 'dc') {
      // The bare Dublin Core element is what the FAIR engine reads, so a
      // qualified value feeds both it and its own qualified key.
      push(DIM_ALIAS[dotted] ?? element, value);
      if (qualifier) push(dotted, value);
    } else {
      // Local and non-DC schemas (dspace.*, oaire.*, others.*) are namespaced.
      // They must never land on a bare DC key: a local `udla.type` silently
      // polluting `type` would corrupt the vocabulary checks with values the
      // repository never published as Dublin Core.
      push(`${schema}.${dotted}`, value);
    }
  }
  return meta;
}

// What the endpoint can actually emit. Offering the user a format the server
// does not support just trades one empty result for another.
export async function listMetadataFormats(baseUrl) {
  const doc = await oaiFetch(baseUrl, { verb: 'ListMetadataFormats' });
  return [...doc.querySelectorAll('metadataFormat')].map(f => ({
    prefix: txt(f, 'metadataPrefix'),
    schema: txt(f, 'schema'),
  })).filter(f => f.prefix);
}

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
  let meta = {};
  const md = recEl.querySelector('metadata');
  if (md) {
    const dimFields = [...md.querySelectorAll('*')].filter(el => el.localName === 'field');
    if (dimFields.length > 0) {
      meta = dimFieldsToDc(dimFields.map(el => ({
        mdschema: el.getAttribute('mdschema'),
        element: el.getAttribute('element'),
        qualifier: el.getAttribute('qualifier'),
        value: el.textContent.trim(),
      })));
    } else {
      for (const el of md.querySelectorAll('*')) {
        const ln = el.localName;
        if (ln === 'dc' || ln === 'metadata' || el.children.length > 0) continue;
        const v = el.textContent.trim();
        if (v) (meta[ln] ??= []).push(v);
      }
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
// `metadataPrefix` defaults to oai_dc because every OAI-PMH endpoint is required
// to expose it. On DSpace, prefer `dim` when it is offered: see dimFieldsToDc().
export async function fetchRecords(baseUrl, { max = 50, from = null, until = null, metadataPrefix = 'oai_dc', onProgress } = {}) {
  const records = [];
  let token = null;
  const firstParams = { verb: 'ListRecords', metadataPrefix };
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
