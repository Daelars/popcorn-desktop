import { Schema } from 'effect'

/**
 * Where a session plays. `chosenPlayer` stores one of these ids, and the player route branches
 * on `kind` instead of magic strings. Cast and network targets plug in here later (#20).
 */
export const PlaybackTarget = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal('local'),
    id: Schema.Literal('local'),
    name: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal('external'),
    id: Schema.String,
    name: Schema.String,
    type: Schema.String,
  }),
)
export type PlaybackTarget = Schema.Schema.Type<typeof PlaybackTarget>
