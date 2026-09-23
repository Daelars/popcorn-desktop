import { Data } from 'effect'

/**
 * Tagged error taxonomy for the main process. Every failure crosses service and
 * IPC boundaries as one of these, with plain-data context — never a bare string
 * or a stack trace. Field names are part of the contract the renderer sees.
 */

interface ErrorFields {
  readonly message: string
  readonly cause?: unknown
}

export class TorrentError extends Data.TaggedError('TorrentError')<
  ErrorFields & { readonly infoHash?: string }
> {}

export class ProviderError extends Data.TaggedError('ProviderError')<
  ErrorFields & { readonly provider: string; readonly operation: string }
> {}

export class SubtitleError extends Data.TaggedError('SubtitleError')<
  ErrorFields & { readonly source: string }
> {}

export class DbError extends Data.TaggedError('DbError')<
  ErrorFields & { readonly operation: string }
> {}

export class DeviceError extends Data.TaggedError('DeviceError')<
  ErrorFields & { readonly device: string; readonly operation: string }
> {}

export class SettingsError extends Data.TaggedError('SettingsError')<
  ErrorFields & { readonly key: string }
> {}

export type ServiceError =
  | TorrentError
  | ProviderError
  | SubtitleError
  | DbError
  | DeviceError
  | SettingsError
