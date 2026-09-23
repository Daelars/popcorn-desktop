import { Schema } from 'effect'
import {
  contracts,
  events,
  type IpcChannel,
  IpcEnvelope,
  type IpcEvent,
  type IpcEventPayload,
  type IpcRequest,
  type IpcResponse,
  type PopcornBridge,
} from './ipc'

/** The transport the preload bridge sits on — Electron's ipcRenderer in production. */
export interface IpcTransport {
  readonly invoke: (channel: string, payload: unknown) => Promise<unknown>
  readonly on: (channel: string, listener: (payload: unknown) => void) => () => void
  /** `webUtils.getPathForFile`: the renderer's sandbox hides real paths from a `File`. */
  readonly pathForFile: (file: unknown) => string
}

/**
 * Builds the renderer-facing bridge. Requests are validated before they leave the
 * renderer, responses and events are validated on arrival; failures arrive as tagged
 * error data and are thrown as-is so renderer code can switch on `tag`.
 */
export function createBridge(transport: IpcTransport): PopcornBridge {
  const invoke = async <K extends IpcChannel>(
    channel: K,
    request: IpcRequest<K>,
  ): Promise<IpcResponse<K>> => {
    // The per-channel schema is chosen at runtime; the union collapses to unknown here.
    const requestSchema = contracts[channel].request as Schema.Schema<unknown>
    const responseSchema = contracts[channel].response as Schema.Schema<unknown>
    const decodedRequest = Schema.decodeUnknownSync(requestSchema)(request)
    const raw = await transport.invoke(channel, decodedRequest)
    const envelope = Schema.decodeUnknownSync(IpcEnvelope)(raw)
    if (!envelope.ok) {
      throw envelope.error
    }
    return Schema.decodeUnknownSync(responseSchema)(envelope.value) as IpcResponse<K>
  }

  const onProgress = (
    listener: (payload: Schema.Schema.Type<(typeof events)['streams:progress']>) => void,
  ) =>
    transport.on('streams:progress', (payload) => {
      listener(Schema.decodeUnknownSync(events['streams:progress'])(payload))
    })

  const onOpenFile = (listener: (target: string) => void) =>
    transport.on('window:openFile', (payload) => {
      listener(Schema.decodeUnknownSync(events['window:openFile'])(payload))
    })

  const onUpdateStatus = (listener: (status: IpcEventPayload<'updates:status'>) => void) =>
    transport.on('updates:status', (payload) => {
      listener(Schema.decodeUnknownSync(events['updates:status'])(payload))
    })

  return { invoke, onProgress, onOpenFile, onUpdateStatus, pathForFile: transport.pathForFile }
}

export type { IpcEvent }
