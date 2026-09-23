/** `Common.fileSize` from the legacy app: 1024-based, two decimals, trailing zeros dropped. */
export function fileSize(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  const value = Math.trunc(bytes)
  if (!Number.isFinite(value) || value < 1) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']
  const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1)
  return `${Number((value / 1024 ** exponent).toFixed(2))} ${units[exponent]}`
}
