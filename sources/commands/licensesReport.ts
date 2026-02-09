import { BaseCommand } from '@yarnpkg/cli'
import { Configuration, Project, structUtils, type Workspace } from '@yarnpkg/core'
import { ppath, xfs } from '@yarnpkg/fslib'
import { Option, UsageError } from 'clipanion'

import { collectLicenseEntries, resolveOutputPath } from '../lib/licensesReport'

export class LicensesReportCommand extends BaseCommand {
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

  includeDev = Option.Boolean(`-d,--include-dev`, false, {
    description: `include dev dependencies`,
  })

  recursiveWorkspaces = Option.Boolean(`--recursive-workspaces`, false, {
    description: `traverse workspace-to-workspace dependencies recursively`,
  })

  recursiveNpm = Option.Boolean(`-r,--recursive-npm`, false, {
    description: `traverse third-party npm dependencies recursively`,
  })

  output = Option.String(`-o,--output`, {
    description: `write JSON to file (stdout if omitted)`,
    required: false,
  })

  async execute(): Promise<number> {
    if (this.allWorkspaces && (this.workspaces?.length ?? 0) > 0) {
      throw new UsageError(`Use either --all-workspaces or --workspace, not both.`)
    }

    const configuration = await Configuration.find(this.context.cwd, this.context.plugins)
    const { project, workspace } = await Project.find(configuration, this.context.cwd)

    await project.restoreInstallState()

    const selectedWorkspaces = this.selectWorkspaces(project, workspace)
    if (this.recursiveWorkspaces) {
      const workspaceEdgeCount = countDirectWorkspaceEdges(
        configuration,
        project,
        selectedWorkspaces,
        this.includeDev,
      )
      if (workspaceEdgeCount === 0) {
        this.context.stderr.write(
          `Warning: --recursive-workspaces is enabled, but no workspace dependencies were found from the selected workspace roots.\n`,
        )
      }
    }

    const entries = await collectLicenseEntries({
      configuration,
      project,
      workspaces: selectedWorkspaces,
      includeDev: this.includeDev,
      recursiveWorkspaces: this.recursiveWorkspaces,
      recursiveNpm: this.recursiveNpm,
    })

    const json = `${JSON.stringify(entries, null, 2)}\n`

    if (this.output) {
      const outputPath = resolveOutputPath(this.context.cwd, this.output)
      await xfs.mkdirPromise(ppath.dirname(outputPath), { recursive: true })
      await xfs.writeFilePromise(outputPath, json)
    } else {
      this.context.stdout.write(json)
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
    const dependencyDescriptors = [...workspace.manifest.dependencies.values()].map((descriptor) =>
      configuration.normalizeDependency(descriptor),
    )
    if (includeDev) {
      dependencyDescriptors.push(
        ...[...workspace.manifest.devDependencies.values()].map((descriptor) =>
          configuration.normalizeDependency(descriptor),
        ),
      )
    }

    for (const descriptor of dependencyDescriptors) {
      const resolution = project.storedResolutions.get(descriptor.descriptorHash)
      if (!resolution) {
        continue
      }

      const resolvedPackage = project.storedPackages.get(resolution)
      if (!resolvedPackage) {
        continue
      }

      if (project.tryWorkspaceByLocator(resolvedPackage)) {
        edges += 1
      }
    }
  }

  return edges
}
