# Context

The domain language for the main process. Use these terms rather than synonyms.

- **StreamSession**: one playing torrent or local file, from `open` to `close`, with a stream of
  states (`connecting → startingDownload → downloading → waitingForSubtitles → ready |
  playingExternally`, then `closed | failed`).
- **PlaybackTarget**: where a session plays: `local`, `external:<player id>`, `chromecast:<id>`,
  `dlna:<id>`, `airplay:<id>`, `xbmc:<id>`.
- **Catalog**: the browsable sources behind the Movies, Series and Anime tabs, each declaring its
  capabilities (`search`, `sort: SortKey[]`, `quality`).
- **Library**: the user's bookmarks and watched state, plus the media snapshot each points at.
- **Setting consumer**: a module that subscribes to a setting key. A key with no consumer is inert
  and must be justified or removed.
- **LegacyMigration**: the one-time import of the NW.js 0.5.1 profile into SQLite. It runs before
  anything reads settings, and a failure never stops startup.

See `docs/adr/` for decisions.
