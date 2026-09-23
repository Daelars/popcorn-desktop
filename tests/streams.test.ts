import { Readable } from 'node:stream'
import { Effect, Fiber, Layer, ManagedRuntime, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  chooseFile,
  matchesEpisode,
  StreamSession,
  StreamSessionLive,
} from '../src/main/stream-session'
import { TorrentEngine, type TorrentHandle } from '../src/main/torrent'

const FILE_BYTES = Buffer.from('0123456789')

function fakeHandle() {
  const state = { paused: false, selected: -1 }
  const handle: TorrentHandle = {
    infoHash: 'aabbccddeeff',
    files: [
      { name: 'Show.S01E02.mkv', length: 10 },
      { name: 'movie.mp4', length: 100 },
    ],
    status: () => ({
      name: 'package',
      length: 110,
      downloaded: 0,
      uploaded: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      peers: 0,
      progress: 0,
      paused: state.paused,
      files: [
        { index: 0, name: 'Show.S01E02.mkv', length: 10 },
        { index: 1, name: 'movie.mp4', length: 100 },
      ],
    }),
    select: (index) => {
      state.selected = index
      const file = handle.files[index]
      if (file === undefined) throw new Error('no such file')
      return Effect.succeed(file)
    },
    progress: Stream.empty,
    createReadStream: () => Readable.from(FILE_BYTES),
    pause: Effect.sync(() => {
      state.paused = true
    }),
    resume: Effect.sync(() => {
      state.paused = false
    }),
    destroy: Effect.void,
  }
  const layer = Layer.succeed(TorrentEngine, { load: () => Effect.succeed(handle) })
  return { state, layer, handle }
}

function runtimeWith(engine: ReturnType<typeof fakeHandle>) {
  return ManagedRuntime.make(StreamSessionLive.pipe(Layer.provide(engine.layer)))
}

const request = {
  source: 'magnet:?xt=urn:btih:aabbccddeeff',
  downloadPath: 'C:/tmp/popcorn',
  origin: 'http://localhost:5173',
}

describe('chooseFile', () => {
  const files = [
    { index: 0, name: 'Show.S01E02.mkv', length: 10 },
    { index: 1, name: 'Show.S01E03.mkv', length: 20 },
    { index: 2, name: 'movie.mp4', length: 100 },
  ]

  it('prefers an explicit index', () => {
    expect(chooseFile(files, { ...request, fileIndex: 0 })).toBe(0)
  })

  it('matches the requested episode', () => {
    expect(chooseFile(files, { ...request, season: '1', episode: '3' })).toBe(1)
    expect(matchesEpisode('Show.S01E03.mkv', '1', '3')).toBe(true)
  })

  it('falls back to the largest video file', () => {
    expect(chooseFile(files, { ...request })).toBe(2)
  })
})

describe('StreamSession', () => {
  it('drives open -> states -> close through the fake engine', async () => {
    const engine = fakeHandle()
    const runtime = runtimeWith(engine)

    const states = await runtime.runPromise(
      Effect.gen(function* () {
        const session = yield* StreamSession
        const { id } = yield* session.open(request)
        // Collect until the session reaches `ready`.
        const collected = yield* session.states(id).pipe(
          Stream.takeUntil((state) => state.state === 'ready'),
          Stream.runCollect,
          Effect.timeout('5 seconds'),
        )
        const list = Array.from(collected)
        yield* session.close(id)
        return list
      }),
    )

    const names = states.map((state) => state.state)
    expect(names[names.length - 1]).toBe('ready')
    expect(names).toContain('downloading')
    const ready = states.find((state) => state.state === 'ready')
    expect(ready?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/\d$/)
    // Largest video wins when no episode hint is given.
    expect(engine.state.selected).toBe(1)
    expect(engine.state.paused).toBe(true)

    await runtime.dispose()
  })

  it('chooses the requested episode file', async () => {
    const engine = fakeHandle()
    const runtime = runtimeWith(engine)
    await runtime.runPromise(
      Effect.gen(function* () {
        const session = yield* StreamSession
        const { id } = yield* session.open({ ...request, season: '1', episode: '2' })
        yield* session.states(id).pipe(
          Stream.takeUntil((state) => state.state === 'ready' || state.state === 'failed'),
          Stream.runHead,
        )
        yield* session.close(id)
      }),
    )
    expect(engine.state.selected).toBe(0)
    await runtime.dispose()
  })

  it('lists torrent files for the picker', async () => {
    const engine = fakeHandle()
    const runtime = runtimeWith(engine)
    const probe = await runtime.runPromise(
      Effect.flatMap(StreamSession, (session) => session.files(request.source, 'C:/tmp')),
    )
    expect(probe.files).toEqual([
      { index: 0, name: 'Show.S01E02.mkv', length: 10 },
      { index: 1, name: 'movie.mp4', length: 100 },
    ])
    await runtime.dispose()
  })

  it('publishes progress on the renderer channel', async () => {
    const engine = fakeHandle()
    const runtime = runtimeWith(engine)
    const state = await runtime.runPromise(
      Effect.flatMap(StreamSession, (session) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(Stream.runHead(session.progress))
          yield* session.open(request)
          yield* Effect.sleep('20 millis')
          return yield* Fiber.join(fiber)
        }),
      ),
    )
    expect(state._tag).toBe('Some')
    await runtime.dispose()
  })
})
