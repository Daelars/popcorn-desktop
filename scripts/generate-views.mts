import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import stylus from 'stylus'

const root = process.cwd()
const stylDir = join(root, 'src/app/styl')
const outFile = join(root, 'resources/themes/views.css')
const TOKEN_DECLARATION = /^\s*\$([\w-]+)\s*=/gm

/** Token names come from the theme files; only those are rewritten to CSS variables. */
function tokenNames(): Set<string> {
  const names = new Set<string>()
  for (const file of readdirSync(stylDir)) {
    if (!file.endsWith('_theme.styl')) continue
    const source = readFileSync(join(stylDir, file), 'utf8')
    for (const match of source.matchAll(TOKEN_DECLARATION)) {
      if (match[1] !== undefined) names.add(match[1])
    }
  }
  return names
}

function transformStylFiles(dir: string, tokens: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      transformStylFiles(path, tokens)
      continue
    }
    if (!entry.name.endsWith('.styl')) continue
    const source = readFileSync(path, 'utf8')
    // nib's `normalize(prop, value, prefixes)` expands to prefixed declarations; the
    // nib JS helpers cannot load on Windows (see above), so expand it here.
    const denormalised = source
      .split('\n')
      .flatMap((line) => {
        const match =
          /^(\s*)([-a-z]+):\s*normalize\('([^']+)',\s*(.+?)(?:,\s*([a-z,\s]+))?\)\s*$/.exec(line)
        if (match === null) return [line]
        const [, indent = '', property = '', , value = '', prefixes = ''] = match
        const lines = [`${indent}${property}: ${value}`]
        if (prefixes.includes('webkit')) lines.push(`${indent}-webkit-${property}: ${value}`)
        if (prefixes.includes('moz')) lines.push(`${indent}-moz-${property}: ${value}`)
        return lines
      })
      .join('\n')
    // Stylus cannot evaluate colour functions on a CSS variable, so these become the
    // CSS-native equivalents before the token rewrite below.
    const transformed = denormalised
      .replace(
        /\brgba\(\s*\$([A-Za-z][\w-]*)\s*,\s*(\$[A-Za-z][\w-]*|[0-9.]+%?)\s*\)/g,
        (_whole, name: string, alpha: string) => {
          const amount = alpha.startsWith('$')
            ? `calc(var(--${alpha.slice(1)}) * 100%)`
            : alpha.endsWith('%')
              ? alpha
              : `${Math.round(Number(alpha) * 100)}%`
          return `unquote("color-mix(in srgb, var(--${name}) ${amount}, transparent)")`
        },
      )
      .replace(
        /\b(lighten|darken)\(\s*\$([A-Za-z][\w-]*)\s*,\s*([0-9.]+)%?\s*\)/g,
        (_whole, fn: string, name: string, amount: string) =>
          `unquote("color-mix(in srgb, var(--${name}) ${Math.max(0, 100 - Number(amount))}%, ${
            fn === 'lighten' ? 'white' : 'black'
          })")`,
      )
      .replace(/\$([A-Za-z][\w-]*)/g, (whole, name: string) =>
        tokens.has(name) ? `var(--${name})` : whole,
      )
    writeFileSync(path, transformed, 'utf8')
  }
}

const work = mkdtempSync(join(tmpdir(), 'popcorn-views-'))
try {
  cpSync(stylDir, work, { recursive: true })
  // nib's JS helper `use()` calls break Stylus 0.64 on Windows; the helpers only add
  // vendor-prefix data, so a local copy without them compiles cleanly.
  const nibSource = join(root, 'node_modules/nib')
  const nibWork = join(work, 'nib')
  cpSync(nibSource, nibWork, { recursive: true })
  for (const entry of readdirSync(nibWork, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.styl')) continue
    const path = join(entry.parentPath ?? nibWork, entry.name)
    const source = readFileSync(path, 'utf8').replace(/^.*\buse\([^)]*\).*$/gm, '')
    writeFileSync(path, source, 'utf8')
  }
  const tokens = tokenNames()
  transformStylFiles(work, tokens)

  const css = await new Promise<string>((resolve, reject) => {
    stylus(readFileSync(join(work, 'views/app.styl'), 'utf8'))
      .set('filename', join(work, 'views/app.styl').replace(/\\\\/g, '/'))
      .set(
        'paths',
        [work, join(work, 'views'), join(root, 'node_modules')].map((p) => p.replace(/\\\\/g, '/')),
      )
      // nib's JS helper (normally loaded through `use()`, which breaks on Windows) maps
      // values for specific properties. Passing values through keeps the declarations
      // valid; only niche legacy value-shims differ.
      .define('normalize', (_property: unknown, value: unknown) => value as never)
      .render((error: Error | null, output: string) => {
        if (error) reject(error)
        else resolve(output)
      })
  })

  // The legacy stylesheets target the Font Awesome 6 webfont family; the app ships a
  // newer major whose fonts register under a different family name.
  const faVersion = JSON.parse(
    readFileSync(join(root, 'node_modules/@fortawesome/fontawesome-free/package.json'), 'utf8'),
  ) as { version: string }
  const faMajor = faVersion.version.split('.')[0]
  const patched = css.replace(
    /"Font Awesome \d+ (Free|Brands)"/g,
    (_whole, style: string) => `"Font Awesome ${faMajor} ${style}"`,
  )

  // The theme points the language flags at node_modules; the packaged app only ships
  // resources/, so the flags are copied beside the other theme images and re-pointed.
  const flagSource = join(root, 'node_modules/flag-icons/flags/4x3')
  const flagTarget = join(root, 'resources/images/flags')
  mkdirSync(flagTarget, { recursive: true })
  for (const file of readdirSync(flagSource)) {
    if (file.endsWith('.svg')) cpSync(join(flagSource, file), join(flagTarget, file))
  }
  const withFlags = patched.replaceAll('/node_modules/flag-icons/flags/4x3/', '../images/flags/')

  writeFileSync(
    outFile,
    `/* Generated by scripts/generate-views.mts - do not edit. */\n${withFlags}`,
    'utf8',
  )
  console.log(`Generated ${outFile} (${withFlags.length} bytes, ${tokens.size} tokens rewritten)`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
