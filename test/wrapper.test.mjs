/**
 * moduleLoaderWrap — the emitted bytes ARE the harness contract
 * (deepseek-harness/packages/client/tsdown.client.ts). These tests pin them
 * byte-for-byte; if they ever need to change, every plugin must move together.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { moduleLoaderWrap, PLATFORM_EXTERNALS, DEFAULT_CLIENT_EXTERNALS, DEFAULT_HOST_EXTERNALS } from '../src/index.js'

test('default wrap is byte-identical to the harness contract', () => {
  const { banner, footer } = moduleLoaderWrap('dsh-local-web-missions')
  assert.equal(
    banner.js,
    'window.__ModuleLoader__.load({ id: "dsh-local-web-missions", factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;',
  )
  assert.equal(footer.js, 'return module.exports; } });')
})

test('id is JSON-stamped (quotes/escapes safe)', () => {
  const { banner } = moduleLoaderWrap('weird "name"')
  assert.ok(banner.js.includes('id: "weird \\"name\\""'), banner.js)
})

test('guard:true wraps registration defensively', () => {
  const { banner, footer } = moduleLoaderWrap('dsh-x', { guard: true })
  assert.ok(banner.js.includes("typeof window !== 'undefined'"), banner.js)
  assert.ok(banner.js.includes('__dsh_loader.load({ id: "dsh-x", factory: (require) => {'), banner.js)
  assert.ok(banner.js.includes('var module = { exports: {} }; var exports = module.exports;'), banner.js)
  assert.ok(footer.js.startsWith('return module.exports; } });'), footer.js)
  assert.ok(footer.js.includes('catch (err)'), footer.js)
  assert.ok(footer.js.includes('console.error("[dsh] dsh-x: client factory failed:", err)'), footer.js)
})

test('guard:true keeps factory body identical to the contract', () => {
  // The loader contract is the factory shape; guard only wraps the CALL site.
  const plain = moduleLoaderWrap('dsh-y')
  const guarded = moduleLoaderWrap('dsh-y', { guard: true })
  const factoryCore = 'var module = { exports: {} }; var exports = module.exports;'
  assert.ok(plain.banner.js.endsWith(factoryCore))
  assert.ok(guarded.banner.js.endsWith(factoryCore))
  assert.ok(plain.footer.js === 'return module.exports; } });')
  assert.ok(guarded.footer.js.startsWith(plain.footer.js))
})

test('empty/non-string id throws TypeError', () => {
  assert.throws(() => moduleLoaderWrap(''), TypeError)
  // @ts-expect-error deliberate misuse
  assert.throws(() => moduleLoaderWrap(undefined), TypeError)
})

test('externals constants match the frozen module-table lists', () => {
  assert.deepEqual([...PLATFORM_EXTERNALS], [
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
  assert.deepEqual([...DEFAULT_HOST_EXTERNALS], ['@deepseek-ai/*'])
  assert.deepEqual(DEFAULT_CLIENT_EXTERNALS[DEFAULT_CLIENT_EXTERNALS.length - 1], '@deepseek-ai/*')
  assert.equal(DEFAULT_CLIENT_EXTERNALS.length, PLATFORM_EXTERNALS.length + 1)
})
