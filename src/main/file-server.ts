import { createServer, type Server } from 'node:http'
import type { Readable } from 'node:stream'
import { Effect, type Scope } from 'effect'
import { TorrentError } from '../shared/errors'

export interface ByteRange {
  readonly start: number
  readonly end: number
}

export interface ServedFile {
  readonly name: string
  readonly length: number
}

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mov': 'video/quicktime',
  '.srt': 'application/x-subrip',
  '.vtt': 'text/vtt',
}

export function contentType(name: string): string {
  const dot = name.lastIndexOf('.')
  return (
    (dot === -1 ? undefined : CONTENT_TYPES[name.slice(dot).toLowerCase()]) ??
    'application/octet-stream'
  )
}

/** Single-range `bytes=start-end` parser; multi-range is not supported, matching the legacy server. */
export function parseRange(header: string | undefined, size: number): ByteRange | null {
  if (header === undefined) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (match === null) return null
  const [, rawStart, rawEnd] = match
  const start = rawStart === '' ? undefined : Number(rawStart)
  const end = rawEnd === '' ? undefined : Number(rawEnd)
  if (start === undefined && end === undefined) return null
  if (start === undefined) {
    const suffixLength = end as number
    if (suffixLength <= 0) return null
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }
  if (start >= size) return null
  return { start, end: Math.min(end ?? size - 1, size - 1) }
}

function isAddrInUse(error: TorrentError): boolean {
  return (error.cause as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE'
}

/** Binds loopback only; EADDRINUSE arrives as an 'error' event and retries on an ephemeral port. */
export function listen(server: Server, port: number): Effect.Effect<number, TorrentError> {
  return Effect.async<number, TorrentError>((resume) => {
    const onError = (cause: Error) => {
      server.removeListener('listening', onListening)
      resume(Effect.fail(new TorrentError({ message: `cannot bind 127.0.0.1:${port}`, cause })))
    }
    const onListening = () => {
      server.removeListener('error', onError)
      const address = server.address()
      resume(Effect.succeed(typeof address === 'object' && address !== null ? address.port : port))
    }
    server.once('listening', onListening)
    server.once('error', onError)
    server.listen(port, '127.0.0.1')
    return Effect.sync(() => {
      server.removeListener('listening', onListening)
      server.removeListener('error', onError)
    })
  })
}

/**
 * Serves one file's bytes from loopback with single-range support, for both a torrent's
 * stream and a file on disk. The server closes when its scope ends.
 */
export function serveFile(options: {
  readonly file: ServedFile
  readonly createStream: (range?: ByteRange) => Readable
  readonly port: number
  readonly origin: string
  readonly fileIndex?: number
}): Effect.Effect<{ port: number; url: string }, TorrentError, Scope.Scope> {
  const { file, createStream, origin } = options
  const fileIndex = options.fileIndex ?? 0
  return Effect.acquireRelease(
    Effect.gen(function* () {
      const server = createServer((request, response) => {
        const requestOrigin = request.headers.origin
        if (requestOrigin !== undefined && requestOrigin === origin) {
          response.setHeader('Access-Control-Allow-Origin', origin)
          response.setHeader('Vary', 'Origin')
        }
        response.setHeader('X-Content-Type-Options', 'nosniff')

        if (request.method === 'OPTIONS') {
          if (requestOrigin === origin) {
            response.statusCode = 204
            response.setHeader('Access-Control-Allow-Methods', 'GET,HEAD')
            response.setHeader('Access-Control-Allow-Headers', 'Range')
          } else {
            response.statusCode = 403
          }
          response.end()
          return
        }

        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
        if (pathname !== `/${fileIndex}`) {
          response.statusCode = 404
          response.end()
          return
        }
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405
          response.end()
          return
        }

        const range = parseRange(request.headers.range, file.length)
        response.setHeader('Accept-Ranges', 'bytes')
        response.setHeader('Content-Type', contentType(file.name))
        if (range === null) {
          response.statusCode = 200
          response.setHeader('Content-Length', file.length)
        } else {
          response.statusCode = 206
          response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${file.length}`)
          response.setHeader('Content-Length', range.end - range.start + 1)
        }
        console.log(
          `[stream] ${request.method} ${pathname} range=${request.headers.range ?? '-'} -> ${response.statusCode} ${contentType(file.name)}`,
        )
        if (request.method === 'HEAD') {
          response.end()
          return
        }

        const stream = createStream(range ?? undefined)
        stream.on('error', (cause: Error) => console.error('[stream] read error:', cause.message))
        response.on('close', () => {
          console.log(`[stream] response closed after ${response.socket?.bytesWritten ?? 0} bytes`)
          stream.destroy()
        })
        stream.pipe(response)
      })

      const bound = yield* listen(server, options.port).pipe(
        Effect.catchIf(isAddrInUse, () => listen(server, 0)),
      )
      return { server, port: bound }
    }),
    ({ server }) => Effect.sync(() => server.close()),
  ).pipe(
    Effect.map(({ port: bound }) => {
      console.log(`[stream] serving ${file.name} at http://127.0.0.1:${bound}/${fileIndex}`)
      return { port: bound, url: `http://127.0.0.1:${bound}/${fileIndex}` }
    }),
  )
}
