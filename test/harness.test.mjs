/**
 * The test subpath harness itself — dogfooded with node --test.
 *
 * NOTE: suites registered here are module-global to harness.mjs, so the
 * pass/fail expectations below account for suites registered by earlier tests
 * in this file (runAll re-runs every registered suite each call).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { describe, it, assertEqual, assertIncludes, assertThrows, runAll } from './harness.mjs'

test('harness: describe/it register and runAll executes', async () => {
  describe('sample suite', () => {
    it('passes', () => {
      assertEqual({ a: 1 }, { a: 1 })
      assertIncludes('hello world', 'world')
    })
    it('async passes', async () => {
      await Promise.resolve()
      assertEqual(2 + 2, 4)
    })
  })

  const result = await runAll({ quiet: true })
  assert.equal(result.failed, 0)
  assert.ok(result.passed >= 2)
  assert.notEqual(process.exitCode, 1, 'green run must not poison exitCode')
})

test('harness: failing case sets exitCode and is reported', async () => {
  describe('failing suite', () => {
    it('fails on purpose', () => {
      assertEqual(1, 2)
    })
  })
  const result = await runAll({ quiet: true })
  assert.ok(result.failed >= 1)
  assert.equal(process.exitCode, 1)
  // exitCode is not deletable on modern node; assigning undefined restores it.
  process.exitCode = undefined
})

test('harness: assertThrows checks class + message and rethrows the error', async () => {
  const err = await assertThrows(
    async () => {
      throw new TypeError('boom: bad thing')
    },
    TypeError,
    'bad thing',
  )
  assert.ok(err instanceof TypeError)

  // No throw → assertThrows itself throws
  await assert.rejects(() => assertThrows(async () => {}), /expected throw/)

  // Wrong class → assertThrows throws
  await assert.rejects(
    () =>
      assertThrows(async () => {
        throw new Error('plain')
      }, TypeError),
    /expected TypeError/,
  )
})

test('harness: it() outside describe throws', () => {
  assert.throws(() => it('orphan', () => {}), /outside describe/)
})
