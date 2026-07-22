// Temporal trend + duplicate detection — dependency-free, runs over the fetched sample.

// Mean overall FAIR% per year. `years[i]` aligns with `assessments[i]`.
export function temporalSeries(years, assessments) {
  const buckets = {};
  years.forEach((y, i) => {
    if (!y || y < 1990 || y > 2100) return;
    (buckets[y] ??= []).push(assessments[i].overallPercent);
  });
  return Object.entries(buckets)
    .map(([y, arr]) => ({ year: +y, n: arr.length, mean: Math.round(arr.reduce((s, v) => s + v, 0) / arr.length) }))
    .sort((a, b) => a.year - b.year);
}

// Records that share a normalized title → likely duplicates (or versions/series).
const normTitle = (t) => (t || '')
  .toLowerCase()
  .normalize('NFKD').replace(/[̀-ͯ]/g, '')    // strip accents
  .replace(/\bv?\d+(\.\d+)*\b/g, ' ')                    // drop version tokens
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

export function findDuplicates(titled) {
  const groups = {};
  for (const { id, title } of titled) {
    const k = normTitle(title);
    if (!k || k.length < 6) continue;
    (groups[k] ??= { title: title, ids: [] }).ids.push(id);
  }
  return Object.values(groups)
    .filter(g => g.ids.length > 1)
    .sort((a, b) => b.ids.length - a.ids.length);
}
