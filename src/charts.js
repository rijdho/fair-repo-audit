// Interactive charts: dependency-free SVG.
// The heatmap and radar show the DISTRIBUTION across records, not just the
// averages: every record × every check, and the profile shape plus its spread.

import { t, tn, n as fmtNum } from './i18n/index.js?v=28';

const pctOf = (grp) => grp.score / grp.maxScore;

// ── FAIR radar over four axes (F/A/I/R).
// datasets: [{ assessments, color?, label }].
//   • one dataset  → mean polygon + faint per-record polygons (shape + spread).
//   • two datasets → one coloured mean polygon each (A vs B overlaid). ──
export function renderRadar(container, datasets, opts) {
  const { colors, fair, grid, surface, muted, tip } = opts;
  const multi = datasets.length > 1;
  const NS = 'http://www.w3.org/2000/svg', mono = 'ui-monospace, SF Mono, Menlo, monospace';
  const W = Math.min(container.clientWidth || 520, 560), H = 400;
  const cx = W / 2, cy = H / 2 + 4, R = Math.min(W, H) * 0.34;
  const AX = [
    { key: 'F', name: t('chart.axis.F'), idx: 0, ang: -Math.PI / 2, color: fair.F },
    { key: 'A', name: t('chart.axis.A'), idx: 1, ang: 0, color: fair.A },
    { key: 'I', name: t('chart.axis.I'), idx: 2, ang: Math.PI / 2, color: fair.I },
    { key: 'R', name: t('chart.axis.R'), idx: 3, ang: Math.PI, color: fair.R },
  ];
  const pt = (ang, v) => [cx + Math.cos(ang) * v * R, cy + Math.sin(ang) * v * R];
  const mk = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const txt = (x, y, s, o = {}) => { const t = mk('text', { x, y, fill: o.fill || muted, 'font-size': o.size || 10, 'font-family': mono, 'text-anchor': o.anchor || 'middle', 'dominant-baseline': 'middle', ...(o.weight ? { 'font-weight': o.weight } : {}) }); t.textContent = s; return t; };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });

  for (const r of [0.25, 0.5, 0.75, 1]) {
    svg.appendChild(mk('circle', { cx, cy, r: r * R, fill: 'none', stroke: grid, 'stroke-width': 1 }));
    svg.appendChild(txt(cx + 12, cy - r * R, `${r * 100 | 0}`, { size: 8 }));
  }
  for (const ax of AX) {
    const [ex, ey] = pt(ax.ang, 1);
    svg.appendChild(mk('line', { x1: cx, y1: cy, x2: ex, y2: ey, stroke: grid, 'stroke-width': 1 }));
    const [lx, ly] = pt(ax.ang, 1.15);
    svg.appendChild(txt(lx, ly, ax.key, { fill: ax.color, size: 16, weight: 700 }));
  }

  const statsOf = (assessments) => {
    const st = {};
    for (const ax of AX) {
      const vals = assessments.map(a => pctOf(a.principles[ax.idx]));
      st[ax.key] = { mean: vals.reduce((s, v) => s + v, 0) / vals.length, min: Math.min(...vals), max: Math.max(...vals) };
    }
    return st;
  };
  const stats = datasets.map(d => statsOf(d.assessments));

  if (!multi) {
    const d = datasets[0], stat = stats[0], color = d.color || colors.hi;
    const isAgg = d.assessments.length > 1;
    if (isAgg) {
      const CAP = 120;
      const sample = d.assessments.length <= CAP ? d.assessments : d.assessments.filter((_, i) => i % Math.ceil(d.assessments.length / CAP) === 0).slice(0, CAP);
      for (const a of sample) {
        const pts = AX.map(ax => pt(ax.ang, pctOf(a.principles[ax.idx])));
        svg.appendChild(mk('polygon', { points: pts.map(p => p.join(',')).join(' '), fill: 'none', stroke: color, 'stroke-width': 1, opacity: 0.08 }));
      }
    }
    const meanPts = AX.map(ax => pt(ax.ang, stat[ax.key].mean));
    svg.appendChild(mk('polygon', { points: meanPts.map(p => p.join(',')).join(' '), fill: color, 'fill-opacity': 0.16, stroke: color, 'stroke-width': 2.5 }));
    AX.forEach((ax, i) => {
      const [px, py] = meanPts[i];
      const [vx, vy] = pt(ax.ang, Math.max(stat[ax.key].mean - 0.14, 0.1));
      svg.appendChild(txt(vx, vy, `${Math.round(stat[ax.key].mean * 100)}%`, { fill: muted, size: 10 }));
      const dot = mk('circle', { cx: px, cy: py, r: 4.5, fill: color, stroke: surface, 'stroke-width': 1.5, style: 'cursor:pointer' });
      dot.addEventListener('mouseenter', e => tip(e, `${ax.key} · ${ax.name}\n`
        + t('chart.radar.mean', { pct: Math.round(stat[ax.key].mean * 100) })
        + (isAgg ? `\n${t('chart.radar.range', { min: Math.round(stat[ax.key].min * 100), max: Math.round(stat[ax.key].max * 100) })}` : '')));
      dot.addEventListener('mouseleave', () => tip(null));
      svg.appendChild(dot);
    });
    container.appendChild(svg);

    const summary = document.createElement('div'); summary.className = 'radar-summary';
    summary.innerHTML = AX.map(ax => {
      const s = stat[ax.key];
      const range = isAgg ? `<span class="rs-range">${Math.round(s.min * 100)}–${Math.round(s.max * 100)}%</span>` : '';
      const lvl = s.mean >= 0.75 ? 'hi' : s.mean >= 0.25 ? 'mid' : 'lo';
      return `<div class="rs-item"><span class="rs-letter" style="color:${ax.color}">${ax.key}</span>
        <span class="rs-name">${ax.name}</span>
        <span class="rs-val lvl-ink-${lvl}">${Math.round(s.mean * 100)}%</span>${range}</div>`;
    }).join('');
    container.appendChild(summary);
    const weak = AX.reduce((m, ax) => stat[ax.key].mean < stat[m.key].mean ? ax : m, AX[0]);
    const takeaway = document.createElement('p'); takeaway.className = 'radar-takeaway';
    takeaway.innerHTML = t('chart.radar.weakest', {
      name: `<b style="color:${weak.color}">${weak.name}</b>`,
      pct: Math.round(stat[weak.key].mean * 100),
    }) + (isAgg ? ' ' + t('chart.radar.spread', { count: fmtNum(d.assessments.length) }) : '');
    container.appendChild(takeaway);
    return;
  }

  // ── Compare mode: one coloured mean polygon per dataset ──
  datasets.forEach((d, di) => {
    const stat = stats[di];
    const meanPts = AX.map(ax => pt(ax.ang, stat[ax.key].mean));
    svg.appendChild(mk('polygon', { points: meanPts.map(p => p.join(',')).join(' '), fill: d.color, 'fill-opacity': 0.1, stroke: d.color, 'stroke-width': 2.5 }));
    AX.forEach((ax, i) => {
      const [px, py] = meanPts[i];
      const dot = mk('circle', { cx: px, cy: py, r: 4, fill: d.color, stroke: surface, 'stroke-width': 1.5, style: 'cursor:pointer' });
      dot.addEventListener('mouseenter', e => tip(e, `${d.label}\n${ax.key} · ${ax.name}: ${Math.round(stat[ax.key].mean * 100)}%`));
      dot.addEventListener('mouseleave', () => tip(null));
      svg.appendChild(dot);
    });
  });
  container.appendChild(svg);
  const lg = document.createElement('div'); lg.className = 'chart-legend';
  lg.innerHTML = datasets.map(d => `<span><i class="sw" style="background:${d.color}"></i>${d.label}</span>`).join('');
  container.appendChild(lg);
  const summary = document.createElement('div'); summary.className = 'radar-summary';
  summary.innerHTML = AX.map(ax => `<div class="rs-item"><span class="rs-letter" style="color:${ax.color}">${ax.key}</span>
    <span class="rs-name">${ax.name}</span>
    <span class="rs-cmp">${datasets.map((d, di) => `<b style="color:${d.color}">${Math.round(stats[di][ax.key].mean * 100)}%</b>`).join(' ')}</span></div>`).join('');
  container.appendChild(summary);
}

