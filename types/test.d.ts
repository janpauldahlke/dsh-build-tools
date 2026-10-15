/**
 * Types for the `dsh-build-tools/test` subpath (test/harness.mjs).
 *
 * HONEST NOTE: the harness is ~120 lines by design. Copying it into your
 * repo's scripts/test/ is the suggested default; importing the subpath is for
 * repos that want one upstream to pull fixes from. See README "Testing".
 */

/** Register a suite; `it()` calls inside the synchronous body attach to it. */
export declare function describe(name: string, fn: () => void): void

/** Register a (possibly async) case in the enclosing suite. */
export declare function it(name: string, fn: () => void | Promise<void>): void

/** Truthiness assertion. */
export declare function assert(cond: unknown, msg?: string): asserts cond

/** Deep-equal via JSON shape (plain data; not a full structural diff). */
export declare function assertEqual(actual: unknown, expected: unknown, msg?: string): void

/** Substring containment on the stringified haystack. */
export declare function assertIncludes(haystack: unknown, needle: string, msg?: string): void

/** Assert fn throws (sync/async); optionally check class + message substring. Returns the error. */
export declare function assertThrows(
  fn: () => unknown | Promise<unknown>,
  ErrorClass?: Function,
  msgIncludes?: string,
): Promise<unknown>

/** Run all registered suites; sets process.exitCode=1 on failure. Evidence log is opt-in. */
export declare function runAll(options?: {
  /** Write PASS/FAIL log to `<cwd>/<evidenceDir>/<evidenceName>` (unattended runs). */
  evidenceName?: string
  /** Defaults to `'agent/evidence'`. */
  evidenceDir?: string
  /** Suppress per-case console output. */
  quiet?: boolean
}): Promise<{ passed: number; failed: number; suites: number }>
