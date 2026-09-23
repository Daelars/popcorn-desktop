import { Readable } from 'node:stream'
import { Effect, Fiber, Layer, ManagedRuntime, Schema, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { StreamManager, StreamManagerLive } from '../src/main/streams'
import { type StreamSession, type TorrentHandle, TorrentService } from '../src/main/torrent'
import { events } from '../src/shared/ipc'

type Emit = (progress: {
  downloaded: number
  uploaded: number
  speed: number
  peers: number
  progress: number
  length: number
  timeRemaining: number
}) => void

function fakeTorrentService() {
  const state = {
    destroyed: 0,
    started: [] as string[],
    paused: false,
    emit: (_progress: unknown) => {},
  }
  const handle: TorrentHandle = {
    infoHash: 'hash-1',
    files: [{ name: 'movie.mp4', length: 10 }],
    status: () => ({
      name: 'Movie',
      length: 10,
      downloaded: 4,
      uploaded: 1,
      downloadSpeed: 2,
      uploadSpeed: 1,
      peers: 3,
      progress: 0.4,
      paused: state.paused,
      files: [{ index: 0, name: 'movie.mp4', length: 10 }],
    }),
    select: () => Effect.succeed({ name: 'movie.mp4', length: 10 }),
    progress: Stream.empty,
    createReadStream: () => Readable.from(Buffer.from('x')),
    pause: Effect.sync(() => {
      state.paused = true
    }),
    resume: Effect.sync(() => {
      state.paused = false
    }),
    destroy: Effect.void,
  }
  const layer = Layer.succeed(TorrentService, {
    start: (request: { torrentId: string; fileIndex: number }) =>
      Effect.gen(function* () {
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            state.destroyed += 1
          }),
        )
        state.started.push(request.torrentId)
        const session: StreamSession = {
          infoHash: 'hash-1',
          port: 41000,
          url: 'http://127.0.0.1:41000/0',
          progress: Stream.asyncPush<Parameters<Emit>[0]>((emit) => {
            state.emit = (progress) => emit.single(progress as Parameters<Emit>[0])
            return Effect.void
          }),
          handle,
        }
        return session
      }),
    probe: (torrentId: string) =>
      Effect.succeed({
        infoHash: torrentId,
        files: [{ index: 0, name: 'movie.mp4', length: 10 }],
        handle,
      }),
  })
  return { state, layer }
}

function managerRuntime(service: ReturnType<typeof fakeTorrentService>) {
  return ManagedRuntime.make(StreamManagerLive.pipe(Layer.provide(service.layer)))
}

const request = {
  torrentId: 'magnet:?xt=urn:btih:abc',
  fileIndex: 0,
  downloadPath: '',
  origin: 'http://localhost',
}

describe('StreamManager', () => {
  it('starts a session and exposes its loopback URL', async () => {
    const service = fakeTorrentService()
    const runtime = managerRuntime(service)
    const handle = await runtime.runPromise(
      Effect.flatMap(StreamManager, (manager) => manager.start(request)),
    )
    expect(handle).toEqual({ infoHash: 'hash-1', port: 41000, url: 'http://127.0.0.1:41000/0' })
    expect(service.state.started).toEqual(['magnet:?xt=urn:btih:abc'])
    await runtime.dispose()
  })

  it('stops a session by info hash exactly once', async () => {
    const service = fakeTorrentService()
    const runtime = managerRuntime(service)
    await runtime.runPromise(Effect.flatMap(StreamManager, (manager) => manager.start(request)))
    await runtime.runPromise(Effect.flatMap(StreamManager, (manager) => manager.stop('hash-1')))
    await runtime.runPromise(Effect.flatMap(StreamManager, (manager) => manager.stop('hash-1')))
    expect(service.state.destroyed).toBe(1)
    await runtime.dispose()
  })

  it('lists live torrents with their status', async () => {
    const service = fakeTorrentService()
    const runtime = managerRuntime(service)
    await runtime.runPromise(Effect.flatMap(StreamManager, (manager) => manager.start(request)))
    const list = await runtime.runPromise(Effect.flatMap(StreamManager, (manager) => manager.list))
    expect(list).toEqual([
      {
        infoHash: 'hash-1',
        name: 'Movie',
        length: 10,
        downloaded: 4,
        uploaded: 1,
        downloadSpeed: 2,
        uploadSpeed: 1,
        peers: 3,
        progress: 0.4,
        paused: false,
        files: [{ index: 0, name: 'movie.mp4', length: 10 }],
      },
    ])
    await runtime.dispose()
  })

  it('pauses and resumes a live torrent', async () => {
    const service = fakeTorrentService()
    const runtime = managerRuntime(service)
    await runtime.runPromise(Effect.flatMap(StreamManager, (manager) => manager.start(request)))
    await runtime.runPromise(Effect.flatMap(StreamManager, (manager) => manager.pause('hash-1')))
    const paused = await runtime.runPromise(
      Effect.flatMap(StreamManager, (manager) => manager.list),
    )
    expect(paused[0]?.paused).toBe(true)
    await runtime.runPromise(Effect.flatMap(StreamManager, (manager) => manager.resume('hash-1')))
    const resumed = await runtime.runPromise(
      Effect.flatMap(StreamManager, (manager) => manager.list),
    )
    expect(resumed[0]?.paused).toBe(false)
    await runtime.dispose()
  })

  it('lists torrent files for the picker', async () => {
    const service = fakeTorrentService()
    const runtime = managerRuntime(service)
    const probe = await runtime.runPromise(
      Effect.flatMap(StreamManager, (manager) => manager.files(request.torrentId, 'C:/tmp')),
    )
    expect(probe.files).toEqual([{ index: 0, name: 'movie.mp4', length: 10 }])
    await runtime.dispose()
  })

  it('publishes session progress to subscribers', async () => {
    const service = fakeTorrentService()
    const runtime = managerRuntime(service)
    const progress = await runtime.runPromise(
      Effect.flatMap(StreamManager, (manager) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.fork(Stream.runHead(manager.progress))
          yield* Effect.sleep('10 millis')
          yield* manager.start(request)
          yield* Effect.sleep('10 millis')
          service.state.emit({
            downloaded: 1,
            uploaded: 0,
            speed: 2,
            peers: 3,
            progress: 0.5,
            length: 100,
            timeRemaining: 5000,
          })
          return yield* Fiber.join(fiber)
        }),
      ),
    )
    expect(progress._tag).toBe('Some')
    if (progress._tag === 'Some') {
      expect(progress.value).toMatchObject({
        infoHash: 'hash-1',
        downloaded: 1,
        uploaded: 0,
        speed: 2,
        peers: 3,
        progress: 0.5,
      })
      // The preload bridge decodes with this schema; an untagged payload used to throw here.
      expect(Schema.decodeUnknownSync(events['streams:progress'])(progress.value)).toMatchObject({
        infoHash: 'hash-1',
      })
    }
    await runtime.dispose()
  })
})
