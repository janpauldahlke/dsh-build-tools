#!/usr/bin/env node
/**
 * dsh-verify-plugin — artifact equivalence gate for plugin migrations.
 *
 * Builds a plugin with buildDshPlugin into a temp dir and byte-diffs every
 * artifact against the committed lib/ baseline. JS must match exactly;
 * .map files pass when mappings/names match (esbuild rewrites source paths
 * relative to the output dir, which differs in temp builds).
 *
 * Usage:
 *   dsh-verify-plugin <plugin-root> <config.mjs>
 *
 * <config.mjs> default-exports the BuildDshPluginOptions for that plugin.
 *
 * Exit 0 = identical. Non-zero = drift; do not publish until understood.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildDshPlugin } from '../src/index.js'

const [rootArg, configArg] = process.argv.slice(2)
if (!rootArg || !configArg) {
  console.error('usage: dsh-verify-plugin <plugin-root> <config.mjs>')
  process.exit(2)
}

const root = resolve(rootArg)
const config = (await import(pathToFileURL(resolve(configArg)).href)).default

const baselineDir = join(root, 'lib')
const tmp = await mkdtemp(join(tmpdir(), 'dsh-verify-'))

let drift = 0
try {
  const result = await buildDshPlugin({ ...config, root, outDir: tmp, log: 'dsh-verify-plugin' })

  for (const artifact of result.artifacts) {
    const candidatePath = join(tmp, artifact)
    const baselinePath = join(baselineDir, artifact)

    /** @type {Buffer} */
    let candidate
    /** @type {Buffer} */
    let baseline
    try {
      ;[candidate, baseline] = await Promise.all([readFile(candidatePath), readFile(baselinePath)])
    } catch (err) {
      console.error(`✗ ${artifact}: cannot compare (${/** @type {Error} */ (err).message})`)
      drift += 1
      continue
    }

    if (candidate.equals(baseline)) {
      console.log(`✓ ${artifact}: byte-identical`)
      continue
    }

    if (artifact.endsWith('.map')) {
      const c = JSON.parse(candidate.toString('utf8'))
      const b = JSON.parse(baseline.toString('utf8'))
      if (c.mappings === b.mappings && JSON.stringify(c.names) === JSON.stringify(b.names)) {
        console.log(`~ ${artifact}: mappings/names identical (source paths differ — temp outDir, expected)`)
        continue
      }
    }

    console.error(`✗ ${artifact}: DRIFT (candidate ${candidate.length}B vs baseline ${baseline.length}B)`)
    console.error(`  candidate: ${candidatePath}`)
    console.error(`  baseline:  ${baselinePath}`)
    drift += 1
  }
} finally {
  await rm(tmp, { recursive: true, force: true })
}

if (drift > 0) {
  console.error(`\n${drift} artifact(s) drifted — DO NOT PUBLISH until understood.`)
  process.exit(1)
}
console.log('\nALL ARTIFACTS MATCH — safe to publish.')
