import { BaseCommand } from '@yarnpkg/cli'
import { Configuration, Project } from '@yarnpkg/core'
import { ppath, xfs } from '@yarnpkg/fslib'
import { Option, UsageError } from 'clipanion'

import {
  auditLicenseEntries,
  getAuditViolations,
  hasAuditViolations,
  parseAllowValues,
  renderLicenseAuditText,
} from '../lib/licenseAudit'
import { collectLicenseEntries, resolveOutputPath } from '../lib/licensesReport'
import { dedupeWorkspaces, selectWorkspacesFromOptions } from '../lib/workspaces'

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

    const selectedWorkspaces = selectWorkspacesFromOptions({
      project,
      currentWorkspace: workspace,
      allWorkspaces: this.allWorkspaces,
      workspaceInputs: this.workspaces,
    })
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
    const violationEntries = getAuditViolations(auditEntries)
    const output = this.json
      ? `${JSON.stringify(violationEntries, null, 2)}\n`
      : renderLicenseAuditText(violationEntries)

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
