import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { transformPlaceholders } from '../scripts/generate-locales.mts'

const root = process.cwd()
const sourceDir = join(root, 'src/app/language')
const outDir = join(root, 'resources/locales')

describe('transformPlaceholders', () => {
  it('rewrites placeholder-free strings unchanged', () => {
    expect(transformPlaceholders('Movies')).toBe('Movies')
  })

  it('numbers placeholders from zero in order', () => {
    expect(transformPlaceholders('Season %s')).toBe('Season {{0}}')
    expect(transformPlaceholders('Increase playback rate by %s and %s again')).toBe(
      'Increase playback rate by {{0}} and {{1}} again',
    )
  })

  it('does not confuse a trailing full stop with a placeholder', () => {
    expect(transformPlaceholders('Initializing %s. Please Wait...')).toBe(
      'Initializing {{0}}. Please Wait...',
    )
  })
})

describe('generated locales', () => {
  it('transforms every locale file with no %s left behind', async () => {
    const files = (await readdir(sourceDir)).filter((file) => file.endsWith('.json'))
    expect(files).toHaveLength(64)

    for (const file of files) {
      const generated = await readFile(join(outDir, file), 'utf8')
      expect(generated, file).not.toContain('%s')
      const entries = JSON.parse(generated) as Record<string, string>
      expect(Object.keys(entries).length, file).toBeGreaterThan(0)
    }
  })

  it('keeps every English key, with placeholders rewritten', async () => {
    const source = JSON.parse(await readFile(join(sourceDir, 'en.json'), 'utf8'))
    const generated = JSON.parse(await readFile(join(outDir, 'en.json'), 'utf8'))
    expect(Object.keys(generated)).toHaveLength(Object.keys(source).length)
    expect(Object.keys(generated)).toHaveLength(534)
    expect(Object.keys(generated)).toContain('Season {{0}}')
    expect(Object.keys(generated)).not.toContain('Season %s')
  })

  it('rewrites values while keeping their meaning', async () => {
    const generated = JSON.parse(await readFile(join(outDir, 'en.json'), 'utf8'))
    expect(generated['Season {{0}}']).toBe('Season {{0}}')
    expect(generated['Initializing {{0}}. Please Wait...']).toBe(
      'Initializing {{0}}. Please Wait...',
    )
  })
})
