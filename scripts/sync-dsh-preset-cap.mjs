#!/usr/bin/env node
/**
 * Regenerate the `preset-standard` override block in the DSH web profile patch.
 *
 * The per-search source cap lives in `@deepseek-ai/dsh-tool-web`'s
 * `searchMaxResults`, mounted by the agent preset (`standard`) — not in
 * dsh-serper-search. A profile patch can only replace a plugin's whole config,
 * so the cap is raised by pinning the entire preset row. That pinned copy can
 * drift when DSH upgrades; this script rebuilds it from the CURRENT composed
 * config and rewrites the marked block in ~/.dsh/profiles/web/cordis.patch.yml.
 *
 * Usage:
 *   node scripts/sync-dsh-preset-cap.mjs [cap]                  # default cap 12
 *   node scripts/sync-dsh-preset-cap.mjs --interrupt [cap]      # also pin interrupt: true
 *   DSH_PROFILE=web DSH_BIN=/path/to/dsh node scripts/sync-dsh-preset-cap.mjs 12
 *
 * `--interrupt` is opt-in. Without it the script only sets `searchMaxResults`
 * and leaves `tool-subagent-control` exactly as DSH composes it. With it, the
 * row also gets `interrupt: true`, which re-enables the `interrupt_agent` tool
 * DSH >= 0.2.2-rc.1 removes by default: a deliberate deviation from DSH's
 * default (docs/upgrade-guide/v0.2.2-rc.1/subagent-interrupt-default), so it
 * is never applied silently. Nor dropped silently: when the block being
 * replaced already pins `interrupt: true`, the script refuses to run unless
 * `--interrupt` keeps it or `--no-interrupt` drops it on purpose.
 *
 * After running, restart `dsh web`; the cap applies to NEW sessions (agent
 * presets are read when an Agent is created).
 *
 * Exit code 0 on success, 1 on missing markers/config.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, renameSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const args = process.argv.slice(2)
const KNOWN_OPTIONS = ['--interrupt', '--no-interrupt']
const unknownOptions = args.filter((arg) => arg.startsWith('--') && !KNOWN_OPTIONS.includes(arg))
if (unknownOptions.length > 0) {
  console.error(`unknown option(s) ${unknownOptions.join(' ')}; known: ${KNOWN_OPTIONS.join(', ')}`)
  process.exit(1)
}
/** Opt-in: also pin `interrupt: true` on the preset's tool-subagent-control row. */
const INTERRUPT = args.includes('--interrupt')
/** Explicit consent to drop an `interrupt: true` the existing block pins. */
const DROP_INTERRUPT = args.includes('--no-interrupt')
if (INTERRUPT && DROP_INTERRUPT) {
  console.error('--interrupt and --no-interrupt are mutually exclusive')
  process.exit(1)
}
const capArg = args.find((arg) => !arg.startsWith('--'))
const CAP = Number(capArg ?? process.env.PRESET_SEARCH_MAX_RESULTS ?? 12)
if (!Number.isInteger(CAP) || CAP < 1 || CAP > 50) {
  console.error(`cap must be an integer 1..50, got ${String(capArg)}`)
  process.exit(1)
}

const PROFILE = process.env.DSH_PROFILE ?? 'web'
const PATCH_PATH = process.env.DSH_PROFILE_PATCH
  ?? join(homedir(), '.dsh', 'profiles', PROFILE, 'cordis.patch.yml')
const DSH_BIN = process.env.DSH_BIN ?? 'dsh'

const HEADER = [
  '# >>> dsh preset-standard override (generated; re-run scripts/sync-dsh-preset-cap.mjs after a DSH upgrade) >>>',
  `# 目的：把一次 web_search 的来源上限从 tool-web 默认的 8 提升到 ${CAP}。`,
  '# 说明：这是 agent preset 的完整覆盖块（patch 对 config 是整体替换），不是插件设置。',
  // Recorded in the block itself, so the deviation from DSH's default is visible where it lives.
  ...(INTERRUPT ? ['# 额外（--interrupt）：tool-subagent-control 的 interrupt 固定为 true；DSH >= 0.2.2-rc.1 默认为 false。'] : []),
].join('\n')
const FOOTER = '# <<< dsh preset-standard override <<<'

/** Run `dsh --profile <p> --dump-config` and return stdout. */
function dumpConfig() {
  try {
    return execFileSync(DSH_BIN, ['--profile', PROFILE, '--dump-config'], { encoding: 'utf8' })
  } catch (error) {
    console.error(`failed to run "${DSH_BIN} --profile ${PROFILE} --dump-config": ${error.message}`)
    process.exit(1)
  }
}

