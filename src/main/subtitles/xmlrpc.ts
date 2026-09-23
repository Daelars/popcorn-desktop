import { Effect } from 'effect'
import { XMLParser } from 'fast-xml-parser'
import { SubtitleError } from '../../shared/errors'

/**
 * The OpenSubtitles API the legacy used (`opensubtitles-api`) speaks XML-RPC. This is a
 * deliberately small client for it: `call` posts a method and `unwrap` turns the parsed
 * `<methodResponse>` back into plain JavaScript values.
 */

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  isArray: (name) => name === 'value' || name === 'member' || name === 'param',
})

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function param(value: unknown): string {
  if (typeof value === 'string')
    return `<param><value><string>${escapeXml(value)}</string></value></param>`
  if (typeof value === 'number') return `<param><value><int>${value}</int></value></param>`
  if (Array.isArray(value)) {
    const entries = value.map((entry) => `<value>${structBody(entry)}</value>`).join('')
    return `<param><value><array><data>${entries}</data></array></value></param>`
  }
  return `<param><value>${structBody(value)}</value></param>`
}

function structBody(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return `<string>${escapeXml(String(value))}</string>`
  const members = Object.entries(value as Record<string, unknown>)
    .map(([name, entry]) => `<member><name>${escapeXml(name)}</name>${memberValue(entry)}</member>`)
    .join('')
  return `<struct>${members}</struct>`
}

function memberValue(value: unknown): string {
  if (typeof value === 'string') return `<value><string>${escapeXml(value)}</string></value>`
  if (typeof value === 'number') return `<value><int>${value}</int></value>`
  if (typeof value === 'boolean') return `<value><boolean>${value ? 1 : 0}</boolean></value>`
  if (Array.isArray(value)) {
    const entries = value.map((entry) => `<value>${structBody(entry)}</value>`).join('')
    return `<value><array><data>${entries}</data></array></value>`
  }
  return `<value>${structBody(value)}</value>`
}

/** Unwraps one `<value>` node: typed scalars, arrays (`<data>`) and structs (`<member>`). */
function unwrap(node: unknown): unknown {
  // XML-RPC values are single-valued; fast-xml-parser is told to always make them arrays.
  if (Array.isArray(node)) return node.length === 0 ? undefined : unwrap(node[0])
  if (node === null || typeof node !== 'object') return node
  const record = node as Record<string, unknown>
  if ('string' in record) return record.string
  if ('int' in record) return Number(record.int)
  if ('i4' in record) return Number(record.i4)
  if ('double' in record) return Number(record.double)
  if ('boolean' in record) return Number(record.boolean) === 1
  if ('array' in record) {
    const data = (record.array as { data?: { value?: unknown } }).data ?? {}
    const values = data.value ?? []
    return (Array.isArray(values) ? values : [values]).map(unwrap)
  }
  if ('struct' in record) {
    const members = (record.struct as { member?: unknown }).member ?? []
    const list = Array.isArray(members) ? members : [members]
    const result: Record<string, unknown> = {}
    for (const entry of list) {
      const member = entry as { name?: unknown; value?: unknown }
      if (member.name === undefined) continue
      result[String(member.name)] = unwrap(member.value)
    }
    return result
  }
  return node
}

/** `POST` an XML-RPC method and return the unwrapped `<methodResponse>` body. */
export function call(
  endpoint: string,
  method: string,
  params: ReadonlyArray<unknown>,
  timeoutMs = 15000,
): Effect.Effect<unknown, SubtitleError> {
  return Effect.tryPromise({
    try: async () => {
      const body =
        `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>` +
        params.map(param).join('') +
        '</params></methodCall>'
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml', 'User-Agent': userAgent },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const parsed = parser.parse(await response.text()) as Record<string, unknown>
      const methodResponse = parsed.methodResponse as Record<string, unknown> | undefined
      const fault = methodResponse?.fault
      if (fault !== undefined) throw new Error(JSON.stringify(unwrap(fault)))
      const responseParams =
        (methodResponse?.params as { param?: unknown } | undefined)?.param ?? []
      const first = Array.isArray(responseParams) ? responseParams[0] : responseParams
      return unwrap((first as { value?: unknown } | undefined)?.value)
    },
    catch: (cause) => new SubtitleError({ message: `${method} failed`, source: endpoint, cause }),
  })
}

export const userAgent = 'Popcorn Time NodeJS'
