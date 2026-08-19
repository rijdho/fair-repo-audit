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

### Changed

- **License: MIT -> AGPL-3.0-or-later.** The code stays fully readable, citable and
  forkable; what changes is that anyone offering a modified version as a network service
  must publish their modifications under the same license. Releases up to 1.3.0 remain
  MIT (including their Zenodo archives).

### Added

- Pages now deploys through a GitHub Actions workflow (`deploy.yml`) instead of the
  legacy branch builder: the test suite gates every deploy, and the tree is uploaded
  verbatim with no Jekyll processing.

## [1.3.0] — 2026-07-28

Version DOI:
[10.5281/zenodo.21647450](https://doi.org/10.5281/zenodo.21647450).

### Added

- **How it works** — an in-app guide in its own tab: the four-step story for newcomers, then
  expandable depth covering the 14 checks one by one (rendered from the same catalogues the
  results use), the scoring bands, and where the data comes from. Available in all four
  languages.
- Zenodo DOIs recorded across the project: concept and version DOIs in `CITATION.cff` (with a
  top-level `doi` so GitHub's "Cite this repository" widget shows it), a DOI badge under the
  README title, a `## Citation` closing section, and a cite line with the concept DOI in the
  page footer, in all four languages.
- Screenshots in the README (`docs/`) — the headline score card and the FAIR profile radar —
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
  hardcoded that account's hostname into a public repository. DataCite is unaffected — it
  sends CORS headers and needs no relay.

### Fixed

- Compare value column widened so scores stay on one line in the system monospace font.
- DOI badge URL carries a cache-bust parameter; without it GitHub's camo proxy serves a stale
  image. (Removing it was tried and had to be reverted.)

## [1.2.0] — 2026-07-22

Version DOI: [10.5281/zenodo.21492531](https://doi.org/10.5281/zenodo.21492531).

### Added

- Scoring of every harvested record against **14 FAIR sub-principles** (Wilkinson et al. 2016),
  each Full (1) / Partial (0.5) / Not met (0) — a faithful port of the Repo MetAudits engine,
  so scores match.
- Two sources: **DataCite** (by client ID, prefix or publisher, queried directly since the API
  sends CORS headers) and **OAI-PMH** (via a thin CORS relay shipped in `cors-proxy/`).
- Concept completeness — the share of records carrying each concrete field, grouped into
  Habermann's four use cases (Text / Identifiers / Connections / Contacts).
- FAIR profile radar with the mean plus every record overlaid, per-record heatmap, reusability
  readout, FAIR-over-time trend, and possible-duplicate detection.
- Per-check detail with a full/partial/not-met split, a fix recommendation, and a drill-down to
  the exact records below full.
- **Year focus** — publication year on DataCite (with **Suggest years** reconstructing the
  records-per-year distribution from count-only queries), record datestamp on OAI-PMH via
  native `from`/`until` selective harvesting.
- **Compare** mode — two repositories side by side, including a dual radar and a concept diff.
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
