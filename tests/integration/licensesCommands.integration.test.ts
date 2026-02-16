import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'

type RunResult = {
  code: number
  stdout: string
  stderr: string
}

const rootDir = resolve(__dirname, '../../..')
const bundlePath = join(rootDir, 'bundles', '@yarnpkg', 'plugin-licenses.js')

test('licenses list supports recursion modes and include flags', async () => {
  const fixture = createFixtureProject()
  try {
    installFixture(fixture)
    importPlugin(fixture)

    const none = runYarn(fixture, ['licenses', 'list', '-w', 'app-web', '--json'], {
      expectSuccess: true,
    })
    assert.deepEqual(getNamesFromJson(none.stdout), ['ext-web'])

    const workspaceOnly = runYarn(
      fixture,
      ['licenses', 'list', '-w', 'app-web', '--recursive-workspaces', '--json'],
      { expectSuccess: true },
    )
    assert.deepEqual(getNamesFromJson(workspaceOnly.stdout), ['ext-shared', 'ext-web'])

    const npmOnly = runYarn(fixture, ['licenses', 'list', '-w', 'app-web', '-r', '--json'], {
      expectSuccess: true,
    })
    assert.deepEqual(getNamesFromJson(npmOnly.stdout), ['ext-transitive', 'ext-web'])

    const both = runYarn(
      fixture,
      ['licenses', 'list', '-w', 'app-web', '--recursive-workspaces', '-r', '--json'],
      { expectSuccess: true },
    )
    assert.deepEqual(getNamesFromJson(both.stdout), ['ext-shared', 'ext-transitive', 'ext-web'])

    const includeRoot = runYarn(
      fixture,
      ['licenses', 'list', '-w', 'app-web', '--include-root-deps', '--json'],
      { expectSuccess: true },
    )
    assert.deepEqual(getNamesFromJson(includeRoot.stdout), ['ext-root', 'ext-web'])

    const includeDev = runYarn(fixture, ['licenses', 'list', '-w', 'app-web', '-d', '--json'], {
      expectSuccess: true,
    })
    assert.deepEqual(getNamesFromJson(includeDev.stdout), ['ext-dev', 'ext-web'])
  } finally {
    cleanupFixture(fixture)
  }
})

test('licenses generate-disclaimer reads LICENSE/NOTICE and fallback message', async () => {
  const fixture = createFixtureProject()
  try {
    installFixture(fixture)
    importPlugin(fixture)

    const result = runYarn(
      fixture,
      ['licenses', 'generate-disclaimer', '-w', 'app-mobile', '--recursive-workspaces'],
      {
        expectSuccess: true,
      },
    )

    assert.match(result.stdout, /EXT NOTICE TEXT/) // ext-mobile has NOTICE file
    assert.match(result.stdout, /EXT LICENSE TEXT/) // ext-shared has LICENSE file
    assert.match(result.stdout, /License text was not found in the package distribution\./) // ext-none
  } finally {
    cleanupFixture(fixture)
  }
})

test('licenses audit outputs violations only and exits non-zero on mismatch', async () => {
  const fixture = createFixtureProject()
  try {
    installFixture(fixture)
    importPlugin(fixture)

    const strictFail = runYarn(
      fixture,
      ['licenses', 'audit', '-w', 'app-web', '-r', '--allow', 'MIT'],
      { expectSuccess: false },
    )
    assert.equal(strictFail.code, 1)
    assert.match(strictFail.stdout, /VIOLATION ext-transitive@1.0.0/)
    assert.doesNotMatch(strictFail.stdout, /ALLOWED/) // violations only

    const jsonOk = runYarn(
      fixture,
      ['licenses', 'audit', '-w', 'app-web', '-r', '--allow', 'MIT,Apache-2.0', '--json'],
      { expectSuccess: true },
    )
    const parsed = JSON.parse(jsonOk.stdout) as Array<{ status: string }>
    assert.deepEqual(parsed, []) // no violations -> empty output
  } finally {
    cleanupFixture(fixture)
  }
})

test('patched dependency metadata is respected and homepage is preferred', async () => {
  const fixture = createFixtureProject()
  try {
    installFixture(fixture)
    importPlugin(fixture)

    const result = runYarn(fixture, ['licenses', 'list', '-w', 'app-patch', '--json'], {
      expectSuccess: true,
    })

    const entry = (JSON.parse(result.stdout) as Array<{ name: string; url: string }>).find(
      (item) => item.name === 'ext-patched',
    )

    assert.ok(entry)
    assert.equal(entry.url, 'https://github.com/owner/repo#readme')
  } finally {
    cleanupFixture(fixture)
  }
})

