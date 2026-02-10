import assert from 'node:assert/strict'
import test from 'node:test'

import { normalizeRepositoryUrl } from '../../sources/lib/urlNormalization'

test('normalizes git+ssh url to https without .git', () => {
  const actual = normalizeRepositoryUrl('git+ssh://git@github.com/org/repo.git#main')
  assert.equal(actual, 'https://github.com/org/repo#main')
})

test('normalizes scp-like git syntax', () => {
  const actual = normalizeRepositoryUrl('git@github.com:org/repo.git')
  assert.equal(actual, 'https://github.com/org/repo')
})

test('normalizes ssh://git@host:owner/repo syntax', () => {
  const actual = normalizeRepositoryUrl('ssh://git@github.com:org/repo.git')
  assert.equal(actual, 'https://github.com/org/repo')
})

test('keeps https urls stable', () => {
  const actual = normalizeRepositoryUrl('https://github.com/org/repo.git')
  assert.equal(actual, 'https://github.com/org/repo')
})

test('supports repository object shape', () => {
  const actual = normalizeRepositoryUrl({ type: 'git', url: 'git://github.com/org/repo.git' })
  assert.equal(actual, 'https://github.com/org/repo')
})

test('normalizes github shorthand owner/repo format', () => {
  const actual = normalizeRepositoryUrl('formatjs/formatjs')
  assert.equal(actual, 'https://github.com/formatjs/formatjs')
})
