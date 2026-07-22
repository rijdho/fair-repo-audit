// Unit tests for src/analysis.js — temporal series + duplicate detection.
// Run with:  node --test tests/

import test from 'node:test';
import assert from 'node:assert/strict';
import { temporalSeries, findDuplicates } from '../src/analysis.js';

test('temporalSeries: buckets by year, means the overall percent, sorts ascending', () => {
  const years = [2020, 2021, 2020, null, 1800];
  const assessments = [{ overallPercent: 80 }, { overallPercent: 60 }, { overallPercent: 40 }, { overallPercent: 99 }, { overallPercent: 99 }];
  assert.deepEqual(temporalSeries(years, assessments), [
    { year: 2020, n: 2, mean: 60 },
    { year: 2021, n: 1, mean: 60 },
  ]);
});

test('findDuplicates: groups by normalized title (case, accents, versions, punctuation)', () => {
  const groups = findDuplicates([
    { id: 'a', title: 'Análisis de suelos v1.2' },
    { id: 'b', title: 'analisis de suelos V2' },
    { id: 'c', title: 'Something else entirely' },
  ]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].ids, ['a', 'b']);
});

test('findDuplicates: ignores empty and too-short titles', () => {
  const groups = findDuplicates([
    { id: 'a', title: '' },
    { id: 'b', title: '' },
    { id: 'c', title: 'ab' },
    { id: 'd', title: 'ab' },
  ]);
  assert.equal(groups.length, 0);
});

test('findDuplicates: biggest groups first', () => {
  const groups = findDuplicates([
    { id: '1', title: 'water quality data' }, { id: '2', title: 'water quality data' },
    { id: '3', title: 'soil samples chile' }, { id: '4', title: 'soil samples chile' }, { id: '5', title: 'soil samples chile' },
  ]);
  assert.equal(groups[0].ids.length, 3);
  assert.equal(groups[1].ids.length, 2);
});
