import { request as httpRequest } from 'node:http'
import { Effect } from 'effect'
import iconv from 'iconv-lite'
import { describe, expect, it } from 'vitest'
import { srtToVtt } from '../src/main/subtitles/convert'
import { isSupportedFormat, searchQuery, subtitleText } from '../src/main/subtitles/opensubtitles'
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

describe('episode-aware subtitle search', () => {
  it('sends season, episode, the file hash and its size', () => {
    const query = searchQuery({
      imdbId: 'tt0944947',
      season: '1',
      episode: '2',
      fileHash: 'abc',
      fileSize: 42,
    })
    expect(query).toMatchObject({
      imdbid: '0944947',
      season: '1',
      episode: '2',
      moviehash: 'abc',
      moviebytesize: '42',
    })
  })

  it('accepts only the formats the converter supports', () => {
    expect(isSupportedFormat('srt')).toBe(true)
    expect(isSupportedFormat('VTT')).toBe(true)
    expect(isSupportedFormat('sub')).toBe(false)
    expect(isSupportedFormat('')).toBe(true)
  })
})

describe('subtitle encoding', () => {
  it('falls back to the language encoding and yields valid VTT', () => {
    const cyrillic = ['1', '00:00:01,000 --> 00:00:04,000', 'Привет мир', ''].join('\r\n')
    const buffer = iconv.encode(cyrillic, 'windows-1251')
    const vtt = subtitleText(buffer, 'application/x-subrip', 'ru')
    expect(vtt.startsWith('WEBVTT')).toBe(true)
    expect(vtt).toContain('Привет мир')
    expect(vtt).not.toContain('\uFFFD')
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
