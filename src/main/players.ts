import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { basename, delimiter, join } from 'node:path'
import { Effect } from 'effect'
import { DeviceError } from '../shared/errors'

/**
 * A switch that takes a value: `joined` attaches it (`--sub-file=<path>`), otherwise the
 * value is the next argument (`-sub <path>`). Stored structured so nothing is re-tokenised.
 */
export interface Flag {
  readonly flag: string
  readonly joined: boolean
}

/**
 * The legacy external-player table, ported verbatim: switches, the BSPlayer argument
 * order, MPlayer OSX Extended's charset switch and VLC's flatpak path all encode field
 * reports and are not re-derivable. Switches are argv arrays, so a path is always one
 * argument and never carries literal quotes.
 */
export interface ExternalPlayerSpec {
  readonly type: string
  readonly cmd?: string
  readonly switches?: ReadonlyArray<string>
  readonly subswitch?: Flag
  readonly fs?: ReadonlyArray<string>
  readonly filenameswitch?: Flag
  readonly urlswitch?: Flag
  readonly stop?: string
  readonly pause?: string
}

export const EXTERNAL_PLAYERS: Readonly<Record<string, ExternalPlayerSpec>> = {
  VLC: {
    type: 'vlc',
    cmd: '/Contents/MacOS/VLC',
    switches: ['--no-video-title-show'],
    subswitch: { flag: '--sub-file=', joined: true },
    fs: ['-f'],
    stop: 'vlc://quit',
    pause: 'vlc://pause',
    filenameswitch: { flag: '--meta-title=', joined: true },
  },
  'Fleex player': {
    type: 'fleex-player',
    cmd: '/Contents/MacOS/Fleex player',
    filenameswitch: { flag: '-file-name', joined: false },
  },
  MPlayer: {
    type: 'mplayer',
    cmd: 'mplayer',
    switches: ['--really-quiet'],
    subswitch: { flag: '-sub', joined: false },
    fs: ['-fs'],
  },
  MPlayerX: {
    type: 'mplayer',
    cmd: '/Contents/MacOS/MPlayerX',
    switches: ['-font', '/Library/Fonts/Arial Bold.ttf'],
    urlswitch: { flag: '-url', joined: false },
    subswitch: { flag: '-sub', joined: false },
    fs: ['-fs'],
  },
  'MPlayer OSX Extended': {
    type: 'mplayer',
    cmd: '/Contents/Resources/Binaries/mpextended.mpBinaries/Contents/MacOS/mplayer',
    switches: ['-font', '/Library/Fonts/Arial Bold.ttf'],
    subswitch: { flag: '-sub', joined: false },
    fs: ['-fs'],
  },
  IINA: {
    type: 'iina',
    cmd: '/Contents/MacOS/iina-cli',
    subswitch: { flag: '--mpv-sub-file=', joined: true },
    fs: ['--mpv-fs'],
  },
  Bomi: {
    type: 'bomi',
    switches: [],
    subswitch: { flag: '--set-subtitle', joined: false },
    fs: ['--action', 'window/enter-fs'],
  },
  mpv: {
    type: 'mpv',
    switches: ['--no-terminal'],
    subswitch: { flag: '--sub-file=', joined: true },
    fs: ['--fs'],
    filenameswitch: { flag: '--force-media-title=', joined: true },
  },
  mpvnet: {
    type: 'mpvnet',
    switches: ['--no-terminal'],
    subswitch: { flag: '--sub-files=', joined: true },
    fs: ['-fs'],
    filenameswitch: { flag: '--force-media-title=', joined: true },
  },
  'MPC-HC': {
    type: 'mpc-hc',
    switches: [],
    subswitch: { flag: '/sub', joined: false },
    fs: ['/fullscreen'],
  },
  'MPC-HC64': {
    type: 'mpc-hc',
    switches: [],
    subswitch: { flag: '/sub', joined: false },
    fs: ['/fullscreen'],
  },
  'MPC-BE': {
    type: 'mpc-be',
    switches: [],
    subswitch: { flag: '/sub', joined: false },
    fs: ['/fullscreen'],
  },
  'MPC-BE64': {
    type: 'mpc-be',
    switches: [],
    subswitch: { flag: '/sub', joined: false },
    fs: ['/fullscreen'],
  },
  SMPlayer: {
    type: 'smplayer',
    switches: [],
    subswitch: { flag: '-sub', joined: false },
    fs: ['-fs'],
    stop: 'smplayer -send-action quit',
    pause: 'smplayer -send-action pause',
  },
  // BSPlayer takes the subtitle path on its own, with no switch in front of it.
  BSPlayer: { type: 'bsplayer', switches: [], subswitch: { flag: '', joined: true }, fs: ['-fs'] },
  PotPlayerMini64: {
    type: 'potplayer',
    switches: [],
    subswitch: { flag: '/sub=', joined: true },
  },
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

/** Renders a switch that takes a value: joined (`--sub-file=<path>`) or separate args. */
function flagArgs(flag: Flag | undefined, value: string): ReadonlyArray<string> {
  if (flag === undefined) return []
  return flag.joined ? [`${flag.flag}${value}`] : [flag.flag, value]
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
  const switches = spec.switches ?? []
  const subtitle =
    input.subtitle === undefined || input.subtitle === ''
      ? []
      : [
          ...(player.id === 'MPlayer OSX Extended' && input.utf8Subtitle === true ? ['-utf8'] : []),
          ...flagArgs(spec.subswitch, input.subtitle),
        ]
  const fullscreen = input.fullscreen === true ? (spec.fs ?? []) : []
  const filename =
    spec.filenameswitch !== undefined && input.title !== undefined && input.title !== ''
      ? flagArgs(spec.filenameswitch, input.title)
      : []
  const url = spec.urlswitch === undefined ? [input.url] : flagArgs(spec.urlswitch, input.url)

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

export interface LaunchOptions {
  /** Called when the player process ends, so the caller can stop the stream it was given. */
  readonly onExit?: (code: number | null) => void
}

/**
 * Launches a player with an argv array; nothing is interpolated into a shell. The effect
 * resolves as soon as the process starts (not when it exits), and a failed launch is a
 * `DeviceError`. Exit is reported through `onExit` rather than blocking the caller.
 */
export function launchPlayer(
  player: ExternalPlayer,
  args: ReadonlyArray<string>,
  options: LaunchOptions = {},
): Effect.Effect<void, DeviceError> {
  const { file, prefix } = playerCommand(player)
  return Effect.async<void, DeviceError>((resume) => {
    const fail = (cause: unknown) =>
      new DeviceError({
        message: `cannot launch ${player.id}`,
        device: player.id,
        operation: 'launch',
        cause,
      })
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(file, [...prefix, ...args], { stdio: 'ignore' })
    } catch (cause) {
      resume(Effect.fail(fail(cause)))
      return
    }
    const onSpawn = () => resume(Effect.void)
    const onError = (cause: Error) => resume(Effect.fail(fail(cause)))
    child.once('spawn', onSpawn)
    child.once('error', onError)
    child.once('exit', (code) => options.onExit?.(code))
    return Effect.sync(() => {
      child.off('spawn', onSpawn)
      child.off('error', onError)
      // The exit listener stays attached: the process outlives this effect on purpose.
    })
  })
}

/** The names the legacy app listed in its player chooser. */
export const externalPlayerNames: ReadonlyArray<string> = Object.keys(EXTERNAL_PLAYERS)
