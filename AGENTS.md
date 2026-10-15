# AGENTS.md — dsh-build-tools

This file is for agents and people who ended up here from **npm** or a **git
clone** — usually while helping someone build or fix a DeepSeek Harness (dsh)
plugin. It is self-contained: everything you need to use this package and to
understand why it exists is below. No other file or repository is required
reading.

Two audiences, both served here:

- **You are in a plugin repo, helping your human build or fix a dsh plugin.**
  Start at "Using this package in a plugin" — it is the concrete path. Then read
  "Making the artifact actually load": those are the failure modes that produce
  correct-looking artifacts and a plugin that still does not appear. Skim "Why
  this package exists" when you need the reasoning behind a constraint.
- **You are changing this package itself.** Read "Why this package exists" first,
  then "Hard contracts" and "Verification gates before any publish".

---

## Using this package in a plugin

The minimum working setup, in order:

1. `npm install --save-dev dsh-build-tools esbuild`
2. Write `build.mjs`:

   ```js
   import { buildDshPlugin } from 'dsh-build-tools'

   await buildDshPlugin()
   ```

   Add `modules: [{ entry, out }]` for any pure-logic code you want to unit test
   without cordis. Add `host: { externals: [...] }` if the host half uses a
   native or runtime dependency that must not be inlined.

3. Set `package.json` fields — `main`, `exports`, `files`, and **both** `dsh.bundle`
   and `dsh.client`. Exact shape and the reasons each field matters:
   "Making the artifact actually load".
4. Add `"prepare": "node build.mjs"`. It fails loudly on a broken build — that
   is the policy, and there is no opt-out; see "The `prepare` script" for why
   the fallback variant was removed.
5. Build, then install the bundle into the profile and verify it actually
   activated — do not stop at "the build succeeded".

`npx dsh-verify-plugin <plugin-root> <config.mjs>` is available when migrating a
plugin that already has committed `lib/` artifacts; it proves the migration
changed no bytes. New plugins do not need it.

---

## Why this package exists

A dsh plugin is **one npm package that must serve two incompatible runtimes**
from one source tree.

**Host face** runs in node inside the harness. It is a Cordis plugin — an
`apply(ctx)` function or a class with `inject`. It may register `ctx.webServer`
routes, timers, and tools. It imports `@deepseek-ai/*` packages that the
harness profile resolves at runtime, so those must stay *external* in the
bundle rather than being inlined.

**Client face** runs in the browser. It is not loaded by an import map, a
service worker, or a bundler on the page. The harness web client installs a
global, `window.__ModuleLoader__`, before plugin scripts run. Each plugin script
registers itself into that loader as a **closure factory**:

```js
window.__ModuleLoader__.load({ id: "<package name>", factory: (require) => {
  var module = { exports: {} }; var exports = module.exports;
  // ...bundled CJS code...
  return module.exports;
} });
```

Inside that factory, `require()` resolves **only** against the host's frozen
module table: react, react-dom, cordis, and the `dsh-client-*` UI packages.
Nothing else exists there. Everything your client uses beyond that baseline has
to be inlined into the bundle at build time.

**That wrapper is not a hack someone invented.** It is the same shape the
harness emits for its own in-tree client packages — `packages/client/tsdown.client.ts`
in the harness tree generates exactly this registration banner, exactly that
`var module = { exports: {} }` intro, and exactly the
`return module.exports; } });` footer. Out-of-tree plugins reproduce the
contract by hand because there is no supported way to ask the harness to bundle
you.

So each plugin needed a `build.mjs` that:

1. bundled the host half as ESM for node with `@deepseek-ai/*` external,
2. bundled the client half as CJS for the browser with the platform baseline
   external and the ModuleLoader wrapper injected as banner/footer,
3. often also bundled a few **standalone pure-logic modules** — the store, the
   config parser, the state machine — with *no* harness externals, so unit tests
   could import them under `node --test` without mocking cordis.

Seven plugins each carried a hand-written copy of that script. Same banner
strings, same nine-entry externals list, same target split. The consequences
were concrete:

- A harness contract change meant seven manual patches, and any of them could
  drift silently — the plugin still builds, still installs, and the client half
  just never enters boot.
- The `prepare` script in six of them was
  `node build.mjs || node -e "console.warn('...relying on prebuilt lib/')"`.
  On any build failure it shipped whatever stale `lib/` was committed. An esbuild
  version mismatch became a plugin that loads yesterday's code and reports
  healthy.
- The wrapper had no guard. If `window.__ModuleLoader__` is absent — renamed
  host, script-order change, extension interference — the bundle throws a
  `ReferenceError` at top level in the host's UI thread.

This package is the consolidation. The contract lives in one file
(`src/index.js`), behind options, with tests pinning the exact bytes and a
byte-diff tool proving that migrating a plugin changes nothing.

**Honest limit:** centralizing does not remove the coupling. `__ModuleLoader__`
is internal to the harness and is not a published stable API. What changed is
the blast radius — one coordinated edit instead of seven silent ones. The
durable fix would be the harness exposing its client preset to out-of-tree
plugins, which would make this package unnecessary. That outcome is welcome.

