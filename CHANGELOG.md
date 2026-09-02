# Changelog

All notable changes to this project are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Each released version is archived on Zenodo with its own version DOI. The concept DOI
[10.5281/zenodo.21492530](https://doi.org/10.5281/zenodo.21492530) always resolves to the
latest release.

> History before 1.2.0 was squashed when the repository was made public; the pre-squash
> commits are preserved on the `pre-squash-backup` tag.

## [Unreleased]

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

[Unreleased]: https://github.com/rijdho/fair-repo-audit/compare/v1.3.0...HEAD
[1.3.0]: https://github.com/rijdho/fair-repo-audit/releases/tag/v1.3.0
[1.2.0]: https://github.com/rijdho/fair-repo-audit/releases/tag/v1.2.0
