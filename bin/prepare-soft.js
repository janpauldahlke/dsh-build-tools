#!/usr/bin/env node
/**
 * dsh-prepare-soft — opt-in soft prepare fallback.
 *
 * Usage (package.json):
 *   "prepare": "node build.mjs || dsh-prepare-soft"
 *
 * Verifies prebuilt artifacts exist (default: lib/index.js, lib/client.js;
 * override via argv), warns on stderr, exits 0. Exits 1 when artifacts are
 * missing — there is nothing to fall back to.
 */
import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(process.cwd())
const required = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ['lib/index.js', 'lib/client.js']

let missing = 0
for (const artifact of required) {
  try {
    await access(join(root, artifact))
  } catch {
    missing += 1
    console.error(`[dsh-prepare-soft] MISSING prebuilt artifact: ${artifact}`)
  }
}

if (missing > 0) {
  console.error(`[dsh-prepare-soft] ${missing} artifact(s) missing — nothing to fall back to. Fix the build.`)
  process.exit(1)
}

console.warn(
  '[dsh-prepare-soft] build failed; falling back to prebuilt lib/ (opt-in soft prepare). ' +
    'Artifacts may be stale — verify lib/ matches src/ before trusting this install.',
)
