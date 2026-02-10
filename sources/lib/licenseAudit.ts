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
    const evaluation = evaluateLicenseExpression(entry.licenseType, normalizedAllows)

    return {
      ...entry,
      status: evaluation.allowed ? 'allowed' : 'violation',
      matchedAllowRule: evaluation.matchedAllowRule,
      detectedLicenseTokens: evaluation.detectedTokens,
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

type ExpressionEvaluation = {
  allowed: boolean
  matchedAllowRule: string | null
  detectedTokens: Array<string>
}

type ExpressionNode =
  | { type: 'license'; token: string }
  | { type: 'and'; left: ExpressionNode; right: ExpressionNode }
  | { type: 'or'; left: ExpressionNode; right: ExpressionNode }

type ParseResult = {
  node: ExpressionNode | null
  tokens: Array<string>
}

function evaluateLicenseExpression(
  licenseType: string,
  normalizedAllows: Map<string, string>,
): ExpressionEvaluation {
  const parsed = parseLicenseExpression(licenseType)
  if (!parsed.node) {
    return {
      allowed: false,
      matchedAllowRule: null,
      detectedTokens: parsed.tokens,
    }
  }

  const evaluated = evaluateExpressionNode(parsed.node, normalizedAllows)
  return {
    allowed: evaluated.allowed,
    matchedAllowRule: evaluated.matchedAllowRule,
    detectedTokens: parsed.tokens,
  }
}

function evaluateExpressionNode(
  node: ExpressionNode,
  normalizedAllows: Map<string, string>,
): { allowed: boolean; matchedAllowRule: string | null } {
  switch (node.type) {
    case 'license': {
      const matched = normalizedAllows.get(normalizeLicenseToken(node.token))
      return { allowed: Boolean(matched), matchedAllowRule: matched ?? null }
    }
    case 'and': {
      const left = evaluateExpressionNode(node.left, normalizedAllows)
      if (!left.allowed) {
        return { allowed: false, matchedAllowRule: null }
      }

      const right = evaluateExpressionNode(node.right, normalizedAllows)
      if (!right.allowed) {
        return { allowed: false, matchedAllowRule: null }
      }

      return { allowed: true, matchedAllowRule: left.matchedAllowRule ?? right.matchedAllowRule }
    }
    case 'or': {
      const left = evaluateExpressionNode(node.left, normalizedAllows)
      if (left.allowed) {
        return left
      }

      return evaluateExpressionNode(node.right, normalizedAllows)
    }
  }
}

function parseLicenseExpression(licenseType: string): ParseResult {
  const inputTokens = tokenizeExpression(licenseType)
  if (inputTokens.length === 0) {
    return { node: null, tokens: [] }
  }

  let cursor = 0
  const detectedTokens: Array<string> = []

  const peek = (): string | null => inputTokens[cursor] ?? null
  const consume = (): string | null => {
    const token = inputTokens[cursor]
    if (token === undefined) {
      return null
    }

    cursor += 1
    return token
  }

  const parseOr = (): ExpressionNode | null => {
    let node = parseAnd()
    if (!node) {
      return null
    }

    while (peekIsOperator(peek(), 'OR')) {
      consume()
      const right = parseAnd()
      if (!right) {
        return null
      }
      node = { type: 'or', left: node, right }
    }

    return node
  }

  const parseAnd = (): ExpressionNode | null => {
    let node = parsePrimary()
    if (!node) {
      return null
    }

    while (peekIsOperator(peek(), 'AND')) {
      consume()
      const right = parsePrimary()
      if (!right) {
        return null
      }
      node = { type: 'and', left: node, right }
    }

    return node
  }

  const parsePrimary = (): ExpressionNode | null => {
    const token = peek()
    if (!token) {
      return null
    }

    if (token === '(') {
      consume()
      const nested = parseOr()
      if (!nested || peek() !== ')') {
        return null
      }
      consume()
      return nested
    }

    if (token === ')' || isOperatorToken(token)) {
      return null
    }

    const licenseToken = consumeLicenseToken()
    if (!licenseToken) {
      return null
    }

    detectedTokens.push(licenseToken)
    return { type: 'license', token: licenseToken }
  }

  const consumeLicenseToken = (): string | null => {
    const start = consume()
    if (!start) {
      return null
    }

    const parts = [start]
    while (true) {
      const token = peek()
      if (
        !token ||
        token === '(' ||
        token === ')' ||
        peekIsOperator(token, 'AND') ||
        peekIsOperator(token, 'OR')
      ) {
        break
      }

      const current = consume()
      if (!current) {
        break
      }

      parts.push(current)
    }

    return parts.join(' ').trim()
  }

  const rootNode = parseOr()
  if (!rootNode || cursor < inputTokens.length) {
    const fallbackTokens = extractLicenseTokens(licenseType)
    return { node: null, tokens: fallbackTokens }
  }

  return {
    node: rootNode,
    tokens: dedupeTokens(detectedTokens),
  }
}

function tokenizeExpression(licenseType: string): Array<string> {
  const spaced = licenseType.replace(/\(/g, ' ( ').replace(/\)/g, ' ) ')
  return spaced
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0)
}

function dedupeTokens(tokens: Array<string>): Array<string> {
  const seen = new Set<string>()
  const unique: Array<string> = []

  for (const token of tokens) {
    const normalized = normalizeLicenseToken(token)
    if (seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    unique.push(token)
  }

  return unique
}

function isOperatorToken(token: string): boolean {
  return peekIsOperator(token, 'AND') || peekIsOperator(token, 'OR')
}

function peekIsOperator(token: string | null, operator: 'AND' | 'OR'): boolean {
  return token !== null && token.toUpperCase() === operator
}
