const TIMESTAMP = /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/

/** Strips a UTF-8 BOM and normalises line endings so parsing is uniform. */
function normalise(input: string): string {
  return input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
}

/**
 * SRT to WebVTT. The legacy pipeline used a package for this; the conversion is a
 * timestamp separator change plus a header, and a missing index line is tolerated.
 */
export function srtToVtt(input: string): string {
  const source = normalise(input)
  const blocks = source.split(/\n{2,}/).filter((block) => block.trim().length > 0)
  const cues: string[] = []

  for (const block of blocks) {
    const lines = block.split('\n').filter((line) => line.trim().length > 0)
    if (lines.length === 0) continue
    const first = lines[0] as string
    const startsWithIndex = /^\d+$/.test(first.trim())
    const timingIndex = startsWithIndex ? 1 : 0
    const timing = lines[timingIndex]
    if (timing === undefined || !TIMESTAMP.test(timing)) continue

    const converted = timing.replace(TIMESTAMP, '$1.$2 --> $3.$4')
    const text = lines.slice(timingIndex + 1).join('\n')
    cues.push(`${converted}\n${text}`)
  }

  return `WEBVTT\n\n${cues.join('\n\n')}\n`
}