// ── Heatmap: records (rows) × 14 sub-principle checks (cols) ──
export function renderHeatmap(container, assessments, tip) {
  const CAP = 150;
  const base = assessments.length <= CAP
    ? assessments
    : assessments.filter((_, i) => i % Math.ceil(assessments.length / CAP) === 0).slice(0, CAP);
  // Worst-first: the records most in need of attention rise to the top.
  const sample = [...base].sort((a, b) => a.overallPercent - b.overallPercent);

  const cols = assessments[0].principles.flatMap(p => p.checks.map(c => ({ id: c.id, name: c.name, letter: p.letter })));
  const grid = document.createElement('div');
  grid.className = 'heatmap';
  grid.style.setProperty('--cols', cols.length);

  // header row: check ids (hover for the full name)
  grid.appendChild(cell('hm-corner', ''));
  for (const c of cols) {
    const h = cell(`hm-col f-ink-${c.letter}`, c.id, `${c.id} · ${c.name}`);
    h.addEventListener('mouseenter', (e) => tip(e, `${c.letter} · ${c.id}\n${c.name}`));
    h.addEventListener('mouseleave', () => tip(null));
    grid.appendChild(h);
  }

  for (const a of sample) {
    const flat = a.principles.flatMap(p => p.checks);
    grid.appendChild(cell('hm-row', shortId(a.identifier), a.identifier));
    flat.forEach((c, i) => {
      const state = c.score === 1 ? 'pass' : c.score === 0.5 ? 'partial' : 'fail';
      const d = document.createElement('div');
      d.className = `hm-cell hm-${state}`;
      d.addEventListener('mouseenter', (e) => tip(e, `${shortId(a.identifier)}\n${cols[i].id} · ${c.name}\n${t(c.score === 1 ? 'level.full' : c.score === 0.5 ? 'level.partial' : 'level.notMet')}`));
      d.addEventListener('mouseleave', () => tip(null));
      grid.appendChild(d);
    });
  }
  container.appendChild(grid);
  if (assessments.length > CAP) {
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = t('chart.heatmap.sampleNote', { shown: sample.length, total: fmtNum(assessments.length) });
    container.appendChild(note);
  }
}

