import { describe, expect, it } from 'vitest'
import { parseRange } from '../src/main/torrent'

describe('parseRange', () => {
  it('parses explicit and suffix ranges', () => {
    expect(parseRange('bytes=2-5', 10)).toEqual({ start: 2, end: 5 })
    expect(parseRange('bytes=-4', 10)).toEqual({ start: 6, end: 9 })
    expect(parseRange('bytes=4-', 10)).toEqual({ start: 4, end: 9 })
    expect(parseRange(undefined, 10)).toBeNull()
    expect(parseRange('bytes=20-30', 10)).toBeNull()
  })
})
