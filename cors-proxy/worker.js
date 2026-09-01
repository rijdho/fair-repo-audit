// Minimal CORS relay for OAI-PMH: deploy your own so fair-repo-audit isn't tied
// to anyone else's infrastructure. It holds NO scoring logic: it forwards a GET to
// an OAI-PMH endpoint and adds CORS headers. That's all.
//
// Deploy:  cd cors-proxy && npx wrangler deploy
// Then paste the resulting *.workers.dev URL (with `/?url=`) into the app's
// "OAI-PMH proxy" field.
//
// Safety: GET only, http(s) targets only, must be an OAI-PMH request (`verb=`
// present), private and loopback hosts are blocked, the upstream read is capped
// and timed out. What it is NOT: see the note on DNS at `isBlockedHost`.

const RATE_LIMIT = 600;          // requests per IP per minute
const RATE_WINDOW_MS = 60_000;
const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;

const ipHits = new Map();

/**
 * A speed bump, not a limit, and worth being honest about: the counter lives in
 * this isolate's memory, and Cloudflare runs as many isolates as it likes. The
 * effective ceiling is therefore some multiple of RATE_LIMIT that nobody can
 * predict. It exists to stop a loop, not an adversary. Real limits belong in
 * Cloudflare's own rate-limiting rules or a Durable Object.
 */
function isRateLimited(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  let e = ipHits.get(ip);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + RATE_WINDOW_MS }; ipHits.set(ip, e); }
  e.count++;
  if (ipHits.size > 10000) ipHits.clear();
  return e.count > RATE_LIMIT;
}

/** The IPv4 ranges that must never be reachable through a public relay. */
function isBlockedV4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;                                   // a name, not an address
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 0) return true;                               // 0.0.0.0/8, "this host"
  if (a === 10 || a === 127) return true;                 // private, loopback
  if (a === 169 && b === 254) return true;                // link-local, and 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true;       // private
  if (a === 192 && b === 168) return true;                // private
  if (a === 100 && b >= 64 && b <= 127) return true;      // CGNAT
  if (a >= 224) return true;                              // multicast and reserved
  return false;
}

/**
 * Is this host one a relay must refuse?
 *
 * Numeric IPv4 in decimal, hex or octal needs no handling here: the WHATWG URL
 * parser normalises `2130706433`, `0x7f000001` and `0177.0.0.1` to 127.0.0.1
 * before this ever sees them. It does NOT normalise IPv6, which is where the
 * gaps were: unique-local, link-local, and the IPv4-mapped form the parser
 * produces for ::ffff:127.0.0.1, which is loopback in a different notation.
 *
 * What this cannot do, stated so nobody assumes otherwise: a perfectly ordinary
 * public name can resolve to a private address, and a relay that inspects the
 * hostname cannot see that. Blocking it would mean resolving the name and
 * pinning the connection to the resolved address, which the Workers runtime does
 * not offer. The `verb=` requirement is what keeps the remaining surface narrow.
 */
export function isBlockedHost(host) {
  const h = String(host ?? '').toLowerCase().replace(/^\[/, '').replace(/\]$/, '');
  if (!h) return true;
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.internal') || h.endsWith('.local')) return true;

  if (h.includes(':')) {
    if (h === '::' || h === '::1') return true;           // unspecified, loopback
    if (/^f[cd]/.test(h)) return true;                    // fc00::/7 unique local
    if (/^fe[89ab]/.test(h)) return true;                 // fe80::/10 link local
    let m = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(h);
    if (m) {
      const hi = parseInt(m[1], 16), lo = parseInt(m[2], 16);
      return isBlockedV4([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
    }
    m = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
    if (m) return isBlockedV4(m[1]);
    return false;
  }
  return isBlockedV4(h);
}

/**
 * Read at most `max` bytes. `await res.text()` would pull an entire response
 * into memory, so a hostile or merely enormous endpoint could spend the whole
 * isolate on one request. Returns null when the cap is passed.
 */
export async function readCapped(res, max = MAX_BYTES) {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > max) return null;
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { all.set(c, at); at += c.byteLength; }
  return new TextDecoder().decode(all);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const err = (msg, status) =>
  new Response(JSON.stringify({ error: msg }), {
    status, headers: { 'Content-Type': 'application/json', ...CORS },
  });

export default {
  // `env.fetch` is a seam for the tests: Workers pass an env object and never
  // set it, so deployment behaviour is unchanged.
  async fetch(request, env = {}) {
    const doFetch = env.fetch ?? fetch;
    if (request.method === 'OPTIONS') return new Response(null, { headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
    if (request.method !== 'GET') return err('GET only', 405);
    if (isRateLimited(request)) return err('Too many requests', 429);

    const target = new URL(request.url).searchParams.get('url');
    if (!target) return err('Missing ?url= parameter', 400);

    let t;
    try { t = new URL(target); } catch { return err('Invalid target URL', 400); }
    if (t.protocol !== 'https:' && t.protocol !== 'http:') return err('Only http(s) targets', 400);
    if (isBlockedHost(t.hostname)) return err('Private/loopback hosts are blocked', 403);
    if (!t.searchParams.has('verb')) return err('Only OAI-PMH requests (verb= required)', 403);

    try {
      const upstream = await doFetch(t.toString(), {
        headers: { 'User-Agent': 'fair-repo-audit/1.0' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'follow',
      });
      const body = await readCapped(upstream, MAX_BYTES);
      if (body === null) return err('Upstream response too large', 502);
      return new Response(body, {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'text/xml',
          'Cache-Control': 'public, max-age=300',
          ...CORS,
        },
      });
    } catch (e) {
      const timedOut = e?.name === 'TimeoutError' || e?.name === 'AbortError';
      return err(timedOut ? `Upstream timed out after ${TIMEOUT_MS / 1000}s` : `Upstream fetch failed: ${e.message}`, 502);
    }
  },
};
