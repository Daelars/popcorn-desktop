import { describe, expect, it } from 'vitest'
import { createBridge, type IpcTransport } from '../src/shared/bridge'

function fakeTransport(handler: (channel: string, payload: unknown) => unknown) {
  const calls: Array<{ channel: string; payload: unknown }> = []
  let listener: ((payload: unknown) => void) | null = null
  const transport: IpcTransport = {
    invoke: async (channel, payload) => {
      calls.push({ channel, payload })
      return handler(channel, payload)
    },
    on: (_channel, next) => {
      listener = next
      return () => {
        listener = null
      }
    },
    pathForFile: (file) => `/dropped/${String(file)}`,
  }
  return { transport, calls, emit: (payload: unknown) => listener?.(payload) }
}

describe('preload bridge', () => {
  it('sends a decoded request and returns the validated value', async () => {
    const { transport, calls } = fakeTransport(() => ({ ok: true, value: 'Official_-_Dark_theme' }))
    const bridge = createBridge(transport)

    const theme = await bridge.invoke('settings:get', { key: 'theme' })

    expect(theme).toBe('Official_-_Dark_theme')
    expect(calls).toEqual([{ channel: 'settings:get', payload: { key: 'theme' } }])
  })

  it('rejects an invalid request before it reaches the transport', async () => {
    const { transport, calls } = fakeTransport(() => ({ ok: true, value: null }))
    const bridge = createBridge(transport)

    await expect(
      bridge.invoke('settings:get', { key: 42 } as unknown as { key: string }),
    ).rejects.toThrow()
    expect(calls).toHaveLength(0)
  })

  it('throws tagged failure data from a failed envelope', async () => {
    const { transport } = fakeTransport(() => ({
      ok: false,
      error: { tag: 'SettingsError', message: 'unknown settings key', context: { key: 'nope' } },
    }))
    const bridge = createBridge(transport)

    await expect(bridge.invoke('settings:get', { key: 'nope' })).rejects.toMatchObject({
      tag: 'SettingsError',
      context: { key: 'nope' },
    })
  })

  it('rejects a response that violates its contract', async () => {
    const { transport } = fakeTransport(() => ({ ok: true, value: [{ imdbId: 7 }] }))
    const bridge = createBridge(transport)

    await expect(bridge.invoke('bookmarks:list', {})).rejects.toThrow()
  })

  it('validates progress events and unsubscribes cleanly', () => {
    const { transport, emit } = fakeTransport(() => ({ ok: true, value: null }))
    const bridge = createBridge(transport)
    const received: Array<{ progress: number }> = []

    const unsubscribe = bridge.onProgress((payload) => received.push(payload))
    emit({
      infoHash: 'abc',
      downloaded: 1,
      uploaded: 0,
      speed: 2,
      uploadSpeed: 3,
      peers: 3,
      progress: 0.5,
      length: 100,
      timeRemaining: 50,
    })
    expect(received).toEqual([
      {
        infoHash: 'abc',
        downloaded: 1,
        uploaded: 0,
        speed: 2,
        uploadSpeed: 3,
        peers: 3,
        progress: 0.5,
        length: 100,
        timeRemaining: 50,
      },
    ])

    expect(() => emit({ infoHash: 'abc', progress: 'half' })).toThrow()
    unsubscribe()
  })
})
