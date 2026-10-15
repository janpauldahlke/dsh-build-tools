/**
 * Public API types for dsh-build-tools. Runtime source is plain ESM JS
 * (src/index.js); these hand-written declarations are the typed surface.
 */
import type { Loader } from 'esbuild'

/** Frozen client module-table baseline — the only runtime requests a client bundle may make. */
export declare const PLATFORM_EXTERNALS: readonly string[]

/** Host-half default externals (`['@deepseek-ai/*']`). */
export declare const DEFAULT_HOST_EXTERNALS: readonly string[]

/** Client-half default externals (PLATFORM_EXTERNALS + `'@deepseek-ai/*'`). */
export declare const DEFAULT_CLIENT_EXTERNALS: readonly string[]

/** esbuild loader map, e.g. `{ '.md': 'text' }`. */
export type LoaderMap = Record<string, Loader>

/** Generate the `window.__ModuleLoader__` registration banner/footer for a client bundle. */
export declare function moduleLoaderWrap(
  id: string,
  options?: { guard?: boolean },
): { banner: { js: string }; footer: { js: string } }

/** Options for {@link buildDshPlugin}. All optional except a resolvable plugin id. */
export interface BuildDshPluginOptions {
  /** Package root. Default: `process.cwd()`. */
  root?: string
  /** Plugin id stamped into the ModuleLoader handoff. Default: package.json "name". */
  id?: string
  /** Output directory, relative to root. Default: `'lib'`. */
  outDir?: string

  /** Host half (ESM, node). `false` disables it. */
  host?:
    | false
    | {
        /** Default: `'src/host/index.ts'`. */
        entry?: string
        /** Output file name inside outDir. Default: `'index.js'`. */
        out?: string
        /** Default: `['@deepseek-ai/*']`. */
        externals?: string[]
        loader?: LoaderMap
        /** Raw esbuild overrides; win over the fields above. */
        esbuildOverrides?: Record<string, unknown>
      }

  /**
   * Standalone modules built without harness externals, for direct import
   * from `node --test`. Built between host and client halves.
   */
  modules?: Array<{
    /** Entry, relative to root. Required. */
    entry: string
    /** Output file name inside outDir, e.g. `'vault.mjs'`. Required. */
    out: string
    externals?: string[]
    loader?: LoaderMap
    esbuildOverrides?: Record<string, unknown>
  }>

  /** Client half (CJS ModuleLoader factory). `false` disables it. */
  client?:
    | false
    | {
        /**
         * Default: `src/client/index.tsx`, fallback `src/client/index.ts`.
         * `.tsx` entries get `jsx: 'automatic'`.
         */
        entry?: string
        /** Default: `'client.js'`. */
        out?: string
        /** Default: PLATFORM_EXTERNALS + `'@deepseek-ai/*'`. */
        externals?: string[]
        /**
         * Wrap registration in a presence check + try/catch. Off by default:
         * emitted bytes must match the harness contract until this is
         * deliberately enabled.
         */
        guard?: boolean
        esbuildOverrides?: Record<string, unknown>
      }

  /** Extra esbuild `define` entries merged into the client build's NODE_ENV define. */
  define?: Record<string, string>
  /** Default: `true`. */
  sourcemap?: boolean
  /** Label for the summary log line. Default: plugin id. */
  log?: string
  /** Injectable esbuild module. Default: `await import('esbuild')` (peer dependency). */
  esbuild?: { build: (options: any) => Promise<any> }
}

/** Result of a successful {@link buildDshPlugin} call. */
export interface BuildDshPluginResult {
  id: string
  root: string
  outDir: string
  /** Output file names inside outDir, in build order. */
  artifacts: string[]
}

/**
 * Build one dual-face dsh plugin: host ESM + client `__ModuleLoader__` CJS,
 * plus optional standalone modules. Byte-identical to the hand-written
 * build.mjs files it replaces, with default options.
 *
 * Throws TypeError on malformed options; Error when package.json, plugin id,
 * or client entry cannot be resolved, or both faces are disabled. esbuild
 * failures propagate.
 */
export declare function buildDshPlugin(options?: BuildDshPluginOptions): Promise<BuildDshPluginResult>
