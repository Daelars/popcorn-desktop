import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { compileTheme, themeNameFromFile } from '../scripts/generate-themes.mts'

const root = process.cwd()
const stylDir = join(root, 'src/app/styl')
const outDir = join(root, 'resources/themes')

const SINGLE_TOKEN_THEMES = 100
const TOKEN_COUNTS: Record<string, number> = {
  'Sebastiaans_-_Black_&_Red_theme': 101,
}

interface Theme {
  name: string
  source: string
  tokens: Map<string, string>
}

let themes: Theme[] = []

beforeAll(async () => {
  const files = (await readdir(stylDir)).filter((file) => file.endsWith('_theme.styl')).sort()
  themes = await Promise.all(
    files.map(async (file) => {
      const source = await readFile(join(stylDir, file), 'utf8')
      return { name: themeNameFromFile(file), source, tokens: await compileTheme(source) }
    }),
  )
})

describe('compileTheme', () => {
  it('compiles every theme file', () => {
    expect(themes).toHaveLength(7)
  })

  it('keeps every declared token', () => {
    for (const theme of themes) {
      const declared = new Set([...theme.source.matchAll(/^\s*\$([\w-]+)\s*=/gm)].map((m) => m[1]))
      expect(theme.tokens.size, theme.name).toBe(declared.size)
      expect(theme.tokens.size, theme.name).toBe(TOKEN_COUNTS[theme.name] ?? SINGLE_TOKEN_THEMES)
    }
  })

  it('preserves literal hex values byte for byte', () => {
    for (const theme of themes) {
      for (const match of theme.source.matchAll(/^\s*\$([\w-]+)\s*=\s*(#[0-9a-f]{3,8})\s*$/gim)) {
        const name = match[1] as string
        const literal = match[2] as string
        expect(theme.tokens.get(name), `${theme.name} ${name}`).toBe(literal)
      }
    }
  })

  it('resolves computed expressions to concrete values', () => {
    const dark = themes.find((theme) => theme.name === 'Official_-_Dark_theme')
    expect(dark).toBeDefined()
    expect(dark?.tokens.get('BgColor1')).toBe('#17181b')
    expect(dark?.tokens.get('ShowOddHighlight')).toBe('#979ba6')
    expect(dark?.tokens.get('EpisodeSelectorHoverTran')).toBe('#7b7e90')
  })

  it('derives the theme name from the file name', () => {
    expect(themeNameFromFile('Official_-_Dark_theme.styl')).toBe('Official_-_Dark_theme')
  })
})

describe('generated output', () => {
  it('exposes each theme under its legacy data-theme name', async () => {
    const css = await readFile(join(outDir, 'Official_-_Dark_theme.css'), 'utf8')
    expect(css).toContain(':root[data-theme="Official_-_Dark_theme"]')
    expect(css).toContain('--BgColor1: #17181b;')
  })

  it('emits the legacy default theme in the manifest', async () => {
    const manifest = JSON.parse(await readFile(join(outDir, 'themes.json'), 'utf8'))
    const settings = await readFile(join(root, 'src/app/settings.js'), 'utf8')
    const legacyDefault = /Settings\.theme\s*=\s*'([^']+)'/.exec(settings)?.[1]
    expect(manifest.default).toBe(legacyDefault)
    expect(manifest.themes).toHaveLength(7)
  })

  it('maps colour tokens into the Tailwind scale and leaves strings out', async () => {
    const index = await readFile(join(outDir, 'index.css'), 'utf8')
    expect(index).toContain('--color-BgColor1: var(--BgColor1);')
    expect(index).toContain('--color-NotificationError: var(--NotificationError);')
    expect(index).not.toContain('--color-Font:')
    expect(index).not.toContain('--color-ButtonRadius:')
    expect(index.match(/@import "/g)).toHaveLength(7)
  })
})
