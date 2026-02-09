import { BaseCommand } from '@yarnpkg/cli'
import { Configuration, Project, structUtils, type Workspace } from '@yarnpkg/core'
import { xfs } from '@yarnpkg/fslib'
import { Option, UsageError } from 'clipanion'

import { collectLicenseEntries, resolveOutputPath } from '../lib/licensesReport'

export class LicensesReportCommand extends BaseCommand {
  static override paths = [[`licenses`, `report`]]

  static override usage = {
    description: `generate a third-party dependency license report`,
    details: `Generate a JSON report with name, version, license type, and repository URL for third-party dependencies.`,
    examples: [
      [`Generate recursive report for all workspaces`, `yarn licenses report -A -r`] as [
        string,
        string,
      ],
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

  recursive = Option.Boolean(`-r,--recursive`, false, {
    description: `traverse transitive dependencies`,
  })

  output = Option.String(`-o,--output`, {
    description: `write JSON to file (stdout if omitted)`,
    required: false,
  })

  async execute(): Promise<number> {
    const configuration = await Configuration.find(this.context.cwd, this.context.plugins)
    const { project, workspace } = await Project.find(configuration, this.context.cwd)

    await project.restoreInstallState()

    const selectedWorkspaces = this.selectWorkspaces(project, workspace)

    const entries = await collectLicenseEntries({
      configuration,
      project,
      workspaces: selectedWorkspaces,
      includeDev: this.includeDev,
      recursive: this.recursive,
    })

    const json = `${JSON.stringify(entries, null, 2)}\n`

    if (this.output) {
      const outputPath = resolveOutputPath(this.context.cwd, this.output)
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
