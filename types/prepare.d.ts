/**
 * Types for the `dsh-build-tools/prepare` subpath (src/prepare.js).
 */

/** Options for {@link prepareBuild}. */
export interface PrepareBuildOptions {
  /** Package root. Default: `process.cwd()`. */
  root?: string
  /** Build command. Default: `process.execPath` (node). */
  command?: string
  /** Command args. Default: `['build.mjs']`. */
  args?: string[]
  /**
   * On build failure, warn on stderr and resolve instead of throwing.
   * Default: false (fail loudly; the install aborts).
   */
  soft?: boolean
  /** Artifacts that must exist after a successful build (paths relative to root). */
  requireArtifacts?: string[]
  /** Label used in failure/warning messages. Default: root directory name. */
  name?: string
  /** Extra env vars for the build subprocess. */
  env?: NodeJS.ProcessEnv
}

/**
 * Run the package build as a `prepare` step. Resolves on success (or on
 * soft-mode fallback); throws otherwise — never fails silently.
 */
export declare function prepareBuild(options?: PrepareBuildOptions): Promise<void>
