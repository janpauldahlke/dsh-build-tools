/**
 * dsh-build-tools — shared dual-face build for DeepSeek Harness plugins.
 *
 * Emits the standard dsh plugin artifact layout:
 *
 * - lib/index.js  — host half: ESM, node, `@deepseek-ai/*` external.
 * - lib/client.js — client half: CJS closure factory, registered through
 *   `window.__ModuleLoader__` per the dsh-client-modules contract
 *   (harness: packages/client/tsdown.client.ts).
 * - lib/<name>.mjs — optional standalone modules for unit tests, built
 *   without harness externals.
 *
 * Contracts:
 *
 * 1. Default output is byte-identical to the hand-written build.mjs files
 *    this replaces (verified via bin/verify-plugin.js against committed
 *    lib/ baselines). Do not change banner/footer strings or default
 *    externals without a coordinated migration across all plugins.
 * 2. `client.guard: true` switches the banner/footer to a defensive
 *    variant (presence check + try/catch). Off by default; changes bytes.
 * 3. Builds fail loudly — esbuild errors propagate, no fallbacks.
 * 4. absWorkingDir is pinned to the package root so output bytes do not
 *    depend on the process cwd.
 */
import { mkdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

/** Frozen client module-table baseline — the only runtime `require()` requests a client bundle may make. */
export const PLATFORM_EXTERNALS = Object.freeze([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

/** Host-half default externals. */
export const DEFAULT_HOST_EXTERNALS = Object.freeze(['@deepseek-ai/*'])

/** Client-half default externals: platform baseline, then the harness wildcard. */
export const DEFAULT_CLIENT_EXTERNALS = Object.freeze([...PLATFORM_EXTERNALS, '@deepseek-ai/*'])

/**
 * Generate the `window.__ModuleLoader__` registration banner/footer.
 * Default output matches the harness contract byte-for-byte:
 *
 *   banner: `window.__ModuleLoader__.load({ id: <json>, factory: (require) => {\n`
 *           `var module = { exports: {} }; var exports = module.exports;`
 *   footer: `return module.exports; } });`
 *
 * With `guard: true`, the call site is wrapped: registration is skipped with
 * a console.warn when `window.__ModuleLoader__` is missing, and factory
 * errors are caught and logged instead of propagating to the host UI.
 *
 * @param {string} id plugin id (npm package name)
 * @param {{ guard?: boolean }} [options]
 * @returns {{ banner: { js: string }, footer: { js: string } }}
 */
export function moduleLoaderWrap(id, options = {}) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('moduleLoaderWrap: id must be a non-empty string (the plugin package name)')
  }

  if (options.guard !== true) {
    return {
      banner: {
        js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;`,
      },
      footer: {
        js: 'return module.exports; } });',
      },
    }
  }

  const warnMsg = JSON.stringify(`[dsh] ${id}: window.__ModuleLoader__ missing; client bundle skipped`)
  const errMsg = JSON.stringify(`[dsh] ${id}: client factory failed:`)
  return {
    banner: {
      js: [
        '(function () {',
        "var __dsh_loader = typeof window !== 'undefined' ? window.__ModuleLoader__ : undefined;",
        `if (!__dsh_loader || typeof __dsh_loader.load !== 'function') { console.warn(${warnMsg}); return; }`,
        'try {',
        `__dsh_loader.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
        'var module = { exports: {} }; var exports = module.exports;',
      ].join('\n'),
    },
    footer: {
      js: `return module.exports; } });\n} catch (err) { console.error(${errMsg}, err); }\n})();`,
    },
  }
}

/**
 * @param {unknown} value
 * @param {string} what
 * @returns {asserts value is Record<string, any>}
 */
function assertPlainObject(value, what) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`buildDshPlugin: ${what} must be an object when provided`)
  }
}

/**
 * Build one dual-face dsh plugin. Defaults reproduce the standard artifact
 * layout exactly; every option is an escape hatch, none required.
 *
 * @param {import('../types/index.js').BuildDshPluginOptions} [options]
 * @returns {Promise<import('../types/index.js').BuildDshPluginResult>}
 */
