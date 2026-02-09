import {
  Cache,
  type Configuration,
  type Descriptor,
  type LocatorHash,
  Manifest,
  type Package,
  type Project,
  structUtils,
  ThrowReport,
  type Workspace,
} from '@yarnpkg/core'
import { npath, type PortablePath, ppath } from '@yarnpkg/fslib'

import { normalizeRepositoryUrl } from './urlNormalization'

export type LicenseEntry = {
  name: string
  version: string
  licenseType: string
  url: string
}

type CollectOptions = {
  configuration: Configuration
  project: Project
  workspaces: Array<Workspace>
  includeDev: boolean
  recursiveWorkspaces: boolean
  recursiveNpm: boolean
}

type PackageMetadata = {
  licenseType: string
  url: string
}

export async function collectLicenseEntries({
  configuration,
  project,
  workspaces,
  includeDev,
  recursiveWorkspaces,
  recursiveNpm,
}: CollectOptions): Promise<Array<LicenseEntry>> {
  const externalLocatorHashes = collectExternalLocatorHashes({
    configuration,
    project,
    workspaces,
    includeDev,
    recursiveWorkspaces,
    recursiveNpm,
  })

  const fetcher = configuration.makeFetcher()
  const cache = await Cache.find(configuration)
  const report = new ThrowReport()
  const checksums = new Map(project.storedChecksums) as Map<LocatorHash, string | null>

  const entries = await mapWithConcurrency([...externalLocatorHashes], 16, async (locatorHash) => {
    const pkg = project.storedPackages.get(locatorHash)
    if (!pkg) {
      return null
    }

    const metadata = await readPackageMetadata({
      project,
      fetcher,
      cache,
      report,
      checksums,
      pkg,
    })

    return {
      name: structUtils.stringifyIdent(pkg),
      version: pkg.version ?? '',
      licenseType: metadata.licenseType,
      url: metadata.url,
    }
  })

  entries.sort((left, right) => {
    const byName = left.name.localeCompare(right.name)
    if (byName !== 0) {
      return byName
    }

    const byVersion = left.version.localeCompare(right.version)
    if (byVersion !== 0) {
      return byVersion
    }

    return left.url.localeCompare(right.url)
  })

  return entries
}

function collectExternalLocatorHashes({
  configuration,
  project,
  workspaces,
  includeDev,
  recursiveWorkspaces,
  recursiveNpm,
}: {
  configuration: Configuration
  project: Project
  workspaces: Array<Workspace>
  includeDev: boolean
  recursiveWorkspaces: boolean
  recursiveNpm: boolean
}): Set<LocatorHash> {
  const external = new Set<LocatorHash>()
  const visitedWorkspaceCwds = new Set<string>()
  const visitedLocatorHashes = new Set<LocatorHash>()

  const queue: Array<
    { type: 'workspace'; workspace: Workspace } | { type: 'locator'; locatorHash: LocatorHash }
  > = workspaces.map((workspace) => ({ type: 'workspace', workspace }))

  while (queue.length > 0) {
    const node = queue.shift()
    if (!node) {
      continue
    }

    if (node.type === 'workspace') {
      if (visitedWorkspaceCwds.has(node.workspace.cwd)) {
        continue
      }

      visitedWorkspaceCwds.add(node.workspace.cwd)
      const descriptors = getWorkspaceDependencyDescriptors(
        configuration,
        node.workspace,
        includeDev,
      )

      for (const descriptor of descriptors) {
        const resolution = project.storedResolutions.get(descriptor.descriptorHash)
        if (!resolution) {
          continue
        }

        const resolvedPackage = project.storedPackages.get(resolution)
        if (!resolvedPackage) {
          continue
        }

        const resolvedWorkspace = project.tryWorkspaceByLocator(resolvedPackage)
        if (resolvedWorkspace) {
          if (recursiveWorkspaces) {
            queue.push({ type: 'workspace', workspace: resolvedWorkspace })
          }
          continue
        }

        external.add(resolution)
        if (recursiveNpm && !visitedLocatorHashes.has(resolution)) {
          queue.push({ type: 'locator', locatorHash: resolution })
        }
      }

      continue
    }

    if (visitedLocatorHashes.has(node.locatorHash)) {
      continue
    }

    visitedLocatorHashes.add(node.locatorHash)

    const pkg = project.storedPackages.get(node.locatorHash)
    if (!pkg) {
      continue
    }

    if (!recursiveNpm) {
      continue
    }

    for (const descriptor of pkg.dependencies.values()) {
      const resolution = project.storedResolutions.get(descriptor.descriptorHash)
      if (!resolution) {
        continue
      }

      const resolvedPackage = project.storedPackages.get(resolution)
      if (!resolvedPackage) {
        continue
      }

      const resolvedWorkspace = project.tryWorkspaceByLocator(resolvedPackage)
      if (resolvedWorkspace) {
        if (recursiveWorkspaces) {
          queue.push({ type: 'workspace', workspace: resolvedWorkspace })
        }
        continue
      }

      external.add(resolution)
      if (!visitedLocatorHashes.has(resolution)) {
        queue.push({ type: 'locator', locatorHash: resolution })
      }
    }
  }

  return external
}

