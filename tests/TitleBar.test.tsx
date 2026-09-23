import { fireEvent, render, screen } from '@testing-library/react'
import { beforeAll, expect, it, vi } from 'vitest'
import { TitleBar } from '../src/renderer/src/components/TitleBar'
import { initI18n } from '../src/renderer/src/i18n'
import type { PopcornBridge } from '../src/shared/ipc'

beforeAll(async () => {
  await initI18n()
})

function stubBridge() {
  const invoke = vi.fn(async () => undefined)
  const bridge = { invoke, onProgress: () => () => undefined } as unknown as PopcornBridge
  Object.defineProperty(window, 'popcorn', { value: bridge, configurable: true })
  return invoke
}

it('drives the window controls over IPC', () => {
  const invoke = stubBridge()
  render(<TitleBar />)

  fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
  expect(invoke).toHaveBeenCalledWith('window:minimize', {})

  fireEvent.click(screen.getByRole('button', { name: 'Maximize' }))
  expect(invoke).toHaveBeenCalledWith('window:maximize', {})

  fireEvent.click(screen.getByRole('button', { name: 'Close' }))
  expect(invoke).toHaveBeenCalledWith('window:close', {})
})