export async function buildDshPlugin(options = {}) {
  const root = resolve(options.root ?? process.cwd())

  /** @type {{ name?: string }} */
  let pkg
  try {
    pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  } catch (err) {
    throw new Error(`buildDshPlugin: cannot read package.json under root ${root} (${/** @type {Error} */ (err).message})`)
  }
  const id = options.id ?? pkg.name
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError(`buildDshPlugin: plugin id missing — set "name" in ${join(root, 'package.json')} or pass options.id`)
  }

  const outDir = resolve(root, options.outDir ?? 'lib')
  await mkdir(outDir, { recursive: true })

  /** @type {{ build: (opts: any) => Promise<any> }} */
  const esbuildModule = options.esbuild ?? (await import('esbuild'))
  const sourcemap = options.sourcemap ?? true
  /** @type {string[]} */
  const artifacts = []

  // ---- host half (ESM, node) ----
  if (options.host !== false) {
    const host = options.host ?? {}
    assertPlainObject(host, 'options.host')
    const out = host.out ?? 'index.js'
    await esbuildModule.build({
      absWorkingDir: root,
      entryPoints: [resolve(root, host.entry ?? 'src/host/index.ts')],
      outfile: join(outDir, out),
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'es2024',
      sourcemap,
      external: host.externals ?? [...DEFAULT_HOST_EXTERNALS],
      ...(host.loader ? { loader: host.loader } : {}),
      logLevel: 'warning',
      ...(host.esbuildOverrides ?? {}),
    })
    artifacts.push(out)
  }

  // ---- standalone modules (ESM, node, no harness externals) ----
  for (const mod of options.modules ?? []) {
    assertPlainObject(mod, 'each options.modules entry')
    if (typeof mod.entry !== 'string' || typeof mod.out !== 'string') {
      throw new TypeError(`buildDshPlugin(${id}): each module needs { entry, out } strings — got ${JSON.stringify(mod)}`)
    }
    await esbuildModule.build({
      absWorkingDir: root,
      entryPoints: [resolve(root, mod.entry)],
      outfile: join(outDir, mod.out),
      bundle: true,
      format: 'esm',
      platform: 'node',
      target: 'es2024',
      sourcemap,
      ...(mod.externals ? { external: mod.externals } : {}),
      ...(mod.loader ? { loader: mod.loader } : {}),
      logLevel: 'warning',
      ...(mod.esbuildOverrides ?? {}),
    })
    artifacts.push(mod.out)
  }

  // ---- client half (CJS, browser, ModuleLoader factory) ----
  if (options.client !== false) {
    const client = options.client ?? {}
    assertPlainObject(client, 'options.client')
    const entry = client.entry ?? (await detectClientEntry(root))
    const out = client.out ?? 'client.js'
    const isTsx = entry.endsWith('.tsx')
    const { banner, footer } = moduleLoaderWrap(id, { guard: client.guard === true })
    await esbuildModule.build({
      absWorkingDir: root,
      entryPoints: [resolve(root, entry)],
      outfile: join(outDir, out),
      bundle: true,
      format: 'cjs',
      platform: 'browser',
      target: 'es2022',
      ...(isTsx ? { jsx: 'automatic' } : {}),
      sourcemap,
      define: { 'process.env.NODE_ENV': '"production"', ...(options.define ?? {}) },
      external: client.externals ?? [...DEFAULT_CLIENT_EXTERNALS],
      banner,
      footer,
      logLevel: 'warning',
      ...(client.esbuildOverrides ?? {}),
    })
    artifacts.push(out)
  }

  if (artifacts.length === 0) {
    throw new Error(`buildDshPlugin(${id}): nothing to build — host and client are both disabled`)
  }

  const label = options.log ?? id
  console.log(`[${label}] built ${artifacts.map((a) => `${outDirLabel(root, outDir)}/${a}`).join(' + ')} for ${id}`)

  return { id, root, outDir, artifacts }
}

/**
 * @param {string} root
 * @param {string} outDir
 * @returns {string} outDir relative to root, for the summary log line
 */
function outDirLabel(root, outDir) {
  const rel = outDir.startsWith(root) ? outDir.slice(root.length).replace(/^[/\\]+/, '') : outDir
  return rel.length > 0 ? rel : '.'
}

/**
 * Default client entry: `src/client/index.tsx`, fallback `src/client/index.ts`.
 * @param {string} root
 * @returns {Promise<string>} root-relative entry path
 */
async function detectClientEntry(root) {
  for (const candidate of ['src/client/index.tsx', 'src/client/index.ts']) {
    try {
      await readFile(join(root, candidate), 'utf8')
      return candidate
    } catch {
      // try next candidate
    }
  }
  throw new Error(`buildDshPlugin: no client entry found at ${join(root, 'src/client/index.{tsx,ts}')} — pass client.entry or client: false`)
}
