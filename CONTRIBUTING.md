# Contributing

Bug reports, corrections and translation fixes are welcome. Open an issue, or a
pull request if the change is small and self-contained.

## Licensing of contributions

This project is licensed **AGPL-3.0-or-later**, and contributions are accepted
on the same terms. By opening a pull request you agree that:

1. your contribution is licensed under AGPL-3.0-or-later, and
2. you grant the maintainer the right to relicense your contribution, including
   under a different or proprietary licence.

Point 2 is not boilerplate and it is worth explaining rather than burying.
This project is the open half of a pair: the same rubric also runs in a hosted
service that is not open source. Keeping the right to move code between the two
is what makes it possible to publish this half at all. Without that grant, a
single merged contribution would permanently prevent it, since a contributor
keeps copyright over their own work and the AGPL would then bind the whole.

If you would rather not grant point 2, say so in the pull request. A bug report
or a precise description of the fix is genuinely useful on its own, and the fix
can be written separately.

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
