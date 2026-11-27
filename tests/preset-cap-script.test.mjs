/**
 * scripts/sync-dsh-preset-cap.mjs guard (autoresearch fix, debug finding #6).
 *
 * The script ships in the npm package (`files` whitelist) and the README tells
 * market users to run it. It rewrites the pinned `preset-standard` row of the
 * user's profile patch. `--interrupt` additionally forces `interrupt: true` on
 * `tool-subagent-control`, which re-enables the `interrupt_agent` tool that
 * DSH >= 0.2.2-rc.1 removes by default: a deliberate deviation from DSH's
 * default, so it must never happen silently in either direction — not applied
 * without the flag, and not dropped without `--no-interrupt`.
 *
 * The script runs as a subprocess against a stand-in `dsh --dump-config`, so
 * the real script is exercised end to end without a DSH install.
 *
 * Run with: `node --test tests/`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SCRIPT = fileURLToPath(new URL('../scripts/sync-dsh-preset-cap.mjs', import.meta.url))

/** The composed rows the script edits, at the indentation `dsh --dump-config` emits. */
const COMPOSED = [
  '- id: preset-standard',
  "  name: '@deepseek-ai/dsh-agent-preset'",
  '  config:',
  '    plugins:',
  '      - id: tool-web',
  "        name: '@deepseek-ai/dsh-tool-web'",
  '        config:',
  '          fetch: true',
  '          searchTimeoutMs: 20000',
  '      - id: delegation',
  "        name: 'cordis:group'",
  '        config:',
  '          - id: tool-subagent-control',
  "            name: '@deepseek-ai/dsh-tool-subagent-control'",
  '            config:',
  '              interrupt: false',
  '          - id: tool-subagent',
  "            name: '@deepseek-ai/dsh-tool-subagent'",
  '- id: preset-ptc',
  "  name: '@deepseek-ai/dsh-agent-preset'",
  '',
].join('\n')

const HEADER = '# >>> dsh preset-standard override (generated; re-run scripts/sync-dsh-preset-cap.mjs after a DSH upgrade) >>>'
const FOOTER = '# <<< dsh preset-standard override <<<'

/** An existing patch whose override block is the given lines. */
function patchWith(block) {
  return ['# user content above', HEADER, ...block, FOOTER, '# user content below', ''].join('\n')
}

/** A stand-in for `dsh --profile <p> --dump-config` that prints the canned composed config. */
function fakeDsh(dir) {
  const script = join(dir, 'fake-dsh.mjs')
  writeFileSync(script, `process.stdout.write(${JSON.stringify(COMPOSED)})\n`)
  const bin = join(dir, 'fake-dsh.sh')
  writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`)
  chmodSync(bin, 0o755)
  return bin
}

/** Run the script once against a fresh patch file; returns status, output and the rewritten patch. */
function run(block, args) {
  const dir = mkdtempSync(join(tmpdir(), 'preset-cap-'))
  const patch = join(dir, 'cordis.patch.yml')
  writeFileSync(patch, patchWith(block))
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, DSH_BIN: fakeDsh(dir), DSH_PROFILE_PATCH: patch },
    encoding: 'utf8',
  })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, patch: readFileSync(patch, 'utf8') }
}

test('by default the script only sets searchMaxResults and leaves interrupt exactly as DSH composes it', () => {
  const { status, patch } = run(['# stale block'], ['24'])
  assert.equal(status, 0)
  assert.match(patch, /^ {10}searchMaxResults: 24$/m)
  assert.match(patch, /^ {14}interrupt: false$/m, "DSH's own default is carried over untouched")
  assert.doesNotMatch(patch, /interrupt: true/)
  // Only the marked region is replaced.
  assert.ok(patch.startsWith(`# user content above\n${HEADER}\n`))
  assert.ok(patch.endsWith(`${FOOTER}\n# user content below\n`))
})

test('--interrupt is the explicit opt-in that pins interrupt: true and says so in the block', () => {
  const { status, patch, stdout } = run(['# stale block'], ['--interrupt', '24'])
  assert.equal(status, 0)
  assert.match(patch, /^ {14}interrupt: true$/m)
  assert.match(patch, /^ {10}searchMaxResults: 24$/m)
  assert.match(patch, /^# .*--interrupt/m, 'the generated block records the deviation')
  assert.match(stdout, /interrupt: true/)
})

test('an interrupt: true pinned by the existing block is never dropped silently', () => {
  const pinned = ['# stale block', '          - id: tool-subagent-control', '              interrupt: true']
  // Without an option: refuse, before even consulting dsh.
  const refused = run(pinned, ['24'])
  assert.equal(refused.status, 1)
  assert.match(refused.stderr, /--interrupt/)
  assert.doesNotMatch(refused.stdout, /rewrote/)
  assert.match(refused.patch, /^ {14}interrupt: true$/m, 'the existing block is left as it was')
  // Keeping it needs --interrupt; dropping it needs --no-interrupt.
  assert.equal(run(pinned, ['--interrupt', '24']).status, 0)
  const dropped = run(pinned, ['--no-interrupt', '24'])
  assert.equal(dropped.status, 0)
  assert.match(dropped.patch, /^ {14}interrupt: false$/m)
})

test('unknown or contradictory options are rejected instead of ignored', () => {
  const typo = run(['# stale block'], ['--interruption', '24'])
  assert.equal(typo.status, 1)
  assert.match(typo.stderr, /unknown option/)
  const both = run(['# stale block'], ['--interrupt', '--no-interrupt', '24'])
  assert.equal(both.status, 1)
  assert.match(both.stderr, /mutually exclusive/)
  const badCap = run(['# stale block'], ['--interrupt', '999'])
  assert.equal(badCap.status, 1)
  assert.match(badCap.stderr, /cap must be an integer/)
})
