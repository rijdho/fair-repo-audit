# fair-repo-audit

[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.21492530.svg)](https://doi.org/10.5281/zenodo.21492530)

**Score the FAIR metadata quality of any DataCite or OAI-PMH repository — entirely in your browser.**

A static, dependency-free web app. Point it at a DataCite client / prefix / publisher, or an
OAI-PMH base URL, and it harvests live metadata and scores every record against **14 FAIR
sub-principles**. Nothing is uploaded or stored; all computation runs client-side.

🔗 **Live:** https://rijdho.github.io/fair-repo-audit/

Available in **English, Spanish, French and German** (auto-detected, switchable).

This is the **open twin** of [Repo MetAudits](https://metaudits.rijdho.org/repo-metaudits/).
That tool keeps its scoring engine server-side (protected); this one moves the *same* rubric
into the browser where it is fully visible — inspired by the open, client-side philosophy of
[Metadata Game Changers](https://metadatagamechangers.com/). The scoring logic in
[`src/fair.js`](src/fair.js) is a faithful port of the production engine, so scores match.

## What it measures

Every record is scored against 14 FAIR sub-principles (Wilkinson et al. 2016), each **Full (1)**,
**Partial (0.5)**, or **Not met (0)**:

| | Checks |
|---|---|
| **F** Findable | F1 persistent identifier · F2 metadata richness · F3 identifier in metadata · F4 searchable registration |
| **A** Accessible | A1 standardized protocol · A1.1 open/free protocol · A2 metadata persistence |
| **I** Interoperable | I1 formal schema · I2 controlled vocabularies · I3 qualified references |
| **R** Reusable | R1 attribute richness · R1.1 machine-readable license · R1.2 provenance (ORCID/ROR/funding) · R1.3 community standards |

### Beyond the score

- **Concept completeness** — the share of records carrying each concrete field (Abstract, Keyword
  vocabulary, Author ORCID, Affiliation ROR, Contact person, Funder ID, Award number…), grouped
  into Habermann's four use cases (Text / Identifiers / Connections / Contacts).
- **FAIR profile radar** — the repository's shape across F/A/I/R, with the mean plus every record
  overlaid so you see the profile *and* the spread. In **Compare** mode, two repositories' shapes
  are overlaid on one radar.
- **Per-record heatmap** — every record × every check (worst records first), hover any cell.
- **Reusability readout** — licence clarity, provenance and standards synthesised into one
  "can others reuse this?" verdict.
- **FAIR over time** — mean FAIR by publication year, with a trend takeaway.
- **Possible duplicates** — records sharing a normalized title.
- **Per-check detail** — what each check evaluates, a full/partial/not-met split, a fix
  recommendation, and a drill-down to the exact records below full. Click a FAIR gauge to peek at
  one principle inline.
- **Year focus** — narrow what's assessed by year. On **DataCite** it filters by *publication
  year*, and **Suggest years** draws the repository's records-per-year distribution (reconstructed
  from cheap count-only queries) so you can click a bar to focus a range. On **OAI-PMH** it filters
  by record *datestamp* (when a record was added/updated in the repo — not publication year), using
  the protocol's native `from`/`until` selective harvesting.
- **Compare** — two repositories side by side (DataCite or OAI-PMH): overall, per-principle,
  concept diff, and the dual radar.
- **License & connectivity profiles**, prioritized recommendations, and **JSON / text / CSV**
  export — including an **Action list (CSV)**: every record that isn't full on a check, with the
  reason (a re-curation to-do list).

### Share a result

Every analysis is captured in the URL, so results are bookmarkable and shareable. Examples:

```
…/fair-repo-audit/?tab=datacite&kind=clientId&q=dryad.dryad&n=100
…/fair-repo-audit/?tab=datacite&kind=clientId&q=dryad.dryad&n=25&y0=2015&y1=2020
…/fair-repo-audit/?tab=compare&ak=clientId&av=dryad.dryad&bk=clientId&bv=gdcc.harvard-dv&n=25
…/fair-repo-audit/?tab=datacite&kind=prefix&q=10.5281&n=100&lang=de
```

Opening such a link runs the analysis automatically. `lang` is optional and pins the
interface language, so a result can be shared with a colleague in their own language.

## Languages

The interface, the per-check explanations and the fix recommendations are available in
**English, Spanish, French and German**. Language is picked in the top bar and resolved
at load in this order: `?lang=` → previous choice (`localStorage`) → `navigator.languages`
→ English. Switching relabels whatever is already on screen without re-querying the API.

What is *not* translated, in any locale, is deliberate: metadata schema field names
(`rightsURI`, `subjectScheme`, `relatedIdentifiers`, `dc:title`…), standard and
organisation names (DataCite, OAI-PMH, Dublin Core, ORCID, ROR, SPDX, ISO 639…), and the
JSON/CSV export keys. Those are strings the user types into a metadata editor or feeds to
a script — translating them would break the very fix the tool is recommending. The
human-readable `.txt` report *is* translated; the machine-readable exports are not.

### Adding or correcting a language

Catalogues are plain ES modules of flat, dotted keys — `src/i18n/en.js` is the source of
truth, and the others are measured against it:

```bash
node --test tests/i18n.test.mjs
```

That suite fails on a missing key, an orphan key from a typo, a `{placeholder}` that was
dropped or renamed in translation, a broken plural pair, and on long values left identical
to English. A missing key is never fatal at runtime — it falls back to English — so a
partial locale degrades to mixed language rather than to blank UI.

To add a language: copy `en.js`, translate the values, register the code and its endonym
in `LANGS` in `src/i18n/index.js`, and import it into `LOCALES`.

## Architecture

```
Browser (GitHub Pages, static — no build step)
├── src/fair.js      — the FAIR engine (14 sub-principles) — OPEN, a faithful port
├── src/datacite.js  — DataCite REST client (CORS-enabled → direct, no proxy)
├── src/oaipmh.js    — OAI-PMH client (DOMParser); routes through a thin CORS relay
├── src/concepts.js  — concept-completeness definitions (keys only; text lives in i18n)
├── src/analysis.js  — temporal trend + duplicate detection
├── src/charts.js    — radar, heatmap, temporal (SVG) — dependency-free
├── src/i18n/        — en · es · fr · de catalogues + a ~140-line t() runtime
└── src/app.js       — UI

cors-proxy/           — optional: a ~40-line CORS relay for OAI-PMH (no scoring logic)
```

- **DataCite** needs no server — the API sends CORS headers, so the browser queries it directly.
  `affiliation=true` is always set (without it DataCite strips ROR affiliation identifiers).
- **OAI-PMH** endpoints rarely send CORS headers, so those requests pass through a **dumb byte
  relay**. It holds no logic — it just forwards the GET and adds CORS headers. Deploy your own
  from [`cors-proxy/`](cors-proxy/) and paste its URL into the app's *CORS proxy* field, so this
  tool never depends on anyone else's infrastructure.

## Tests

The engine and analysis modules are pure functions, covered by unit tests (Node's built-in
runner, no dependencies):

```bash
node --test tests/*.test.mjs
```

`fair.test.mjs` and `analysis.test.mjs` assert on **scores**, and those fixtures double as
the parity contract with the server-side engine in Repo MetAudits: a change that flips an
expected score should be mirrored there or documented as a divergence. Because they cover
scores rather than wording, they stayed green throughout the i18n extraction — which is the
point, but also means they cannot vouch for the prose. `i18n.test.mjs` covers that side:
locale parity, placeholder integrity, and the structural contracts the UI parses.

## Run locally

No build step. Serve the folder with any static server:

```bash
python3 -m http.server 8000    # then open http://localhost:8000
```

## Deploy the CORS proxy (optional, for OAI-PMH)

```bash
cd cors-proxy
npx wrangler deploy            # prints https://…workers.dev
```

Paste `https://…workers.dev/?url=` into the app's *CORS proxy (advanced)* field.

## Methodology & validation

The rubric, the Full/Partial/None bands, and the source-capability-aware scoring are documented
in [Repo MetAudits' METHODOLOGY.md](https://metaudits.rijdho.org/repo-metaudits/) and
cross-validated against the independent [FAIR-Checker](https://fair-checker.france-bioinformatique.fr/)
tool. Because the engine here is a faithful port, those results carry over.

## License

[MIT](LICENSE) — reuse and adapt freely.

## Citation

If you use this tool or its rubric, please cite it — see [`CITATION.cff`](CITATION.cff) or the
"Cite this repository" button. Archived on Zenodo: concept DOI
[10.5281/zenodo.21492530](https://doi.org/10.5281/zenodo.21492530) (always resolves to the
latest version).
