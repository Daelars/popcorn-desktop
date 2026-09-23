import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { Context, Effect, Exit, Layer, Ref, Scope } from 'effect'
import { SubtitleError, TorrentError } from '../shared/errors'
import { serveFile } from './file-server'
import { srtToVtt } from './subtitles/convert'
import { startSubtitleServer } from './subtitles/server'

/** A local file being served to the player, plus the sidecar subtitle found beside it. */
export interface LocalFileHandle {
  readonly port: number
  readonly url: string
  readonly name: string
  readonly subtitle?: string
}

export interface LocalFilesShape {
  readonly serve: (
    path: string,
    origin: string,
  ) => Effect.Effect<LocalFileHandle, TorrentError | SubtitleError>
  readonly stop: (port: number) => Effect.Effect<void>
  /** Converts a dropped `.srt`/`.vtt` to WebVTT and serves it for the player. */
  readonly subtitle: (
    path: string,
    origin: string,
  ) => Effect.Effect<{ port: number; url: string }, TorrentError | SubtitleError>
  /** Serves subtitle text that is already WebVTT (a provider download). */
  readonly serveVtt: (
    vtt: string,
    origin: string,
  ) => Effect.Effect<{ port: number; url: string }, SubtitleError>
}

export class LocalFiles extends Context.Tag('LocalFiles')<LocalFiles, LocalFilesShape>() {}

/** `movie.mkv` looks for `movie.srt` / `movie.vtt` / `movie.en.srt` beside it. */
export function sidecarSubtitle(path: string): string | undefined {
  const extension = extname(path)
  const base = extension === '' ? path : path.slice(0, path.length - extension.length)
  const candidates = [`${base}.srt`, `${base}.vtt`, join(dirname(path), `${basename(base)}.en.srt`)]
  return candidates.find((candidate) => existsSync(candidate))
}

export const LocalFilesLive = Layer.scoped(
  LocalFiles,
  Effect.gen(function* () {
    const sessions = yield* Ref.make(new Map<number, Scope.CloseableScope>())

    const keep = (scope: Scope.CloseableScope, port: number) =>
      Ref.update(sessions, (current) => new Map(current).set(port, scope))

    const serve: LocalFilesShape['serve'] = (path, origin) =>
      Effect.gen(function* () {
        const size = yield* Effect.try({
          try: () => statSync(path).size,
          catch: (cause) => new TorrentError({ message: `cannot read ${path}`, cause }),
        })
        const scope = yield* Scope.make()
        const served = yield* Scope.extend(
          serveFile({
            file: { name: basename(path), length: size },
            createStream: (range) =>
              range === undefined
                ? createReadStream(path)
                : createReadStream(path, { start: range.start, end: range.end }),
            port: 0,
            origin,
          }),
          scope,
        )
        yield* keep(scope, served.port)
        const subtitle = sidecarSubtitle(path)
        return {
          port: served.port,
          url: served.url,
          name: basename(path),
          ...(subtitle === undefined ? {} : { subtitle }),
        }
      })

    const stop: LocalFilesShape['stop'] = (port) =>
      Effect.gen(function* () {
        const scope = (yield* Ref.get(sessions)).get(port)
        if (scope === undefined) return
        yield* Scope.close(scope, Exit.void)
        yield* Ref.update(sessions, (current) => {
          const next = new Map(current)
          next.delete(port)
          return next
        })
      })

    const subtitle: LocalFilesShape['subtitle'] = (path, origin) =>
      Effect.gen(function* () {
        const extension = extname(path).toLowerCase()
        if (extension !== '.srt' && extension !== '.vtt') {
          return yield* Effect.fail(
            new SubtitleError({
              message: `${extension || 'file'} is not a subtitle`,
              source: path,
            }),
          )
        }
        const source = yield* Effect.try({
          try: () => readFileSync(path, 'utf8'),
          catch: (cause) => new TorrentError({ message: `cannot read subtitle at ${path}`, cause }),
        })
        const scope = yield* Scope.make()
        const served = yield* Scope.extend(
          startSubtitleServer(extension === '.vtt' ? source : srtToVtt(source), 0, origin),
          scope,
        )
        yield* keep(scope, served.port)
        return { port: served.port, url: served.url }
      })

    const serveVtt: LocalFilesShape['serveVtt'] = (vtt, origin) =>
      Effect.gen(function* () {
        const scope = yield* Scope.make()
        const served = yield* Scope.extend(startSubtitleServer(vtt, 0, origin), scope)
        yield* keep(scope, served.port)
        return { port: served.port, url: served.url }
      })

    return LocalFiles.of({ serve, stop, subtitle, serveVtt })
  }),
)
