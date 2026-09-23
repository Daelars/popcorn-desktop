import { request as httpRequest } from 'node:http'
import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { srtToVtt } from '../src/main/subtitles/convert'
import { startSubtitleServer } from '../src/main/subtitles/server'

const srt = [
  '1',
  '00:00:01,000 --> 00:00:04,000',
  'First line',
  '',
  '2',
  '00:00:05,500 --> 00:00:07,250',
  'Second line',
  'with a continuation',
  '',
].join('\n')

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

describe('srtToVtt', () => {
  it('converts timestamps and keeps cue text', () => {
    const vtt = srtToVtt(srt)
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true)
    expect(vtt).toContain('00:00:01.000 --> 00:00:04.000')
    expect(vtt).toContain('Second line\nwith a continuation')
    expect(vtt).not.toContain('00:00:01,000')
  })

  it('tolerates CRLF, a BOM and missing index lines', () => {
    const messy = `\uFEFF00:00:01,000 --> 00:00:02,000\r\nOnly a cue\r\n`
    const vtt = srtToVtt(messy)
    expect(vtt).toContain('00:00:01.000 --> 00:00:02.000')
    expect(vtt).toContain('Only a cue')
  })

  it('drops blocks without a valid timing line', () => {
    expect(srtToVtt('not a subtitle at all')).toBe('WEBVTT\n\n\n')
  })
})

describe('subtitle server', () => {
  it('serves the vtt from loopback without reflecting origins', async () => {
    const server = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const handle = yield* startSubtitleServer(srtToVtt(srt))
          const response = yield* Effect.promise(() =>
            httpGet(handle.url, { Origin: 'https://evil.test' }),
          )
          expect(response.status).toBe(200)
          expect(response.headers['content-type']).toBe('text/vtt; charset=utf-8')
          expect(response.headers['access-control-allow-origin']).toBeUndefined()
          expect(response.body.startsWith('WEBVTT')).toBe(true)

          const missing = yield* Effect.promise(() => httpGet(`${handle.url}.nope`))
          expect(missing.status).toBe(404)
          return handle
        }),
      ),
    )
    expect(server.port).toBeGreaterThan(0)
  })
})