// ── Temporal: mean FAIR% per year (SVG bars) ──
export function renderTemporal(container, rows, opts) {
  const { colors, axis, grid, tip } = opts;
  const NS = 'http://www.w3.org/2000/svg';
  const W = container.clientWidth || 760, H = 220, padL = 30, padR = 10, padT = 12, padB = 24;
  const iw = W - padL - padR, ih = H - padT - padB, n = rows.length;
  const gap = iw / n, bw = Math.min(48, gap * 0.68);
  const mk = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });
  const mono = 'ui-monospace, SF Mono, Menlo, monospace';
  for (const v of [0, 50, 100]) {
    const y = padT + ih - v / 100 * ih;
    svg.appendChild(mk('line', { x1: padL, y1: y, x2: W - padR, y2: y, stroke: grid, 'stroke-width': 1 }));
    const t = mk('text', { x: 2, y: y + 3, fill: axis, 'font-size': 9, 'font-family': mono }); t.textContent = v; svg.appendChild(t);
  }
  rows.forEach((r, i) => {
    const x = padL + gap * i + (gap - bw) / 2;
    const h = Math.max(r.mean / 100 * ih, 1.5), y = padT + ih - h;
    const color = r.mean >= 75 ? colors.hi : r.mean >= 25 ? colors.mid : colors.lo;
    const rect = mk('rect', { x, y, width: bw, height: h, rx: 3, fill: color, style: 'cursor:pointer' });
    rect.addEventListener('mouseenter', e => tip(e, `${r.year}\n${t('chart.temporal.meanFair', { pct: r.mean })}\n${tn('chart.records', r.n, { count: fmtNum(r.n) })}`));
    rect.addEventListener('mouseleave', () => tip(null));
    svg.appendChild(rect);
    if (n <= 18 || i % Math.ceil(n / 18) === 0) {
      const t = mk('text', { x: x + bw / 2, y: H - 7, fill: axis, 'font-size': 9, 'text-anchor': 'middle', 'font-family': mono });
      t.textContent = `'${String(r.year).slice(2)}`; svg.appendChild(t);
    }
  });
  container.appendChild(svg);
}

