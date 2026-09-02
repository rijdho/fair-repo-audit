// The service client is thin on purpose, so what is worth testing is exactly
// the part that is easy to get wrong: how it addresses the endpoint, and how it
// turns three different kinds of failure into three different messages. A user
// who cannot reach the service needs to be told that the other modes still
// work, which is a different message from "your input was rejected".
//
// Run with:  node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, vessels, setEndpoint, getEndpoint, isConfigured } from '../src/analyze.js';

const withFetch = async (impl, fn) => {
  const real = globalThis.fetch;
  globalThis.fetch = impl;
  try { return await fn(); } finally { globalThis.fetch = real; }
};
const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' } });

test.afterEach(() => setEndpoint(undefined));

test('a trailing slash on the endpoint never doubles up in the URL', async () => {
  setEndpoint('https://example.test/');
  assert.equal(getEndpoint(), 'https://example.test');
  let seen;
  await withFetch(async (url) => { seen = url; return jsonRes({ ok: true }); },
    () => analyze('rvdata', 'Sharp', 10));
  assert.equal(seen, 'https://example.test/');
});

test('with no endpoint configured the client refuses instead of posting somewhere', async () => {
  // There is no default address any more: the endpoint is a deployment detail
  // injected at build time, so a fork or a bare checkout has this mode off.
  // Refusing here is what lets the UI remove the tab rather than offer a button
  // that can only fail.
  setEndpoint('');
  assert.equal(getEndpoint(), '');
  assert.equal(isConfigured(), false);
  let called = false;
  await assert.rejects(
    withFetch(async () => { called = true; return jsonRes({}); }, () => analyze('rvdata', 'x', 10)),
    (e) => e.message === 'unconfigured');
  assert.equal(called, false, 'must not reach the network when unconfigured');
});

test('the vessel list is a GET, the analysis is a POST carrying the request', async () => {
  setEndpoint('https://example.test');
  const calls = [];
  await withFetch(async (url, init) => { calls.push({ url, init }); return jsonRes({ vessels: [] }); },
    () => vessels());
  assert.equal(calls[0].url, 'https://example.test/vessels');
  assert.equal(calls[0].init.method, 'GET');

  calls.length = 0;
  await withFetch(async (url, init) => { calls.push({ url, init }); return jsonRes({ meta: {} }); },
    () => analyze('rvdata', 'Atlantis', 25));
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { source: 'rvdata', value: 'Atlantis', n: 25 });
});

test('a network failure is distinguishable from a rejected request', async () => {
  setEndpoint('https://example.test');
  // Unreachable: the caller shows "the other modes still work".
  await assert.rejects(
    withFetch(async () => { throw new TypeError('Failed to fetch'); }, () => analyze('rvdata', 'x', 10)),
    (e) => e.message === 'unreachable');

  // Rejected with a reason: the service's own message is what the user needs.
  await assert.rejects(
    withFetch(async () => jsonRes({ error: 'Rate limit reached. Try again in a minute.' }, 429),
      () => analyze('rvdata', 'x', 10)),
    (e) => e.message === 'Rate limit reached. Try again in a minute.');
});

test('a non-JSON error body still yields a usable message, not a parse crash', async () => {
  setEndpoint('https://example.test');
  await assert.rejects(
    withFetch(async () => new Response('<html>502</html>', { status: 502 }),
      () => analyze('rvdata', 'x', 10)),
    (e) => /502/.test(e.message));
});