---

## What it builds

| Artifact | Format | Role |
| --- | --- | --- |
| `lib/index.js` | ESM, node, `es2024` | host half; `@deepseek-ai/*` external |
| `lib/client.js` | CJS, browser, `es2022` | client half; ModuleLoader-wrapped |
| `lib/<name>.mjs` | ESM, node | optional standalone modules, no harness externals |

The third row is what makes the logic testable. Bundling your store or config
parser on its own, with nothing external, means `node --test` can import real
code instead of a mocked harness.

Usage:

```js
// build.mjs
import { buildDshPlugin } from 'dsh-build-tools'

await buildDshPlugin({
  modules: [
    { entry: 'src/host/store.ts', out: 'store.mjs' },
  ],
  host: { externals: ['node-nvml', '@deepseek-ai/*'] },
})
```

Defaults handle the common shape (`src/host/index.ts`, `src/client/index.tsx`,
`.ts` stub fallback, `jsx: 'automatic'` for `.tsx`). Every quirk is an option —
`externals`, `loader`, `define`, `esbuildOverrides`, per face. Nothing about
this package knows the names of the plugins it builds. Full surface:
`types/index.d.ts`.

`esbuild` is a **peer dependency**: the plugin supplies its own pinned version,
as it did before.

---

## Making the artifact actually load

Building correctly is necessary and not sufficient. These are the failure modes
that were learned by losing time to them, and they are not obvious from the
build output — the artifacts look right and the plugin still does not appear.

**`package.json` needs `"main": "lib/index.js"`.** The harness defaults to
`index.js`; a correct `exports` map alone is not enough, and the host half fails
to load without `main`.

```json
{
  "name": "my-unique-plugin-name",
  "version": "0.1.0",
  "type": "module",
  "main": "lib/index.js",
  "exports": {
    ".": "./lib/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "files": ["lib", "cordis.patch.yml", "README.md", "LICENSE"],
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "inject": ["@deepseek-ai/dsh-client-ui-sidebar-right"]
    }
  }
}
```

**Both `dsh.bundle` and `dsh.client` are required.** `dsh.client` without
`dsh.bundle` installs the package as a plain dependency and it never activates —
no bundle row means nothing inserts it into the profile composition. Missing
`dsh.client` means the client half never enters boot, usually silently.

**`cordis.patch.yml` is a top-level YAML array**, and its `name` must match
`package.json` `name` exactly:

```yaml
- insert:
    - id: my-plugin
      name: my-unique-plugin-name
```

The `id` only needs uniqueness within the profile composition; the `name` must
be the real package name.

**The package must resolve from the profile's `node_modules`** — typically
`~/.dsh/profiles/web/node_modules`, not the harness checkout's. The scan
baseUrl is the profile. If resolution fails:

```sh
ln -sfn /abs/path/to/package "$HOME/.dsh/profiles/web/node_modules/my-unique-plugin-name"
```

**Client half shape.** `export const inject = ['slots', ...]` plus
`export function apply(ctx) { ... }`. Register UI at the top level of `apply`,
not only inside a React effect — registering only in an effect can stall boot
silently. Clean up with `ctx.effect`.

**Client artifacts 404 on direct request — by design.** They are served only
through the `??` combo URL. Requesting `lib/client.js` as a single file returns
404 and proves nothing about whether your client is broken. Take the combo URL
from the boot HTML (unescaping `&amp;`) and request that.

**Web-server route registration shape:** `{ kind: 'exact', path, handler }`,
with two separate `ctx.effect()` calls — one registering the sampler, one
unregistering. Unload must dispose routes and timers.

**`dsh web` already implies the web profile.** Do not pass `--profile web` to
it. (`--profile` is still correct for `dsh plugin ...` and `dsh --dump-config`.)

**Rebuild before boot, every time.** After any client edit, `node build.mjs`
must have run. The running dev server picks up changed `lib/client.js` bytes via
HMR; a host-half change may need a restart of that process. Verify the route
serves your latest build before trusting what you see — a stale bundle
answering `{"ok":true}` looks identical to success.

**Never `pkill dsh` or `pkill node`.** That pattern matches the primary session
and local inference servers as well as any test instance. If a port must be
freed, identify the specific pid and kill only that one. Test on a second port;
do not bounce the primary session to see whether something works.

---

## The `prepare` script

Policy is **fail loudly**:

```json
"prepare": "node build.mjs"
```

There is no soft fallback, and deliberately so. An earlier version of this
package shipped `dsh-prepare-soft`, invoked as
`"prepare": "node build.mjs || dsh-prepare-soft"`. It could not work: when
`node build.mjs` fails because `dsh-build-tools` is unresolvable — which is
exactly what happens when the toolchain is missing — the fallback binary is
provided by that same unresolvable package. The install then died with
`dsh-prepare-soft: not found` (exit 127), a less useful failure than a clean
strict error. It was removed rather than repaired.

A build failure fails the install. That is the point: a plugin that loads
stale `lib/` and reports healthy is worse than an install that stops.

