/**
 * Release workflow guard (autoresearch fix, debug finding #13).
 *
 * `sh scripts/release.sh` pushes the release commit and its tag together
 * (`git push --follow-tags`). A workflow that triggers on both the branch push
 * and the tag push starts two runs for one release; both pass the "already
 * published?" check before either has published, so both run `npm publish`
 * (the second one fails) and both try to create the GitHub Release — and the
 * branch run pushes the tag itself, which used to start a third run.
 *
 * Run with: `node --test tests/`
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const workflow = readFileSync(new URL('../.github/workflows/publish.yml', import.meta.url), 'utf8')

/** The `on:` block, up to the next top-level key. */
const trigger = /^on:\n([\s\S]*?)(?=^\S)/m.exec(workflow)?.[1] ?? ''

test('the publish workflow is triggered by exactly one event: a push to main', () => {
  assert.match(trigger, /^ {4}branches:\n {6}- main$/m, 'a push to main publishes')
  assert.doesNotMatch(trigger, /tags:/, 'a v* tag push would start a second run for the same release')
})

test('publish runs are serialized, never cancelled halfway and never concurrent', () => {
  assert.match(workflow, /^concurrency:\n {2}group: \S+\n {2}cancel-in-progress: false$/m)
})
