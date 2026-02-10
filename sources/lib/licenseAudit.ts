import type { LicenseEntry } from './licensesReport'

export type LicenseAuditStatus = 'allowed' | 'violation'

export type LicenseAuditEntry = LicenseEntry & {
  status: LicenseAuditStatus
  matchedAllowRule: string | null
  detectedLicenseTokens: Array<string>
}

export function parseAllowValues(values: Array<string>): Array<string> {
  const parsed = values
    .flatMap((value) => value.split(','))
    .map((value) => value.trim())
    .filter((value) => value.length > 0)

  const seen = new Set<string>()
  const unique: Array<string> = []

  for (const item of parsed) {
    const normalized = normalizeLicenseToken(item)
    if (seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    unique.push(item)
  }

  return unique
}

export function auditLicenseEntries(
  entries: Array<LicenseEntry>,
  allowRules: Array<string>,
): Array<LicenseAuditEntry> {
  const normalizedAllows = new Map<string, string>()
  for (const rule of allowRules) {
    normalizedAllows.set(normalizeLicenseToken(rule), rule)
  }

  return entries.map((entry) => {
    const tokens = extractLicenseTokens(entry.licenseType)
    let matchedAllowRule: string | null = null

    for (const token of tokens) {
      const matched = normalizedAllows.get(normalizeLicenseToken(token))
      if (matched) {
        matchedAllowRule = matched
        break
      }
    }

    return {
      ...entry,
      status: matchedAllowRule ? 'allowed' : 'violation',
      matchedAllowRule,
      detectedLicenseTokens: tokens,
    }
  })
}

export function renderLicenseAuditText(entries: Array<LicenseAuditEntry>): string {
  if (entries.length === 0) {
    return ''
  }

  return `${entries
    .map((entry) => {
      return [
        `${entry.status.toUpperCase()} ${entry.name}@${entry.version}`,
        `  license: ${entry.licenseType}`,
        `  url: ${entry.url}`,
        `  matchedAllowRule: ${entry.matchedAllowRule ?? 'none'}`,
      ].join('\n')
    })
    .join('\n\n')}\n`
}

export function hasAuditViolations(entries: Array<LicenseAuditEntry>): boolean {
  return entries.some((entry) => entry.status === 'violation')
}

export function getAuditViolations(entries: Array<LicenseAuditEntry>): Array<LicenseAuditEntry> {
  return entries.filter((entry) => entry.status === 'violation')
}

function extractLicenseTokens(licenseType: string): Array<string> {
  const raw = licenseType.trim()
  if (raw.length === 0) {
    return []
  }

  const split = raw
    .split(/\s+OR\s+|\s+AND\s+|\s+WITH\s+|[()]/gi)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)

  return split.length > 0 ? split : [raw]
}

function normalizeLicenseToken(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase()
}
