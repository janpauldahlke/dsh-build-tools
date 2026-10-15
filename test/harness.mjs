/**
 * dsh-build-tools/test — zero-dependency test harness for dsh plugins.
 *
 * Runs under plain `node --test`. No jest, no vitest, no config: node --test
 * already provides the runner, assertions, and mocks with zero dependencies.
 * This file adds a describe/it surface and an optional evidence log for
 * unattended runs.
 *
 * The file is ~150 lines by design. Copying it into a plugin repo
 * (scripts/test/harness.mjs) is the suggested default — no dependency, and the
 * repo owns its test stack. The subpath import exists for repos that prefer
 * pulling fixes from one upstream:
 *
 *   import { describe, it, assertEqual } from 'dsh-build-tools/test'
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** @typedef {{ name: string, fn: () => void | Promise<void> }} Case */
/** @typedef {{ name: string, cases: Case[] }} Suite */

/** @type {Suite[]} */
const suites = []
/** @type {Suite | null} */
let current = null

/**
 * Register a suite. Synchronous body; `it()` calls inside attach to it.
 * @param {string} name
 * @param {() => void} fn
 */
export function describe(name, fn) {
  const suite = { name, cases: [] }
  suites.push(suite)
  const prev = current
  current = suite
  fn()
  current = prev
}

/**
 * Register a case in the enclosing suite. May be async.
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 */
export function it(name, fn) {
  if (!current) throw new Error(`it(${JSON.stringify(name)}) outside describe`)
  current.cases.push({ name, fn })
}

/**
 * @param {unknown} cond
 * @param {string} [msg]
 * @returns {asserts cond}
 */
export function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

/**
 * Deep-equal via JSON shape — good enough for plain
 * data; not a full structural diff).
 * @param {unknown} actual
 * @param {unknown} expected
 * @param {string} [msg]
 */
export function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    throw new Error(msg || `expected ${e}, got ${a}`)
  }
}

/**
 * @param {unknown} haystack
 * @param {string} needle
 * @param {string} [msg]
 */
export function assertIncludes(haystack, needle, msg) {
  if (!String(haystack).includes(needle)) {
    throw new Error(msg || `expected to include ${JSON.stringify(needle)}`)
  }
}

/**
 * Assert `fn` throws (sync or async). Optionally check error class and a
 * substring of the message. Returns the thrown error for further assertions.
 * @param {() => unknown | Promise<unknown>} fn
 * @param {Function} [ErrorClass]
 * @param {string} [msgIncludes]
 * @returns {Promise<unknown>}
 */
export async function assertThrows(fn, ErrorClass, msgIncludes) {
  /** @type {any} */
  let threw = null
  try {
    await fn()
  } catch (err) {
    threw = err
  }
  if (!threw) throw new Error('expected throw')
  if (ErrorClass && !(threw instanceof ErrorClass)) {
    throw new Error(`expected ${ErrorClass.name}, got ${threw?.name || threw}`)
  }
  if (msgIncludes && !String(threw.message || threw).includes(msgIncludes)) {
    throw new Error(`expected message to include ${JSON.stringify(msgIncludes)}, got ${threw.message}`)
  }
  return threw
}

/**
 * Run every registered suite. Sets `process.exitCode = 1` on failure.
 *
 * Evidence log is OPT-IN (`evidenceName`) — unlike the long-horizon original
 * which always wrote agent/evidence/: library code must not litter repos that
 * don't ask for it.
 *
 * @param {{ evidenceName?: string, evidenceDir?: string, quiet?: boolean }} [options]
 * @returns {Promise<{ passed: number, failed: number, suites: number }>}
 */
export async function runAll({ evidenceName, evidenceDir, quiet = false } = {}) {
  /** @type {string[]} */
  const log = []
  let failed = 0
  let passed = 0

  for (const suite of suites) {
    if (!quiet) console.log(`\n▸ ${suite.name}`)
    for (const c of suite.cases) {
      const label = `${suite.name} › ${c.name}`
      try {
        await c.fn()
        passed += 1
        log.push(`PASS ${label}`)
        if (!quiet) console.log(`  ✓ ${c.name}`)
      } catch (err) {
        failed += 1
        const detail = err instanceof Error ? err.stack || err.message : String(err)
        log.push(`FAIL ${label}\n${detail}`)
        if (!quiet) {
          console.error(`  ✗ ${c.name}`)
          console.error(`    ${err instanceof Error ? err.message : err}`)
        }
      }
    }
  }

  const summary = `passed=${passed} failed=${failed} suites=${suites.length}`
  log.push(summary)
  if (!quiet) console.log(`\n${summary}`)

  if (evidenceName) {
    const ev = join(process.cwd(), evidenceDir ?? 'agent/evidence')
    await mkdir(ev, { recursive: true })
    await writeFile(join(ev, evidenceName), `${log.join('\n')}\n`, 'utf8')
  }

  if (failed > 0) process.exitCode = 1
  return { passed, failed, suites: suites.length }
}