/** Extract the `- id: preset-standard` top-level block from the composed YAML. */
function extractPreset(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((line) => line.startsWith('- id: preset-standard'))
  if (start === -1) throw new Error('preset-standard not found in the composed config')
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('- id: ')) {
      end = i
      break
    }
  }
  return lines.slice(start, end)
}

/** Set `searchMaxResults` inside the preset's tool-web config. */
function withCap(block, cap) {
  const toolWeb = block.findIndex((line) => line.trim() === '- id: tool-web')
  if (toolWeb === -1) throw new Error('preset-standard no longer mounts tool-web; regenerate manually')
  let config = -1
  for (let i = toolWeb + 1; i < block.length; i += 1) {
    if (block[i].trim() === 'config:') {
      config = i
      break
    }
    if (!block[i].startsWith('        ')) break
  }
  if (config === -1) throw new Error('tool-web entry has no config block')
  let lastOption = config
  for (let i = config + 1; i < block.length; i += 1) {
    if (!block[i].startsWith('          ')) break
    lastOption = i
  }
  const existing = block.findIndex((line, index) => index > config && index <= lastOption && line.trim().startsWith('searchMaxResults:'))
  if (existing !== -1) {
    block[existing] = `          searchMaxResults: ${cap}`
  } else {
    const fetchLine = block.findIndex((line, index) => index > config && index <= lastOption && line.trim() === 'fetch: true')
    const at = fetchLine === -1 ? config + 1 : fetchLine + 1
    block.splice(at, 0, `          searchMaxResults: ${cap}`)
  }
  return block
}

/** Force `interrupt: true` on the preset's tool-subagent-control row.
 *
 * DSH >= 0.2.2-rc.1 ships `interrupt: false` in every built-in preset, which
 * removes the `interrupt_agent` tool (Team mode included). Regenerating this
 * block from the composed config would inherit that default and silently drop
 * the opt-in, so it is re-applied here. See
 * docs/upgrade-guide/v0.2.2-rc.1/subagent-interrupt-default.
 */
function withInterrupt(block) {
  const control = block.findIndex((line) => line.trim() === '- id: tool-subagent-control')
  if (control === -1) throw new Error('preset-standard no longer mounts tool-subagent-control; regenerate manually')
  let config = -1
  for (let i = control + 1; i < block.length; i += 1) {
    if (block[i].trim() === 'config:') {
      config = i
      break
    }
    if (!block[i].startsWith('            ')) break
  }
  if (config === -1) {
    block.splice(control + 2, 0, '            config:', '              interrupt: true')
    return block
  }
  let lastOption = config
  for (let i = config + 1; i < block.length; i += 1) {
    if (!block[i].startsWith('              ')) break
    lastOption = i
  }
  const existing = block.findIndex((line, index) => index > config && index <= lastOption && line.trim().startsWith('interrupt:'))
  if (existing !== -1) {
    block[existing] = '              interrupt: true'
  } else {
    block.splice(config + 1, 0, '              interrupt: true')
  }
  return block
}

const patch = readFileSync(PATCH_PATH, 'utf8')
const startMarker = '# >>> dsh preset-standard override'
const footerMarker = '# <<< dsh preset-standard override <<<'
const start = patch.indexOf(startMarker)
const end = patch.indexOf(footerMarker)
if (start === -1 || end === -1 || end < start) {
  console.error(`override markers not found in ${PATCH_PATH}; add them manually first`)
  process.exit(1)
}
// The interrupt opt-in is never dropped silently either: the block being
// replaced may be the only place it is pinned.
if (!INTERRUPT && !DROP_INTERRUPT && /^\s+interrupt: true\s*$/m.test(patch.slice(start, end))) {
  console.error(`the existing override block in ${PATCH_PATH} pins tool-subagent-control interrupt: true.\nRe-run with --interrupt to keep it, or with --no-interrupt to drop it on purpose.`)
  process.exit(1)
}

const composed = dumpConfig()
const rawBlock = extractPreset(composed)
const capBlock = INTERRUPT ? withInterrupt(withCap(rawBlock, CAP)) : withCap(rawBlock, CAP)
const region = `${HEADER}\n${capBlock.join('\n').replace(/\s+$/u, '')}\n${FOOTER}\n`
const next = `${patch.slice(0, start)}${region}${patch.slice(end + footerMarker.length + 1)}`
const tmp = `${PATCH_PATH}.tmp-${process.pid}`
writeFileSync(tmp, next)
renameSync(tmp, PATCH_PATH)
console.log(`rewrote preset-standard override in ${PATCH_PATH} (searchMaxResults: ${CAP}${INTERRUPT ? ', interrupt: true' : ''})`)
console.log(`verify with: dsh --profile ${PROFILE} --dump-config | grep -A6 "id: tool-web"`)
