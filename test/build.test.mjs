/**
 * buildDshPlugin — option plumbing verified with an injected mock esbuild
 * (no real bundling), so defaults/quirks are pinned independently of any
 * esbuild version.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDshPlugin } from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const mini = join(here, 'fixtures/mini-plugin')
const stub = join(here, 'fixtures/stub-plugin')

/** Capturing mock: records every esbuild.build options object. */
function mockEsbuild() {
  /** @type {Record<string, any>[]} */
  const calls = []
  return {
    calls,
    /** @param {Record<string, any>} opts */
    build: async (opts) => {
      calls.push(opts)
      return {}
    },
  }
}

test('defaults reproduce the standard dual-face layout', async () => {
  const esbuild = mockEsbuild()
  const result = await buildDshPlugin({ root: mini, esbuild, log: 'test' })

  assert.equal(result.id, 'mini-plugin')
  assert.deepEqual(result.artifacts, ['index.js', 'client.js'])
  assert.equal(esbuild.calls.length, 2)

  const host = esbuild.calls[0]
  assert.equal(host.format, 'esm')
  assert.equal(host.platform, 'node')
  assert.equal(host.target, 'es2024')
  assert.deepEqual(host.external, ['@deepseek-ai/*'])
  assert.equal(host.entryPoints[0], join(mini, 'src/host/index.ts'))
  assert.equal(host.outfile, join(result.outDir, 'index.js'))

  const client = esbuild.calls[1]
  assert.equal(client.format, 'cjs')
  assert.equal(client.platform, 'browser')
  assert.equal(client.target, 'es2022')
  assert.equal(client.jsx, 'automatic') // .tsx entry
  assert.deepEqual(client.define, { 'process.env.NODE_ENV': '"production"' })
  assert.equal(client.external[client.external.length - 1], '@deepseek-ai/*')
  assert.ok(client.banner.js.startsWith('window.__ModuleLoader__.load({ id: "mini-plugin"'))
  assert.equal(client.footer.js, 'return module.exports; } });')
})

test('modules[] build between host and client, fully bundled by default', async () => {
  const esbuild = mockEsbuild()
  await buildDshPlugin({
    root: mini,
    esbuild,
    log: 'test',
    modules: [{ entry: 'src/host/pure.ts', out: 'pure.mjs' }],
  })

  assert.equal(esbuild.calls.length, 3)
  const mod = esbuild.calls[1]
  assert.equal(mod.format, 'esm')
  assert.equal(mod.platform, 'node')
  assert.equal(mod.external, undefined) // no externals → pure bundle
  assert.equal(mod.outfile.endsWith('pure.mjs'), true)
})

test('per-face escape hatches: externals, loader, define, esbuildOverrides', async () => {
  const esbuild = mockEsbuild()
  await buildDshPlugin({
    root: mini,
    esbuild,
    log: 'test',
    host: { externals: ['node-nvml', '@deepseek-ai/*'], loader: { '.md': 'text' } },
    client: { externals: ['react'], guard: true, esbuildOverrides: { minify: true } },
    define: { 'process.env.DSH_TEST': '"1"' },
  })

  const host = esbuild.calls[0]
  assert.deepEqual(host.external, ['node-nvml', '@deepseek-ai/*'])
  assert.deepEqual(host.loader, { '.md': 'text' })

  const client = esbuild.calls[1]
  assert.deepEqual(client.external, ['react'])
  assert.equal(client.minify, true)
  assert.ok(client.banner.js.includes("typeof window !== 'undefined'"))
  assert.deepEqual(client.define, {
    'process.env.NODE_ENV': '"production"',
    'process.env.DSH_TEST': '"1"',
  })
})

test('client:false / host:false build only the remaining face', async () => {
  const esbuild = mockEsbuild()
  const clientOnly = await buildDshPlugin({ root: mini, esbuild, log: 'test', host: false })
  assert.deepEqual(clientOnly.artifacts, ['client.js'])

  const hostOnly = await buildDshPlugin({ root: mini, esbuild, log: 'test', client: false })
  assert.deepEqual(hostOnly.artifacts, ['index.js'])
})

test('both faces disabled throws', async () => {
  const esbuild = mockEsbuild()
  await assert.rejects(
    () => buildDshPlugin({ root: mini, esbuild, log: 'test', host: false, client: false }),
    /nothing to build/,
  )
})

test('stub client entry (.ts, no JSX) is auto-detected and gets no jsx flag', async () => {
  const esbuild = mockEsbuild()
  const result = await buildDshPlugin({ root: stub, esbuild, log: 'test', host: false })
  assert.deepEqual(result.artifacts, ['client.js'])
  const client = esbuild.calls[0]
  assert.equal(client.entryPoints[0], join(stub, 'src/client/index.ts'))
  assert.equal(client.jsx, undefined)
})

test('missing package.json / missing id throws with a useful message', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bt-'))
  try {
    await assert.rejects(() => buildDshPlugin({ root: dir, esbuild: mockEsbuild() }), /cannot read package\.json/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('esbuild failures propagate (fail loudly, never swallow)', async () => {
  const boom = {
    build: async () => {
      throw new Error('esbuild exploded')
    },
  }
  await assert.rejects(() => buildDshPlugin({ root: mini, esbuild: boom, log: 'test' }), /esbuild exploded/)
})

test('modules entry without { entry, out } throws TypeError', async () => {
  const esbuild = mockEsbuild()
  await assert.rejects(
    // @ts-expect-error deliberate misuse
    () => buildDshPlugin({ root: mini, esbuild, log: 'test', modules: [{ entry: 'src/host/pure.ts' }] }),
    TypeError,
  )
})
