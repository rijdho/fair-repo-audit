#!/usr/bin/env node
// metrics-watch: score a repository's metadata on a schedule and keep the history.
//
// A one-off audit tells you where you are. It cannot tell you whether you are
// getting better, and it cannot show anyone that a curation effort worked. This
// script turns the same rubric into a time series: run it monthly, commit the
// output, and the score history accumulates in your own repository under your
// own control.
//
// It has no dependencies and no build step. It imports the very same modules the
// browser app uses, so a scheduled score and a score you read on the page can
// never drift apart: there is one rubric, in src/fair.js.
//
// Usage:
//   node scripts/metrics-watch.mjs --config metrics-watch.json --out history.json
//   node scripts/metrics-watch.mjs --mode prefix --value 10.7284 --out history.json
//
// Config file shape (a set is just more than one target):
//   { "sample": 100,
//     "targets": [ { "label": "R2R", "mode": "prefix", "value": "10.7284" } ] }
//
// See .github/workflows/metrics-watch.example.yml for the scheduled version.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { assessDataCiteWork, aggregateAssessments } from '../src/fair.js';
import { fetchWorks } from '../src/datacite.js';
import { dataCiteConcepts } from '../src/concepts.js';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : fallback;
};
const die = (msg) => { console.error(`metrics-watch: ${msg}`); process.exit(1); };

const configPath = arg('config');
const outPath = arg('out', 'history.json');
const today = arg('date', new Date().toISOString().slice(0, 10));

let config;
if (configPath) {
  if (!existsSync(configPath)) die(`config not found: ${configPath}`);
  config = JSON.parse(readFileSync(configPath, 'utf8'));
} else {
  const mode = arg('mode'), value = arg('value');
  if (!mode || !value) die('give --config, or both --mode and --value');
  config = { sample: parseInt(arg('sample', '100'), 10), targets: [{ mode, value, label: value }] };
}

const VALID = new Set(['clientId', 'prefix', 'publisher']);
const sample = Math.min(Math.max(parseInt(config.sample ?? 100, 10) || 100, 1), 1000);
const targets = (config.targets || []).filter(t => {
  if (!VALID.has(t.mode) || !t.value) { console.error(`  skipping malformed target: ${JSON.stringify(t)}`); return false; }
  return true;
});
if (!targets.length) die('no usable targets in the config');

/** One scoring run against one repository. */
async function score(target) {
  const r = await fetchWorks(target.mode, target.value, { pageSize: sample, page: 1 });
  if (!r.works.length) return null;
  const assessments = r.works.map(w => assessDataCiteWork({ id: w.id, type: w.type, attributes: w.attributes }));
  const agg = aggregateAssessments(assessments);
  // Concept percentages flatten to key -> pct: the group structure is
  // reconstructible from the app's own catalogue and would only bloat a file
  // that grows by one entry every month, forever.
  const concepts = {};
  for (const g of dataCiteConcepts(r.works)) for (const c of g.concepts) concepts[c.key] = c.pct;
  return {
    date: today,
    sampled: r.works.length,
    total: r.total,
    overall: agg.overallPercent,
    principles: agg.principles.map(p => ({ letter: p.letter, score: p.score, max: p.maxScore })),
    checks: agg.principles.flatMap(p => p.checks.map(c => ({ id: c.id, score: c.score }))),
    concepts,
  };
}

const history = existsSync(outPath)
  ? JSON.parse(readFileSync(outPath, 'utf8'))
  : { generator: 'metrics-watch', rubric: 'fair-repo-audit/src/fair.js', targets: [] };

let changed = 0;
for (const target of targets) {
  const key = `${target.mode}:${target.value}`;
  let entry = history.targets.find(t => `${t.mode}:${t.value}` === key);
  if (!entry) { entry = { label: target.label || target.value, mode: target.mode, value: target.value, runs: [] }; history.targets.push(entry); }
  if (target.label) entry.label = target.label;

  process.stderr.write(`  scoring ${entry.label} (${key})… `);
  let run;
  try { run = await score(target); }
  catch (e) { console.error(`failed: ${e.message}`); continue; }
  if (!run) { console.error('no records'); continue; }

  // Re-running on the same day replaces that day's entry rather than adding a
  // second one, so a re-run after a fix does not double-count in the trend.
  const i = entry.runs.findIndex(x => x.date === run.date);
  if (i >= 0) entry.runs[i] = run; else entry.runs.push(run);
  entry.runs.sort((a, b) => a.date.localeCompare(b.date));
  changed++;
  console.error(`${run.overall}% over ${run.sampled} of ${run.total}`);
}

if (!changed) die('nothing scored; leaving the history untouched');

history.updated = new Date().toISOString();
writeFileSync(outPath, JSON.stringify(history, null, 2) + '\n');
console.error(`\nwrote ${outPath}: ${history.targets.length} target(s), ${history.targets.reduce((s, t) => s + t.runs.length, 0)} run(s) total`);
