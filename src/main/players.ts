import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, delimiter, join } from 'node:path'
import { Effect } from 'effect'

/**
 * The legacy external-player table, ported verbatim: switches, the BSPlayer argument
 * order, MPlayer OSX Extended's charset switch and VLC's flatpak path all encode field
 * reports and are not re-derivable.
 */
export interface ExternalPlayerSpec {
  readonly type: string
  readonly cmd?: string
  readonly switches?: string
  readonly subswitch?: string
  readonly fs?: string
  readonly filenameswitch?: string
  readonly urlswitch?: string
  readonly stop?: string
  readonly pause?: string
}

export const EXTERNAL_PLAYERS: Readonly<Record<string, ExternalPlayerSpec>> = {
  VLC: {
    type: 'vlc',
    cmd: '/Contents/MacOS/VLC',
    switches: '--no-video-title-show',
    subswitch: '--sub-file=',
    fs: '-f',
    stop: 'vlc://quit',
    pause: 'vlc://pause',
    filenameswitch: '--meta-title=',
  },
  'Fleex player': {
    type: 'fleex-player',
    cmd: '/Contents/MacOS/Fleex player',
    filenameswitch: '-file-name ',
  },
  MPlayer: {
    type: 'mplayer',
    cmd: 'mplayer',
    switches: '--really-quiet',
    subswitch: '-sub ',
    fs: '-fs',
  },
  MPlayerX: {
    type: 'mplayer',
    cmd: '/Contents/MacOS/MPlayerX',
    switches: '-font "/Library/Fonts/Arial Bold.ttf"',
    urlswitch: '-url ',
    subswitch: '-sub ',
    fs: '-fs',
  },
  'MPlayer OSX Extended': {
    type: 'mplayer',
    cmd: '/Contents/Resources/Binaries/mpextended.mpBinaries/Contents/MacOS/mplayer',
    switches: '-font "/Library/Fonts/Arial Bold.ttf"',
    subswitch: '-sub ',
    fs: '-fs',
  },
  IINA: {
    type: 'iina',
    cmd: '/Contents/MacOS/iina-cli',
    subswitch: '--mpv-sub-file=',
    fs: '--mpv-fs',
  },
  Bomi: {
    type: 'bomi',
    switches: '',
    subswitch: '--set-subtitle ',
    fs: '--action window/enter-fs',
  },
  mpv: {
    type: 'mpv',
    switches: '--no-terminal',
    subswitch: '--sub-file=',
    fs: '--fs',
    filenameswitch: '--force-media-title=',
  },
  mpvnet: {
    type: 'mpvnet',
    switches: '--no-terminal',
    subswitch: '--sub-files=',
    fs: '-fs',
    filenameswitch: '--force-media-title=',
  },
  'MPC-HC': { type: 'mpc-hc', switches: '', subswitch: '/sub ', fs: '/fullscreen' },
  'MPC-HC64': { type: 'mpc-hc', switches: '', subswitch: '/sub ', fs: '/fullscreen' },
  'MPC-BE': { type: 'mpc-be', switches: '', subswitch: '/sub ', fs: '/fullscreen' },
  'MPC-BE64': { type: 'mpc-be', switches: '', subswitch: '/sub ', fs: '/fullscreen' },
  SMPlayer: {
    type: 'smplayer',
    switches: '',
    subswitch: '-sub ',
    fs: '-fs',
    stop: 'smplayer -send-action quit',
    pause: 'smplayer -send-action pause',
  },
  BSPlayer: { type: 'bsplayer', switches: '', subswitch: '', fs: '-fs' },
  PotPlayerMini64: { type: 'potplayer', switches: '', subswitch: '/sub=' },
}

/** A player found on disk. */
export interface ExternalPlayer {
  readonly id: string
  readonly type: string
  readonly path: string
}

export interface PlaybackInput {
  readonly url: string
  /** A local subtitle file; empty when the player should use none. */
  readonly subtitle?: string
  readonly title?: string
  readonly fullscreen?: boolean
  /** True for MPlayer OSX Extended, which needs the `-utf8` switch for UTF-8 subs. */
  readonly utf8Subtitle?: boolean
}

function switchesOf(value: string | undefined): ReadonlyArray<string> {
  if (value === undefined || value.trim() === '') return []
  // The table stores several switches per player, some with quoted values.
  return value.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
}

/**
 * Resolves what to execute. macOS matches the `.app` bundle, so the binary inside it is
 * appended; flatpak VLC is run through `flatpak run` rather than by path.
 */
export function playerCommand(player: ExternalPlayer): {
  readonly file: string
  readonly prefix: ReadonlyArray<string>
} {
  if (player.path.includes('/flatpak/app/org.videolan.VLC/')) {
    return { file: '/usr/bin/flatpak', prefix: ['run', 'org.videolan.VLC'] }
  }
  const spec = EXTERNAL_PLAYERS[player.id]
  if (spec?.cmd !== undefined && player.path.endsWith('.app')) {
    return { file: player.path + spec.cmd, prefix: [] }
  }
  return { file: player.path, prefix: [] }
}

