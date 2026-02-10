import assert from 'node:assert/strict'
import test from 'node:test'

import { renderDisclaimerReport } from '../../sources/lib/licensesReport'

test('renders empty disclaimer report as empty string', () => {
  assert.equal(renderDisclaimerReport([]), '')
})

test('groups entries by identical license text', () => {
  const actual = renderDisclaimerReport([
    {
      name: 'a',
      version: '1.0.0',
      licenseType: 'MIT',
      url: 'https://example.com/a',
      licenseText: 'MIT text',
    },
    {
      name: 'b',
      version: '1.0.0',
      licenseType: 'MIT',
      url: 'https://example.com/b',
      licenseText: 'MIT text',
    },
    {
      name: 'c',
      version: '1.0.0',
      licenseType: 'Apache-2.0',
      url: 'https://example.com/c',
      licenseText: '',
    },
  ])

  assert.match(actual, /The following software may be included in this product: a@1.0.0, b@1.0.0\./)
  assert.match(actual, /MIT text/)
  assert.match(actual, /The following software may be included in this product: c@1.0.0\./)
  assert.match(actual, /License text was not found in the package distribution\./)
})
