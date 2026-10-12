// History: the pure part of the registration-cohort view.
//
// Three readings sit on top of the cohort samples, and each one exists because the
// plain cohort score could be read wrongly:
//
//   cohortConcepts  which identifiers and links each cohort carries. A repository can
//                   hold a flat score for years while it starts writing ROR ids; the
//                   share per cohort shows when.
//   cohortMoves     which checks moved between the first and the last cohort, so a
//                   drift of "+3 points" says what it is made of.
//   bulkCandidates  days that concentrate a year's edits. DataCite's `updated` is the
//                   last change to a record, and a platform that re-sends every record
//                   at once (DataverseNL did on 2025-07-02 and 03: 8,283 of 9,676 edits
//                   that year) looks exactly like a curator at work. The candidates are
//                   only that: the page confirms each one with an exact count.
//
// Nothing here touches the network or the DOM, so all three are tested offline.

import { dataCiteConcepts } from './concepts.js?v=57';

/** The concepts worth following over time: who, where, under what terms, linked to what.
 *  Their definitions are the DataCite mode's own (concepts.js), so a share read here is
 *  the same share that mode reports for the same records. */
export const HX_CONCEPTS = ['authorAffiliation', 'affiliationRor', 'authorOrcid', 'licenseUri', 'funderId', 'relatedIdentifier'];

/** Share of a cohort's sampled works carrying each concept, in percent (one decimal). */
export function cohortConcepts(works) {
  const all = new Map(dataCiteConcepts(works).flatMap((g) => g.concepts).map((c) => [c.key, c.pct]));
  return Object.fromEntries(HX_CONCEPTS.map((k) => [k, works.length ? all.get(k) ?? null : null]));
}

/**
 * Checks whose mean moved between two cohort aggregates by at least `min` of the
 * check's range (a quarter of a point by default), largest move first. Means are
 * the unrounded ones: the rounded 0, ½, 1 band would hide most real movement.
 */
export function cohortMoves(aggA, aggB, min = 0.25) {
  const flat = (agg) => new Map(agg.principles.flatMap((p) => p.checks).map((c) => [c.id, c]));
  const a = flat(aggA), b = flat(aggB), out = [];
  for (const [id, cb] of b) {
    const ca = a.get(id);
    if (!ca) continue;
    const from = ca.rawMean ?? ca.score, to = cb.rawMean ?? cb.score;
    if (Math.abs(to - from) >= min) out.push({ id, name: cb.name, from, to });
  }
  return out.sort((x, y) => Math.abs(y.to - y.from) - Math.abs(x.to - x.from));
}

const isoDay = (s) => String(s ?? '').slice(0, 10);
const shift = (day, by) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + by);
  return d.toISOString().slice(0, 10);
};

/**
 * Per year, the three-day window around the day on which most sampled records were
 * last updated, when that window holds at least half of the year's sampled updates
 * and at least `minRecords` of them. A bulk re-send can run past midnight, so one day
 * is too narrow. Returns [{ year, from, to }], for the page to count exactly.
 */
export function bulkCandidates(works, { minShare = 0.5, minRecords = 3 } = {}) {
  const byYear = new Map();
  for (const w of works) {
    const day = isoDay(w.attributes?.updated);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const y = Number(day.slice(0, 4));
    if (!byYear.has(y)) byYear.set(y, new Map());
    const days = byYear.get(y);
    days.set(day, (days.get(day) || 0) + 1);
  }
  const out = [];
  for (const [year, days] of [...byYear].sort((p, q) => p[0] - q[0])) {
    const total = [...days.values()].reduce((s, v) => s + v, 0);
    const [top] = [...days].sort((p, q) => q[1] - p[1] || p[0].localeCompare(q[0]));
    const from = shift(top[0], -1), to = shift(top[0], 1);
    const inWindow = [...days].filter(([d]) => d >= from && d <= to).reduce((s, [, v]) => s + v, 0);
    if (inWindow >= minRecords && inWindow / total >= minShare) out.push({ year, from, to });
  }
  return out;
}