npm does **not** run `prepare` for packages installed from the registry; the
published tarball already contains `lib/`. Published plugins therefore install
fine without the toolchain. `prepare` runs on git installs and clones, which do
require it.

---

## Testing

`dsh-build-tools/test` exports a zero-dependency harness — `describe`, `it`,
`assertEqual`, `assertIncludes`, `assertThrows`, `runAll` — meant to run under
plain `node --test`. No jest, no vitest, no config.

It is about 120 lines. **Copying it into your repo is the suggested default**
(`scripts/test/harness.mjs`); you own your test stack and carry no dependency.
The subpath import exists for repos that would rather pull fixes from one
upstream.

Vitest was considered and declined. `node --test` already provides the runner,
assertions, and mocks with zero dependencies, and the existing plugins use it.
Vitest would add watch mode, snapshots, and coverage — genuine improvements,
priced as a dependency and a config file per repo. If you want them, `runAll` is
the seam to replace.

---

## Hard contracts — for changes to this package

1. **Byte-identical output.** Default `buildDshPlugin()` output must match the
   committed `lib/` of the existing plugins byte for byte; all seven verify
   clean. The banner/footer strings in `moduleLoaderWrap()` mirror the harness
   contract — never reformat, re-wrap, or tidy them. `test/wrapper.test.mjs`
   pins the bytes.
2. **`absWorkingDir: root` on every esbuild call.** Otherwise output bytes
   (banner comments, sourcemap paths) depend on the process cwd. This was real
   drift, found by the byte-diff gate.
3. **Fail loudly.** esbuild errors propagate. No silent fallbacks, no swallowed
   errors, anywhere in this package.
4. **Escape hatches over constraints.** Real quirks exist: native deps kept
   external, `.md` inlined as text, dep-free stub clients with no externals
   list at all, custom defines. Express them through options. No
   plugin-specific code belongs in `src/` or `bin/`.
5. **`client.guard` stays off by default.** The guarded variant wraps
   registration in a presence check plus `try/catch`, degrading a missing
   loader to `console.warn` instead of a `ReferenceError` in the host UI thread.
   It is implemented and tested. It is off for two reasons: in the supported
   boot path the loader exists before plugin scripts run, so the guard only
   fires in an already-broken environment where a loud throw may be more useful
   than a warning nobody reads; and enabling it changes emitted bytes for every
   plugin at once, which conflicts with contract 1 during migration. Enabling it
   is a deliberate maintainer decision, not a default.

**Verifying a migration.** `npx dsh-verify-plugin <plugin-root> <config.mjs>`
builds into a temp dir and byte-diffs every artifact against the committed
`lib/`. JS must match exactly; source maps pass on identical `mappings` and
`names`, since temp-dir source paths legitimately differ. Non-zero exit means
drift: do not publish until it is understood.

## Conventions

- Runtime source is plain ESM JavaScript with JSDoc types; `types/*.d.ts` is the
  hand-written public surface. Changing an exported signature means updating the
  matching `.d.ts`.
- `npm run typecheck` (`tsc --noEmit`, `checkJs`) stays clean.
- Tests run under `node --test` with `node:assert/strict` and top-level `test()`.
  The bundled harness is dogfooded in `test/harness.test.mjs`; note its suites
  are module-global, so `runAll` expectations account for suites registered by
  earlier tests in the same file.
- No new runtime dependencies. `esbuild` is a peer dependency; `typescript` and
  `@types/node` are dev-only.
- Comments stay factual, contract-focused, and neutral. No narrative, no history
  in code comments, no references to specific people or past conversations.
  History lives in git.

## Verification gates before any publish

```sh
npm run typecheck
npm test
npx dsh-verify-plugin <plugin-root> <config.mjs>
```

`prepublishOnly` runs typecheck and tests. Publishing to npm requires the
maintainer's OTP (2FA on writes). **Agents must never run `npm publish`
autonomously** — prepare the tree and hand the command over.

## Contributing — including disagreeing

This package encodes one maintainer's consolidation of a reverse-engineered
contract. Several decisions are judgment calls with real trade-offs, recorded as
open rather than settled:

- **The guard question** (contract 5): graceful degradation versus fail loudly.
  Both positions are defensible; the current state postpones the choice.
- **Byte-identity as the migration gate**: it makes refactoring safe, but any
  genuine improvement to the emitted artifact then needs a coordinated bump
  across every plugin. If that cost exceeds the safety, the gate should change.
- **`node --test` over Vitest**: correct for this codebase, not a general claim.
- **Centralizing instead of upstreaming**: see "Honest limit" above.

If you find an approach that fits better — a cleaner expression of the contract,
a defect in the byte-identity assumption, evidence that the harness loader
behaves differently than described here, or a way to make this package obsolete
— raise it with evidence. An issue or a PR is fine. Do not silently diverge in
one plugin. A finding that invalidates something written here is more valuable
than code that conforms to it.

The same applies to the harness itself: if this file conflicts with the version
you actually run, the installed harness wins. Note the drift and continue with a
fallback.
