/**
 * package.json surface — exports map and files list are part of the contract
 * consumers depend on. Subpaths resolve; `./package.json` is reachable because
 * dsh plugins export it and consumers read the installed version from it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))

test('exports cover the documented subpaths', () => {
  assert.deepEqual(Object.keys(pkg.exports).sort(), [
    '.',
    './package.json',
    './test',
  ])
})

test('every exported target exists on disk', async () => {
  for (const [subpath, entry] of Object.entries(pkg.exports)) {
    const target = typeof entry === 'string' ? entry : entry.default
    if (!target) continue
    await assert.doesNotReject(
      () => readFile(join(root, target), 'utf8'),
      `exports["${subpath}"] -> ${target} is missing`,
    )
  }
})

test('exports["."] and its types both resolve', () => {
  const entry = pkg.exports['.']
  assert.equal(entry.types, './types/index.d.ts')
  assert.equal(entry.default, './src/index.js')
})

test('bin entries exist on disk', async () => {
  for (const [name, target] of Object.entries(pkg.bin)) {
    await assert.doesNotReject(
      () => readFile(join(root, target), 'utf8'),
      `bin ${name} -> ${target} is missing`,
    )
  }
})

test('files includes everything the package needs to ship', () => {
  for (const needed of ['README.md', 'AGENTS.md', 'src/', 'bin/', 'types/']) {
    assert.ok(pkg.files.includes(needed), `files is missing ${needed}`)
  }
})

/**
 * A target that exists on disk but is not covered by `files` publishes a
 * broken export. `package.json` and `README.md` are always shipped by npm
 * regardless of the allowlist.
 * @param {string} target path relative to package root, with or without `./`
 */
function isShipped(target) {
  const rel = target.replace(/^\.\//, '')
  if (rel === 'package.json' || rel === 'README.md') return true
  const allowlist = /** @type {string[]} */ (pkg.files)
  return allowlist.some((entry) =>
    entry.endsWith('/') ? rel.startsWith(entry) : rel === entry,
  )
}

test('every exported target is covered by the files allowlist', () => {
  for (const [subpath, entry] of Object.entries(pkg.exports)) {
    const target = typeof entry === 'string' ? entry : entry.default
    if (!target) continue
    assert.ok(
      isShipped(target),
      `exports["${subpath}"] -> ${target} is not in files[]; it would 404 for consumers`,
    )
    if (typeof entry === 'object' && entry.types) {
      assert.ok(
        isShipped(entry.types),
        `exports["${subpath}"].types -> ${entry.types} is not in files[]`,
      )
    }
  }
})

test('every bin target is covered by the files allowlist', () => {
  for (const [name, target] of Object.entries(pkg.bin)) {
    assert.ok(
      isShipped(target),
      `bin ${name} -> ${target} is not in files[]; the command would not install`,
    )
  }
})

test('esbuild stays a peer dependency, not a runtime dependency', () => {
  assert.ok(pkg.peerDependencies?.esbuild, 'esbuild peerDependency missing')
  assert.equal(pkg.dependencies, undefined, 'package must have no runtime deps')
})
