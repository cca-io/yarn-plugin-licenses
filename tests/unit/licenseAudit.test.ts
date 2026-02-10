import assert from 'node:assert/strict'
import test from 'node:test'

import {
  auditLicenseEntries,
  getAuditViolations,
  hasAuditViolations,
  parseAllowValues,
  renderLicenseAuditText,
} from '../../sources/lib/licenseAudit'

test('parseAllowValues supports comma-separated and repeated options', () => {
  const parsed = parseAllowValues(['MIT,Apache-2.0', 'MIT', 'BSD-2-Clause'])
  assert.deepEqual(parsed, ['MIT', 'Apache-2.0', 'BSD-2-Clause'])
})

test('auditLicenseEntries marks allowed and violation correctly', () => {
  const entries = auditLicenseEntries(
    [
      { name: 'a', version: '1.0.0', licenseType: 'MIT', url: 'x' },
      { name: 'b', version: '1.0.0', licenseType: 'GPL-3.0', url: 'y' },
      { name: 'c', version: '1.0.0', licenseType: 'Apache-2.0 OR MIT', url: 'z' },
    ],
    ['mit', 'apache-2.0'],
  )

  assert.equal(entries[0]?.status, 'allowed')
  assert.equal(entries[1]?.status, 'violation')
  assert.equal(entries[2]?.status, 'allowed')
  assert.equal(hasAuditViolations(entries), true)
})

test('getAuditViolations filters allowed entries', () => {
  const violations = getAuditViolations([
    {
      name: 'a',
      version: '1.0.0',
      licenseType: 'MIT',
      url: 'u',
      status: 'allowed',
      matchedAllowRule: 'MIT',
      detectedLicenseTokens: ['MIT'],
    },
    {
      name: 'b',
      version: '1.0.0',
      licenseType: 'GPL-3.0',
      url: 'u',
      status: 'violation',
      matchedAllowRule: null,
      detectedLicenseTokens: ['GPL-3.0'],
    },
  ])

  assert.equal(violations.length, 1)
  assert.equal(violations[0]?.name, 'b')
})

test('renderLicenseAuditText returns detailed violation entries', () => {
  const text = renderLicenseAuditText([
    {
      name: 'b',
      version: '1.0.0',
      licenseType: 'GPL-3.0',
      url: 'u',
      status: 'violation',
      matchedAllowRule: null,
      detectedLicenseTokens: ['GPL-3.0'],
    },
  ])

  assert.match(text, /VIOLATION b@1.0.0/)
  assert.match(text, /matchedAllowRule: none/)
})
