// FAIR Assessment Engine — client-side ESM port of the repo-metaudits fair-engine.
// Faithfully lifted from the server Worker (same 14 sub-principle logic, identical scores).
// This is the OPEN version: the rubric implementation is fully visible here.
// Source of truth for the methodology: README.md.
//
// All user-facing prose lives in src/i18n/*.js and is reached through t()/tn().
// What deliberately stays as English literals in this file is DATA, not UI:
// SPDX ids, DCMI type values, subject-scheme and licence names, Dublin Core
// element labels (dc:title…), and every schema field name (rightsURI,
// subjectScheme, relatedIdentifiers…) that a user types into a metadata editor.
// Those travel through the catalogue as {vars}, never as keys.

// `n` (locale number formatting) is imported but intentionally unused for now: every
// count in this file lands in an exported report, and digit grouping would change the
// English output for values >= 1000. Wire it up when that change is wanted.
// eslint-disable-next-line no-unused-vars
import { t, tn, n } from './i18n/index.js?v=24';

function toArr(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String);
  return [String(val)];
}

// ── Identifier analysis ──

const PID_PATTERNS = [
  { name: 'DOI', regex: /^10\.\d{4,}\// },
  { name: 'DOI URL', regex: /^https?:\/\/(dx\.)?doi\.org\/10\./ },
  { name: 'Handle', regex: /^https?:\/\/hdl\.handle\.net\// },
  { name: 'Handle', regex: /^hdl:/ },
  { name: 'URN', regex: /^urn:[a-z0-9][a-z0-9-]{0,31}:/ },
  { name: 'ARK', regex: /^ark:\// },
  { name: 'PURL', regex: /^https?:\/\/purl\.org\// },
];

function classifyIdentifier(id) {
  for (const p of PID_PATTERNS) {
    if (p.regex.test(id)) return { type: p.name, isPersistent: true };
  }
  if (/^https?:\/\//.test(id)) return { type: 'URL', isPersistent: false };
  if (/^[A-Za-z0-9-]+$/.test(id) && id.length < 50) return { type: 'Local ID', isPersistent: false };
  return { type: 'Unknown', isPersistent: false };
}

// ── License analysis ──

// Exact SPDX-style identifier classification — used when a rights entry carries a
// structured identifier (rightsIdentifier) or an spdx.org / opensource.org URI.
// Matching the identifier exactly can never false-positive on prose, so it runs
// BEFORE the free-text patterns below.
const SPDX_IDS = {
  'MIT': { name: 'MIT License', open: true },
  'MIT-0': { name: 'MIT License', open: true },
  'APACHE-2.0': { name: 'Apache 2.0', open: true },
  'BSD-2-CLAUSE': { name: 'BSD 2-Clause', open: true },
  'BSD-3-CLAUSE': { name: 'BSD 3-Clause', open: true },
  '0BSD': { name: 'BSD Zero Clause', open: true },
  'ISC': { name: 'ISC License', open: true },
  'ZLIB': { name: 'zlib License', open: true },
  'UNLICENSE': { name: 'The Unlicense', open: true },
  'MPL-2.0': { name: 'MPL 2.0', open: true },
  'EPL-1.0': { name: 'EPL', open: true },
  'EPL-2.0': { name: 'EPL', open: true },
  'EUPL-1.1': { name: 'EUPL', open: true },
  'EUPL-1.2': { name: 'EUPL', open: true },
  'ARTISTIC-2.0': { name: 'Artistic 2.0', open: true },
  'BSL-1.0': { name: 'Boost 1.0', open: true },
  'ODBL-1.0': { name: 'ODbL 1.0', open: true },
  'ODC-BY-1.0': { name: 'ODC-By 1.0', open: true },
  'CDLA-PERMISSIVE-1.0': { name: 'CDLA-Permissive', open: true },
  'CDLA-PERMISSIVE-2.0': { name: 'CDLA-Permissive', open: true },
};

function classifySpdxId(raw) {
  if (!raw) return null;
  const id = String(raw).trim().toUpperCase().replace(/\.(HTML|JSON|TXT)$/, '');
  const gpl = id.match(/^([AL]?GPL)-(\d(?:\.\d+)?)(-ONLY|-OR-LATER|\+)?$/);
  if (gpl) return { name: `${gpl[1]} ${gpl[2]}`, open: true };
  if (/^CC0(-\d[\d.]*)?$/.test(id) || id === 'CC-PDDC') return { name: 'CC0 / Public Domain', open: true };
  const cc = id.match(/^CC-BY((?:-(?:SA|NC|ND))*)(-\d[\d.]*)?$/);
  if (cc) return { name: `CC BY${cc[1]}${cc[2] ? ' ' + cc[2].slice(1) : ''}`, open: !/NC|ND/.test(cc[1]) };
  return SPDX_IDS[id] || null;
}

// spdx.org / opensource.org license URIs carry the identifier in the path
// (covers both OSI URL forms: /licenses/MIT and the current /license/mit).
function classifyLicenseUri(uri) {
  const m = String(uri || '').match(/(?:spdx\.org\/licenses|opensource\.org\/licen[cs]es?)\/([A-Za-z0-9.+-]+)/i);
  return m ? classifySpdxId(m[1]) : null;
}

const LICENSE_PATTERNS = [
  { name: 'CC BY 4.0', regex: /creativecommons\.org\/licenses\/by\/4/i, open: true },
  { name: 'CC BY-SA', regex: /creativecommons\.org\/licenses\/by-sa/i, open: true },
  { name: 'CC BY-NC', regex: /creativecommons\.org\/licenses\/by-nc(?!-nd)/i, open: false },
  { name: 'CC BY-NC-SA', regex: /creativecommons\.org\/licenses\/by-nc-sa/i, open: false },
  { name: 'CC BY-NC-ND', regex: /creativecommons\.org\/licenses\/by-nc-nd/i, open: false },
  { name: 'CC BY-ND', regex: /creativecommons\.org\/licenses\/by-nd/i, open: false },
  { name: 'CC0 / Public Domain', regex: /creativecommons\.org\/(publicdomain|licenses\/cc0|publicdomain\/zero)/i, open: true },
  { name: 'CC BY 3.0', regex: /creativecommons\.org\/licenses\/by\/3/i, open: true },
  // Free-text patterns require license CONTEXT (or a bare identifier-only value) so
  // proper nouns can't false-positive: "© MIT" the university, "Apache Point
  // Observatory", "deposited in the Open Access repository". Structured identifiers
  // and spdx.org/opensource.org URIs are classified exactly, above.
  { name: 'MIT License', regex: /\bMIT(?:-|\s+)licen[cs]ed?\b|\blicen[cs]ed?\s+under\s+(?:the\s+)?MIT\b|^\s*MIT(?:-0)?\s*$/i, open: true },
  { name: 'Apache 2.0', regex: /\bapache\s+licen[cs]e\b|\bapache[- ]2(\.0)?\b/i, open: true },
  { name: 'GPL', regex: /\bGNU\s+(?:Affero\s+|Lesser\s+)?General\s+Public\s+Licen[cs]e\b|\b[AL]?GPL\s*[- ]?v?\d|\blicen[cs]ed?\s+under\s+(?:the\s+)?[AL]?GPL\b|^\s*[AL]?GPL\s*$/i, open: true },
  { name: 'Open Access', regex: /^\s*open\s*access\s*$|info:eu-repo\/semantics\/openAccess|\bopen\s+access\s+licen[cs]e\b/i, open: true },
  { name: 'All rights reserved', regex: /all rights reserved/i, open: false },
];

function classifyLicense(text) {
  const hasUri = /https?:\/\//.test(text);
  for (const p of LICENSE_PATTERNS) {
    if (p.regex.test(text)) return { name: p.name, open: p.open, hasUri };
  }
  return { name: 'Unrecognized license', open: false, hasUri };
}

// Two-tier license analysis over a normalized rights array.
// Each raw entry: { text, uri, identifier, scheme }.
// Every source (Dublin Core free text, DataCite rightsList, custom adapters)
// maps its shape into this form, so the analysis is source-agnostic.
// Distinguishes machine-readability (a license URI) from PID/vocabulary
// declaration (rightsIdentifier + rightsIdentifierScheme, e.g. SPDX/CC) —
// the same "present vs actionable" split used across the audit suite.
function analyzeLicense(rawEntries) {
  const entries = (rawEntries || []).filter(
    e => (e.text && String(e.text).trim()) || e.uri || e.identifier
  );
  if (entries.length === 0) {
    return { class: 'none', machineReadable: false, spdxDeclared: false,
      multi: false, primaryName: null, count: 0, entries: [] };
  }
  const classified = entries.map(e => {
    // Structured signals first — an exact identifier or a known license URI can
    // never false-positive on prose, unlike the free-text patterns.
    const structured = classifySpdxId(e.identifier) || classifyLicenseUri(e.uri);
    const c = structured
      ? { ...structured, hasUri: !!e.uri }
      : classifyLicense(`${e.text || ''} ${e.uri || ''} ${e.identifier || ''}`);
    const machineReadable = !!(e.uri && /^https?:\/\//i.test(e.uri)) || c.hasUri;
    const spdxDeclared = !!(e.identifier && e.scheme);
    let cls;
    if (c.name === 'All rights reserved') cls = 'all-rights-reserved';
    else if (c.open) cls = 'open';
    else cls = 'restricted';
    return {
      name: c.name, open: c.open, class: cls,
      uri: e.uri || null, identifier: e.identifier || null, scheme: e.scheme || null,
      machineReadable, spdxDeclared,
    };
  });
  const distinctNames = [...new Set(classified.map(c => c.name))];
  const primary = classified.find(c => c.class === 'open') || classified[0];
  return {
    class: primary.class,
    machineReadable: classified.some(c => c.machineReadable),
    spdxDeclared: classified.some(c => c.spdxDeclared),
    multi: distinctNames.length > 1,
    primaryName: primary.name,
    count: classified.length,
    entries: classified,
  };
}

// ── Vocabulary analysis ──

const DCMI_TYPES = ['Text', 'Dataset', 'Image', 'Sound', 'MovingImage', 'Software',
  'InteractiveResource', 'PhysicalObject', 'Event', 'Service', 'Collection', 'StillImage'];

const SUBJECT_SCHEMES = [
  { name: 'DDC (Dewey)', regex: /^\d{3}(\.\d+)?$/ },
  { name: 'LCC', regex: /^[A-Z]{1,2}\d/ },
  { name: 'MeSH', regex: /mesh/i },
  { name: 'LCSH', regex: /^[A-Z][a-z]+--/ },
];

// NOTE: the callback parameter is `v`, not `t` — `t` is the translator import.
function checkDcmiType(types) {
  const normalized = types.map(v => v.trim());
  const found = normalized.filter(v => DCMI_TYPES.some(d => d.toLowerCase() === v.toLowerCase()));
  return { matches: found.length > 0, found };
}

function checkLanguageCode(langs) {
  const isoPattern = /^[a-z]{2,3}(-[A-Z]{2})?$/;
  const valid = langs.filter(l => isoPattern.test(l.trim()));
  return { valid: valid.length > 0, codes: valid };
}

function detectSubjectScheme(subjects) {
  for (const s of subjects) {
    for (const scheme of SUBJECT_SCHEMES) {
      if (scheme.regex.test(s)) return scheme.name;
    }
  }
  return null;
}

// ── Dublin Core field inventory ──

const DC_FIELDS = [
  { key: 'title', required: true, label: 'dc:title' },
  { key: 'creator', required: true, label: 'dc:creator' },
  { key: 'subject', required: true, label: 'dc:subject' },
  { key: 'description', required: true, label: 'dc:description' },
  { key: 'publisher', required: true, label: 'dc:publisher' },
  { key: 'contributor', required: false, label: 'dc:contributor' },
  { key: 'date', required: true, label: 'dc:date' },
  { key: 'type', required: true, label: 'dc:type' },
  { key: 'format', required: false, label: 'dc:format' },
  { key: 'identifier', required: true, label: 'dc:identifier' },
  { key: 'source', required: false, label: 'dc:source' },
  { key: 'language', required: true, label: 'dc:language' },
  { key: 'relation', required: false, label: 'dc:relation' },
  { key: 'coverage', required: false, label: 'dc:coverage' },
  { key: 'rights', required: true, label: 'dc:rights' },
];

function inventoryDcFields(meta) {
  const present = [];
  const missing = [];
  const missingRequired = [];
  for (const f of DC_FIELDS) {
    const val = toArr(meta[f.key]);
    if (val.length > 0) {
      present.push(f.label);
    } else {
      missing.push(f.label);
      if (f.required) missingRequired.push(f.label);
    }
  }
  return { present, missing, missingRequired, total: DC_FIELDS.length, filled: present.length };
}

// ── Date analysis ──

// `granularity` is display prose — it only ever reaches a details string — so it is
// translated. The format hints inside it (YYYY-MM-DD…) stay literal by design.
function analyzeDateQuality(dates) {
  if (dates.length === 0) return { hasIso: false, granularity: t('date.granularity.none'), sample: '' };
  const sample = dates[0];
  if (/^\d{4}-\d{2}-\d{2}T/.test(sample)) return { hasIso: true, granularity: t('date.granularity.datetime'), sample };
  if (/^\d{4}-\d{2}-\d{2}$/.test(sample)) return { hasIso: true, granularity: t('date.granularity.day'), sample };
  if (/^\d{4}-\d{2}$/.test(sample)) return { hasIso: true, granularity: t('date.granularity.month'), sample };
  if (/^\d{4}$/.test(sample)) return { hasIso: true, granularity: t('date.granularity.year'), sample };
  return { hasIso: false, granularity: t('date.granularity.nonIso'), sample };
}

// ── Score helpers ──

// The glyph is structural \u2014 exports and the UI key off it \u2014 so it stays in the
// code; only the word after it comes from the catalogue.
function scoreLabel(s) {
  return s === 1 ? `\u25cf ${t('score.full')}`
    : s === 0.5 ? `\u25d0 ${t('score.partial')}`
    : `\u25cb ${t('score.notMet')}`;
}

function roundScore(avgScore) {
  return avgScore >= 0.75 ? 1 : avgScore >= 0.25 ? 0.5 : 0;
}

// ══════════════════════════════════════
// ── OAI-PMH FAIR Assessment ──
// ══════════════════════════════════════

function assessOaiRecord(record) {
  const meta = record.metadata ?? {};
  const identifiers = toArr(meta.identifier);
  const inv = inventoryDcFields(meta);
  const dates = toArr(meta.date);
  const dateQuality = analyzeDateQuality(dates);
  const types = toArr(meta.type);
  const subjects = toArr(meta.subject);
  const rights = toArr(meta.rights);
  const relations = toArr(meta.relation);
  const sources = toArr(meta.source);
  const languages = toArr(meta.language);
  const contributors = toArr(meta.contributor);
  const creators = toArr(meta.creator);
  const descriptions = toArr(meta.description);

  // Classify all identifiers
  const classifiedIds = identifiers.map(id => ({ id, ...classifyIdentifier(id) }));
  const persistentIds = classifiedIds.filter(c => c.isPersistent);
  const hasUrl = classifiedIds.some(c => c.type === 'URL' || c.isPersistent);

  // License analysis (Dublin Core: free text only, no structured URI/scheme)
  const lic = analyzeLicense(rights.map(r => ({ text: r })));

  // Vocabulary analysis
  const dcmiCheck = checkDcmiType(types);
  const langCheck = checkLanguageCode(languages);
  const subjectScheme = detectSubjectScheme(subjects);

  const f1Score = persistentIds.length > 0 ? 1 : hasUrl ? 0.5 : 0;
  const f2Score = inv.missingRequired.length === 0 ? 1 : inv.filled >= 8 ? 0.5 : 0;
  const f3Score = persistentIds.length > 0 ? 1 : identifiers.length > 0 ? 0.5 : 0;
  const i2Score = (dcmiCheck.matches && (langCheck.valid || subjectScheme)) ? 1
    : (dcmiCheck.matches || langCheck.valid || subjectScheme) ? 0.5 : 0;
  const i3Score = relations.length > 0 ? (relations.some(r => /^https?:\/\/|^10\.\d{4}/.test(r)) ? 1 : 0.5) : 0;
  const r1Score = inv.filled >= 12 ? 1 : inv.filled >= 8 ? 0.5 : 0;
  const r11Score = lic.class === 'none' ? 0 : lic.machineReadable ? 1 : 0.5;
  const r12Score = (creators.length > 0 && (contributors.length > 0 || sources.length > 0 || dates.length > 0))
    ? (contributors.length > 0 ? 1 : 0.5) : (creators.length > 0 ? 0.5 : 0);
  const r13Score = dcmiCheck.matches && langCheck.valid && dateQuality.hasIso ? 1
    : (dcmiCheck.matches || langCheck.valid || dateQuality.hasIso) ? 0.5 : 0;

  const checks = {
    F: [
      {
        id: 'F1', name: t('check.oai.F1.name'),
        description: t('check.oai.F1.description'),
        score: f1Score,
        maxScore: 1,
        get details() { return `${scoreLabel(f1Score)}. `
          + (persistentIds.length > 0
            ? tn('check.oai.F1.details.hasPid', persistentIds.length, {
                list: persistentIds.map(p => `[${p.type}] ${p.id}`).join(' | '),
              })
            : hasUrl
              ? t('check.oai.F1.details.noPid', {
                  list: classifiedIds.map(c => `[${c.type}] ${c.id.substring(0, 80)}`).join(' | '),
                })
              : t('check.oai.F1.details.none')); },
      },
      {
        id: 'F2', name: t('check.oai.F2.name'),
        description: t('check.oai.F2.description'),
        score: f2Score,
        maxScore: 1,
        get details() { return `${scoreLabel(f2Score)}. `
          + t('check.oai.F2.details.populated', { filled: inv.filled, total: inv.total }) + ' '
          + (inv.missingRequired.length > 0
            ? t('check.oai.F2.details.missingRequired', { fields: inv.missingRequired.join(', ') })
            : t('check.oai.F2.details.allRequired')) + ' '
          + (inv.missing.length > 0
            ? t('check.oai.F2.details.optionalMissing', { fields: inv.missing.join(', ') })
            : t('check.oai.F2.details.allPresent')); },
      },
      {
        id: 'F3', name: t('check.oai.F3.name'),
        description: t('check.oai.F3.description'),
        score: f3Score,
        maxScore: 1,
        get details() { return `${scoreLabel(f3Score)}. `
          + (identifiers.length > 0
            ? tn('check.oai.F3.details.hasIds', identifiers.length, {
                list: classifiedIds.map(c => `[${c.type}] ${c.id.substring(0, 80)}`).join(' | '),
              }) + ' '
              + (persistentIds.length > 0
                ? t('check.oai.F3.details.withPid')
                : t('check.oai.F3.details.noPid'))
            : t('check.oai.F3.details.none')); },
      },
      {
        id: 'F4', name: t('check.oai.F4.name'),
        description: t('check.oai.F4.description'),
        score: 1,
        maxScore: 1,
        get details() { return `${scoreLabel(1)}. `
          + t('check.oai.F4.details.main') + ' '
          + t('check.oai.F4.details.identifier', {
              identifier: record.header.identifier,
              datestamp: record.header.datestamp,
            }) + ' '
          + (record.header.setSpec
            ? tn('check.oai.F4.details.sets', toArr(record.header.setSpec).length, {
                sets: toArr(record.header.setSpec).join(', '),
              })
            : t('check.oai.F4.details.noSet')); },
      },
    ],

    A: [
      {
        id: 'A1', name: t('check.oai.A1.name'),
        description: t('check.oai.A1.description'),
        score: 1,
        maxScore: 1,
        get details() { return `${scoreLabel(1)}. `
          + t('check.oai.A1.details.main', { identifier: record.header.identifier }); },
      },
      {
        id: 'A1.1', name: t('check.oai.A1.1.name'),
        description: t('check.oai.A1.1.description'),
        score: 1,
        maxScore: 1,
        get details() { return `${scoreLabel(1)}. ` + t('check.oai.A1.1.details.main'); },
      },
      {
        id: 'A2', name: t('check.oai.A2.name'),
        description: t('check.oai.A2.description'),
        score: record.header.status === 'deleted' ? 0.5 : 1,
        maxScore: 1,
        get details() { return record.header.status === 'deleted'
          ? `${scoreLabel(0.5)}. `
            + t('check.oai.A2.details.deleted', { identifier: record.header.identifier })
          : `${scoreLabel(1)}. `
            + t('check.oai.A2.details.active', { datestamp: record.header.datestamp }); },
      },
    ],

    I: [
      {
        id: 'I1', name: t('check.oai.I1.name'),
        description: t('check.oai.I1.description'),
        score: 1,
        maxScore: 1,
        get details() { return `${scoreLabel(1)}. ` + t('check.oai.I1.details.main'); },
      },
      {
        id: 'I2', name: t('check.oai.I2.name'),
        description: t('check.oai.I2.description'),
        score: i2Score,
        maxScore: 1,
        get details() { return `${scoreLabel(i2Score)}. ` + t('check.oai.I2.details.intro') + ' '
          + (types.length > 0
            ? (dcmiCheck.matches
              ? t('check.oai.I2.details.type.match', {
                  found: dcmiCheck.found.join(', '),
                  list: DCMI_TYPES.slice(0, 6).join(', '),
                })
              : t('check.oai.I2.details.type.noMatch', {
                  value: types[0],
                  list: DCMI_TYPES.slice(0, 6).join(', '),
                }))
            : t('check.oai.I2.details.type.empty')) + ' '
          + (subjects.length > 0
            ? (subjectScheme
                ? tn('check.oai.I2.details.subject.withScheme', subjects.length, { scheme: subjectScheme })
                : tn('check.oai.I2.details.subject.noScheme', subjects.length)) + ' '
              + t('check.oai.I2.details.subject.terms', {
                  terms: subjects.slice(0, 3).join('", "'),
                  ellipsis: subjects.length > 3 ? '\u2026' : '',
                })
            : t('check.oai.I2.details.subject.empty')) + ' '
          + (languages.length > 0
            ? (langCheck.valid
                ? t('check.oai.I2.details.language.valid', { codes: langCheck.codes.join(', ') })
                : t('check.oai.I2.details.language.invalid', { value: languages[0] }))
            : t('check.oai.I2.details.language.empty')); },
      },
      {
        id: 'I3', name: t('check.oai.I3.name'),
        description: t('check.oai.I3.description'),
        score: i3Score,
        maxScore: 1,
        get details() { return `${scoreLabel(i3Score)}. ` + t('check.oai.I3.details.intro') + ' '
          + (relations.length > 0
            ? tn('check.oai.I3.details.refs', relations.length, {
                list: relations.slice(0, 3).map(r => {
                  const cl = classifyIdentifier(r);
                  return `[${cl.type}] ${r.substring(0, 80)}`;
                }).join(' | '),
                ellipsis: relations.length > 3 ? '\u2026' : '',
              }) + ' '
              + (relations.some(r => /^https?:\/\/|^10\.\d{4}/.test(r))
                ? t('check.oai.I3.details.resolvable')
                : t('check.oai.I3.details.textOnly'))
            : t('check.oai.I3.details.empty') + ' '
              + (sources.length > 0
                ? t('check.oai.I3.details.sourcePresent', { source: sources[0].substring(0, 60) })
                : t('check.oai.I3.details.sourceEmpty'))
              + ' ' + t('check.oai.I3.details.improve')); },
      },
    ],

    R: [
      {
        id: 'R1', name: t('check.oai.R1.name'),
        description: t('check.oai.R1.description'),
        score: r1Score,
        maxScore: 1,
        get details() { return `${scoreLabel(r1Score)}. `
          + t('check.oai.R1.details.populated', { filled: inv.filled, total: inv.total }) + ' '
          + t('check.oai.R1.details.keyFields') + ' '
          + (creators.length > 0
            ? t('check.oai.R1.details.creator.present', {
                count: creators.length,
                names: creators.slice(0, 2).join('; '),
                ellipsis: creators.length > 2 ? '\u2026' : '',
              })
            : t('check.oai.R1.details.creator.missing')) + ' | '
          + (descriptions.length > 0
            ? t('check.oai.R1.details.description.present', { chars: descriptions[0].length })
            : t('check.oai.R1.details.description.missing')) + ' | '
          + (dates.length > 0
            ? t('check.oai.R1.details.date.present', {
                granularity: dateQuality.granularity,
                sample: dateQuality.sample,
              })
            : t('check.oai.R1.details.date.missing')) + ' | '
          + (toArr(meta.publisher).length > 0
            ? t('check.oai.R1.details.publisher.present', { value: toArr(meta.publisher)[0] })
            : t('check.oai.R1.details.publisher.missing')) + '. '
          + (inv.filled < 12
            ? t('check.oai.R1.details.improve', {
                fields: inv.missing.slice(0, 3).join(', '),
                ellipsis: inv.missing.length > 3 ? '\u2026' : '',
              })
            : ''); },
      },
      {
        id: 'R1.1', name: t('check.oai.R1.1.name'),
        description: t('check.oai.R1.1.description'),
        score: r11Score,
        maxScore: 1,
        get details() { return `${scoreLabel(r11Score)}. `
          + (lic.class !== 'none'
            // primaryName and class are classifier output (data), not translatable prose.
            ? t('check.oai.R1.1.details.present', { name: lic.primaryName, class: lic.class }) + ' '
              + (lic.multi ? t('check.oai.R1.1.details.multi', { count: lic.count }) + ' ' : '')
              + (lic.machineReadable
                ? t('check.oai.R1.1.details.machineReadable')
                : t('check.oai.R1.1.details.noUri', { text: rights[0].substring(0, 100) }))
            : t('check.oai.R1.1.details.none')); },
      },
      {
        id: 'R1.2', name: t('check.oai.R1.2.name'),
        description: t('check.oai.R1.2.description'),
        score: r12Score,
        maxScore: 1,
        get details() { return `${scoreLabel(r12Score)}. ` + t('check.oai.R1.2.details.intro') + ' '
          + (creators.length > 0
            ? t('check.oai.R1.2.details.creator.present', {
                count: creators.length,
                names: creators.slice(0, 2).join('; '),
                ellipsis: creators.length > 2 ? '\u2026' : '',
              })
            : t('check.oai.R1.2.details.creator.empty')) + ' '
          + (contributors.length > 0
            ? t('check.oai.R1.2.details.contributor.present', {
                count: contributors.length,
                names: contributors.slice(0, 2).join('; '),
              })
            : t('check.oai.R1.2.details.contributor.empty')) + ' '
          + (sources.length > 0
            ? t('check.oai.R1.2.details.source.present', { source: sources[0].substring(0, 60) })
            : t('check.oai.R1.2.details.source.empty')) + ' '
          + (dates.length > 0
            ? tn('check.oai.R1.2.details.date.present', dates.length, { granularity: dateQuality.granularity })
            : t('check.oai.R1.2.details.date.empty')) + ' '
          + (r12Score < 1 ? t('check.oai.R1.2.details.improve') : ''); },
      },
      {
        id: 'R1.3', name: t('check.oai.R1.3.name'),
        description: t('check.oai.R1.3.description'),
        score: r13Score,
        maxScore: 1,
        get details() { return `${scoreLabel(r13Score)}. ` + t('check.oai.R1.3.details.intro') + ' '
          + (dcmiCheck.matches
            ? t('check.oai.R1.3.details.dcmi.yes', { found: dcmiCheck.found.join(', ') })
            : t('check.oai.R1.3.details.dcmi.no')) + ' '
          + (langCheck.valid
            ? t('check.oai.R1.3.details.language.yes', { codes: langCheck.codes.join(', ') })
            : t('check.oai.R1.3.details.language.no')) + ' '
          + (dateQuality.hasIso
            ? t('check.oai.R1.3.details.date.yes', { granularity: dateQuality.granularity })
            : t('check.oai.R1.3.details.date.no')) + ' '
          + t('check.oai.R1.3.details.note'); },
      },
    ],
  };

  const connectivity = {
    creators: creators.length, creatorsId: 0,
    affiliations: 0, affiliationsId: 0,
    funders: 0, fundersId: 0,
    contributors: contributors.length, contributorsId: 0,
  };
  return buildAssessment('oai-pmh', record.header.identifier, checks, lic, connectivity);
}

// ══════════════════════════════════════
// ── DataCite FAIR Assessment ──
// ══════════════════════════════════════

function assessDataCiteWork(work) {
  const a = work.attributes;
  const doi = a.doi;

  // Creator analysis
  const creatorsWithOrcid = (a.creators ?? []).filter(c => (c.nameIdentifiers ?? []).some(n => n.nameIdentifierScheme === 'ORCID'));
  const creatorsWithAffiliation = (a.creators ?? []).filter(c => c.affiliation && c.affiliation.length > 0);

  // Connectivity: do entities carry the identifiers that link them (ORCID/ROR/funder IDs)
  const dcCreators = a.creators ?? [];
  const dcContribs = a.contributors ?? [];
  const orcidCount = arr => arr.filter(c => (c.nameIdentifiers ?? []).some(n => n.nameIdentifierScheme === 'ORCID')).length;
  const allAffils = [...dcCreators, ...dcContribs].flatMap(c => c.affiliation ?? []);
  const dcFunders = a.fundingReferences ?? [];
  const connectivity = {
    creators: dcCreators.length, creatorsId: orcidCount(dcCreators),
    affiliations: allAffils.length, affiliationsId: allAffils.filter(af => !!af.affiliationIdentifier).length,
    funders: dcFunders.length, fundersId: dcFunders.filter(f => !!f.funderIdentifier).length,
    contributors: dcContribs.length, contributorsId: orcidCount(dcContribs),
  };
  const totalCreators = (a.creators ?? []).length;

  // Attribute inventory
  // `name` is the DataCite schema field name — data, never translated. Only the
  // human-readable `detail` counters go through the catalogue.
  const attrInventory = [
    { name: 'titles', present: (a.titles?.length ?? 0) > 0, detail: a.titles?.[0]?.title?.substring(0, 60) ?? '' },
    { name: 'creators', present: totalCreators > 0, detail: tn('attr.creators', totalCreators) },
    { name: 'publisher', present: !!a.publisher, detail: a.publisher ?? '' },
    { name: 'publicationYear', present: !!a.publicationYear, detail: String(a.publicationYear ?? '') },
    { name: 'resourceType', present: !!a.types?.resourceTypeGeneral, detail: `${a.types?.resourceTypeGeneral ?? ''}${a.types?.resourceType ? ` / ${a.types.resourceType}` : ''}` },
    { name: 'subjects', present: (a.subjects?.length ?? 0) > 0, detail: tn('attr.subjects', a.subjects?.length ?? 0) },
    { name: 'dates', present: (a.dates?.length ?? 0) > 0, detail: (a.dates ?? []).map(d => `${d.dateType}: ${d.date}`).join(', ') },
    { name: 'relatedIdentifiers', present: (a.relatedIdentifiers?.length ?? 0) > 0, detail: tn('attr.relations', a.relatedIdentifiers?.length ?? 0) },
    { name: 'rightsList', present: (a.rightsList?.length ?? 0) > 0, detail: a.rightsList?.[0]?.rights ?? '' },
    { name: 'descriptions', present: (a.descriptions?.length ?? 0) > 0, detail: tn('attr.descriptions', a.descriptions?.length ?? 0) },
    { name: 'language', present: !!a.language, detail: a.language ?? '' },
    { name: 'formats', present: (a.formats?.length ?? 0) > 0, detail: (a.formats ?? []).join(', ') },
    { name: 'sizes', present: (a.sizes?.length ?? 0) > 0, detail: (a.sizes ?? []).join(', ') },
    { name: 'version', present: !!a.version, detail: a.version ?? '' },
    { name: 'fundingReferences', present: (a.fundingReferences?.length ?? 0) > 0, detail: tn('attr.funders', a.fundingReferences?.length ?? 0) },
    { name: 'geoLocations', present: (a.geoLocations?.length ?? 0) > 0, detail: tn('attr.locations', a.geoLocations?.length ?? 0) },
  ];
  const filledAttrs = attrInventory.filter(a => a.present);
  const missingAttrs = attrInventory.filter(a => !a.present);

  // License analysis — all four DataCite rights fields, per-entry (multi-license aware)
  const lic = analyzeLicense((a.rightsList ?? []).map(r => ({
    text: r.rights,
    uri: r.rightsUri,
    identifier: r.rightsIdentifier,
    scheme: r.rightsIdentifierScheme,
  })));

  // Subject scheme analysis
  const schemedSubjects = (a.subjects ?? []).filter(s => s.subjectScheme);
  const unschemedSubjects = (a.subjects ?? []).filter(s => !s.subjectScheme);

  // Related identifiers analysis — only entries carrying a relationType count as "typed"
  const typedRels = (a.relatedIdentifiers ?? []).filter(r => r.relationType);
  const relTypes = typedRels.reduce((acc, r) => {
    acc[r.relationType] = (acc[r.relationType] ?? 0) + 1;
    return acc;
  }, {});

  const checks = {
    F: [
      {
        id: 'F1', name: t('check.dc.F1.name'),
        description: t('check.dc.F1.description'),
        score: doi ? 1 : 0,
        maxScore: 1,
        get details() { return doi
          ? t('check.dc.F1.details.hasDoi', { doi })
            + (a.identifiers?.length
              ? ' ' + t('check.dc.F1.details.additional', {
                  list: a.identifiers.map(i => `[${i.identifierType}] ${i.identifier}`).join('; '),
                })
              : '')
          : t('check.dc.F1.details.noDoi'); },
      },
      {
        id: 'F2', name: t('check.dc.F2.name'),
        description: t('check.dc.F2.description'),
        score: filledAttrs.length >= 12 ? 1 : filledAttrs.length >= 7 ? 0.5 : 0,
        maxScore: 1,
        get details() { return t('check.dc.F2.details.populated', {
            filled: filledAttrs.length,
            total: attrInventory.length,
            list: filledAttrs.map(x => x.name).join(', '),
          }) + ' '
          + (missingAttrs.length > 0
            ? t('check.dc.F2.details.missing', { list: missingAttrs.map(x => x.name).join(', ') })
            : t('check.dc.F2.details.allPresent')); },
      },
      {
        id: 'F3', name: t('check.dc.F3.name'),
        description: t('check.dc.F3.description'),
        score: doi ? 1 : 0,
        maxScore: 1,
        get details() { return doi
          ? t('check.dc.F3.details.hasDoi', { doi }) + ' '
            + (a.url
              ? t('check.dc.F3.details.landingPage', { url: a.url })
              : t('check.dc.F3.details.noLandingPage'))
          : t('check.dc.F3.details.noDoi'); },
      },
      {
        id: 'F4', name: t('check.dc.F4.name'),
        description: t('check.dc.F4.description'),
        score: 1,
        maxScore: 1,
        get details() { return t('check.dc.F4.details.main', {
          type: a.types?.resourceTypeGeneral ?? t('check.dc.F4.details.unspecified'),
          created: a.created,
          updated: a.updated,
        }); },
      },
    ],

    A: [
      {
        id: 'A1', name: t('check.dc.A1.name'),
        description: t('check.dc.A1.description'),
        score: 1,
        maxScore: 1,
        get details() { return t('check.dc.A1.details.main', { doi }); },
      },
      {
        id: 'A1.1', name: t('check.dc.A1.1.name'),
        description: t('check.dc.A1.1.description'),
        score: 1,
        maxScore: 1,
        get details() { return t('check.dc.A1.1.details.main'); },
      },
      {
        id: 'A2', name: t('check.dc.A2.name'),
        description: t('check.dc.A2.description'),
        score: 1,
        maxScore: 1,
        get details() { return t('check.dc.A2.details.main', { updated: a.updated }); },
      },
    ],

    I: [
      {
        id: 'I1', name: t('check.dc.I1.name'),
        description: t('check.dc.I1.description'),
        score: a.schemaVersion ? 1 : 0.5,
        maxScore: 1,
        get details() { return (a.schemaVersion
            ? t('check.dc.I1.details.schemaVersioned', { version: a.schemaVersion })
            : t('check.dc.I1.details.schemaUnversioned')) + ' '
          + t('check.dc.I1.details.formal') + ' '
          + t('check.dc.I1.details.resourceType', {
              type: `${a.types?.resourceTypeGeneral ?? t('check.dc.I1.details.missing')}${a.types?.resourceType ? ` / ${a.types.resourceType}` : ''}`,
            }); },
      },
      {
        id: 'I2', name: t('check.dc.I2.name'),
        description: t('check.dc.I2.description'),
        score: schemedSubjects.length > 0 ? 1
          : (a.types?.resourceTypeGeneral && (a.subjects?.length ?? 0) > 0) ? 0.5 : 0,
        maxScore: 1,
        get details() { return [
          (a.subjects?.length ?? 0) > 0
            ? tn('check.dc.I2.details.subjects', a.subjects.length) + ' '
              + (schemedSubjects.length > 0
                ? t('check.dc.I2.details.withScheme', {
                    list: schemedSubjects.map(s => `"${s.subject}" [${s.subjectScheme}]`).slice(0, 3).join('; '),
                  }) + ' '
                : '')
              + (unschemedSubjects.length > 0
                ? t('check.dc.I2.details.withoutScheme', {
                    list: unschemedSubjects.map(s => `"${s.subject}"`).slice(0, 3).join(', '),
                    ellipsis: unschemedSubjects.length > 3 ? '\u2026' : '',
                  })
                : '')
            : t('check.dc.I2.details.noSubjects'),
          t('check.dc.I2.details.resourceType', {
            type: a.types?.resourceTypeGeneral ?? t('check.dc.I2.details.resourceTypeMissing'),
          }),
          a.language
            ? t('check.dc.I2.details.language', { language: a.language })
            : t('check.dc.I2.details.languageNone'),
        ].join('. '); },
      },
      {
        id: 'I3', name: t('check.dc.I3.name'),
        description: t('check.dc.I3.description'),
        score: (a.relatedIdentifiers?.length ?? 0) > 0
          ? (typedRels.length > 0 ? 1 : 0.5) : 0,
        maxScore: 1,
        get details() { return (a.relatedIdentifiers?.length ?? 0) > 0
          ? tn('check.dc.I3.details.count', a.relatedIdentifiers.length) + ' '
            + (typedRels.length > 0
              ? t('check.dc.I3.details.relationTypes', {
                  list: Object.entries(relTypes).map(([k, v]) => `${k} (${v})`).join(', '),
                })
              : t('check.dc.I3.details.noRelationType')) + ' '
            + t('check.dc.I3.details.sample', {
                list: a.relatedIdentifiers.slice(0, 2).map(r => `[${r.relatedIdentifierType}] ${r.relatedIdentifier}${r.relationType ? ` \u2014 ${r.relationType}` : ''}`).join('; '),
              })
          : t('check.dc.I3.details.none'); },
      },
    ],

    R: [
      {
        id: 'R1', name: t('check.dc.R1.name'),
        description: t('check.dc.R1.description'),
        score: filledAttrs.length >= 12 ? 1 : filledAttrs.length >= 8 ? 0.5 : 0,
        maxScore: 1,
        get details() { return t('check.dc.R1.details.count', {
            filled: filledAttrs.length,
            total: attrInventory.length,
          }) + ' '
          + t('check.dc.R1.details.key', {
              list: filledAttrs.slice(0, 8).map(x => `${x.name}=${x.detail}`).join(' | '),
            }) + ' '
          + (missingAttrs.length > 0
            ? t('check.dc.R1.details.gaps', { list: missingAttrs.map(x => x.name).join(', ') })
            : ''); },
      },
      {
        id: 'R1.1', name: t('check.dc.R1.1.name'),
        description: t('check.dc.R1.1.description'),
        score: lic.class === 'none' ? 0 : lic.machineReadable ? 1 : 0.5,
        maxScore: 1,
        get details() { return lic.class !== 'none'
          // primaryName / class / identifier / scheme are classifier output, not prose.
          ? (lic.multi
              ? t('check.dc.R1.1.details.licenseMulti', { name: lic.primaryName, class: lic.class, count: lic.count })
              : t('check.dc.R1.1.details.license', { name: lic.primaryName, class: lic.class })) + ' '
            + t('check.dc.R1.1.details.uri', {
                uri: lic.machineReadable
                  ? lic.entries.find(e => e.machineReadable).uri || t('check.dc.R1.1.details.uriPresent')
                  : t('check.dc.R1.1.details.uriMissing'),
              }) + ' '
            + (lic.spdxDeclared
              ? t('check.dc.R1.1.details.spdxYes', {
                  identifier: lic.entries.find(e => e.spdxDeclared).identifier,
                  scheme: lic.entries.find(e => e.spdxDeclared).scheme,
                })
              : t('check.dc.R1.1.details.spdxNo')) + ' '
            + t('check.dc.R1.1.details.raw', { raw: a.rightsList.map(r => r.rights).join('; ') })
          : t('check.dc.R1.1.details.none'); },
      },
      {
        id: 'R1.2', name: t('check.dc.R1.2.name'),
        description: t('check.dc.R1.2.description'),
        score: creatorsWithOrcid.length > 0 ? 1
          : (creatorsWithAffiliation.length > 0 || (a.fundingReferences?.length ?? 0) > 0) ? 0.5
          : totalCreators > 0 ? 0.5 : 0,
        maxScore: 1,
        get details() { return [
          totalCreators > 0
            ? t('check.dc.R1.2.details.creatorsNamed', {
                count: totalCreators,
                names: a.creators.slice(0, 2).map(c => c.name).join('; '),
                ellipsis: totalCreators > 2 ? '\u2026' : '',
              })
            : t('check.dc.R1.2.details.creators', { count: totalCreators }),
          creatorsWithOrcid.length > 0
            ? t('check.dc.R1.2.details.orcidSample', {
                count: creatorsWithOrcid.length,
                total: totalCreators,
                identifier: creatorsWithOrcid[0].nameIdentifiers[0].nameIdentifier,
              })
            : t('check.dc.R1.2.details.orcid', { count: creatorsWithOrcid.length, total: totalCreators }),
          creatorsWithAffiliation.length > 0
            ? t('check.dc.R1.2.details.affiliationSample', {
                count: creatorsWithAffiliation.length,
                total: totalCreators,
                name: creatorsWithAffiliation[0].affiliation[0].name,
              })
            : t('check.dc.R1.2.details.affiliation', { count: creatorsWithAffiliation.length, total: totalCreators }),
          (a.fundingReferences?.length ?? 0) > 0
            ? t('check.dc.R1.2.details.funding', {
                list: a.fundingReferences.map(f => `${f.funderName}${f.awardNumber ? ` #${f.awardNumber}` : ''}`).join('; '),
              })
            : t('check.dc.R1.2.details.fundingNone'),
        ].join('. '); },
      },
      {
        id: 'R1.3', name: t('check.dc.R1.3.name'),
        description: t('check.dc.R1.3.description'),
        score: a.schemaVersion && a.types?.resourceTypeGeneral ? 1 : 0.5,
        maxScore: 1,
        get details() { return [
          a.schemaVersion
            ? t('check.dc.R1.3.details.schema', { version: a.schemaVersion })
            : t('check.dc.R1.3.details.schemaNone'),
          t('check.dc.R1.3.details.resourceType', {
            type: `${a.types?.resourceTypeGeneral ?? t('check.dc.R1.3.details.resourceTypeMissing')}${a.types?.resourceType ? ` (${a.types.resourceType})` : ''}`,
          }),
          [doi, totalCreators > 0, a.titles?.length, a.publisher, a.publicationYear, a.types?.resourceTypeGeneral].every(Boolean)
            ? t('check.dc.R1.3.details.mandatoryAll')
            : t('check.dc.R1.3.details.mandatoryIncomplete'),
        ].join('. '); },
      },
    ],
  };

  return buildAssessment('datacite', doi || work.id, checks, lic, connectivity);
}


// ══════════════════════════════════════
// ── Build Assessment Helper ──
// ══════════════════════════════════════

// Label properties are lazy getters, not baked strings. An assessment is computed
// once but re-rendered on every language switch, and the UI redraws from the stored
// result rather than re-fetching — so a plain string would leave the check names
// frozen in whatever language was active when the analysis ran. Enumerable, so
// JSON.stringify still serialises them for the export path.
const live = (obj, prop, key) =>
  Object.defineProperty(obj, prop, { get: () => t(key), enumerable: true, configurable: true });

function buildAssessment(source, identifier, checks, license, connectivity) {
  // Key namespace mirrors the two scoring paths: assessDataCiteWork / assessOaiRecord.
  const ns = source === 'datacite' ? 'dc' : 'oai';
  const principles = Object.entries(checks).map(([letter, cs]) => {
    for (const c of cs) {
      live(c, 'name', `check.${ns}.${c.id}.name`);
      live(c, 'description', `check.${ns}.${c.id}.description`);
    }
    const p = {
      letter,
      checks: cs,
      score: cs.reduce((sum, c) => sum + c.score, 0),
      maxScore: cs.length,
    };
    return live(p, 'name', `principle.${letter}`);
  });
  const overallScore = principles.reduce((s, p) => s + p.score, 0);
  const overallMax = principles.reduce((s, p) => s + p.maxScore, 0);

  return {
    source,
    identifier,
    timestamp: new Date().toISOString(),
    principles,
    overallScore,
    overallMax,
    overallPercent: Math.round((overallScore / overallMax) * 100),
    ...(license ? { license: {
      class: license.class,
      machineReadable: license.machineReadable,
      spdxDeclared: license.spdxDeclared,
      multi: license.multi,
      primaryName: license.primaryName,
      count: license.count,
    } } : {}),
    ...(connectivity ? { connectivity } : {}),
  };
}

// ══════════════════════════════════════
// ── Aggregate Assessments ──
// ══════════════════════════════════════

// Roll a per-record license summary up into a collection-level profile.
// Pure counting (no proprietary classification) — safe to mirror client-side.
function buildLicenseProfile(assessments) {
  const withLic = assessments.filter(a => a.license);
  if (withLic.length === 0) return undefined;
  // `count`, not `n` — `n` is the locale number formatter imported at the top.
  const count = withLic.length;
  const classes = { open: 0, restricted: 0, 'all-rights-reserved': 0, none: 0 };
  const distinct = {};
  let machineReadable = 0, spdxDeclared = 0, multi = 0;
  for (const a of withLic) {
    const l = a.license;
    classes[l.class] = (classes[l.class] ?? 0) + 1;
    if (l.machineReadable) machineReadable++;
    if (l.spdxDeclared) spdxDeclared++;
    if (l.multi) multi++;
    // 'Unspecified' sits in the same namespace as the classifier's licence names
    // (CC BY 4.0, MIT License…) and doubles as the grouping key, so it stays literal.
    const key = l.primaryName || 'Unspecified';
    if (!distinct[key]) distinct[key] = { name: key, count: 0, class: l.class };
    distinct[key].count++;
  }
  const pct = x => Math.round((x / count) * 1000) / 10;
  return {
    total: count,
    withLicense: count - classes.none,
    classes,
    machineReadablePct: pct(machineReadable),
    spdxDeclaredPct: pct(spdxDeclared),
    multiPct: pct(multi),
    distinct: Object.values(distinct).sort((a, b) => b.count - a.count).slice(0, 20),
  };
}

// Roll per-record connectivity summaries into a collection-level profile.
function buildConnectivityProfile(assessments) {
  const withC = assessments.filter(a => a.connectivity);
  if (withC.length === 0) return undefined;
  const acc = { creators: [0, 0], affiliations: [0, 0], funders: [0, 0], contributors: [0, 0] };
  let recordsWithUnidentifiedCreators = 0;
  for (const a of withC) {
    const c = a.connectivity;
    acc.creators[0] += c.creators; acc.creators[1] += c.creatorsId;
    acc.affiliations[0] += c.affiliations; acc.affiliations[1] += c.affiliationsId;
    acc.funders[0] += c.funders; acc.funders[1] += c.fundersId;
    acc.contributors[0] += c.contributors; acc.contributors[1] += c.contributorsId;
    if (c.creators > c.creatorsId) recordsWithUnidentifiedCreators++;
  }
  const pair = ([total, identified]) => ({ total, identified });
  return {
    creators: pair(acc.creators),
    affiliations: pair(acc.affiliations),
    funders: pair(acc.funders),
    contributors: pair(acc.contributors),
    recordsWithUnidentifiedCreators,
    totalRecords: withC.length,
  };
}

function aggregateAssessments(assessments) {
  if (assessments.length === 0) return undefined;
  // `count`, not `n` — `n` is the locale number formatter imported at the top.
  const count = assessments.length;
  const source = assessments[0].source;

  const ns = source === 'datacite' ? 'dc' : 'oai';
  const principleLetters = ['F', 'A', 'I', 'R'];
  const principles = principleLetters.map((letter, li) => {
    const refChecks = assessments[0].principles[li].checks;
    const avgChecks = refChecks.map((rc, ci) => {
      const scores = assessments.map(a => a.principles[li].checks[ci].score);
      const avgScore = scores.reduce((s, v) => s + v, 0) / count;
      const rounded = roundScore(avgScore);
      const fullCount = scores.filter(s => s === 1).length;
      const partialCount = scores.filter(s => s === 0.5).length;
      const zeroCount = scores.filter(s => s === 0).length;

      // `detail` chains onto the per-record lazy getter instead of reading it here.
      // Reading it eagerly would freeze these strings at aggregation time, so a JSON
      // export taken after a language switch would carry current-language `name` and
      // `details` beside stale-language `detail`. Only the export consumes this — the
      // UI drill-down reads lastAssessments directly — but the file should be coherent.
      const aggregateDetails = assessments.map(a => {
        const rec = a.principles[li].checks[ci];
        const entry = { identifier: a.identifier, score: rec.score };
        return Object.defineProperty(entry, 'detail', {
          get: () => rec.details, enumerable: true, configurable: true,
        });
      });

      // Spreading `rc` evaluates its lazy label getters and would freeze them as
      // plain strings, so they are re-applied to the aggregate copy. `details` is
      // a getter for the same reason \u2014 the closure holds the counts, so it can be
      // recomputed in whatever language is current at render time.
      const agg = {
        ...rc,
        score: rounded,
        rawMean: avgScore,   // unrounded mean \u2014 consumers needing a true % read this, not the 0/0.5/1 band
        get details() {
          return tn('aggregate.details', count, {
            full: fullCount, partial: partialCount, zero: zeroCount,
            avg: (avgScore * 100).toFixed(0),
          });
        },
        aggregateDetails,
      };
      live(agg, 'name', `check.${ns}.${rc.id}.name`);
      live(agg, 'description', `check.${ns}.${rc.id}.description`);
      return agg;
    });
    const p = {
      letter,
      checks: avgChecks,
      score: avgChecks.reduce((s, c) => s + c.score, 0),
      maxScore: avgChecks.length,
    };
    return live(p, 'name', `principle.${letter}`);
  });

  const overallScore = principles.reduce((s, p) => s + p.score, 0);
  const overallMax = principles.reduce((s, p) => s + p.maxScore, 0);

  const licenseProfile = buildLicenseProfile(assessments);
  const connectivityProfile = buildConnectivityProfile(assessments);

  return {
    source,
    identifier: tn('aggregate.identifier', count),
    timestamp: new Date().toISOString(),
    principles,
    overallScore,
    overallMax,
    overallPercent: Math.round((overallScore / overallMax) * 100),
    ...(licenseProfile ? { licenseProfile } : {}),
    ...(connectivityProfile ? { connectivityProfile } : {}),
  };
}

// ══════════════════════════════════════
// ── Recommendations Engine ──
// ══════════════════════════════════════

function getRecommendation(checkId, score, source) {
  if (source === 'datacite') {
    if (checkId === 'F1') return score === 0 ? t('rec.dc.F1.zero') : t('rec.dc.F1');
    if (checkId === 'F2') return t('rec.dc.F2');
    if (checkId === 'F3') return t('rec.dc.F3');
    if (checkId === 'I2') return t('rec.dc.I2');
    if (checkId === 'I3') return t('rec.dc.I3');
    if (checkId === 'R1') return t('rec.dc.R1');
    if (checkId === 'R1.1') return t('rec.dc.R1.1');
    if (checkId === 'R1.2') return t('rec.dc.R1.2');
  }
  // Generic recommendations for custom adapters
  const generic = {
    'F1': score === 0 ? t('rec.generic.F1.zero') : t('rec.generic.F1'),
    'F2': t('rec.generic.F2'),
    'F3': t('rec.generic.F3'),
    'F4': t('rec.generic.F4'),
    'A1': t('rec.generic.A1'),
    'A1.1': t('rec.generic.A1.1'),
    'A2': t('rec.generic.A2'),
    'I1': t('rec.generic.I1'),
    'I2': score === 0 ? t('rec.generic.I2.zero') : t('rec.generic.I2'),
    'I3': t('rec.generic.I3'),
    'R1': t('rec.generic.R1'),
    'R1.1': score === 0 ? t('rec.generic.R1.1.zero') : t('rec.generic.R1.1'),
    'R1.2': t('rec.generic.R1.2'),
    'R1.3': t('rec.generic.R1.3'),
  };
  return generic[checkId] || t('rec.fallback');
}

function getRating(percent) {
  if (percent >= 90) return t('rating.excellent');
  if (percent >= 75) return t('rating.good');
  if (percent >= 50) return t('rating.moderate');
  if (percent >= 25) return t('rating.low');
  return t('rating.critical');
}

function generateRecommendations(assessment) {
  const checks = [];
  for (const group of assessment.principles) {
    for (const check of group.checks) {
      checks.push({
        id: check.id,
        name: check.name,
        score: check.score,
        details: check.details,
        principleLetter: group.letter,
        recommendation: getRecommendation(check.id, check.score, assessment.source),
      });
    }
  }
  const critical = checks.filter(c => c.score === 0);
  const improvement = checks.filter(c => c.score === 0.5);
  const passing = checks.filter(c => c.score === 1);
  return {
    rating: getRating(assessment.overallPercent),
    percent: assessment.overallPercent,
    critical,
    improvement,
    passing,
  };
}

function generateTextReport(assessment, repoName, extraInfo) {
  const recs = generateRecommendations(assessment);
  const icon = (s) => s === 1 ? '[PASS]' : s === 0.5 ? '[PARTIAL]' : '[FAIL]';
  const sep = '='.repeat(55);
  const line = '-'.repeat(55);

  let out = `${sep}\n  ${t('report.header')}\n  ${t('report.generated', { date: new Date().toISOString().split('T')[0] })}\n${sep}\n\n`;
  if (repoName) out += `${t('report.repository', { name: repoName })}\n`;
  out += `${t('report.source', { source: assessment.source.toUpperCase() })}\n${t('report.identifier', { identifier: assessment.identifier })}\n`;
  // Deliberately NOT n(): the report is an export, and locale digit grouping would
  // change the English output (1234 → 1,234). Flip this on as a conscious decision.
  if (extraInfo?.totalRecords) out += `${t('report.totalRecords', { count: extraInfo.totalRecords })}\n`;
  if (extraInfo?.sets) out += `${t('report.sets', { sets: extraInfo.sets })}\n`;
  if (extraInfo?.formats) out += `${t('report.formats', { formats: extraInfo.formats })}\n`;

  out += `\n${line}\n  ${t('report.overallScore', {
    percent: assessment.overallPercent,
    score: assessment.overallScore,
    max: assessment.overallMax,
  })}\n  ${t('report.rating', { rating: recs.rating })}\n${line}\n\n`;

  for (const p of assessment.principles) {
    const pct = Math.round((p.score / p.maxScore) * 100);
    out += `  ${p.letter} - ${p.name}: ${p.score}/${p.maxScore} (${pct}%)\n`;
  }

  out += `\n${sep}\n  ${t('report.detailedChecks')}\n${sep}\n\n`;
  for (const p of assessment.principles) {
    out += `${p.letter} - ${p.name.toUpperCase()}\n${line}\n`;
    for (const c of p.checks) {
      out += `${icon(c.score)} ${c.id} - ${c.name}\n    ${c.details}\n\n`;
    }
  }

  out += `${sep}\n  ${t('report.recommendations')}\n${sep}\n\n`;
  if (recs.critical.length > 0) {
    out += `${t('report.critical')}\n`;
    for (const c of recs.critical) out += `  * ${c.id}: ${c.recommendation}\n`;
    out += '\n';
  }
  if (recs.improvement.length > 0) {
    out += `${t('report.needsImprovement')}\n`;
    for (const c of recs.improvement) out += `  * ${c.id}: ${c.recommendation}\n`;
    out += '\n';
  }
  if (recs.passing.length > 0) {
    out += `${t('report.passing', { ids: recs.passing.map(c => c.id).join(', ') })}\n\n`;
  }

  out += `${sep}\n  ${t('report.note')}\n  ${t('report.generatedBy')}\n${sep}\n`;
  return out;
}

export { assessOaiRecord, assessDataCiteWork, aggregateAssessments, generateRecommendations, generateTextReport };
