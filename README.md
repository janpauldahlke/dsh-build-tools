# dsh-build-tools

Shared build tooling for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) plugins. One package replaces the copy-pasted `build.mjs` that every `dsh-*` plugin carries, so the dual-face packaging contract lives in exactly one place.

## The problem space

A dsh plugin is **one npm package that has to serve two very different runtimes**:

- the **host face** runs in node inside the harness. It is a Cordis plugin (`apply` / class + `inject`), it may open `ctx.webServer` routes, and it imports harness packages that the profile resolves at runtime.
- the **client face** runs in the browser. It is not loaded as a module by a bundler or an import map — the harness web client installs a `window.__ModuleLoader__` global, and each plugin script registers itself into it as a **closure factory**: `window.__ModuleLoader__.load({ id, factory })`. Inside that factory, `require()` resolves only against the host's frozen module table (React, cordis, the `dsh-client-*` UI packages). Everything else must be inlined into the bundle.

So the same source tree has to produce two artifacts with two module systems, two targets, and two different external-resolution rules — and the client one has to be wrapped in that exact registration call or it never enters `__DSH_BOOT__` (often silently).

That wrapper is **not a hack invented by these plugins**. It mirrors what the harness does to its own in-tree client packages: `packages/client/tsdown.client.ts` emits the same registration banner, the same `var module = { exports: {} }` intro, and the same `return module.exports; } });` footer. Out-of-tree plugins reproduce that contract by hand, because there is no supported way to ask the harness to bundle you.

Reproducing it by hand in every repo is the actual problem: the banner/footer strings, the platform externals list, the host/client target split, and the extra standalone bundles for unit tests were copy-pasted across seven plugins. One contract change means seven manual patches, and any one of them can drift silently.

**This package is the consolidation.** It encodes that contract once, behind options, and proves equivalence with a byte-diff gate instead of eyeballing.

## What it builds

| Artifact | Format | Role |
| --- | --- | --- |
| `lib/index.js` | ESM, node, `es2024` | host half (Cordis plugin); `@deepseek-ai/*` stays external |
| `lib/client.js` | CJS, browser, `es2022` | client half; wrapped in the `__ModuleLoader__` registration |
| `lib/<name>.mjs` | ESM, node | optional standalone modules, built without harness externals |

The third row is what makes the logic testable: your store/config/tool code gets its own bundle with no cordis in it, so `node --test` can import it directly instead of mocking the harness.

## Install

```sh
npm install --save-dev dsh-build-tools esbuild
```

`esbuild` is a peer dependency — the plugin supplies its own pinned version, same as before.

## Use

A plugin's `build.mjs` becomes this:

```js
import { buildDshPlugin } from 'dsh-build-tools'

await buildDshPlugin()
```

Defaults cover the common shape (`src/host/index.ts` → `lib/index.js`, `src/client/index.tsx` → `lib/client.js`). Anything else is an option:

```js
import { buildDshPlugin } from 'dsh-build-tools'

await buildDshPlugin({
  // extra pure-logic bundles for node --test
  modules: [
    { entry: 'src/host/store.ts', out: 'store.mjs' },
    { entry: 'src/host/config.ts', out: 'config.mjs' },
  ],
  // a native dep that must stay external in the host half
  host: { externals: ['node-nvml', '@deepseek-ai/*'] },
})
```

Full option reference: [`types/index.d.ts`](types/index.d.ts). Escape hatches exist per face (`externals`, `loader`, `esbuildOverrides`) — if a plugin needs something unusual, it should not need to fork this package.

## The `prepare` script

The previous pattern across these plugins was:

```json
"prepare": "node build.mjs || node -e \"console.warn('... relying on prebuilt lib/')\""
```

That swallows build failures and silently ships whatever stale `lib/` is committed — an esbuild version mismatch or a type error becomes a plugin that loads yesterday's code and reports healthy. The default policy here is the opposite: **fail loudly**. Either drop the fallback:

```json
"prepare": "node build.mjs"
```

or, if you genuinely track prebuilt `lib/` for git installs on machines without the toolchain, opt in explicitly — it still verifies the artifacts exist and warns on stderr, never silently:

```json
"prepare": "node build.mjs || dsh-prepare-soft"
```

There is also a programmatic form (`import { prepareBuild } from 'dsh-build-tools/prepare'`) with the same loud-by-default, `{ soft: true }` opt-in behavior.

## Testing

`dsh-build-tools/test` exports a tiny zero-dependency harness — `describe` / `it` / `assertEqual` / `assertThrows` / `runAll` — designed to run under plain `node --test`. No jest, no vitest, no config files.

**Honest recommendation:** this harness is ~120 lines. Copying it into your repo (e.g. `scripts/test/harness.mjs`) is the suggested default — zero coupling, and you own your test stack. The subpath import exists for repos that prefer pulling fixes from one upstream:

```js
import { describe, it, assertEqual } from 'dsh-build-tools/test'
```

