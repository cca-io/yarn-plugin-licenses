# Yarn 4 License Report Plugin

Yarn plugin that generates a JSON list of third-party dependency licenses for Yarn 4 projects.

## Requirements

- Node >= 20.10.0
- Corepack + Yarn 4

Development baseline is Node 24 (see `.node-version`).

## Install dependencies

```bash
corepack yarn install
```

## Build plugin bundle

```bash
corepack yarn build
```

Bundle output:

`/Users/christoph/projects/cca/licenses/bundles/@yarnpkg/plugin-licenses.js`

## Import plugin in a target project

```bash
yarn plugin import /absolute/path/to/bundles/@yarnpkg/plugin-licenses.js
```

## Usage

Generate report for current workspace:

```bash
yarn licenses list
```

Generate npm-recursive report for all workspaces including dev dependencies:

```bash
yarn licenses list -A -r -d
```

Generate both workspace-recursive and npm-recursive report:

```bash
yarn licenses list -A --recursive-workspaces -r
```

Write report to file:

```bash
yarn licenses list -A -r -o licenses.json
```

Select specific workspace(s):

```bash
yarn licenses list -w @scope/app -w packages/web -r
```

## Output format

JSON array entries:

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

- Output contains third-party dependencies only (workspaces are excluded).
- Output is sorted by package name, then version, then URL for stable diffs.
- Repository URLs are normalized to stable HTTPS values.
- If `-o/--output` is omitted, JSON is printed to stdout.

## Development commands

```bash
yarn lint
yarn typecheck
yarn test
yarn build
```
