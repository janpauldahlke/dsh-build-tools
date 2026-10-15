/**
 * `prepare`-script policy.
 *
 * Default: fail loudly — a broken build must not silently ship a stale lib/.
 * Opt-in (`soft: true`): warn on stderr, verify prebuilt artifacts exist,
 * then resolve, for repos that intentionally track prebuilt lib/.
 */
import { spawnSync } from 'node:child_process'
import { access } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/**
 * Run the package build as a `prepare` step.
 *
 * @param {import('../types/prepare.js').PrepareBuildOptions} [options]
 * @returns {Promise<void>}
 */
export async function prepareBuild(options = {}) {
  const root = resolve(options.root ?? process.cwd())
  const command = options.command ?? process.execPath
  const args = options.args ?? ['build.mjs']
  const soft = options.soft === true
  const name = options.name ?? basenameOf(root)

  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...(options.env ?? {}) },
  })

  if (result.status === 0) {
    for (const artifact of options.requireArtifacts ?? []) {
      try {
        await access(join(root, artifact))
      } catch {
        fail(name, soft, `build exited 0 but ${artifact} is missing`)
      }
    }
    return
  }

  const why = result.error
    ? `spawn failed: ${result.error.message}`
    : `exit code ${result.status ?? 'unknown'}${result.signal ? ` (signal ${result.signal})` : ''}`
  fail(name, soft, why)
}

/**
 * @param {string} name
 * @param {boolean} soft
 * @param {string} why
 * @returns {void}
 */
function fail(name, soft, why) {
  const msg = `[${name}] prepare: build failed (${why})`
  if (!soft) {
    throw new Error(`${msg}. Refusing to continue with stale artifacts — fix the build or remove the prepare hook.`)
  }
  console.warn(`${msg}; falling back to prebuilt lib/ (soft prepare, opt-in). Verify lib/ matches src/ before trusting this install.`)
}

/** @param {string} p */
function basenameOf(p) {
  const parts = p.split(/[\\/]/)
  return parts[parts.length - 1] || p
}
