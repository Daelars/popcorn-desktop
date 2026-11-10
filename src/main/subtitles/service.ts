import { Context, Effect, Layer } from 'effect'
import type { SettingsError, SubtitleError } from '../../shared/errors'
import { LocalFiles } from '../localfiles'
import { SettingsService, type SettingsServiceShape } from '../settings'
import { fetchSubtitle, searchSubtitles } from './opensubtitles'

export interface SubtitlesShape {
  /** `update:subtitles`: the provider's language map (code → download url). */
  readonly list: (
    imdbId: string,
  ) => Effect.Effect<{ subtitles: Record<string, string> }, SubtitleError | SettingsError>
  /** Downloads one language and serves it as WebVTT, which is what the player can cue. */
  readonly fetch: (
    imdbId: string,
    lang: string,
    origin: string,
  ) => Effect.Effect<{ port: number; url: string }, SubtitleError | SettingsError>
}

export class SubtitlesService extends Context.Tag('SubtitlesService')<
  SubtitlesService,
  SubtitlesShape
>() {}

/** Settings values arrive decoded but untyped; the OpenSubtitles fields are strings. */
function readString(
  settings: SettingsServiceShape,
  key: string,
): Effect.Effect<string, SettingsError> {
  return settings.read(key).pipe(Effect.map((value) => (typeof value === 'string' ? value : '')))
}

/** OpenSubtitles search and download; the credentials come from Settings. */
export const SubtitlesServiceLive = Layer.effect(
  SubtitlesService,
  Effect.gen(function* () {
    const settings = yield* SettingsService
    const local = yield* LocalFiles
    const credentials = Effect.all({
      username: readString(settings, 'opensubtitlesUsername'),
      password: readString(settings, 'opensubtitlesPassword'),
    })

    return SubtitlesService.of({
      list: (imdbId) =>
        Effect.gen(function* () {
          const { username, password } = yield* credentials
          const subtitles = yield* searchSubtitles({ imdbId, username, password })
          return { subtitles }
        }),
      fetch: (imdbId, lang, origin) =>
        Effect.gen(function* () {
          const { username, password } = yield* credentials
          const vtt = yield* fetchSubtitle({ imdbId, lang, username, password })
          return yield* local.serveVtt(vtt, origin)
        }),
    })
  }),
)
