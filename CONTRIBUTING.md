# Contributing

Bug reports, corrections and translation fixes are welcome. Open an issue, or a
pull request if the change is small and self-contained.

## Licensing of contributions

This project is licensed **Apache-2.0**, and contributions are accepted on the same terms:
section 5 of the licence says that anything submitted for inclusion is licensed under it, with
no separate agreement to sign. Apache-2.0 is permissive, so the maintainer can also carry a
contribution into the hosted FAIR Readout Server, which runs the same rubric; that is what
makes it possible to keep the two scoring alike.

## Scope: this measures, it does not remediate

The tool reads metadata and reports on it. It does not write metadata, look identifiers up, or
propose corrections, and that boundary is deliberate rather than a gap waiting to be filled.

A tool that both measures a repository and fixes it has a harder time being believed about either.
The score has to mean "this is what your published metadata says", full stop, and it stops meaning
that as soon as the same tool is also in the business of changing what it says. Keeping the audit
clean is worth more than the convenience of doing both in one place, and remediation is well served
by other tools.

So a pull request that adds identifier lookup, a metadata editor, or a "fix this for me" button
will be declined however well it is written. Please raise an issue before building anything in that
direction. Reporting a NEW thing worth measuring, on the other hand, is always in scope.

## Running the tests

No dependencies and no build step. The suite runs on Node's own test runner:

```sh
node --test tests/*.test.mjs
```

The locale tests are the ones that fail most often and they are doing their job:
a UI string added to `src/i18n/en.js` must be added to `de.js` and `es.js` too,
with the same `{placeholder}` tokens.

## What runs where

Most of this repository runs in the browser and that is a promise the README
makes to users, so it matters where new code goes:

- **In the browser**: the DataCite and OAI-PMH modes, the whole scoring rubric
  in `src/fair.js`, every chart and every export. These upload nothing.
- **In a service**: the "Source vs published" mode only. `src/analyze.js` is the
  entire client for it, and it is deliberately thin.

A change that moves browser-side analysis into a service breaks a published
promise, so it needs the README, the page copy and the meta description updated
in the same commit.