/** Builds the argv array; filenames and subtitles are arguments, never shell text. */
export function playerArgs(player: ExternalPlayer, input: PlaybackInput): ReadonlyArray<string> {
  const spec = EXTERNAL_PLAYERS[player.id]
  if (spec === undefined) return [input.url]
  const switches = switchesOf(spec.switches)
  const subtitle =
    input.subtitle === undefined || input.subtitle === ''
      ? []
      : [
          ...(player.id === 'MPlayer OSX Extended' && input.utf8Subtitle === true ? ['-utf8'] : []),
          ...switchesOf(spec.subswitch),
          input.subtitle,
        ]
  const fullscreen =
    input.fullscreen === true && spec.fs !== undefined ? switchesOf(spec.fs) : ([] as const)
  const filename =
    spec.filenameswitch !== undefined && input.title !== undefined && input.title !== ''
      ? [...switchesOf(spec.filenameswitch), input.title]
      : []
  const url = [...switchesOf(spec.urlswitch), input.url]

  // BSPlayer needs its arguments in a specific order: url, then sub, then fs, then switches.
  return player.id === 'BSPlayer'
    ? [...url, ...subtitle, ...fullscreen, ...switches]
    : [...switches, ...subtitle, ...fullscreen, ...filename, ...url]
}

/** Where the legacy app looked for players, per platform. */
export function playerSearchPaths(
  platform: NodeJS.Platform,
  environment: Record<string, string | undefined>,
): ReadonlyArray<string> {
  const paths: string[] = []
  const add = (path: string | undefined) => {
    if (path !== undefined && path !== '' && existsSync(path)) paths.push(path)
  }
  switch (platform) {
    case 'linux':
      for (const entry of (environment.PATH ?? '').split(delimiter)) add(entry)
      add('/snap/bin')
      add('/var/lib/flatpak/app/org.videolan.VLC/current/active')
      add(`${environment.HOME ?? ''}/.nix-profile/bin`)
      add('/run/current-system/sw/bin')
      break
    case 'darwin':
      for (const entry of (environment.PATH ?? '').split(delimiter)) add(entry)
      add('/Applications')
      add(`${environment.HOME ?? ''}/Applications`)
      break
    default:
      add(`${environment.SystemDrive ?? 'C:'}\\Program Files\\`)
      add(`${environment.SystemDrive ?? 'C:'}\\Program Files (x86)\\`)
      add(`${environment.LOCALAPPDATA ?? ''}\\Apps\\2.0\\`)
      break
  }
  return paths
}

const SCAN_DEPTH = 3

/** Case-insensitive lookup: Windows executables are lowercase, the table is not. */
const BY_LOWER_NAME = new Map(
  Object.entries(EXTERNAL_PLAYERS).map(([name, spec]) => [name.toLowerCase(), { name, spec }]),
)

/** Yields every entry, bundles included, so `.app` directories are candidates too. */
async function* walk(directory: string, depth: number): AsyncGenerator<string> {
  if (depth < 0) return
  let entries: ReadonlyArray<{ name: string; isDirectory: () => boolean }>
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const path = join(directory, entry.name)
    yield path
    if (entry.isDirectory()) {
      yield* walk(path, depth - 1)
    }
  }
}

/**
 * Finds installed players under the platform's search paths. When several builds of the
 * same player exist the newest wins, which is what the legacy scanner did with birthtimes.
 */
export function scanPlayers(
  roots: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<ExternalPlayer>> {
  return Effect.promise(async () => {
    const found = new Map<string, { player: ExternalPlayer; born: number }>()
    for (const root of roots) {
      for await (const candidate of walk(root, SCAN_DEPTH)) {
        const id = basename(candidate)
          .replace(/\.app$/, '')
          .replace(/\.exe$/, '')
        const match = BY_LOWER_NAME.get(id.toLowerCase())
        if (match === undefined) continue
        const info = await stat(candidate).catch(() => undefined)
        if (info === undefined) continue
        const born = info.birthtimeMs
        const previous = found.get(match.name)
        if (previous === undefined || born > previous.born) {
          found.set(match.name, {
            player: { id: match.name, type: match.spec.type, path: candidate },
            born,
          })
        }
      }
    }
    return [...found.values()].map((entry) => entry.player)
  })
}

/** Launches a player with an argv array; nothing is interpolated into a shell. */
export function launchPlayer(
  player: ExternalPlayer,
  args: ReadonlyArray<string>,
): Effect.Effect<void> {
  const { file, prefix } = playerCommand(player)
  return Effect.tryPromise(
    () =>
      new Promise<void>((resolve, reject) => {
        execFile(file, [...prefix, ...args], (error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
  ).pipe(
    Effect.asVoid,
    Effect.orElseSucceed(() => undefined),
  )
}

/** The names the legacy app listed in its player chooser. */
export const externalPlayerNames: ReadonlyArray<string> = Object.keys(EXTERNAL_PLAYERS)