Why not Vitest? `node --test` already provides the runner, assertions, and mocks with zero dependencies, and the existing plugins use it. Vitest would add watch mode, snapshots, and coverage — real DX wins, but a dependency and config in every repo for sugar this codebase doesn't need. If you want them, the harness is the seam: swap `runAll` for your runner of choice.

## Verifying a migration

When moving an existing plugin onto this package, the emitted artifacts must stay identical. `dsh-verify-plugin` is the gate:

```sh
npx dsh-verify-plugin /path/to/plugin /path/to/config.mjs
```

It builds into a temp dir and byte-diffs every artifact against the committed `lib/`. JS must match exactly; source maps pass on identical `mappings`/`names` (temp-dir source paths legitimately differ). Exit non-zero = drift = do not publish.

## Guarantees and honest limits

**Byte-identical output is the contract.** With default options the emitted `lib/index.js` / `lib/client.js` match the hand-written `build.mjs` files this replaces, byte for byte. All seven existing plugins currently verify clean. If that ever has to change, it changes across every plugin at once, deliberately — not by accident in one repo.

**The client wrapper is coupled to the harness, and that is intentional.** It tracks `packages/client/tsdown.client.ts`, which is not a published stable API. This package does not remove that coupling — it moves it to one file with a test pinning the bytes, so a harness change is one coordinated edit instead of seven silent ones.

**The defensive guard is off by default — here is the honest reasoning.** A missing or renamed `window.__ModuleLoader__` makes the current wrapper throw a `ReferenceError` at the top level of the bundle, in the host's UI thread. `client.guard: true` wraps the registration in a presence check plus a `try/catch`, so a plugin degrades to a `console.warn` instead of taking the UI down.

It is still off, for two reasons:

1. In the supported boot path the harness installs the loader facade **before** plugin scripts run, so the guard never fires. It only triggers in a broken environment — and in that environment a loud `ReferenceError` in the console is arguably more useful than a warning nobody reads.
2. Turning it on changes emitted bytes for every plugin simultaneously, which conflicts with the byte-identity gate during migration.

So it is implemented, tested, and one flag away — but enabling it across every plugin is a deliberate decision, not a default. The tension between graceful degradation and failing loudly is real and unresolved here; a well-argued position on it is a welcome contribution (see `AGENTS.md`).

**Not a general-purpose bundler.** This encodes one packaging convention for one plugin ecosystem. If your plugin doesn't look like a dsh plugin, this isn't for you.

**Build-time only.** Plugins depend on this as a devDependency; published plugin artifacts contain none of it. A bad release here cannot break an already-published plugin.

**No CSS pipeline yet.** The harness preset compiles `.module.css` via lightningcss; no plugin uses it today. When one does, that's the moment to add it — not before.

## Development

```sh
npm install
npm test        # node --test, includes real-esbuild integration tests
npm run typecheck
npx dsh-verify-plugin /path/to/plugin /path/to/config.mjs
```

`AGENTS.md` is self-contained background for agents and people who arrive here from npm or a clone — the dual-face contract, why this package exists, and the failure modes that were learned the hard way.

## The dsh plugin zoo

This package exists because these plugins each carried a hand-written copy of
the same build script. They are the consumers of the contract encoded here —
and the evidence for what the contract has to support. Each one exercises a
different escape hatch, which is why those escape hatches exist rather than a
single hardcoded build.

| Package | Repo | What it exercises |
| --- | --- | --- |
| [`dsh-gpu-monitor-nvml`](https://www.npmjs.com/package/dsh-gpu-monitor-nvml) | [source](https://github.com/janpauldahlke/dsh-gpu-monitor-nvml) | A native runtime dependency (`node-nvml`) kept external via `host.externals`. The canonical soft-`prepare` case. |
| [`dsh-slot-health`](https://www.npmjs.com/package/dsh-slot-health) | [source](https://github.com/janpauldahlke/dsh-local-endpoint-health) | The largest `modules` list — six standalone testables spanning both host and client source trees, so logic can be unit-tested without cordis. |
| [`dsh-local-long-horizon`](https://www.npmjs.com/package/dsh-local-long-horizon) | [source](https://github.com/janpauldahlke/dsh-local-long-horizon) | Testables consumed by a custom runner (`scripts/run-tests.mjs`) rather than plain `node --test`. |
| [`dsh-agent-processes`](https://www.npmjs.com/package/dsh-agent-processes) | [source](https://github.com/janpauldahlke/dsh-agent-processes) | Shared logic bundled once and imported by both faces. Carries an ambient `src/types.d.ts` shim so `tsc --noEmit` can resolve `@deepseek-ai/*`. |
| [`dsh-local-memento`](https://www.npmjs.com/package/dsh-local-memento) | [source](https://github.com/janpauldahlke/dsh-memento) | `loader: { '.md': 'text' }` — Markdown inlined as a string at build time, on both the client and a standalone module. |


---

If you maintain a plugin that uses this package and hits a case the options do
not cover, that is the signal to open an issue here rather than fork the build
script back into your repo. A new escape hatch benefits every plugin above; a
one-off patch in a single plugin is exactly the drift this package was created
to end.

## License

MIT
