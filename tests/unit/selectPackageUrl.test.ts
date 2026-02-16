import assert from 'node:assert/strict'
import test from 'node:test'

import { selectPackageUrl } from '../../sources/lib/licensesReport'

test('prefers repository url over homepage url', () => {
  const actual = selectPackageUrl({
    repository: 'git+ssh://git@github.com/acme/pkg.git',
    homepage: 'https://example.com/project',
  })

  assert.equal(actual, 'https://github.com/acme/pkg')
})

test('falls back to homepage when repository is missing', () => {
  const actual = selectPackageUrl({
    repository: undefined,
    homepage: 'https://example.com/project',
  })

  assert.equal(actual, 'https://example.com/project')
})