// ── Year picker: records-per-publicationYear bars, click to set a range.
// data: [{year, count}] ascending. opts.selected = [from|null, until|null].
// Click a bar → pick that year; click another → span the two; click again → restart.
// opts.onPick(from, until) fires the re-query. ──
export function renderYearPicker(container, data, opts) {
  const { accent, muted, axis, grid, tip, selected = [null, null], onPick } = opts;
  const NS = 'http://www.w3.org/2000/svg', mono = 'ui-monospace, SF Mono, Menlo, monospace';
  const [selFrom, selTo] = selected;
  const W = container.clientWidth || 760, H = 128, padL = 8, padR = 8, padT = 10, padB = 20;
  const iw = W - padL - padR, ih = H - padT - padB, n = data.length;
  const max = Math.max(1, ...data.map(d => d.count));
  const gap = iw / n, bw = Math.min(30, gap * 0.72);
  const mk = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });
  svg.appendChild(mk('line', { x1: padL, y1: padT + ih, x2: W - padR, y2: padT + ih, stroke: grid, 'stroke-width': 1 }));
  const inSel = (y) => selFrom != null && selTo != null && y >= selFrom && y <= selTo;
  const pick = (y) => {
    let f, t;
    if (selFrom == null) { f = t = y; }
    else if (selFrom === selTo) { f = Math.min(selFrom, y); t = Math.max(selFrom, y); }
    else { f = t = y; }
    onPick(f, t);
  };
  data.forEach((d, i) => {
    const x = padL + gap * i + (gap - bw) / 2;
    const h = d.count ? Math.max(d.count / max * ih, 2) : 0;
    const on = inSel(d.year);
    if (h > 0) svg.appendChild(mk('rect', { x, y: padT + ih - h, width: bw, height: h, rx: 2, fill: on ? accent : muted, 'fill-opacity': on ? 0.95 : 0.32 }));
    const hit = mk('rect', { x: padL + gap * i, y: padT, width: gap, height: ih, fill: 'transparent', style: 'cursor:pointer; pointer-events:all' });
    hit.addEventListener('mouseenter', e => tip(e, `${d.year}\n${tn('chart.records', d.count, { count: fmtNum(d.count) })}${on ? `\n${t('chart.yearpicker.inRange')}` : ''}`));
    hit.addEventListener('mouseleave', () => tip(null));
    hit.addEventListener('click', () => pick(d.year));
    svg.appendChild(hit);
    if (n <= 16 || i % Math.ceil(n / 16) === 0 || i === n - 1) {
      const t = mk('text', { x: x + bw / 2, y: H - 6, fill: axis, 'font-size': 9, 'text-anchor': 'middle', 'font-family': mono });
      t.textContent = `'${String(d.year).slice(2)}`; svg.appendChild(t);
    }
  });
  container.appendChild(svg);
}

function cell(cls, text, title) {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  if (title) d.title = title;
  return d;
}
const shortId = (id) => String(id).replace(/^https?:\/\/(dx\.)?doi\.org\//, '').replace(/^oai:/, '').slice(0, 28);

// ── Curation activity: DOIs registered vs records updated, per year ──
// Two series on ONE count axis, which is legitimate because both are counts of
// records. The shape is the message: registration without updating is a
// deposit-and-forget collection; updating that outlives registration is a
// collection someone is still curating.
// rows: [{year, registered, updated}] ascending.
export function renderActivity(container, rows, opts) {
  const { colors, axis, grid, tip } = opts;
  const NS = 'http://www.w3.org/2000/svg';
  const W = container.clientWidth || 760, H = 230, padL = 42, padR = 12, padT = 14, padB = 26;
  const iw = W - padL - padR, ih = H - padT - padB, n = rows.length || 1;
  const mk = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });
  const mono = 'ui-monospace, SF Mono, Menlo, monospace';

  const max = Math.max(1, ...rows.flatMap(r => [r.registered, r.updated]));
  // A round ceiling so the gridline labels are readable numbers.
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const y = (v) => padT + ih - (v / top) * ih;
  const fmt = (v) => v >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v);

  for (const v of [0, top / 2, top]) {
    svg.appendChild(mk('line', { x1: padL, y1: y(v), x2: W - padR, y2: y(v), stroke: grid, 'stroke-width': 1 }));
    const lb = mk('text', { x: padL - 6, y: y(v) + 3, fill: axis, 'font-size': 9, 'text-anchor': 'end', 'font-family': mono });
    lb.textContent = fmt(v); svg.appendChild(lb);
  }

  const gap = iw / n, bw = Math.min(20, gap * 0.36);
  rows.forEach((r, i) => {
    const cx = padL + gap * i + gap / 2;
    [['registered', colors.a, -1], ['updated', colors.b, 1]].forEach(([key, col, side]) => {
      const v = r[key], h = Math.max((v / top) * ih, v > 0 ? 1.5 : 0);
      if (h <= 0) return;
      const x = cx + (side < 0 ? -bw - 1 : 1);
      const rect = mk('rect', { x, y: padT + ih - h, width: bw, height: h, rx: 2, fill: col, style: 'cursor:pointer' });
      rect.addEventListener('mouseenter', e => tip(e, `${r.year}\n${t('chart.activity.' + key, { count: fmtNum(v) })}`));
      rect.addEventListener('mouseleave', () => tip(null));
      svg.appendChild(rect);
    });
    if (n <= 18 || i % Math.ceil(n / 18) === 0) {
      const lb = mk('text', { x: cx, y: H - 7, fill: axis, 'font-size': 9, 'text-anchor': 'middle', 'font-family': mono });
      lb.textContent = `'${String(r.year).slice(2)}`; svg.appendChild(lb);
    }
  });
  container.appendChild(svg);
}