test('recursive npm traversal completes quickly on warm cache for fixture', async () => {
  const fixture = createFixtureProject()
  try {
    installFixture(fixture)
    importPlugin(fixture)

    runYarn(fixture, ['licenses', 'list', '-A', '-r', '--json'], { expectSuccess: true }) // warm-up

    const start = Date.now()
    runYarn(fixture, ['licenses', 'list', '-A', '-r', '--json'], { expectSuccess: true })
    const elapsedMs = Date.now() - start

    // Guard against pathological regressions/loops; threshold intentionally generous.
    assert.ok(elapsedMs < 15000, `expected warm recursive run < 15s, got ${elapsedMs}ms`)
  } finally {
    cleanupFixture(fixture)
  }
})

function createFixtureProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'licenses-fixture-'))
  const externalSpecs = createExternalPackages(dir)

  writeJson(join(dir, 'package.json'), {
    name: 'fixture-root',
    private: true,
    packageManager: 'yarn@4.12.0',
    workspaces: ['packages/*'],
    dependencies: {
      'ext-root': externalSpecs['ext-root'],
    },
  })

  writeFileSync(
    join(dir, '.yarnrc.yml'),
    ['enableGlobalCache: false', 'cacheFolder: ./.yarn/cache'].join('\n'),
  )

  createWorkspacePackages(dir, externalSpecs)
  createPatchFile(dir)

  return dir
}

function createExternalPackages(root: string): Record<string, string> {
  const registryRoot = join(root, 'registry')
  mkdirSync(registryRoot, { recursive: true })

  const extRootTgz = createTarballPackage(registryRoot, 'ext-root', {
    name: 'ext-root',
    version: '1.0.0',
    license: 'MIT',
    homepage: 'https://github.com/acme/ext-root#readme',
  })

  const extDevTgz = createTarballPackage(registryRoot, 'ext-dev', {
    name: 'ext-dev',
    version: '1.0.0',
    license: 'MIT',
    repository: 'github:acme/ext-dev',
  })

  const extTransitiveTgz = createTarballPackage(registryRoot, 'ext-transitive', {
    name: 'ext-transitive',
    version: '1.0.0',
    license: 'Apache-2.0',
    repository: 'acme/ext-transitive',
  })

  const extWebTgz = createTarballPackage(
    registryRoot,
    'ext-web',
    {
      name: 'ext-web',
      version: '1.0.0',
      license: 'MIT',
      dependencies: {
        'ext-transitive': fileDep(extTransitiveTgz),
      },
      repository: {
        type: 'git',
        url: 'git+ssh://git@github.com/acme/ext-web.git',
      },
    },
    {
      NOTICE: 'EXT NOTICE TEXT',
    },
  )

  const extSharedTgz = createTarballPackage(
    registryRoot,
    'ext-shared',
    {
      name: 'ext-shared',
      version: '1.0.0',
      license: 'MIT',
      homepage: 'https://github.com/acme/ext-shared',
    },
    {
      LICENSE: 'EXT LICENSE TEXT',
    },
  )

  const extNoneTgz = createTarballPackage(registryRoot, 'ext-none', {
    name: 'ext-none',
    version: '1.0.0',
    license: 'MIT',
    homepage: 'https://github.com/acme/ext-none',
  })

  const extMobileTgz = createTarballPackage(
    registryRoot,
    'ext-mobile',
    {
      name: 'ext-mobile',
      version: '1.0.0',
      license: 'MIT',
      homepage: 'https://github.com/acme/ext-mobile',
      dependencies: {
        'ext-none': fileDep(extNoneTgz),
      },
    },
    {
      NOTICE: 'EXT NOTICE TEXT',
    },
  )

  const extPatchedTgz = createTarballPackage(registryRoot, 'ext-patched', {
    name: 'ext-patched',
    version: '1.0.0',
    license: 'MIT',
    repository: 'owner/repo.git',
    homepage: 'https://example.com/original',
  })

  return {
    'ext-root': fileDep(extRootTgz),
    'ext-dev': fileDep(extDevTgz),
    'ext-transitive': fileDep(extTransitiveTgz),
    'ext-web': fileDep(extWebTgz),
    'ext-shared': fileDep(extSharedTgz),
    'ext-mobile': fileDep(extMobileTgz),
    'ext-none': fileDep(extNoneTgz),
    'ext-patched': fileDep(extPatchedTgz),
  }
}

function createWorkspacePackages(root: string, externalSpecs: Record<string, string>): void {
  createPackage(join(root, 'packages', 'app-shared'), {
    name: 'app-shared',
    version: '1.0.0',
    private: true,
    dependencies: {
      'ext-shared': externalSpecs['ext-shared'],
    },
  })

  createPackage(join(root, 'packages', 'app-web'), {
    name: 'app-web',
    version: '1.0.0',
    private: true,
    dependencies: {
      'app-shared': 'workspace:*',
      'ext-web': externalSpecs['ext-web'],
    },
    devDependencies: {
      'ext-dev': externalSpecs['ext-dev'],
    },
  })

  createPackage(join(root, 'packages', 'app-mobile'), {
    name: 'app-mobile',
    version: '1.0.0',
    private: true,
    dependencies: {
      'ext-mobile': externalSpecs['ext-mobile'],
      'ext-none': externalSpecs['ext-none'],
      'app-shared': 'workspace:*',
    },
  })

  createPackage(join(root, 'packages', 'app-patch'), {
    name: 'app-patch',
    version: '1.0.0',
    private: true,
    dependencies: {
      'ext-patched': `patch:ext-patched@${externalSpecs['ext-patched']}#${join(root, 'patches', 'ext-patched.patch')}`,
    },
  })
}

