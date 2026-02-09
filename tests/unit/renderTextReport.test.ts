import assert from 'node:assert/strict'
import test from 'node:test'

import { renderTextReport } from '../../sources/lib/licensesReport'

test('renders empty report as empty string', () => {
  assert.equal(renderTextReport([]), '')
})

test('renders tree-style text report', () => {
  const actual = renderTextReport([
    {
      name: '@scope/a',
      version: '1.0.0',
      licenseType: 'MIT',
      url: 'https://example.com/a',
    },
    {
      name: '@scope/b',
      version: '2.0.0',
      licenseType: 'Apache-2.0',
      url: 'https://example.com/b',
    },
  ])

  assert.equal(
    actual,
    [
      '├─ @scope/a@1.0.0',
      '│  ├─ License: MIT',
      '│  └─ URL: https://example.com/a',
      '└─ @scope/b@2.0.0',
      '   ├─ License: Apache-2.0',
      '   └─ URL: https://example.com/b',
      '',
    ].join('\n'),
  )
})
