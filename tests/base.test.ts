import { describe, expect, it } from 'vitest'
import { processArgs } from '../src/main/providers/base'

describe('processArgs', () => {
  it('parses the OBJECT arg type — the path that used to throw JSON.Parse', () => {
    const result = processArgs({ config: 'object' }, { config: '{"quality":"1080p"}' })
    expect(result).toEqual({ config: { quality: '1080p' } })
  })

  it('coerces the other arg types', () => {
    expect(processArgs({ count: 'number' }, { count: '42' })).toEqual({ count: 42 })
    expect(processArgs({ list: 'array' }, { list: 'a,b,c' })).toEqual({ list: ['a', 'b', 'c'] })
    expect(processArgs({ flag: 'boolean' }, { flag: 'yes' })).toEqual({ flag: true })
    expect(processArgs({ name: 'string' }, { name: 'value' })).toEqual({ name: 'value' })
  })

  it('skips args the caller did not provide', () => {
    expect(processArgs({ a: 'string', b: 'number' }, { a: 'x' })).toEqual({ a: 'x' })
    expect(processArgs({ a: 'string' }, undefined)).toEqual({})
  })
})
