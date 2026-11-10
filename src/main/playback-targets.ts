import { Context, Deferred, Effect, Layer } from 'effect'
import type { PlaybackTarget } from '../shared'
import { PlaybackError } from '../shared/errors'
import { PlayersService } from './players'
import { StreamSession } from './stream-session'

export interface PlaybackHandle {
  readonly target: PlaybackTarget
  readonly sessionId: string
}

export interface PlaybackOptions {
  readonly title?: string
  readonly subtitle?: string
  readonly fullscreen?: boolean
}

export interface PlaybackTargetsShape {
  /** Everywhere a session can play: `local` plus each external player found on disk. */
  readonly list: Effect.Effect<ReadonlyArray<PlaybackTarget>>
  readonly play: (
    target: PlaybackTarget,
    sessionId: string,
    options?: PlaybackOptions,
  ) => Effect.Effect<PlaybackHandle, PlaybackError>
}

export class PlaybackTargets extends Context.Tag('PlaybackTargets')<
  PlaybackTargets,
  PlaybackTargetsShape
>() {}

/**
 * The adapter per playback kind. `local` is a no-op (the renderer plays the URL itself);
 * `external` hands the session's loopback URL to the player and closes the session when the
 * player exits, so no stream is left running behind it.
 */
export const PlaybackTargetsLive = Layer.effect(
  PlaybackTargets,
  Effect.gen(function* () {
    const players = yield* PlayersService
    const sessions = yield* StreamSession

    return PlaybackTargets.of({
      list: Effect.map(
        players.list(),
        (found): ReadonlyArray<PlaybackTarget> => [
          { kind: 'local', id: 'local', name: 'Popcorn Time' },
          ...found.map((player) => ({
            kind: 'external' as const,
            id: player.id,
            name: player.id,
            type: player.type,
          })),
        ],
      ),
      play: (target, sessionId, options = {}) =>
        Effect.gen(function* () {
          if (target.kind === 'local') return { target, sessionId }

          const state = yield* sessions.current(sessionId)
          if (state === undefined || state.url === '') {
            return yield* Effect.fail(
              new PlaybackError({
                message: `session ${sessionId} is not ready`,
                target: target.id,
                operation: 'play',
              }),
            )
          }

          // The player outlives this effect; a deferred reports its exit back into the graph.
          const exited = yield* Deferred.make<void>()
          yield* players.play(
            {
              playerId: target.id,
              url: state.url,
              ...(options.title === undefined ? {} : { title: options.title }),
              ...(options.subtitle === undefined ? {} : { subtitle: options.subtitle }),
              ...(options.fullscreen === undefined ? {} : { fullscreen: options.fullscreen }),
            },
            { onExit: () => Deferred.unsafeDone(exited, Effect.void) },
          )
          yield* Deferred.await(exited).pipe(
            Effect.zipRight(sessions.close(sessionId)),
            Effect.fork,
          )

          return { target, sessionId }
        }),
    })
  }),
)
