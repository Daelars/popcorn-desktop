import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

// pnpm scripts run from the repo root, and so does Vitest.
const root = process.cwd()
const sourceDir = join(root, 'src/app/language')
const outDir = join(root, 'resources/locales')

/**
 * Rewrites legacy printf-style %s placeholders to i18next positional {{0}}, {{1}}, ...
 * Applied to keys as well as values: call sites become t('Season {{0}}', { 0: 3 }).
 */
export function transformPlaceholders(value: string): string {
  let index = 0
  return value.replace(/%s/g, () => {
    const placeholder = `{{${index}}}`
    index += 1
    return placeholder
  })
}

export function transformLocale(entries: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(entries).map(([key, value]) => [
      transformPlaceholders(key),
      transformPlaceholders(value),
    ]),
  )
}

/** Transforms every locale under src/app/language into resources/locales. Returns the file names written. */
export async function generateAll(): Promise<string[]> {
  const files = (await readdir(sourceDir)).filter((file) => file.endsWith('.json')).sort()
  if (files.length === 0) {
    throw new Error(`no locale files in ${sourceDir}`)
  }

  await mkdir(outDir, { recursive: true })
  for (const file of files) {
    const source = JSON.parse(await readFile(join(sourceDir, file), 'utf8')) as Record<
      string,
      string
    >
    const transformed = transformLocale(source)
    await writeFile(join(outDir, file), `${JSON.stringify(transformed, null, 2)}\n`, 'utf8')
  }
  return files
}

if ((process.argv[1] ?? '').endsWith('generate-locales.mts')) {
  const files = await generateAll()
  console.log(`Generated ${files.length} locales`)
}
