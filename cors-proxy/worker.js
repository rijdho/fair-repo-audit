// Minimal CORS relay for OAI-PMH — deploy your own so fair-repo-audit isn't tied
// to anyone else's infrastructure. It holds NO scoring logic: it forwards a GET to
// an OAI-PMH endpoint and adds CORS headers. That's all.
//
// Deploy:  cd cors-proxy && npx wrangler deploy
// Then paste the resulting *.workers.dev URL (with `/?url=`) into the app's
// "OAI-PMH proxy" field.
//
// Safety: GET only, https/http targets only, must be an OAI-PMH request
// (`verb=` present), and private/loopback hosts are blocked (basic SSRF guard).

const RATE_LIMIT = 600;          // requests per IP per minute
const RATE_WINDOW_MS = 60_000;
const ipHits = new Map();

function isRateLimited(request) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const now = Date.now();
  let e = ipHits.get(ip);
  if (!e || now > e.resetAt) { e = { count: 0, resetAt: now + RATE_WINDOW_MS }; ipHits.set(ip, e); }
  e.count++;
  if (ipHits.size > 10000) ipHits.clear();
  return e.count > RATE_LIMIT;
}

function isPrivateHost(host) {
  return /^(localhost|127\.|10\.|192\.168\.|169\.254\.|::1|\[?::1\]?)/i.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || host.endsWith('.internal') || host.endsWith('.local');
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
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: { ...CORS, 'Access-Control-Max-Age': '86400' } });
    if (request.method !== 'GET') return err('GET only', 405);
    if (isRateLimited(request)) return err('Too many requests', 429);

    const target = new URL(request.url).searchParams.get('url');
    if (!target) return err('Missing ?url= parameter', 400);

    let t;
    try { t = new URL(target); } catch { return err('Invalid target URL', 400); }
    if (t.protocol !== 'https:' && t.protocol !== 'http:') return err('Only http(s) targets', 400);
    if (isPrivateHost(t.hostname)) return err('Private/loopback hosts are blocked', 403);
    if (!t.searchParams.has('verb')) return err('Only OAI-PMH requests (verb= required)', 403);

    try {
      const upstream = await fetch(t.toString(), { headers: { 'User-Agent': 'fair-repo-audit/1.0' } });
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: {
          'Content-Type': upstream.headers.get('Content-Type') || 'text/xml',
          'Cache-Control': 'public, max-age=300',
          ...CORS,
        },
      });
    } catch (e) {
      return err(`Upstream fetch failed: ${e.message}`, 502);
    }
  },
};
