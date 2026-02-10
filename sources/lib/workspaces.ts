import { type Project, structUtils, type Workspace } from '@yarnpkg/core'
import { UsageError } from 'clipanion'

export function selectWorkspacesFromOptions({
  project,
  currentWorkspace,
  allWorkspaces,
  workspaceInputs,
}: {
  project: Project
  currentWorkspace: Workspace | null
  allWorkspaces: boolean
  workspaceInputs: Array<string> | undefined
}): Array<Workspace> {
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

export function dedupeWorkspaces(workspaces: Array<Workspace>): Array<Workspace> {
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

export function matchesWorkspace(workspace: Workspace, input: string): boolean {
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