// ── Score trend over time: one line per repository ──
// series: [{ label, color, points: [{date, value}] }], dates ISO, ascending.
// A shared time axis, because comparing repositories only means anything when
// the runs line up; a per-series axis would let two different histories look
// like the same story.
export function renderTrend(container, series, opts) {
  const { axis, grid, tip, surface } = opts;
  const NS = 'http://www.w3.org/2000/svg';
  const W = container.clientWidth || 760, H = 250, padL = 38, padR = 14, padT = 16, padB = 30;
  const iw = W - padL - padR, ih = H - padT - padB;
  const mk = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); return e; };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H });
  const mono = 'ui-monospace, SF Mono, Menlo, monospace';

  const dates = [...new Set(series.flatMap(s => s.points.map(p => p.date)))].sort();
  if (!dates.length) return;
  const x = (d) => dates.length === 1 ? padL + iw / 2 : padL + (dates.indexOf(d) / (dates.length - 1)) * iw;
  const y = (v) => padT + ih - (v / 100) * ih;

  for (const v of [0, 50, 100]) {
    svg.appendChild(mk('line', { x1: padL, y1: y(v), x2: W - padR, y2: y(v), stroke: grid, 'stroke-width': 1 }));
    const lb = mk('text', { x: padL - 6, y: y(v) + 3, fill: axis, 'font-size': 9, 'text-anchor': 'end', 'font-family': mono });
    lb.textContent = v; svg.appendChild(lb);
  }
  // Label the ends, and the middle when there is room, rather than every run:
  // a monthly history overruns the axis within two years.
  const marks = dates.length <= 8 ? dates.map((_, i) => i) : [0, Math.floor(dates.length / 2), dates.length - 1];
  marks.forEach(i => {
    const lb = mk('text', { x: x(dates[i]), y: H - 9, fill: axis, 'font-size': 9, 'text-anchor': 'middle', 'font-family': mono });
    lb.textContent = dates[i].slice(2, 7); svg.appendChild(lb);
  });

  series.forEach(s => {
    const pts = [...s.points].sort((a, b) => a.date.localeCompare(b.date));
    if (pts.length > 1) {
      svg.appendChild(mk('path', {
        d: pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date)},${y(p.value)}`).join(' '),
        fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      }));
    }
    pts.forEach(p => {
      // A ring in the surface colour keeps overlapping series readable where
      // two repositories happen to land on the same score.
      const c = mk('circle', { cx: x(p.date), cy: y(p.value), r: 4, fill: s.color,
        stroke: surface || '#fff', 'stroke-width': 1.5, style: 'cursor:pointer' });
      c.addEventListener('mouseenter', e => tip(e, `${s.label}\n${p.date}\n${p.value}%${p.note ? '\n' + p.note : ''}`));
      c.addEventListener('mouseleave', () => tip(null));
      svg.appendChild(c);
    });
  });
  container.appendChild(svg);
}
