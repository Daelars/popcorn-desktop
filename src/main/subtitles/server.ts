import { createServer, type Server } from 'node:http'
import { Effect, type Scope } from 'effect'
import { SubtitleError } from '../../shared/errors'

export interface SubtitleServer {
  readonly port: number
  readonly url: string
}

function listen(server: Server, port: number): Effect.Effect<number, SubtitleError> {
  return Effect.async<number, SubtitleError>((resume) => {
    const onError = (cause: Error) => {
      server.removeListener('listening', onListening)
      resume(
        Effect.fail(
          new SubtitleError({ message: 'cannot bind subtitle server', source: 'subtitles', cause }),
        ),
      )
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
 * Serves one WebVTT document from loopback. The legacy reflected any Origin header; here
 * only the app's own origin is allowed, so a hostile page cannot read subtitles.
 */
export function startSubtitleServer(
  vtt: string,
  port = 0,
  origin?: string,
): Effect.Effect<SubtitleServer, SubtitleError, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.gen(function* () {
      const server = createServer((request, response) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') {
          response.statusCode = 405
          response.end()
          return
        }
        const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
        if (pathname !== '/' && pathname !== '/subtitles.vtt') {
          response.statusCode = 404
          response.end()
          return
        }
        // A `<track>` is a CORS request, so the app's own origin is allowed and nothing else.
        if (origin !== undefined && request.headers.origin === origin) {
          response.setHeader('Access-Control-Allow-Origin', origin)
          response.setHeader('Vary', 'Origin')
        }
        response.setHeader('Content-Type', 'text/vtt; charset=utf-8')
        response.setHeader('X-Content-Type-Options', 'nosniff')
        response.setHeader('Content-Security-Policy', "default-src 'none'")
        response.end(vtt)
      })
      const bound = yield* listen(server, port)
      return { server, port: bound }
    }),
    ({ server }) => Effect.sync(() => server.close()),
  ).pipe(
    Effect.map(({ port: bound }) => ({
      port: bound,
      url: `http://127.0.0.1:${bound}/subtitles.vtt`,
    })),
  )
}
