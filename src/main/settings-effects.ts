import { Context, Effect, Layer } from 'effect'
import type { SettingsError } from '../shared/errors'
import { SettingsService } from './settings'
import { WindowService } from './window'

export interface SettingsEffectsShape {
  /** Writes a setting, then applies the side effects the legacy app ran on change. */
  readonly set: (key: string, value: unknown) => Effect.Effect<void, SettingsError>
}

export class SettingsEffects extends Context.Tag('SettingsEffects')<
  SettingsEffects,
  SettingsEffectsShape
>() {}

/**
 * Settings as a consumer of itself: `bigPicture` scales the window when it changes, which
 * the legacy settings page did directly. Keeping it here takes the side effect out of IPC.
 */
export const SettingsEffectsLive = Layer.effect(
  SettingsEffects,
  Effect.gen(function* () {
    const settings = yield* SettingsService
    const window = yield* WindowService

    return SettingsEffects.of({
      set: (key, value) =>
        Effect.gen(function* () {
          yield* settings.set(key, value)
          if (key === 'bigPicture' && typeof value === 'number') {
            yield* window.setZoom(value)
          }
        }),
    })
  }),
)
