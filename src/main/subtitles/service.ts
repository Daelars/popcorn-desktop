import { Context, Effect, Layer } from 'effect'
import { type SettingsError, SubtitleError } from '../../shared/errors'
import { LocalFiles } from '../localfiles'
import { SettingsService, type SettingsServiceShape } from '../settings'
import { fetchSubtitle, searchSubtitles } from './opensubtitles'

export interface SubtitleMedia {
  readonly season?: string
  readonly episode?: string
  readonly fileHash?: string
  readonly fileSize?: number
}

export interface SubtitlesShape {
  /** `update:subtitles`: the provider's language map (code → download url). */
  readonly list: (
    imdbId: string,
    media?: SubtitleMedia,
  ) => Effect.Effect<{ subtitles: Record<string, string> }, SubtitleError | SettingsError>
  /** Downloads one language and serves it as WebVTT, which is what the player can cue. */
  readonly fetch: (
    imdbId: string,
    lang: string,
    origin: string,
    media?: SubtitleMedia,
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

/** OpenSubtitles search and download; the credentials and default language come from Settings. */
export const SubtitlesServiceLive = Layer.effect(
  SubtitlesService,
  Effect.gen(function* () {
    const settings = yield* SettingsService
    const local = yield* LocalFiles
    const credentials = Effect.all({
      username: readString(settings, 'opensubtitlesUsername'),
      password: readString(settings, 'opensubtitlesPassword'),
    })
    const withMedia = (media: SubtitleMedia | undefined): SubtitleMedia => {
      const { season, episode, fileHash, fileSize } = media ?? {}
      return {
        ...(season === undefined ? {} : { season }),
        ...(episode === undefined ? {} : { episode }),
        ...(fileHash === undefined ? {} : { fileHash }),
        ...(fileSize === undefined ? {} : { fileSize }),
      }
    }

    return SubtitlesService.of({
      list: (imdbId, media) =>
        Effect.gen(function* () {
          const { username, password } = yield* credentials
          const subtitles = yield* searchSubtitles({
            imdbId,
            ...withMedia(media),
            username,
            password,
          })
          return { subtitles }
        }),
      fetch: (imdbId, lang, origin, media) =>
        Effect.gen(function* () {
          const { username, password } = yield* credentials
          // The legacy default: the renderer's choice, else `subtitle_language` from Settings.
          const selected = lang === '' ? yield* settings.get('subtitle_language') : lang
          if (selected === '' || selected === 'none') {
            return yield* Effect.fail(
              new SubtitleError({
                message: 'no subtitle language selected',
                source: imdbId,
              }),
            )
          }
          const vtt = yield* fetchSubtitle({
            imdbId,
            ...withMedia(media),
            lang: selected,
            username,
            password,
          })
          return yield* local.serveVtt(vtt, origin)
        }),
    })
  }),
)
