export function normalizeRepositoryUrl(input: unknown): string | null {
  const raw = extractUrl(input)
  if (!raw) {
    return null
  }

  const trimmed = raw.trim()
  if (trimmed.length === 0) {
    return null
  }

  const hashIndex = trimmed.indexOf('#')
  const base = hashIndex >= 0 ? trimmed.slice(0, hashIndex) : trimmed
  const fragment = hashIndex >= 0 ? trimmed.slice(hashIndex) : ''

  const withoutGitPlus = base.startsWith('git+') ? base.slice(4) : base
  const https = toHttps(withoutGitPlus)
  // Drop ".git" so output stays stable even when upstream metadata flips between
  // clone URLs and browser URLs.
  const withoutGitSuffix = https.replace(/\.git$/i, '')
  const withoutTrailingSlash = withoutGitSuffix.replace(/\/$/, '')

  return `${withoutTrailingSlash}${fragment}`
}

function extractUrl(input: unknown): string | null {
  if (typeof input === 'string') {
    return input
  }

  if (input && typeof input === 'object') {
    const candidate = (input as { url?: unknown }).url
    if (typeof candidate === 'string') {
      return candidate
    }
  }

  return null
}

function toHttps(input: string): string {
  // npm metadata sometimes stores "owner/repo" shorthand in repository fields.
  // Convert it to a canonical URL to keep report output deterministic.
  const githubShortcut = input.match(/^([^/@:\s]+)\/([^#\s]+)$/)
  if (githubShortcut) {
    const owner = githubShortcut[1]
    const repo = githubShortcut[2]
    return `https://github.com/${owner}/${repo}`
  }

  if (input.startsWith('github:')) {
    return `https://github.com/${input.slice('github:'.length)}`
  }

  const sshLike = input.match(/^git@([^:]+):(.+)$/)
  if (sshLike) {
    const host = sshLike[1]
    const path = sshLike[2]
    return `https://${host}/${path}`
  }

  if (input.startsWith('ssh://git@')) {
    const rest = input.slice('ssh://git@'.length)
    const slashIndex = rest.indexOf('/')
    const colonIndex = rest.indexOf(':')

    if (colonIndex >= 0 && (slashIndex === -1 || colonIndex < slashIndex)) {
      const host = rest.slice(0, colonIndex)
      const remainder = rest.slice(colonIndex + 1)
      // Keep explicit numeric ports (host:7999/path), but normalize scp-like
      // host:path URLs into browser-style host/path URLs.
      if (/^\d+\//.test(remainder)) {
        return `https://${host}:${remainder}`
      }
      return `https://${host}/${remainder}`
    }

    return `https://${rest}`
  }

  if (input.startsWith('git://')) {
    return `https://${input.slice('git://'.length)}`
  }

  return input
}
