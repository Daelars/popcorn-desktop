import { createServer, request as httpRequest } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { Effect, Exit, Fiber, Layer, ManagedRuntime, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import type { WebTorrentTorrent } from 'webtorrent'
import {
  parseRange,
  TorrentEngine,
  type TorrentHandle,
  type TorrentProgress,
  TorrentService,
  TorrentServiceLive,
} from '../src/main/torrent'
import { handleOf } from '../src/main/webtorrent-engine'
import { TorrentError } from '../src/shared/errors'

const FILE_BYTES = Buffer.from('0123456789')

interface FakeState {
  destroyed: number
  selected: number
  paused: boolean
  emitted: (progress: TorrentProgress) => void
}

function fakeEngine(options: { failLoad?: boolean } = {}) {
  const state: FakeState = { destroyed: 0, selected: -1, paused: false, emitted: () => {} }

  const handle: TorrentHandle = {
    infoHash: 'aabbccddeeff',
    files: [{ name: 'movie.mp4', length: FILE_BYTES.length }],
    status: () => ({
      name: 'movie.mp4',
      length: FILE_BYTES.length,
      downloaded: 0,
      uploaded: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      peers: 0,
      progress: 0,
      paused: state.paused,
      files: [{ index: 0, name: 'movie.mp4', length: FILE_BYTES.length }],
    }),
    pause: Effect.sync(() => {
      state.paused = true
    }),
    resume: Effect.sync(() => {
      state.paused = false
    }),
    select: (index) =>
      Effect.sync(() => {
        state.selected = index
        const file = handle.files[index]
        if (file === undefined) throw new TorrentError({ message: 'no such file' })
        return file
      }),
    progress: Stream.asyncPush<TorrentProgress>((emit) => {
      state.emitted = (progress) => emit.single(progress)
      return Effect.void
    }),
    createReadStream: (_index, range) =>
      Readable.from(
        range === undefined ? FILE_BYTES : FILE_BYTES.subarray(range.start, range.end + 1),
      ),
    destroy: Effect.sync(() => {
      state.destroyed += 1
    }),
  }

  const layer = Layer.succeed(TorrentEngine, {
    load: () =>
      options.failLoad === true
        ? Effect.fail(new TorrentError({ message: 'no peers' }))
        : Effect.succeed(handle),
  })

  return { state, layer, handle }
}

function runtimeWith(engine: ReturnType<typeof fakeEngine>) {
  return ManagedRuntime.make(TorrentServiceLive.pipe(Layer.provide(engine.layer)))
}

function httpGet(
  url: string,
  headers: Record<string, string> = {},
): Promise<{
  status: number
  headers: Record<string, string | string[] | undefined>
  body: string
}> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { headers }, (res) => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        body += chunk
      })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }))
    })
    req.on('error', reject)
    req.end()
  })
}

const request = {
  torrentId: 'magnet:?xt=urn:btih:aabbccddeeff',
  fileIndex: 0,
  downloadPath: 'C:/tmp/popcorn',
  origin: 'http://localhost:5173',
}

describe('parseRange', () => {
  it('parses explicit and suffix ranges', () => {
    expect(parseRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 })
    expect(parseRange('bytes=-4', 10)).toEqual({ start: 6, end: 9 })
    expect(parseRange('bytes=4-', 10)).toEqual({ start: 4, end: 9 })
    expect(parseRange(undefined, 10)).toBeNull()
    expect(parseRange('bytes=20-30', 10)).toBeNull()
  })
})

