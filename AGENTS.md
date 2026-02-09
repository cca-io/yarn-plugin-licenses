# License Reporting Project Scope

## Goal
Build a robust solution for Yarn 4 projects to generate dependency license reports, replacing the missing `yarn licenses ls` behavior from Yarn 1.

## Required Output
Produce JSON shaped like:

```json
[
  {
    "name": "@emotion/react",
    "version": "11.14.0",
    "licenseType": "MIT",
    "url": "https://github.com/emotion-js/emotion#main"
  }
]
```

Notes:
- Default output is tree-style text (similar to Yarn 1 `licenses list`).
- JSON output is a JSON array of package entries when `--json` is set.
- Entries are sorted by `name` (stable ordering).
- Metadata must come from dependency package metadata.

## Functional Requirements
1. Support Yarn 4 projects, including monorepos with workspaces.
2. Support reporting scope:
   - Entire project (all workspaces), or
   - Selected workspace/package(s).
   - Report output must include only third-party dependencies (external packages).
   - Workspace packages are excluded from output entries.
3. Support dependency inclusion flags:
   - Include/exclude `devDependencies`.
   - Recursive/transitive collection toggle.
4. Handle patched dependencies correctly (Yarn patch):
   - Report correct `licenseType` and `url` for patched packages.
5. Normalize repository URLs to stable values:
   - Avoid output instability (`.git` suffix variations).
   - Convert `git+ssh` style repository URLs to equivalent `https` URLs.
6. Ensure deterministic output suitable for CI and diffs.

## Bonus Requirements
1. License policy check:
   - Validate dependencies against an allow-list of license types (e.g. MIT, Apache-2.0).
2. Vulnerability check:
   - Report known security issues/CVEs per dependency.

## Engineering Preferences
- New standalone project.
- Prefer dependency-free implementation where practical.
- Yarn plugin implementation is preferred if it improves dependency graph accuracy.

## Implementation Basis and Dependencies
- Primary implementation target: Yarn 4 plugin.
- Graph/source of truth: Yarn internals (`Project`, `Workspace`, stored resolutions/packages), not ad-hoc lockfile parsing.
- Runtime dependencies should be Yarn-native and minimal:
  - `@yarnpkg/core`
  - `@yarnpkg/cli`
  - `@yarnpkg/fslib`
  - Node.js built-ins only (no extra third-party runtime libs unless justified).
- Build-time dependency:
  - `@yarnpkg/builder` for plugin bundling/compilation.
- Dependency policy:
  - Prefer zero additional third-party runtime dependencies.
  - Any non-Yarn runtime dependency requires explicit justification (correctness or unavoidable interoperability).

## Tooling and Test Strategy
- Package manager/runtime for this project:
  - Use Corepack with Yarn 4 (project itself managed by Yarn 4).
  - The plugin must be testable against this same project ("self-test").
- Language/toolchain:
  - Use latest stable TypeScript.
  - Use Biome for formatting and linting.
- Node.js policy:
  - Development baseline: latest Node 24 (tracked via `.node-version`).
  - Supported plugin runtime: Node >=20.10.0.
  - Runtime compatibility must be validated on Node 20, 22, and 24.
- CI:
  - Use GitHub Actions.
  - Run lint, build, and tests on Node 20.x, 22.x, and 24.x.
- Plugin packaging:
  - Build/bundle with `@yarnpkg/builder`.
  - Do not minify by default (favor debuggability and stable diagnostics).
- Test framework/tooling:
  - Prefer Node.js built-in test runner (`node:test`) and `assert`.
  - Avoid third-party test dependencies unless clearly justified.
- Test layers:
  - Unit tests for pure logic (URL normalization, sorting, deterministic output, option handling).
  - Integration tests that execute the built plugin via Yarn commands in fixture projects.
- Integration fixture coverage must include:
  - single-package project
  - monorepo/workspaces
  - workspace-to-workspace dependency
  - include/exclude dev dependency behavior
  - recursive vs non-recursive traversal
  - patched dependency (`patch:`) metadata correctness
  - repository URL normalization edge cases
- Golden file approach:
  - Expected JSON outputs are checked in and compared byte-for-byte.
  - Repeat runs with same lockfile/flags must yield identical output.

## Suggested CLI Behaviors
- `-w, --workspace <name>` (repeatable): limit scope to specific workspace(s).
- `-A, --all-workspaces`: process full monorepo.
- `-d, --include-dev`: include dev dependencies.
- `--include-root-deps`: include root workspace dependencies as additional dependency seeds.
- `--recursive-workspaces`: recursively traverse workspace-to-workspace dependency edges.
- `-r, --recursive-npm`: recursively traverse npm dependency graph.
- `--json`: emit JSON output (default is text output).
- `-o, --output <file>`: write report output to file (otherwise print to stdout).
- `--check-licenses <allowlist-file|csv>`: enforce license allow-list.
- `--check-vulns`: enable vulnerability/CVE checks.

## Acceptance Criteria
1. Same lockfile and same flags produce byte-stable output.
2. Patched packages report correct license and normalized URL.
3. Workspace filtering and recursion flags behave as documented.
4. Output ordering is deterministic and sorted by package name.
5. CI-friendly exit codes:
   - `0` for success/compliant checks.
   - non-zero when checks fail or generation errors occur.
