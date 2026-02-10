import { BaseCommand } from '@yarnpkg/cli'
import { Configuration, Project, structUtils, type Workspace } from '@yarnpkg/core'
import { ppath, xfs } from '@yarnpkg/fslib'
import { Option, UsageError } from 'clipanion'

import {
  collectDisclaimerEntries,
  renderDisclaimerReport,
  resolveOutputPath,
} from '../lib/licensesReport'

export class LicensesGenerateDisclaimerCommand extends BaseCommand {
  static override paths = [[`licenses`, `generate-disclaimer`]]

  static override usage = {
    description: `generate a third-party dependency disclaimer text`,
    details: `Generate a disclaimer text by grouping dependencies that share the same license notice text.`,
    examples: [
      [`Generate disclaimers for all workspaces`, `yarn licenses generate-disclaimer -A`] as [
        string,
        string,
      ],
      [
        `Generate recursive disclaimer report`,
        `yarn licenses generate-disclaimer -A --recursive-workspaces -r`,
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

  async execute(): Promise<number> {
    if (this.allWorkspaces && (this.workspaces?.length ?? 0) > 0) {
      throw new UsageError(`Use either --all-workspaces or --workspace, not both.`)
    }

    const configuration = await Configuration.find(this.context.cwd, this.context.plugins)
    const { project, workspace } = await Project.find(configuration, this.context.cwd)

    await project.restoreInstallState()

    const selectedWorkspaces = selectWorkspaces(
      project,
      workspace,
      this.allWorkspaces,
      this.workspaces,
    )
    const seedWorkspaces = this.includeRootDeps
      ? dedupeWorkspaces([...selectedWorkspaces, project.topLevelWorkspace])
      : selectedWorkspaces

    const entries = await collectDisclaimerEntries({
      configuration,
      project,
      workspaces: seedWorkspaces,
      includeDev: this.includeDev,
      recursiveWorkspaces: this.recursiveWorkspaces,
      recursiveNpm: this.recursiveNpm,
    })

    const output = renderDisclaimerReport(entries)

    if (this.output) {
      const outputPath = resolveOutputPath(this.context.cwd, this.output)
      await xfs.mkdirPromise(ppath.dirname(outputPath), { recursive: true })
      await xfs.writeFilePromise(outputPath, output)
    } else {
      this.context.stdout.write(output)
    }

    return 0
  }
}

function selectWorkspaces(
  project: Project,
  currentWorkspace: Workspace | null,
  allWorkspaces: boolean,
  workspaceInputs: Array<string> | undefined,
): Array<Workspace> {
  const requestedWorkspaces = workspaceInputs ?? []

  if (allWorkspaces) {
    return project.workspaces
  }

  if (requestedWorkspaces.length > 0) {
    return requestedWorkspaces.map((workspaceName) => {
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
