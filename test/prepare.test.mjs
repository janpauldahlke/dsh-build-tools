/**
 * prepareBuild — loud by default; soft fallback is opt-in and still noisy.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { prepareBuild } from '../src/prepare.js'

/** @param {(dir: string) => Promise<void>} fn */
async function withTmp(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-bt-prep-'))
  try {
    await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const exitFail = ['-e', 'process.exit(3)']
const exitOk = ['-e', 'process.exit(0)']

test('build failure → throws (loud, default policy)', async () => {
  await withTmp(async (dir) => {
    await assert.rejects(
      () => prepareBuild({ root: dir, command: process.execPath, args: exitFail }),
      /prepare: build failed \(exit code 3\)/,
    )
  })
})

test('build failure + soft:true → resolves with stderr warning', async () => {
  await withTmp(async (dir) => {
    /** @type {string[]} */
    const warnings = []
    const origWarn = console.warn
    console.warn = (...a) => warnings.push(a.join(' '))
    try {
      await prepareBuild({ root: dir, command: process.execPath, args: exitFail, soft: true })
    } finally {
      console.warn = origWarn
    }
    assert.equal(warnings.length, 1)
    assert.match(warnings[0], /falling back to prebuilt lib\//)
    assert.match(warnings[0], /soft prepare, opt-in/)
  })
})

test('build success + requireArtifacts → verifies artifacts exist', async () => {
  await withTmp(async (dir) => {
    await writeFile(join(dir, 'ok.js'), '')
    await assert.rejects(
      () => prepareBuild({ root: dir, command: process.execPath, args: exitOk, requireArtifacts: ['ok.js', 'missing.js'] }),
      /missing\.js is missing/,
    )
    await prepareBuild({ root: dir, command: process.execPath, args: exitOk, requireArtifacts: ['ok.js'] })
  })
})

test('spawn failure (bad command) → throws, not a silent skip', async () => {
  await withTmp(async (dir) => {
    await assert.rejects(
      () => prepareBuild({ root: dir, command: '/nonexistent/dsh-node-binary' }),
      /prepare: build failed/,
    )
  })
})

test('soft mode + missing artifacts still exits loud via bin (manual check hook)', async () => {
  // The bin itself is exercised in verify-plugin usage; here we only pin that
  // prepareBuild never resolves silently on failure without soft:true.
  await withTmp(async (dir) => {
    await assert.rejects(() => prepareBuild({ root: dir, command: process.execPath, args: exitFail }))
  })
})
