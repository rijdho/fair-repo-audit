// The scorer is a scheduled job: nobody watches it run, and a history file is
// append-only, so a bug here quietly corrupts a series that is meant to be
// trustworthy for years. These tests pin the two behaviours that make the file
// safe to accumulate.
//
// Run with:  node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('../scripts/metrics-watch.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'mw-'));
const run = (args) => execFileSync('node', [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test.after(() => rmSync(dir, { recursive: true, force: true }));

test('a malformed config is refused rather than half-run', () => {
  const cfg = join(dir, 'bad.json');
  writeFileSync(cfg, JSON.stringify({ targets: [{ mode: 'nonsense', value: 'x' }] }));
  assert.throws(() => run(['--config', cfg, '--out', join(dir, 'x.json')]),
    (e) => /no usable targets/.test(String(e.stderr)));
});

test('a missing config is refused, not silently treated as empty', () => {
  assert.throws(() => run(['--config', join(dir, 'nope.json'), '--out', join(dir, 'x.json')]),
    (e) => /config not found/.test(String(e.stderr)));
});

test('re-running on the same date replaces that run rather than appending a second', { concurrency: false }, () => {
  const out = join(dir, 'hist.json');
  const args = ['--mode', 'prefix', '--value', '10.7284', '--sample', '3', '--out', out];
  run([...args, '--date', '2026-01-01']);
  run([...args, '--date', '2026-02-01']);
  run([...args, '--date', '2026-02-01']);   // same day again, after a fix say
  const h = JSON.parse(readFileSync(out, 'utf8'));
  assert.equal(h.targets.length, 1);
  const dates = h.targets[0].runs.map(r => r.date);
  assert.deepEqual(dates, ['2026-01-01', '2026-02-01'],
    'a same-day re-run must overwrite, or the trend double-counts');
});

test('a run carries everything the viewer needs and nothing it does not', { concurrency: false }, () => {
  const out = join(dir, 'shape.json');
  run(['--mode', 'prefix', '--value', '10.7284', '--sample', '3', '--out', out, '--date', '2026-03-01']);
  const r = JSON.parse(readFileSync(out, 'utf8')).targets[0].runs[0];
  assert.equal(r.date, '2026-03-01');
  assert.ok(Number.isFinite(r.overall) && r.overall >= 0 && r.overall <= 100);
  assert.equal(r.principles.length, 4);
  assert.deepEqual(r.principles.map(p => p.letter), ['F', 'A', 'I', 'R']);
  assert.equal(r.checks.length, 14, 'all 14 sub-principles, so the history can be re-analysed later');
  assert.ok(Object.keys(r.concepts).length > 10);
  // No records: a history file grows forever and must stay small.
  assert.ok(!JSON.stringify(r).includes('"attributes"'));
});