function createPatchFile(root: string): void {
  mkdirSync(join(root, 'patches'), { recursive: true })
  const tempDir = mkdtempSync(join(root, 'patch-tmp-'))
  const originalPath = join(tempDir, 'original-package.json')
  const modifiedPath = join(tempDir, 'modified-package.json')

  writeJson(originalPath, {
    name: 'ext-patched',
    version: '1.0.0',
    license: 'MIT',
    repository: 'owner/repo.git',
    homepage: 'https://example.com/original',
  })

  writeJson(modifiedPath, {
    name: 'ext-patched',
    version: '1.0.0',
    license: 'MIT',
    repository: 'git+ssh://git@github.com/owner/repo.git',
    homepage: 'https://github.com/owner/repo#readme',
  })

  const diff = spawnSync('diff', ['-u', originalPath, modifiedPath], { encoding: 'utf8' })
  const rawDiff = diff.stdout ?? ''
  const hunkLines = rawDiff
    .split('\n')
    .filter(
      (line) =>
        line.startsWith('@@') ||
        line.startsWith(' ') ||
        line.startsWith('+') ||
        line.startsWith('-'),
    )
    .filter((line) => !line.startsWith('--- ') && !line.startsWith('+++ '))

  const patchContent = [
    'diff --git a/package.json b/package.json',
    '--- a/package.json',
    '+++ b/package.json',
    ...hunkLines,
    '',
  ].join('\n')

  writeFileSync(join(root, 'patches', 'ext-patched.patch'), patchContent)
  rmSync(tempDir, { recursive: true, force: true })
}

function installFixture(cwd: string): void {
  // Fixtures are generated on the fly and start without a lockfile.
  // CI enables immutable installs by default, so allow lockfile creation here.
  const installResult = runYarn(cwd, ['install', '--mode=skip-build', '--no-immutable'], {
    expectSuccess: true,
  })
  assert.equal(installResult.code, 0)
}

function importPlugin(cwd: string): void {
  const result = runYarn(cwd, ['plugin', 'import', bundlePath], { expectSuccess: true })
  assert.equal(result.code, 0)
}

function cleanupFixture(dir: string): void {
  rmSync(dir, { recursive: true, force: true })
}

function createPackage(
  dir: string,
  manifest: Record<string, unknown>,
  files?: Record<string, string>,
): void {
  mkdirSync(dir, { recursive: true })
  writeJson(join(dir, 'package.json'), manifest)

  for (const [name, content] of Object.entries(files ?? {})) {
    writeFileSync(join(dir, name), content)
  }
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function fileDep(path: string): string {
  return `file:${path}`
}

function createTarballPackage(
  registryRoot: string,
  name: string,
  manifest: Record<string, unknown> & { version?: string | number },
  files?: Record<string, string>,
): string {
  const packageTempRoot = mkdtempSync(join(registryRoot, `${name}-src-`))
  const packageDir = join(packageTempRoot, 'package')
  createPackage(packageDir, manifest, files)

  const version = manifest.version
  const tgzPath = join(registryRoot, `${name}-${String(version ?? '1.0.0')}.tgz`)
  const packed = spawnSync('tar', ['-czf', tgzPath, '-C', packageTempRoot, 'package'], {
    encoding: 'utf8',
  })
  if ((packed.status ?? 1) !== 0) {
    throw new Error(`Failed to create tarball for ${name}: ${packed.stderr ?? ''}`)
  }

  rmSync(packageTempRoot, { recursive: true, force: true })
  return tgzPath
}

function runYarn(cwd: string, args: Array<string>, options: { expectSuccess: boolean }): RunResult {
  const result = spawnSync('corepack', ['yarn', ...args], {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      YARN_ENABLE_GLOBAL_CACHE: '0',
      YARN_CACHE_FOLDER: join(cwd, '.yarn', 'cache'),
    },
  })

  const code = result.status ?? 1
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''

  if (options.expectSuccess && code !== 0) {
    throw new Error(
      `Command failed: yarn ${args.join(' ')}\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    )
  }

  return { code, stdout, stderr }
}

function getNamesFromJson(json: string): Array<string> {
  const parsed = JSON.parse(json) as Array<{ name: string }>
  return parsed.map((entry) => entry.name).sort((left, right) => left.localeCompare(right))
}
