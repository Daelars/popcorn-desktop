/**
 * Failures cross the IPC boundary as tagged data (`{ tag, message, context }`), not as
 * Error instances, so `String(error)` would render `[object Object]`.
 */
export function failureText(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'object' && error !== null) {
    const record = error as { tag?: unknown; message?: unknown; context?: unknown }
    const tag = typeof record.tag === 'string' ? record.tag : ''
    const message = typeof record.message === 'string' ? record.message : JSON.stringify(error)
    const context =
      record.context === undefined || record.context === null
        ? ''
        : ` ${JSON.stringify(record.context)}`
    return tag === '' ? `${message}${context}` : `${tag}: ${message}${context}`
  }
  return String(error)
}
