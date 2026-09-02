# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each released version is archived on Zenodo with its own version DOI. The concept DOI
[10.5281/zenodo.21492530](https://doi.org/10.5281/zenodo.21492530) always resolves to the
latest release.

> History before 1.2.0 was squashed when the repository was made public; the pre-squash
> commits are preserved on the `pre-squash-backup` tag.

## [1.7.0]: 2026-09-02

Version DOI: [10.5281/zenodo.22253780](https://doi.org/10.5281/zenodo.22253780).

### Changed

- **Source vs published runs in your browser now, and there is no hosted service left.** It was
  the one exception to the claim this whole tool is built on, and the exception is gone: the
  connectors, the element ledger and the field map moved into `src/analyze.js`, under the same
  AGPL as everything else here, and both sides are scored by the `src/fair.js` the other modes
  already use rather than by a service binding to a private engine.

  What forced the question was a ceiling, not a principle. A Cloudflare Worker on the free plan
  may make 50 subrequests per invocation, and this analysis costs about five reads per cruise:
  measured at 46 for a sample of 8, 51 at 9, 56 at 10, 131 at 25. The default sample of 10 was
  therefore returning a 502 in production while the same code passed its end-to-end test in Node,
  where no such ceiling exists. That is the shape of the bug worth remembering: a test that runs
  the code somewhere without the limit cannot see the limit. Moving the work into the browser
  removes the ceiling rather than raising it, and a sample of 25 now completes in about 24
  seconds against live APIs.

  Nothing stood in the way once the question was asked: R2R answers
  `Access-Control-Allow-Origin: *` on GET and on preflight, DataCite answers with the page's own
  origin, and the rubric was already here.

  The service's shared cache is the real loss. Ten people analysing the same vessel used to cost
  R2R one round of reads and now cost ten, so the politeness it enforced is kept client-side:
  detail reads three cruises at a time, DOI lookups five, and a six-hour per-browser cache. Both
  batch widths are pinned by tests, because they are now the only thing between a public research
  API funded by a research programme and one visitor's twenty-five cruises.

- **The client-side claim is unscoped again, in all three locales.** v1.6.0 had to qualify it in
  the README, the meta description, the page and the "How it works" step, and every one of those
  qualifications is now false, which is worse than an inaccurate promise. The "What runs where"
  table says browser in all four rows.

- **Three errors instead of one.** The service returned "unreachable" for everything that went
  wrong. The three ways of finding nothing are now told apart: no cruises matched, the records
  carry no DOI, or none of those DOIs came back from DataCite. Each is a different thing for the
  reader to do next.

### Removed

- The `analyze` Worker's endpoint, the `<meta name="fair-analyze-endpoint">` tag it was injected
  into, the `ANALYZE_ENDPOINT` repository variable and the deploy step that filled it. A fork gets
  the mode working with no configuration at all, where before it got the tab switched off.

## [1.6.0]: 2026-09-02

Version DOI: [10.5281/zenodo.22250697](https://doi.org/10.5281/zenodo.22250697).

### Added

- **A "Source vs published" mode.** Every other mode here reads the record a repository
  *publishes*, which is the thin side. A repository usually knows more about a dataset than it
  writes into the record, and that difference is invisible to anything that only sees the output.
  The new mode reads a repository's own API alongside its published DataCite records, scores both
  with the same 14-sub-principle rubric, and reports the crossing: an element ledger showing what
  the source holds, what reaches the published record, and what share survives.

  The ledger carries the **DataCite pointer for every element** (`titles[].title`,
  `creators/contributors[].nameIdentifiers[scheme=ORCID]`, `geoLocations[].geoLocationBox`...).
  The people who can act on a finding are the ones who maintain a minting template, and a
  percentage they cannot locate in their own schema is not actionable. Every record links to both
  sides so any row can be checked against the live APIs.

  Two elements are measured by identity rather than by count, because counting would score them
  wrong: a title replaced by a generated string, and ORCIDs where the published record carries one
  of the five the source holds. Both would otherwise read as full carriage.

  The first repository supported is R2R (Rolling Deck to Repository).

- **`metrics-watch`: scheduled scoring, and a Metrics view that reads the history.** A one-off audit
  cannot show that a curation effort worked. `scripts/metrics-watch.mjs` scores any set of DataCite
  repositories and appends to a history file; the workflow in `.github/workflows/metrics-watch.yml`
  runs it on the first of every month and commits the result. Setup is forking this repository and
  copying one example config, with no account, key or service anywhere in it.

  The scorer imports the same `src/fair.js` the browser uses, so a scheduled score and a score read
  on the page cannot drift. It runs on Node's built-ins alone. Re-running on a date that already has
  a run replaces it rather than appending, so a re-run after a fix cannot double-count the trend.

  A history holds runs and never records: date, sample, overall, all fourteen sub-principle scores
  and the concept percentages. Small enough to accumulate for years, and complete enough that an old
  history can be re-analysed in ways nobody has thought of yet.

- **A "History" view: FAIR score per registration cohort, plus curation activity.** Publication
  year describes the research; `registered` describes the metadata, because it is when the record
  was written. Scoring cohort by cohort separates a repository that has improved its practice from
  one minting every year out of the same template, which a single overall score cannot do. The
  activity chart counts records registered against records edited per year, both from count-only
  queries. Running it against R2R shows the 2016 and 2021 cohorts scoring identically and a mass
  re-curation of roughly 35,000 records in 2020.

- **A "Re-curation" view: what changed in one record, and when.** Replays a DOI's DataCite audit
  log, reconstructing the record at every revision and scoring each one, so an edit that improved a
  record and an edit that damaged it are both visible.

  Where DataCite's log does not reach back to the `create` entry, the reconstruction is partial and
  the scores are **withheld** rather than computed. Scoring a partial reconstruction would report a
  decent record as a terrible one, and the figure would look plausible, which is the dangerous kind
  of wrong. The change history is exact either way and is still shown.

- The analysis service address is read from a `fair-analyze-endpoint` meta tag that **ships empty**
  and is filled by the deploy workflow from a repository variable. No deployment's infrastructure
  hostname is published in source, and a fork or a bare checkout gets a working tree with this one
  mode switched off rather than a button that can only fail. The pre-commit guard caught the first
  attempt, which had the hostname inline; it was right to.

- `CONTRIBUTING.md`, which states plainly what contributing means for licensing here, including
  why the relicensing grant is asked for and what to do if you would rather not give it.

- `tests/analyze.test.mjs`: the service client is thin, so what is tested is what is easy to get
  wrong, namely endpoint addressing and telling three kinds of failure apart. A user who cannot
  reach the service needs to hear that the other modes still work, which is not the same message
  as "your input was rejected".

### Changed

- **The client-side claim is now scoped rather than absolute, in all three locales.** The README,
  the meta description, the page lede and the "How it works" step said computation runs entirely
  in the browser and nothing is uploaded. That stays true of the DataCite, OAI-PMH and Compare
  modes, and it is not true of the new one, which sends the repository and value you chose to its
  analysis service. Naming the exception is the honest fix; deleting the promise would have been
  the lazy one. A new "What runs where" table in the README says which mode runs where and what
  leaves the browser.

  The OAI-PMH CORS relay is unaffected and its own promise still holds: it forwards a GET and adds
  headers, and holds no scoring logic.

- **The README follows the house order.** Setup and operational sections (`metrics-watch`, "What
  runs where") came before "What it measures", so a reader met configuration before learning what
  the tool measures, and the methodology sat after the deployment instructions. The order now runs
  what it measures, the views, the languages, the architecture, the methodology, then tests, run,
  deploy and caveats.

- **The rail foot and the page footer follow the family shape.** The attribution lived in two
  places and in neither of the family's forms: a contact line plus a licence line in the rail, and
  a separate page footer at the end of the content carrying the DOI and the open-twin sentence.
  The rail now reads what the family's rails read, in three lines, and says the same thing on
  every view rather than only where the content happens to end: what the data is, `by @rijdho ·
  AGPL-3.0 · github`, then the concept DOI with "Cite this tool" as its title. The page footer is
  gone, and the open-twin sentence moved into "Open by design", next to the openness statement it
  elaborates, without the licence and repository link the rail already carries.

- **One lede per mode, in one slot, instead of a page lede repeated under every tab.** A fixed
  paragraph sat above all eight tabs and described the DataCite mode, its privacy scope and the
  rubric, whatever tab was open; five tabs then added a lede of their own underneath it. On the
  Metrics tab that meant 115 words of prose, half of it about modes the reader was not looking
  at, before the first control. The eyebrow stays as the page's identity and a single slot below
  it now carries one lede for the open tab, 21 to 40 words, saying what that mode reads and where
  it runs. The key lives on the element rather than the text, so a language switch re-renders
  whichever mode is open. `ui.cx.note` lost the quotation of a page lede that no longer exists,
  and its Spanish dropped a stray second person the rest of the locale does not use.

  Two tests now hold the markup and the catalogue together: every key `index.html` asks for is
  defined in English, and every tab in the rail has a `lede.<mode>` to render. The keys are built
  as `lede.${mode}` at runtime, so a renamed tab would otherwise print the key string itself, in
  every language, and no locale-parity test would see it.

### Fixed

- **Every asset is versioned, at one number, and a test keeps it that way.** With no bundler
  here, nothing content-hashes the files, so the `?v=` on a URL is the only thing that reaches a
  browser holding an old copy. Four numbers were live at once: the stylesheet at 31, the entry
  module at 30, the modules at 28, and the three locale files with no version at all. A browser
  could therefore serve a cached module against a fresh one importing a symbol the cached copy
  does not export, which aborts the whole graph with no visible error and leaves a blank page that
  looks deployed. Everything now sits at one version, and `tests/cachebust.test.mjs` fails if a
  relative import loses its version or a number drifts out of step.

- **The reusability verdict takes the status palette, not the brand.** The 3px left border is the
  house signal for "this item carries a verdict", and it was painted brand violet, which makes
  chrome encode meaning. Both verdict boxes now colour it by what they are actually saying: green
  when every reuse meter clears 75%, amber when one lags or when unidentified creators are flagged
  as a quick win.

### Removed

- Two exported functions nobody called: `getLang` in `src/i18n/index.js` and `getProxy` in
  `src/oaipmh.js`. Both appeared exactly once in the repository, at their own definition. An
  export that is never imported reads as a supported entry point and is not one.

### Security

- **The OAI-PMH relay refuses four more classes of internal address.** The guard matched
  strings against the hostname, which the URL parser had already normalised for numeric
  IPv4 in any base, so that part was sound. It was not sound for IPv6: unique-local
  (`fc00::/7`), link-local (`fe80::/10`), the unspecified `0.0.0.0`, and the IPv4-mapped
  form the parser produces for `::ffff:127.0.0.1`, which is loopback in a notation no
  amount of matching on `127.` would catch. CGNAT and multicast are refused too. What it
  still cannot do is stated in the code rather than assumed away: a public name that
  resolves to a private address is invisible to any check on the hostname.
- **The relay caps and times out the upstream read.** `await res.text()` pulled an entire
  response into memory, so one enormous or hostile endpoint could spend the isolate. Now
  8 MB and 20 seconds, both refused as a 502 that says which happened.
- **The rate limiter says what it is.** The counter lives in one isolate's memory and
  Cloudflare runs as many as it likes, so the real ceiling is an unknowable multiple of
  600. It stops a loop, not an adversary, and the comment now says so instead of implying
  a guarantee.
- **The relay has tests.** It is the one piece here that runs on someone else's account
  and takes a URL from a stranger, and it had none. Fifteen now, each confirmed to fail
  when the check it covers is removed.
- **A Content-Security-Policy.** GitHub Pages sends no security headers at all, so a meta
  policy is the only one available: `default-src 'none'` with scripts pinned to this
  origin. Two compromises are named in the page rather than hidden. `style-src` keeps
  `'unsafe-inline'` because the bars and charts build style attributes as they go, and
  `connect-src` cannot be an allowlist while the relay URL is the user's to choose.

## [1.5.0]: 2026-08-20

Version DOI: [10.5281/zenodo.22024876](https://doi.org/10.5281/zenodo.22024876).

### Removed

- The French interface. The app now ships in English, Spanish and German; `src/i18n/fr.js`
  and the French typography test are gone, and the language switcher lists three locales.

### Changed

- Em dashes are out of every written surface: interface strings, README, changelog, code
  comments and workflow files. Each one became a colon, a comma, parentheses or two
  sentences, chosen per sentence rather than swapped blindly.
- Principle glosses no longer repeat the principle name behind an em dash delimiter.
  `app.js` used to split them on `" — "`; the name is rendered from `principle.<letter>`
  and the gloss is now a standalone sentence, which is also what the locale test checks.
- README screenshots regenerated against the current build, with the alt text updated to
  the numbers they now show (Dryad at 169,871 records, Interoperable at 87%).

### Fixed

- `CITATION.cff` pointed at the v1.3.0 version DOI while declaring version 1.4.0. It now
  carries the DOI Zenodo minted for 1.4.0.

## [1.4.0]: 2026-08-19

Version DOI: [10.5281/zenodo.22014016](https://doi.org/10.5281/zenodo.22014016).

### Changed

- **License: MIT -> AGPL-3.0-or-later.** The code stays fully readable, citable and
  forkable; what changes is that anyone offering a modified version as a network service
  must publish their modifications under the same license. Releases up to 1.3.0 remain
  MIT (including their Zenodo archives).

### Added

- **Metadata format choice for OAI-PMH, and DIM support.** The harvester was pinned to
  `oai_dc`, the poorest format an endpoint exposes. DSpace flattens every qualifier into
  it, so `rights.uri`, `identifier.orcid`, `identifier.ror` and `language.iso` arrive
  stripped or not at all, and a DSpace repository then scores worse than it deserves for
  a reason that lives in the crosswalk rather than in its metadata. A format selector now
  sits beside the sample size, defaulting to "richest available": the app asks the
  endpoint (`ListMetadataFormats`) and picks the best format it can parse. The choice
  travels in the shared link as `f=`.
- **DIM crosswalk** (`dimFieldsToDc`). DIM carries every value on the same element name
  (`<dim:field mdschema= element= qualifier=>`), so the generic leaf-element walk
  collapsed an entire record into a single `field` key: the format was unreadable in
  practice. Values now map onto their Dublin Core element, keep their qualified key
  alongside (`rights.uri`), and non-DC schemas are namespaced, so a local `udla.type` can
  never be mistaken for a published `dc:type`. `contributor.author` is aliased to
  `creator`, the way DSpace's own oai_dc crosswalk does it.
- Pages now deploys through a GitHub Actions workflow (`deploy.yml`) instead of the
  legacy branch builder: the test suite gates every deploy, and the tree is uploaded
  verbatim with no Jekyll processing.

## [1.3.0]: 2026-07-28

Version DOI:
[10.5281/zenodo.21647450](https://doi.org/10.5281/zenodo.21647450).

### Added

- **How it works**: an in-app guide in its own tab: the four-step story for newcomers, then
  expandable depth covering the 14 checks one by one (rendered from the same catalogues the
  results use), the scoring bands, and where the data comes from. Available in all four
  languages.
- Zenodo DOIs recorded across the project: concept and version DOIs in `CITATION.cff` (with a
  top-level `doi` so GitHub's "Cite this repository" widget shows it), a DOI badge under the
  README title, a `## Citation` closing section, and a cite line with the concept DOI in the
  page footer, in all four languages.
- Screenshots in the README (`docs/`): the headline score card and the FAIR profile radar,
  plus `docs/screenshots.mjs`, which regenerates them against a live Dryad query.
- `## Caveats` section in the README, and a Mermaid diagram of how DataCite and OAI-PMH
  queries reach the scoring engine.
- A line stating who the tool is for, above the live link.
- This changelog.

### Changed

- README restructured: the languages line moved up top, `## Citation` became the closing
  section, standardized with `coara-action-planner`.

### Removed

- **The built-in default CORS relay.** OAI-PMH now requires a relay you deploy yourself from
  `cors-proxy/` and paste into *CORS proxy (advanced)*; the app shows a clear error until you
  do. Shipping a default contradicted this tool's own promise of depending on nobody else's
  infrastructure: it routed every visitor's OAI-PMH traffic through a single account and
  hardcoded that account's hostname into a public repository. DataCite is unaffected: it
  sends CORS headers and needs no relay.

### Fixed

- Compare value column widened so scores stay on one line in the system monospace font.
- DOI badge URL carries a cache-bust parameter; without it GitHub's camo proxy serves a stale
  image. (Removing it was tried and had to be reverted.)

## [1.2.0]: 2026-07-22

Version DOI: [10.5281/zenodo.21492531](https://doi.org/10.5281/zenodo.21492531).

### Added

- Scoring of every harvested record against **14 FAIR sub-principles** (Wilkinson et al. 2016),
  each Full (1) / Partial (0.5) / Not met (0): a faithful port of the Repo MetAudits engine,
  so scores match.
- Two sources: **DataCite** (by client ID, prefix or publisher, queried directly since the API
  sends CORS headers) and **OAI-PMH** (via a thin CORS relay shipped in `cors-proxy/`).
- Concept completeness: the share of records carrying each concrete field, grouped into
  Habermann's four use cases (Text / Identifiers / Connections / Contacts).
- FAIR profile radar with the mean plus every record overlaid, per-record heatmap, reusability
  readout, FAIR-over-time trend, and possible-duplicate detection.
- Per-check detail with a full/partial/not-met split, a fix recommendation, and a drill-down to
  the exact records below full.
- **Year focus**: publication year on DataCite (with **Suggest years** reconstructing the
  records-per-year distribution from count-only queries), record datestamp on OAI-PMH via
  native `from`/`until` selective harvesting.
- **Compare** mode: two repositories side by side, including a dual radar and a concept diff.
- Shareable, bookmarkable result URLs that re-run the analysis on open, with an optional
  `lang` parameter.
- Full English, Spanish, French and German interface, with schema field names and export keys
  deliberately left untranslated.
- JSON / text / CSV export, including an **Action list (CSV)** of every record below full on a
  check, with the reason.
- Unit tests for the engine, the analysis modules and locale parity (Node's built-in runner,
  no dependencies).
- `CITATION.cff` with citation metadata, MIT licence.

[Unreleased]: https://github.com/rijdho/fair-repo-audit/compare/v1.7.0...HEAD
[1.7.0]: https://github.com/rijdho/fair-repo-audit/releases/tag/v1.7.0
[1.6.0]: https://github.com/rijdho/fair-repo-audit/releases/tag/v1.6.0
[1.5.0]: https://github.com/rijdho/fair-repo-audit/releases/tag/v1.5.0
[1.4.0]: https://github.com/rijdho/fair-repo-audit/releases/tag/v1.4.0
[1.3.0]: https://github.com/rijdho/fair-repo-audit/releases/tag/v1.3.0
[1.2.0]: https://github.com/rijdho/fair-repo-audit/releases/tag/v1.2.0
