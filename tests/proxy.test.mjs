// The OAI-PMH relay. It is the one piece of this repo that runs on someone
// else's account and accepts a URL from a stranger, so its refusals are the
// part worth testing: an open relay is a gift to whoever finds it first.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import worker, { isBlockedHost, readCapped } from '../cors-proxy/worker.js';

const call = (url, opts = {}, env = {}) => worker.fetch(new Request(url, opts), env);
const RELAY = 'https://relay.example/';
const target = (t) => `${RELAY}?url=${encodeURIComponent(t)}`;

// ── what the guard must refuse ──────────────────────────────────────────────

test('loopback and private ranges are refused', () => {
  for (const h of ['localhost', '127.0.0.1', '127.1.2.3', '10.0.0.1', '192.168.1.1',
                   '172.16.0.1', '172.31.255.255', '0.0.0.0', '100.64.0.1'])
    assert.equal(isBlockedHost(h), true, `${h} should be refused`);
});

test('the cloud metadata address is refused', () => {
  // 169.254.169.254 is the one address that turns an open relay into a
  // credential leak on most cloud providers.
  assert.equal(isBlockedHost('169.254.169.254'), true);
});

test('IPv6 loopback, unique-local and link-local are refused', () => {
  for (const h of ['::1', '[::1]', '::', 'fd00::1', '[fd00::1]', 'fc00::1', 'fe80::1', '[fe80::1]'])
    assert.equal(isBlockedHost(h), true, `${h} should be refused`);
});

test('loopback wearing IPv4-mapped IPv6 notation is refused', () => {
  // `new URL('http://[::ffff:127.0.0.1]/').hostname` is '[::ffff:7f00:1]', which
  // no amount of matching on '127.' would ever catch.
  assert.equal(isBlockedHost('[::ffff:7f00:1]'), true);
  assert.equal(isBlockedHost('::ffff:127.0.0.1'), true);
  assert.equal(isBlockedHost('[::ffff:c0a8:1]'), true, '192.168.0.1 mapped');
});

test('internal-looking suffixes are refused', () => {
  for (const h of ['db.internal', 'printer.local', 'foo.localhost'])
    assert.equal(isBlockedHost(h), true, `${h} should be refused`);
});

test('ordinary public hosts are allowed', () => {
  for (const h of ['export.arxiv.org', 'oai.datacite.org', '8.8.8.8', '2001:4860:4860::8888'])
    assert.equal(isBlockedHost(h), false, `${h} should be allowed`);
});

test('numeric IPv4 in other bases needs no handling, because the URL parser normalises it', () => {
  // Recorded as a test so nobody "fixes" this by adding regexes that do nothing.
  for (const raw of ['http://2130706433/', 'http://0x7f000001/', 'http://0177.0.0.1/', 'http://127.1/'])
    assert.equal(isBlockedHost(new URL(raw).hostname), true, `${raw} should be refused`);
});

// ── what the handler must refuse ────────────────────────────────────────────

test('only GET is served', async () => {
  assert.equal((await call(RELAY, { method: 'POST' })).status, 405);
  assert.equal((await call(RELAY, { method: 'OPTIONS' })).status, 200);
});

test('a missing or unusable target is refused before any fetch happens', async () => {
  let called = false;
  const env = { fetch: async () => { called = true; return new Response('x'); } };
  assert.equal((await call(RELAY, {}, env)).status, 400);
  assert.equal((await call(target('not a url'), {}, env)).status, 400);
  assert.equal((await call(target('file:///etc/passwd'), {}, env)).status, 400);
  assert.equal((await call(target('http://127.0.0.1/?verb=Identify'), {}, env)).status, 403);
  assert.equal((await call(target('https://example.org/oai'), {}, env)).status, 403, 'no verb=');
  assert.equal(called, false, 'nothing may be fetched on a rejected request');
});

test('a valid OAI-PMH target is relayed with CORS headers', async () => {
  const env = { fetch: async () => new Response('<OAI-PMH/>', { headers: { 'Content-Type': 'text/xml' } }) };
  const res = await call(target('https://export.arxiv.org/oai2?verb=Identify'), {}, env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(await res.text(), '<OAI-PMH/>');
});

// ── the cap and the timeout ─────────────────────────────────────────────────

const streamOf = (chunks) => new ReadableStream({
  start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); },
});

test('a response inside the cap is read whole', async () => {
  const res = new Response(streamOf(['abc', 'def']));
  assert.equal(await readCapped(res, 100), 'abcdef');
});

test('a response past the cap is refused rather than buffered', async () => {
  const res = new Response(streamOf(['x'.repeat(50), 'y'.repeat(60)]));
  assert.equal(await readCapped(res, 64), null);
});

test('a declared content-length past the cap is refused before reading', async () => {
  const res = new Response('short', { headers: { 'content-length': '99999999' } });
  assert.equal(await readCapped(res, 1024), null);
});

test('an oversized upstream becomes a 502, not a crash', async () => {
  // Declared length rather than a real 8MB body: the streaming path is covered
  // directly above, and this is about what the handler does with the refusal.
  const env = { fetch: async () => new Response('z', { headers: { 'content-length': String(9 * 1024 * 1024) } }) };
  const res = await call(target('https://export.arxiv.org/oai2?verb=ListRecords'), {}, env);
  assert.equal(res.status, 502);
  assert.match(await res.text(), /too large/i);
});

test('an upstream that never answers becomes a 502 that says so', async () => {
  const env = { fetch: async () => { const e = new Error('timed out'); e.name = 'TimeoutError'; throw e; } };
  const res = await call(target('https://export.arxiv.org/oai2?verb=Identify'), {}, env);
  assert.equal(res.status, 502);
  assert.match(await res.text(), /timed out/i);
});

// ── the page's own policy ───────────────────────────────────────────────────

test('the page ships a policy that denies by default and pins scripts to this origin', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  const m = /http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html);
  assert.ok(m, 'no Content-Security-Policy in the page');
  const d = Object.fromEntries(m[1].split(';').map((x) => x.trim()).filter(Boolean)
    .map((x) => { const [k, ...v] = x.split(/\s+/); return [k, v]; }));

  assert.deepEqual(d['default-src'], ["'none'"]);
  assert.deepEqual(d['object-src'], ["'none'"]);
  assert.deepEqual(d['base-uri'], ["'none'"]);
  // The one that carries the weight: a script may come from here and nowhere
  // else, and never from an attribute or a string.
  assert.deepEqual(d['script-src'], ["'self'"]);
  assert.equal(/<script(?![^>]*\ssrc=)/.test(html), false, 'an inline script would need a hash or unsafe-inline');
});
