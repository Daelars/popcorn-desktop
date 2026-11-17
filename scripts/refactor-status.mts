/**
 * Read-only status report for the port-plan refactor (#33), built for a monitoring loop.
 * It never checks out, commits or pushes; it reads the newest `origin/phase-*` branch (the
 * stack tip) through `git show`, so it is safe to run while another agent works.
 *
 *   pnpm monitor:refactor             facts only
 *   pnpm monitor:refactor --checks    also typecheck, lint and test, when HEAD is the tip
 *   pnpm monitor:refactor --tip <ref> report on a specific ref instead of the newest branch
 *
 * Each run writes `.refactor-monitor/latest.md` and `state.json`, and the report opens with
 * what changed since the previous run. The loop itself is the `refactor-monitor` skill in
 * `.agents/skills/`.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/** gh would otherwise resolve the upstream popcorn-official repo from the fork's remotes. */
const REPO = 'Daelars/popcorn-desktop'
const STATE_DIR = '.refactor-monitor'
const STATE_FILE = join(STATE_DIR, 'state.json')

interface State {
  readonly tip: string
  readonly tipSha: string
  readonly probes: Record<string, boolean>
  readonly phase7: Record<string, boolean>
  readonly rules: Record<string, number>
  readonly prs: Record<string, string>
  readonly checks: Record<string, string>
}

function git(...args: ReadonlyArray<string>): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

function tryRun(file: string, args: ReadonlyArray<string>): string | undefined {
  const result = spawnSync(file, args, { encoding: 'utf8' })
  return result.status === 0 ? result.stdout.trim() : undefined
}

/** A file's contents at a ref, or '' when it does not exist there. */
function fileAt(ref: string, path: string): string {
  try {
    return git('show', `${ref}:${path}`)
  } catch {
    return ''
  }
}

/** Lines matching a pattern at a ref, as `path:line:text`. */
function grepAt(ref: string, pattern: string, paths: ReadonlyArray<string>): ReadonlyArray<string> {
  const out = tryRun('git', ['grep', '-n', '-E', pattern, ref, '--', ...paths])
  return out === undefined || out === '' ? [] : out.split('\n')
}

/**
 * Known bugs and gaps from the 2026-09-23 review. `present` is true while the defect is still
 * visible at the ref; a probe flipping to false means it was fixed (or the code moved, which
 * the loop's reviewer confirms by reading the diff).
 */
const probes: ReadonlyArray<{
  readonly id: string
  readonly label: string
  readonly present: (ref: string) => boolean
}> = [
  {
    id: 'bug-7',
    label: 'External player argv: `--sub-file=` split from its path, quotes kept (7.3)',
    present: (ref) => fileAt(ref, 'src/main/players.ts').includes('switchesOf(spec.subswitch)'),
  },
  {
    id: 'bug-10',
    label: 'Season pack downloads whole: select without deselect (7.5)',
    present: (ref) => !fileAt(ref, 'src/main/webtorrent-engine.ts').includes('deselect'),
  },
  {
    id: 'bug-12',
    label: 'TMDB browse ignores filters.keywords, yet declares search (7.4)',
    present: (ref) => !fileAt(ref, 'src/main/providers/tmdb.ts').includes('keywords'),
  },
  {
    id: 'bug-16',
    label: '"Upload speed" shows total bytes uploaded (7.6)',
    present: (ref) => grepAt(ref, String.raw`uploaded \?\? 0\)\}/s`, ['src/renderer']).length > 0,
  },
  {
    id: 'gap-9.2',
    label: 'Subtitles not inside StreamSession: `waitingForSubtitles` never emitted in main',
    present: (ref) => grepAt(ref, 'waitingForSubtitles', ['src/main']).length === 0,
  },
  {
    id: 'gap-10.2',
    label: 'SettingsPage does not render from the settings metadata (10.2)',
    present: (ref) =>
      !/metadata|SETTINGS_META/i.test(fileAt(ref, 'src/renderer/src/routes/SettingsPage.tsx')),
  },
]

/** AGENTS.md rules as counts at the ref; a rising count is worth a look. */
const rules: ReadonlyArray<{
  readonly id: string
  readonly pattern: string
  readonly paths: ReadonlyArray<string>
}> = [
  {
    id: 'any',
    pattern: String.raw`: any\b|as any\b|<any>`,
    paths: ['src/main', 'src/shared', 'src/renderer'],
  },
  {
    id: 'throw new Error (main/shared)',
    pattern: "throw new Error|throw '",
    paths: ['src/main', 'src/shared'],
  },
  { id: 'renderer imports main', pattern: "from '[^']*main/", paths: ['src/renderer'] },
  {
    id: 'runPromise outside ipc.ts',
    pattern: String.raw`\.runPromise\(|Effect\.runPromise`,
    paths: ['src/main', ':!src/main/ipc.ts', ':!src/main/smoke.ts'],
  },
]

function newestPhaseBranch(): string {
  return git(
    'for-each-ref',
    '--sort=-committerdate',
    '--count=1',
    '--format=%(refname:short)',
    'refs/remotes/origin/phase-*',
  )
}

function runCheck(script: string): string {
  // pnpm is a shim script on Windows, so it needs a shell; the script name is a fixed literal.
  const result = spawnSync(`pnpm ${script}`, { encoding: 'utf8', shell: true })
  const output = `${result.stdout}\n${result.stderr}`
  const warnings = /Found (\d+) warnings?/.exec(output)?.[1]
  const tests = /Tests\s+(.+?)\s*$/m.exec(output)?.[1]
  const detail = [tests, warnings === undefined ? undefined : `${warnings} warnings`]
    .filter((part) => part !== undefined)
    .join(', ')
  return `${result.status === 0 ? 'pass' : 'FAIL'}${detail === '' ? '' : ` (${detail})`}`
}

