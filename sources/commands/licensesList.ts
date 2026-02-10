import { BaseCommand } from '@yarnpkg/cli'
import { Configuration, Project, structUtils, type Workspace } from '@yarnpkg/core'
import { ppath, xfs } from '@yarnpkg/fslib'
import { Option, UsageError } from 'clipanion'

import {
  collectLicenseEntries,
  type DebugEntry,
  renderTextReport,
  resolveOutputPath,
} from '../lib/licensesReport'

export class LicensesListCommand extends BaseCommand {
  static override paths = [[`licenses`, `list`]]

  static override usage = {
    description: `generate a third-party dependency license report`,
    details: `Generate a JSON report with name, version, license type, and repository URL for third-party dependencies.`,
    examples: [
      [`Generate recursive npm report for all workspaces`, `yarn licenses list -A -r`] as [
        string,
        string,
      ],
      [
        `Generate recursive workspace and npm report`,
        `yarn licenses list -A --recursive-workspaces -r`,
      ] as [string, string],
    ],
  }

  allWorkspaces = Option.Boolean(`-A,--all-workspaces`, false, {
    description: `include all workspaces`,
  })

  workspaces = Option.Array(`-w,--workspace`, {
    description: `workspace name (repeatable)`,
  })

  includeDev = Option.Boolean(`-d,--include-dev-deps`, false, {
    description: `include dev dependencies`,
  })

  includeRootDeps = Option.Boolean(`--include-root-deps`, false, {
    description: `treat root workspace dependencies as additional seed dependencies`,
  })

  recursiveWorkspaces = Option.Boolean(`--recursive-workspaces`, false, {
    description: `traverse workspace-to-workspace dependencies recursively`,
  })

  recursiveNpm = Option.Boolean(`-r,--recursive-npm`, false, {
    description: `traverse third-party npm dependencies recursively`,
  })

  output = Option.String(`-o,--output`, {
    description: `write report to file (stdout if omitted)`,
    required: false,
  })

  debugPackage = Option.String(`--debug-package`, {
    required: false,
  })

  json = Option.Boolean(`--json`, false, {
    description: `emit JSON instead of text`,
  })

  async execute(): Promise<number> {
    if (this.allWorkspaces && (this.workspaces?.length ?? 0) > 0) {
      throw new UsageError(`Use either --all-workspaces or --workspace, not both.`)
    }

    const configuration = await Configuration.find(this.context.cwd, this.context.plugins)
    const { project, workspace } = await Project.find(configuration, this.context.cwd)

    await project.restoreInstallState()

    const selectedWorkspaces = this.selectWorkspaces(project, workspace)
    const seedWorkspaces = this.includeRootDeps
      ? dedupeWorkspaces([...selectedWorkspaces, project.topLevelWorkspace])
      : selectedWorkspaces
    if (this.recursiveWorkspaces) {
      const workspaceEdgeCount = countDirectWorkspaceEdges(
        configuration,
        project,
        seedWorkspaces,
        this.includeDev,
      )
      if (workspaceEdgeCount === 0) {
        this.context.stderr.write(
          `Warning: --recursive-workspaces is enabled, but no workspace dependencies were found from the selected workspace roots.\n`,
        )
      }
    }

    const collectOptions = {
      configuration,
      project,
      workspaces: seedWorkspaces,
      includeDev: this.includeDev,
      recursiveWorkspaces: this.recursiveWorkspaces,
      recursiveNpm: this.recursiveNpm,
      onDebugEntry: (entry: DebugEntry) => {
        this.context.stderr.write(`debug-package: ${entry.name}@${entry.version}\n`)
        this.context.stderr.write(`  licenseType: ${entry.licenseType}\n`)
        this.context.stderr.write(`  raw.repository: ${stringifyUnknown(entry.rawRepository)}\n`)
        this.context.stderr.write(`  raw.homepage: ${stringifyUnknown(entry.rawHomepage)}\n`)
        this.context.stderr.write(`  normalized.url: ${entry.normalizedUrl}\n`)
      },
    }
    if (this.debugPackage) {
      Object.assign(collectOptions, { debugPackageName: this.debugPackage })
    }

    const entries = await collectLicenseEntries(collectOptions)

    const output = this.json ? `${JSON.stringify(entries, null, 2)}\n` : renderTextReport(entries)

    if (this.output) {
      const outputPath = resolveOutputPath(this.context.cwd, this.output)
      await xfs.mkdirPromise(ppath.dirname(outputPath), { recursive: true })
      await xfs.writeFilePromise(outputPath, output)
    } else {
      this.context.stdout.write(output)
    }

    return 0
  }

  private selectWorkspaces(project: Project, currentWorkspace: Workspace | null): Array<Workspace> {
    const requestedWorkspaces = this.workspaces ?? []

    if (this.allWorkspaces) {
      return project.workspaces
    }

    if (requestedWorkspaces.length > 0) {
      return requestedWorkspaces.map((workspaceName: string) => {
        const workspace = project.workspaces.find((candidate) =>
          matchesWorkspace(candidate, workspaceName),
        )
        if (!workspace) {
          throw new UsageError(`Workspace not found: ${workspaceName}`)
        }

        return workspace
      })
    }

    if (currentWorkspace) {
      return [currentWorkspace]
    }

    throw new UsageError(`No workspace selected. Use --all-workspaces or --workspace.`)
  }
}

function dedupeWorkspaces(workspaces: Array<Workspace>): Array<Workspace> {
  const seen = new Set<string>()
  const deduped: Array<Workspace> = []

  for (const workspace of workspaces) {
    if (seen.has(workspace.cwd)) {
      continue
    }

    seen.add(workspace.cwd)
    deduped.push(workspace)
  }

  return deduped
}

function matchesWorkspace(workspace: Workspace, input: string): boolean {
  if (workspace.manifest.name) {
    if (structUtils.stringifyIdent(workspace.manifest.name) === input) {
      return true
    }
  }

  if (workspace.relativeCwd === input) {
    return true
  }

  const segments = workspace.relativeCwd.split('/')
  const basename = segments[segments.length - 1] ?? workspace.relativeCwd
  return basename === input
}

function countDirectWorkspaceEdges(
  configuration: Configuration,
  project: Project,
  workspaces: Array<Workspace>,
  includeDev: boolean,
): number {
  let edges = 0

  for (const workspace of workspaces) {
    const dependencyDescriptors = [...workspace.manifest.dependencies.values()]
    if (includeDev) {
      dependencyDescriptors.push(...workspace.manifest.devDependencies.values())
    }

    for (const descriptor of dependencyDescriptors) {
      const resolution =
        project.storedResolutions.get(descriptor.descriptorHash) ??
        project.storedResolutions.get(configuration.normalizeDependency(descriptor).descriptorHash)
      if (!resolution) {
        continue
      }

      const resolvedPackage = project.storedPackages.get(resolution)
      if (!resolvedPackage) {
        continue
      }

      if (
        (descriptor.range.startsWith('workspace:') ||
          project.tryWorkspaceByDescriptor(descriptor) !== null) &&
        project.tryWorkspaceByLocator(resolvedPackage)
      ) {
        edges += 1
      }
    }
  }

  return edges
}

function stringifyUnknown(value: unknown): string {
  if (value === undefined) {
    return 'undefined'
  }

  if (typeof value === 'string') {
    return value
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}
