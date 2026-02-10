import { BaseCommand } from '@yarnpkg/cli'
import { Configuration, Project, structUtils, type Workspace } from '@yarnpkg/core'
import { ppath, xfs } from '@yarnpkg/fslib'
import { Option, UsageError } from 'clipanion'

import {
  auditLicenseEntries,
  hasAuditViolations,
  parseAllowValues,
  renderLicenseAuditText,
} from '../lib/licenseAudit'
import { collectLicenseEntries, resolveOutputPath } from '../lib/licensesReport'

export class LicensesAuditCommand extends BaseCommand {
  static override paths = [[`licenses`, `audit`]]

  static override usage = {
    description: `audit third-party licenses against an allow-list`,
    details: `Audit collected third-party dependency licenses and fail when a license is not allow-listed.`,
    examples: [
      [
        `Audit all workspaces with recursive npm traversal`,
        `yarn licenses audit -A -r --allow MIT,Apache-2.0`,
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

  allow = Option.Array(`--allow`, {
    description: `allowed license type(s), repeatable or comma-separated`,
  })

  json = Option.Boolean(`--json`, false, {
    description: `emit JSON instead of text`,
  })

  output = Option.String(`-o,--output`, {
    description: `write report to file (stdout if omitted)`,
    required: false,
  })

  async execute(): Promise<number> {
    if (this.allWorkspaces && (this.workspaces?.length ?? 0) > 0) {
      throw new UsageError(`Use either --all-workspaces or --workspace, not both.`)
    }

    const allowRules = parseAllowValues(this.allow ?? [])
    if (allowRules.length === 0) {
      throw new UsageError(`At least one --allow value is required.`)
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

    const entries = await collectLicenseEntries({
      configuration,
      project,
      workspaces: seedWorkspaces,
      includeDev: this.includeDev,
      recursiveWorkspaces: this.recursiveWorkspaces,
      recursiveNpm: this.recursiveNpm,
    })

    const auditEntries = auditLicenseEntries(entries, allowRules)
    const output = this.json
      ? `${JSON.stringify(auditEntries, null, 2)}\n`
      : renderLicenseAuditText(auditEntries)

    if (this.output) {
      const outputPath = resolveOutputPath(this.context.cwd, this.output)
      await xfs.mkdirPromise(ppath.dirname(outputPath), { recursive: true })
      await xfs.writeFilePromise(outputPath, output)
    } else {
      this.context.stdout.write(output)
    }

    return hasAuditViolations(auditEntries) ? 1 : 0
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