describe('TorrentService', () => {
  it('streams the selected file from a loopback URL', async () => {
    const engine = fakeEngine()
    const runtime = runtimeWith(engine)

    await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* TorrentService
          const session = yield* service.start(request)
          expect(session.url).toBe(`http://127.0.0.1:${session.port}/0`)
          expect(session.infoHash).toBe('aabbccddeeff')

          const response = yield* Effect.promise(() => httpGet(session.url))
          expect(response.status).toBe(200)
          expect(response.body).toBe('0123456789')
        }),
      ),
    )
    await runtime.dispose()
  })

  it('serves range requests', async () => {
    const engine = fakeEngine()
    const runtime = runtimeWith(engine)

    await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* TorrentService
          const session = yield* service.start(request)
          const response = yield* Effect.promise(() => httpGet(session.url, { Range: 'bytes=2-5' }))
          expect(response.status).toBe(206)
          expect(response.headers['content-range']).toBe('bytes 2-5/10')
          expect(response.body).toBe('2345')
        }),
      ),
    )
    await runtime.dispose()
  })

  it('retries on EADDRINUSE with an ephemeral port', async () => {
    const engine = fakeEngine()
    const runtime = runtimeWith(engine)
    const occupied = createServer()
    const occupiedPort = await new Promise<number>((resolve) => {
      occupied.listen(0, '127.0.0.1', () => resolve((occupied.address() as AddressInfo).port))
    })

    try {
      await runtime.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const service = yield* TorrentService
            const session = yield* service.start({ ...request, port: occupiedPort })
            expect(session.port).not.toBe(occupiedPort)
            const response = yield* Effect.promise(() => httpGet(session.url))
            expect(response.status).toBe(200)
          }),
        ),
      )
    } finally {
      occupied.close()
      await runtime.dispose()
    }
  })

  it('closes the server when the scope ends and leaves the torrent loaded', async () => {
    const engine = fakeEngine()
    const runtime = runtimeWith(engine)

    let port = 0
    await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* TorrentService
          const session = yield* service.start(request)
          port = session.port
        }),
      ),
    )

    // The torrent is deliberately not destroyed: webtorrent 3 crashes when a torrent is
    // destroyed while its peers are live, and a later start reuses it by info hash.
    expect(engine.state.destroyed).toBe(0)
    expect(engine.state.selected).toBe(0)
    await expect(httpGet(`http://127.0.0.1:${port}/0`)).rejects.toThrow()
    await runtime.dispose()
  })

  it('only sends CORS headers for the allowed origin', async () => {
    const engine = fakeEngine()
    const runtime = runtimeWith(engine)

    await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* TorrentService
          const session = yield* service.start(request)

          const allowed = yield* Effect.promise(() =>
            httpGet(session.url, { Origin: request.origin }),
          )
          expect(allowed.headers['access-control-allow-origin']).toBe(request.origin)

          const hostile = yield* Effect.promise(() =>
            httpGet(session.url, { Origin: 'https://evil.test' }),
          )
          expect(hostile.status).toBe(200)
          expect(hostile.headers['access-control-allow-origin']).toBeUndefined()
        }),
      ),
    )
    await runtime.dispose()
  })

  it('streams download progress', async () => {
    const engine = fakeEngine()
    const runtime = runtimeWith(engine)

    await runtime.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const service = yield* TorrentService
          const session = yield* service.start(request)
          const first = yield* Effect.promise(async () => {
            const fiber = Effect.runFork(Stream.runCollect(Stream.take(session.progress, 1)))
            await new Promise((resolve) => setTimeout(resolve, 10))
            engine.state.emitted({
              downloaded: 5,
              uploaded: 1,
              speed: 100,
              peers: 2,
              progress: 0.5,
              length: 10,
              timeRemaining: 50,
            })
            return Effect.runPromise(Fiber.join(fiber))
          })
          expect(Array.from(first)).toEqual([
            {
              downloaded: 5,
              uploaded: 1,
              speed: 100,
              peers: 2,
              progress: 0.5,
              length: 10,
              timeRemaining: 50,
            },
          ])
        }),
      ),
    )
    await runtime.dispose()
  })

  it('lists files and keeps the torrent loaded when probing', async () => {
    const engine = fakeEngine()
    const runtime = runtimeWith(engine)

    const probe = await runtime.runPromise(
      Effect.flatMap(TorrentService, (service) =>
        service.probe(request.torrentId, request.downloadPath),
      ),
    )

    expect(probe.infoHash).toBe('aabbccddeeff')
    expect(probe.files).toEqual([{ index: 0, name: 'movie.mp4', length: FILE_BYTES.length }])
    // The handle stays loaded so a following stream start reuses it by info hash.
    expect(probe.handle).toBeDefined()
    expect(engine.state.destroyed).toBe(0)
    await runtime.dispose()
  })

  it('surfaces engine load failures as TorrentError', async () => {
    const engine = fakeEngine({ failLoad: true })
    const runtime = runtimeWith(engine)

    const exit = await runtime.runPromise(
      Effect.exit(
        Effect.scoped(Effect.flatMap(TorrentService, (service) => service.start(request))),
      ),
    )

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain('TorrentError')
    }
    await runtime.dispose()
  })
})

describe('webtorrent file selection', () => {
  function fakeTorrent() {
    const selected = new Set<number>()
    const files = [0, 1, 2].map((piece) => {
      const name = `episode-${piece + 1}.mkv`
      return {
        name,
        length: 10,
        path: name,
        createReadStream: () => Readable.from(Buffer.from('0123456789')),
        select: () => {
          selected.add(piece)
        },
        deselect: () => {
          selected.delete(piece)
        },
      }
    })
    const torrent: Record<string, unknown> = {
      infoHash: 'aabbccddeeff',
      name: 'Season 1',
      length: 30,
      files,
      pieces: [null, null, null],
      downloaded: 0,
      uploaded: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      numPeers: 0,
      progress: 0,
      paused: false,
      ready: true,
      once: () => torrent,
      on: () => torrent,
      off: () => torrent,
      select: (start: number, end: number) => {
        for (let piece = start; piece <= end; piece += 1) selected.add(piece)
      },
      deselect: (start: number, end: number) => {
        for (let piece = start; piece <= end; piece += 1) selected.delete(piece)
      },
      pause: () => {},
      resume: () => {},
      destroy: () => {},
    }
    return { torrent: torrent as unknown as WebTorrentTorrent, selected }
  }

  it('deselects every file and selects only the chosen one', () => {
    const { torrent, selected } = fakeTorrent()
    // WebTorrent selects every file by default when the torrent is added.
    selected.add(0)
    selected.add(1)
    selected.add(2)

    const handle = handleOf(torrent)
    const file = Effect.runSync(handle.select(1))

    expect(file.name).toBe('episode-2.mkv')
    expect([...selected]).toEqual([1])
  })
})
