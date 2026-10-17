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
 *   node scripts/sync-dsh-preset-cap.mjs [cap]     # default cap 12
 *   DSH_PROFILE=web DSH_BIN=/path/to/dsh node scripts/sync-dsh-preset-cap.mjs 12
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

const CAP = Number(process.argv[2] ?? process.env.PRESET_SEARCH_MAX_RESULTS ?? 12)
if (!Number.isInteger(CAP) || CAP < 1 || CAP > 50) {
  console.error(`cap must be an integer 1..50, got ${String(process.argv[2])}`)
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

const composed = dumpConfig()
const rawBlock = extractPreset(composed)
const capBlock = withCap(rawBlock, CAP)
const region = `${HEADER}\n${capBlock.join('\n').replace(/\s+$/u, '')}\n${FOOTER}\n`

const patch = readFileSync(PATCH_PATH, 'utf8')
const startMarker = '# >>> dsh preset-standard override'
const footerMarker = '# <<< dsh preset-standard override <<<'
const start = patch.indexOf(startMarker)
const end = patch.indexOf(footerMarker)
if (start === -1 || end === -1 || end < start) {
  console.error(`override markers not found in ${PATCH_PATH}; add them manually first`)
  process.exit(1)
}
const next = `${patch.slice(0, start)}${region}${patch.slice(end + footerMarker.length + 1)}`
const tmp = `${PATCH_PATH}.tmp-${process.pid}`
writeFileSync(tmp, next)
renameSync(tmp, PATCH_PATH)
console.log(`rewrote preset-standard override in ${PATCH_PATH} (searchMaxResults: ${CAP})`)
console.log(`verify with: dsh --profile ${PROFILE} --dump-config | grep -A6 "id: tool-web"`)