function diffState(previous: State | undefined, next: State): ReadonlyArray<string> {
  if (previous === undefined) return ['First run: no previous state to compare.']
  const changes: string[] = []
  if (previous.tipSha !== next.tipSha) {
    changes.push(
      `Tip moved: ${previous.tip}@${previous.tipSha.slice(0, 8)} → ${next.tip}@${next.tipSha.slice(0, 8)}`,
    )
  }
  const sections = ['probes', 'phase7', 'rules', 'prs', 'checks'] as const
  for (const section of sections) {
    const before = previous[section]
    const after = next[section]
    for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (before[key] !== after[key]) {
        changes.push(`${section}.${key}: ${String(before[key])} → ${String(after[key])}`)
      }
    }
  }
  return changes
}

const argv = process.argv.slice(2)
const tipFlag = argv.indexOf('--tip')
const withChecks = argv.includes('--checks')

tryRun('git', ['fetch', '--quiet', 'origin'])
const tip = (tipFlag >= 0 ? argv[tipFlag + 1] : undefined) ?? newestPhaseBranch()
const tipSha = git('rev-parse', tip)
const previous: State | undefined = existsSync(STATE_FILE)
  ? (JSON.parse(readFileSync(STATE_FILE, 'utf8')) as State)
  : undefined

const phase7Branches = git(
  'for-each-ref',
  '--format=%(refname:short)',
  'refs/remotes/origin/phase-7.*',
)
  .split('\n')
  .filter((branch) => branch !== '')
const phase7 = Object.fromEntries(
  phase7Branches.map((branch) => [
    branch.replace('origin/', ''),
    tryRun('git', ['merge-base', '--is-ancestor', branch, tipSha]) !== undefined,
  ]),
)

const prList = tryRun('gh', [
  'pr',
  'list',
  '-R',
  REPO,
  '--state',
  'all',
  '--limit',
  '100',
  '--json',
  'number,state,headRefName,baseRefName,title',
])
const prRows: ReadonlyArray<{
  number: number
  state: string
  headRefName: string
  baseRefName: string
  title: string
}> = prList === undefined ? [] : JSON.parse(prList)
const phasePrs = prRows
  .filter((pr) => pr.headRefName.startsWith('phase-'))
  .sort((a, b) => a.number - b.number)

const head = git('rev-parse', 'HEAD')
const checks: Record<string, string> = {}
if (withChecks) {
  if (head === tipSha) {
    for (const script of ['typecheck', 'lint', 'test']) checks[script] = runCheck(script)
  } else {
    checks.skipped = `HEAD is ${git('rev-parse', '--abbrev-ref', 'HEAD')}, not the tip`
  }
}

const state: State = {
  tip,
  tipSha,
  probes: Object.fromEntries(probes.map((probe) => [probe.id, probe.present(tipSha)])),
  phase7,
  rules: Object.fromEntries(
    rules.map((rule) => [rule.id, grepAt(tipSha, rule.pattern, rule.paths).length]),
  ),
  prs: Object.fromEntries(phasePrs.map((pr) => [`#${pr.number}`, pr.state])),
  checks,
}

const newCommits =
  previous !== undefined && previous.tipSha !== tipSha
    ? (tryRun('git', ['log', '--oneline', `${previous.tipSha}..${tipSha}`]) ??
      '(previous tip not an ancestor; history was rewritten)')
    : ''
const lastCommit = git('log', '-1', '--format=%h %s (%cr)', tipSha)
const dirty = git('status', '--porcelain', '--untracked-files=no')
  .split('\n')
  .filter((line) => line !== '').length

const changes = diffState(previous, state)
const report = [
  `# Refactor status: ${new Date().toISOString()}`,
  '',
  '## Changes since last run',
  ...(changes.length === 0 ? ['None.'] : changes.map((change) => `- ${change}`)),
  ...(newCommits === '' ? [] : ['', '### New commits on the tip', '```', newCommits, '```']),
  '',
  '## Stack tip',
  `- ${tip} @ ${tipSha.slice(0, 8)}: ${lastCommit}`,
  `- Working tree: HEAD ${head === tipSha ? 'is' : 'is not'} the tip; ${dirty} tracked file(s) with changes`,
  '',
  '## Known bugs and gaps (present = still visible at the tip)',
  ...probes.map(
    (probe) => `- [${state.probes[probe.id] ? 'present' : 'gone'}] ${probe.id}: ${probe.label}`,
  ),
  '',
  '## Phase 7 branches merged into the tip',
  ...Object.entries(phase7).map(([branch, merged]) => `- [${merged ? 'yes' : 'NO'}] ${branch}`),
  '',
  '## AGENTS.md rule counts at the tip',
  ...Object.entries(state.rules).map(([rule, count]) => `- ${rule}: ${count}`),
  '',
  '## Checks',
  ...(withChecks
    ? Object.entries(checks).map(([name, result]) => `- ${name}: ${result}`)
    : ['Not run (pass --checks).']),
  '',
  '## Phase PRs',
  ...(prList === undefined
    ? ['gh unavailable; PR state not read.']
    : phasePrs.map((pr) => `- #${pr.number} ${pr.state} ${pr.headRefName} → ${pr.baseRefName}`)),
].join('\n')

mkdirSync(STATE_DIR, { recursive: true })
writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`)
writeFileSync(join(STATE_DIR, 'latest.md'), `${report}\n`)
console.log(report)