function getWorkspaceDependencyDescriptors(
  configuration: Configuration,
  workspace: Workspace,
  includeDev: boolean,
): Array<Descriptor> {
  const descriptors = [...workspace.manifest.dependencies.values()].map((descriptor) =>
    configuration.normalizeDependency(descriptor),
  )
  if (includeDev) {
    descriptors.push(
      ...[...workspace.manifest.devDependencies.values()].map((descriptor) =>
        configuration.normalizeDependency(descriptor),
      ),
    )
  }
  return descriptors
}

async function readPackageMetadata({
  project,
  fetcher,
  cache,
  report,
  checksums,
  pkg,
}: {
  project: Project
  fetcher: ReturnType<Configuration['makeFetcher']>
  cache: Cache
  report: ThrowReport
  checksums: Map<LocatorHash, string | null>
  pkg: Package
}): Promise<PackageMetadata> {
  const devirtualized = structUtils.ensureDevirtualizedLocator(pkg)
  const fetchResult = await fetcher.fetch(devirtualized, {
    project,
    fetcher,
    cache,
    checksums,
    report,
  })

  try {
    const manifest = fetchResult.prefixPath.endsWith(`/${Manifest.fileName}`)
      ? await Manifest.fromFile(fetchResult.prefixPath, { baseFs: fetchResult.packageFs })
      : await Manifest.find(fetchResult.prefixPath, { baseFs: fetchResult.packageFs })
    const rawMetadata = manifest.raw as {
      repository?: unknown
      homepage?: unknown
      licenses?: unknown
    }

    const licenseType = manifest.license ?? parseRawLicenseType(rawMetadata.licenses) ?? 'UNKNOWN'
    const url =
      normalizeRepositoryUrl(rawMetadata.repository) ??
      normalizeRepositoryUrl(rawMetadata.homepage) ??
      ''

    return {
      licenseType,
      url,
    }
  } finally {
    fetchResult.releaseFs?.()
  }
}

export function resolveOutputPath(cwd: string, outputPath: string): PortablePath {
  const portableCwd = npath.toPortablePath(cwd)
  const portableOutputPath = npath.toPortablePath(outputPath)
  return ppath.resolve(portableCwd, portableOutputPath)
}

function parseRawLicenseType(rawLicenses: unknown): string | null {
  if (!Array.isArray(rawLicenses) || rawLicenses.length === 0) {
    return null
  }

  const values = rawLicenses
    .map((entry) => {
      if (typeof entry === 'string') {
        return entry.trim()
      }

      if (entry && typeof entry === 'object') {
        const candidate = (entry as { type?: unknown }).type
        if (typeof candidate === 'string') {
          return candidate.trim()
        }
      }

      return ''
    })
    .filter((entry) => entry.length > 0)

  if (values.length === 0) {
    return null
  }

  return values.join(' OR ')
}

async function mapWithConcurrency<T, U>(
  items: Array<T>,
  concurrency: number,
  mapper: (item: T) => Promise<U | null>,
): Promise<Array<U>> {
  const maxConcurrency = Math.max(1, Math.floor(concurrency))
  const result: Array<U> = []
  let nextIndex = 0

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      const currentItem = items[currentIndex]
      if (currentItem === undefined) {
        continue
      }

      const mapped = await mapper(currentItem)
      if (mapped !== null) {
        result.push(mapped)
      }
    }
  }

  const workers = Array.from({ length: Math.min(maxConcurrency, items.length) }, () => runWorker())
  await Promise.all(workers)
  return result
}
