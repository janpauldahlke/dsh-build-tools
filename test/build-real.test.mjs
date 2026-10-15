/**
 * buildDshPlugin with REAL esbuild — smoke-level proof the emitted artifacts
 * have the contract shape (banner/footer/intro bytes around real bundle code).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildDshPlugin } from '../src/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const mini = join(here, 'fixtures/mini-plugin')

test('real esbuild run emits contract-shaped artifacts', async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), 'dsh-bt-out-'))
  t.after(() => rm(outDir, { recursive: true, force: true }))

  const result = await buildDshPlugin({
    root: mini,
    outDir,
    log: 'test',
    modules: [{ entry: 'src/host/pure.ts', out: 'pure.mjs' }],
  })
  assert.deepEqual(result.artifacts, ['index.js', 'pure.mjs', 'client.js'])

  const client = await readFile(join(outDir, 'client.js'), 'utf8')
  assert.ok(client.startsWith('window.__ModuleLoader__.load({ id: "mini-plugin", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;\n'), client.slice(0, 200))
  assert.ok(client.includes('return module.exports; } });'), 'footer missing')
  assert.ok(client.includes('mini-plugin-client'), 'client marker not bundled')
  // externals stay require() calls in the CJS factory
  assert.ok(client.includes('require("react")'), 'react should stay external')

  const host = await readFile(join(outDir, 'index.js'), 'utf8')
  assert.ok(host.includes('mini-plugin-host'))
  assert.ok(host.includes('@deepseek-ai/cordis'), 'cordis stays external in host ESM')

  const pure = await readFile(join(outDir, 'pure.mjs'), 'utf8')
  assert.ok(pure.includes('mini-plugin-pure'))
  assert.ok(!pure.includes('@deepseek-ai'), 'testable module must be harness-free')
})
