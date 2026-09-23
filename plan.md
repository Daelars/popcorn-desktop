# Conversion Plan — Popcorn Time → Electron + TypeScript

Rebuild of this fork (`Daelars/popcorn-desktop`) from the NW.js / Backbone / Marionette
codebase into an Electron + TypeScript application, preserving the current look and
feature set while restructuring the Node-side logic as typed services behind an IPC
boundary.

Companion document: [`stack.md`](./stack.md) — technology choices and rationale.

---

## Baseline

Measured against `420bbba7` (development, Aug 2025).

| | |
|---|---|
| Application JS | 78 files, ~21,860 LOC in `src/app` |
| Views | 29 files, 9,419 LOC (`lib/views/`) |
| Node-side logic | ~4,500 LOC (streamer, database, httpapi, updater, settings, devices, providers) |
| Templates | 27 `.tpl`, 2,124 lines, 693 containing embedded JS |
| Styling | 34 `.styl`, 8,491 lines — of which 951 are design tokens across 7 themes |
| Locales | 63 files, 534 keys, 631 `i18n.__()` call sites |
| Event bus | 91 distinct `App.vent` events, 106 listeners, 285 triggers |
| jQuery | 833 call sites |
| Tests | 0 |
| Native dependencies | 1 (`sodium-native`, via `bittorrent-dht-sodium`) |

Architectural summary: no bundler and no module system. `index.html` loads 60+ `<script>`
tags in hand-maintained order; each file is an IIFE attaching to a global `window.App`.
Node integration is enabled in the renderer, so `require('fs')` and `$('.cover')` appear
in the same file. There is no main/renderer split — "backend" and "frontend" share one
execution context.

---

## Invariants

These hold at every commit after Phase 0.

1. `pnpm typecheck && pnpm lint && pnpm test` passes. No `any` without a comment naming the reason.
2. From Phase 2 onward the app **boots**. A phase may be feature-incomplete; it may not be broken.
3. Domain types live in `shared/` and are the single source of truth across IPC. The renderer never imports from `main/`.
4. No Node API, `require`, or filesystem access in the renderer. This rule is the point of the migration.
5. Every ported behaviour is either covered by a test or listed on the parity checklist as manually verified.

**Project definition of done:** parity checklist complete (108 settings keys, 29 views,
6 device targets, 63 locales) and a real 0.5.1 user profile migrates without data loss.

---

## Phases

| # | Phase | Ends when | Size |
|---|---|---|---|
| 0 | Foundations | empty themed window opens, CI green | M |
| 1 | Main process core | torrent streams to a port via typed IPC, headless | L |
| 2 | Providers + shell | app opens, tabs switch, no content | M |
| 3 | Browse | can browse/filter/search all three tabs | L |
| 4 | Detail + player | can watch something end to end | XL |
| 5 | Devices + long tail | parity checklist complete | XL |
| 6 | Ship | signed installers, migration verified | M |

Phases 3–5 are the bulk of the work. Phase 4 is the single riskiest.

---

## Phase 0 — Foundations

### 0.1 Repo scaffold

- `electron-vite` + TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
- Structure: `src/main/` · `src/preload/` · `src/renderer/` · `src/shared/` · `resources/`
- Biome replaces JSHint. Delete `.jshintrc`, `.jsbeautifyrc`, `.bowerrc`.
- Vitest + Testing Library. Playwright deferred to Phase 6.
- CI runs typecheck, lint, test. Pin all GitHub Actions to commit SHAs — the current
  workflow uses `actions/upload-artifact@master` and `kiriles90/variable-mapper@master`,
  both mutable refs on third-party repos.

### 0.2 Design tokens *(scripted)*

- Parse the 7 `src/app/styl/*_theme.styl` files: 99 tokens each (101 in one)
- Emit `resources/themes/*.css` as `:root[data-theme="x"]` custom properties
- Generate a Tailwind colour scale referencing `var(--token)`
- Theme switching becomes `document.documentElement.dataset.theme`
- **Keep exact hex values.** The look is then preserved by construction, not by eye.

### 0.3 Locale pipeline *(scripted)*

- Copy 63 files from `src/app/language/` to `resources/locales/`
- Transform `%s` → `{{0}}`. Only 20 keys are affected; there are no `%d` and no plurals.
- i18next config **must** set `keySeparator: false` and `nsSeparator: false` — keys are
  natural-language English and contain `.` and `:`, which would otherwise be parsed as
  nesting and namespace separators.
- `rtl-detect` drives the `dir` attribute for **ar, fa, he, ur**. Use Tailwind logical
  properties (`ps-*`/`pe-*`, not `pl-*`/`pr-*`) from the first component — the current
  app ships these four locales with no RTL layout support, and retrofitting is expensive.

### 0.4 Shared domain types

- Derive from the existing provider contract: `MediaItem`, `Movie`, `Show`, `Episode`,
  `Torrent`, `Quality`, `Provider`, `Filters`
- Branded IDs (`ImdbId`, `TvdbId`) to stop bare strings being passed interchangeably
- `effect/Schema` definitions double as IPC runtime validation

---

## Phase 1 — Main process core

### 1.1 Effect foundations

- Tagged error taxonomy: `TorrentError`, `ProviderError`, `SubtitleError`, `DbError`,
  `DeviceError`, `SettingsError`
- `Layer` composition root; conventions for `Scope`, `acquireRelease`, interruption
- Fix the `Effect.runPromise` boundary at the IPC handler and nowhere else

### 1.2 SettingsService

- 108 keys from `settings.js`, typed, with defaults
- Fixes an existing bug: `AdvSettings.set()` writes to the database *then* mutates the
  global, so reads between the call and its resolution see stale values

### 1.3 DatabaseService

- `better-sqlite3`; schema for bookmarks, watched, movies, shows, settings
- Drop the `database.js:40-42` defect where an index is created and immediately removed
  on every boot
- **Migration** from legacy NeDB files and `localStorage` under `nw.App.dataPath`.
  Non-negotiable — users have years of watch history.

### 1.4 TorrentService — the Effect proving ground

- Wrap `webtorrent` 3.x in `Effect.async` / `Stream.async`
- Replace 14 `this.stopped` checks and the `throw 'interrupt'` at `streamer.js:551`
  with real structured interruption
- `Scope` / `acquireRelease` for the torrent → server → port → teardown lifecycle

Fixed by construction rather than by vigilance:

- The unreachable `listen()` retry — `listen` reports `EADDRINUSE` asynchronously via an
  `'error'` event, so the `try/catch` at `streamer.js:565` never fires and the retry has
  likely never run
- Leaked servers on failure
- `streamer.js:591` passes `serverPort` where `FileServer(file, opts)` expects options,
  so `opts.origin` falls back to `*` and DNS-rebinding protection is disabled
- All three HTTP servers currently bind `0.0.0.0`; bind `127.0.0.1` explicitly

### 1.5 Typed IPC

- Channel contracts in `shared/`, validated with `effect/Schema` in both directions
- `contextBridge` preload surface; `contextIsolation: true`, `nodeIntegration: false`
- Streaming progress delivered as an event channel, not polled

> **Gate.** If Effect feels wrong after 1.4, this is the decision point. One module spent,
> not the architecture. See the risk register.

---

## Phase 2 — Providers + renderer shell

### 2.1 Provider layer *(typed port, not rewrite)*

The `butter-provider/*` files are already ES classes using `fetch`, with a stable
interface: `fetch(filters) → {results, hasMore}`, `detail()`, `filters()`, `feature()`.
They get types added, not a rewrite.

- Fix `JSON.Parse` (capital P) at `butter-provider/generic.js:29` — a guaranteed
  `TypeError` on the `OBJECT` argument path
- Replace the three-way provider loading in `bootstrap.js` — `readdirSync` script
  injection, `package.json#providers` paths, and `/butter-provider-/` dependency-name
  matching — with a single static typed registry
- Metadata providers: Trakt, OpenSubtitles, fanart, TMDB

### 2.2 TanStack Query

Replaces four independent cache layers currently doing one job:
`memoizee` (10 min maxAge, 0.5 preFetch) in `butter-provider/generic.js`, 11 `localStorage`
cache references in the watchlist providers, `lib/providers/torrent_cache.js`, and the 24h
TTL in `database.js`.

### 2.3 App shell

- Window chrome, custom titlebar plus the separate Windows titlebar variant
- Tab bar and routing — replaces the `App.ViewStack` string array
- Theme and i18n providers mounted
- Radix or Headless UI primitives for modal, dropdown, tooltip. **This is where jQuery and
  Bootstrap 3 leave the codebase**, taking 833 call sites with them.

---

## Phase 3 — Browse

### 3.1 Poster grid — `list.js` (639) + `item.js` (462)

- **TanStack Virtual.** The grid is currently unvirtualised and renders thousands of items.
- `useInfiniteQuery` for pagination
- Runtime-computed poster sizing (`postersJump [134…294]`, `postersSizeRatio`, driven by a
  settings slider) uses CSS variables, not utility classes
- Cover overlays: rating stars, bookmark state, watched state

### 3.2 Filter bar — `filter_bar.js` (492)

Genres (24 movie / 27 TV / 41 anime), per-type sorters, search, and the YTS quality and
rating filters.

### 3.3 Browsers

`generic/movie/show/anime/favorite/watchlist_browser.js`. Favorites and watchlist read
from DatabaseService over IPC.

> **Gate.** Side-by-side screenshot comparison against 0.5.1 across all 7 themes.
> This is where "same look" is proven or isn't.

---

## Phase 4 — Detail + player *(riskiest)*

### 4.1 Detail views

`movie_detail.js` (437), `show_detail.js` (1,012) — season/episode tree, watched state,
synopsis, trailer. Plus `quality_selector.js`, `lang_dropdown.js`, `torrent_list.js`,
`play_control.js`.

### 4.2 Player — `player.js` (1,289) + `videojshooks.js` (506) + `videojsplugins.js` (206)

The player's own API surface is roughly 15 calls (`volume`, `currentTime`, `playbackRate`,
`userActive`, `on`, `muted`, `options`, `trigger`, `el`) and ports nearly verbatim to
video.js 8.

What breaks is the video.js 4 class system — `vjs.Component.extend({})` and
`vjs.MenuItem.extend({})` were removed in v5. Re-author against `videojs.registerComponent`:

- `TextTrackMenuItem`
- `LoadProgressBar`
- `SmallerSubtitleButton`
- `BiggerSubtitleButton`
- 4 `videojs.plugin` registrations

Also: subtitle rendering, offset and size controls, keyboard shortcuts (Mousetrap becomes a
typed hook). Drop `videojs-youtube` 1.2.10 — it is pinned to the dead v4 line, so trailers
need a different path.

### 4.3 Subtitle pipeline — `lib/subtitle/*`

OpenSubtitles fetch, charset detection (`jschardet` / `iconv-lite`), srt→vtt conversion.
The subtitle server binds `127.0.0.1` and stops reflecting arbitrary `Origin` headers.
Remove the dead `fs.readFile` whose result is discarded at `lib/subtitle/server.js:53-67`.

---

## Phase 5 — Devices + long tail

### 5.1 Device layer — `lib/device/*` (955 LOC)

Chromecast, DLNA, AirPlay and XBMC are pure-JS libraries; wrap them in Effect.

**`ext_player.js`: port the 16-player table verbatim.** VLC, mpv, mpvnet, MPC-HC, MPC-HC64,
MPC-BE, MPC-BE64, IINA, Bomi, SMPlayer, BSPlayer, PotPlayerMini64, MPlayer, MPlayerX,
MPlayer OSX Extended, Fleex. Copy the switches, BSPlayer's argument ordering, MPlayer OSX
Extended's charset detection, and the VLC-via-flatpak path check. These encode bugs someone
hit in the field and cannot be re-derived.

**Fix the shell injection while porting:** `child.exec` with a concatenated command string
becomes `execFile` with an argv array. Torrent filenames and subtitle paths are
attacker-controlled and currently flow into a shell. This also deletes all the manual
quoting logic.

### 5.2 Settings — `settings_container.js` (1,196)

108 keys. A ~600-line `switch` over DOM element IDs becomes a typed schema driving the form.

### 5.3 Remaining views

`seedbox.js` (554), `torrent_collection.js` (686), `file_selector.js` (210),
`loading.js` (417), `keyboard.js`, `notification.js`, `about.js`, `disclaimer.js`,
`init_modal.js`.

### 5.4 Integrations

- Trakt sync and OAuth — move tokens out of plaintext storage into `safeStorage`
- Updater: replace the deprecated `Buffer()` constructor with `Buffer.from`; swap
  `sodium-native` for `@noble/ed25519`, after which **the tree has no native dependencies**
- JSON-RPC HTTP API (838 LOC) — **decide whether to keep it.** Disabled by default, but
  ships `popcorn`/`popcorn` as default credentials over cleartext Basic auth. If kept:
  bind loopback and replace Basic auth with a generated token.

---

## Phase 6 — Ship

- `electron-builder` producing nsis, dmg, AppImage and deb. Retire `nw-builder`, the 17KB
  `gulpfile.js`, `make_popcorn.sh`, and the `dist/` shell scripts.
- Auto-update via `electron-updater`
- **Migration rehearsal against a real 0.5.1 profile** — the highest-consequence test in
  the project
- Security pass: loopback binds verified, CSP, `contextIsolation`, no remote module
- Playwright smoke tests
- Rotate the API keys committed in `settings.js`. A Trakt `client_secret` in a public
  repository is compromised by definition.

---

## Transfer manifest

| Verbatim | Typed port | Rewrite |
|---|---|---|
| 63 locale files (20 keys transformed) | `butter-provider/*` — already ES classes | 29 views → React |
| 7 × 99 theme tokens → CSS variables | `lib/providers/*` | 27 templates → JSX |
| 16-player quirk table | `common.js`, `media_name.js` | 7,540 lines of view Stylus → Tailwind |
| Images, fonts, icons | `database.js` schema | `streamer.js` → Effect |
| Genre and sorter lists in `config.js` | device protocol logic | `settings_container.js` switch → schema |
| The two `patches/` behaviours | | `httpapi.js` (if kept) |

---

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Effect learning curve stalls the rebuild | Med-High | Phase 1.4 is the deliberate gate — one module spent, not the architecture |
| Phase 4 player larger than scoped | Medium | Ship a plain `<video>` fallback first; layer video.js 8 features incrementally |
| "Same look" drifts | High | Screenshot gate at end of Phase 3, all 7 themes; tokens keep exact hex values |
| Data migration loses user history | Low / severe | Rehearse against a real profile in Phase 1, not Phase 6; back up before writing |
| Solo developer, no reviewer | High | Every phase ends in a working app; abandonment at any boundary still leaves something usable |
| Provider APIs change or die mid-rebuild | Medium | Providers are ported, not rewritten, so they stay swappable |

---

## Sequencing rules

1. **Phase 1.4 before anything renderer-side.** It is the Effect decision gate and the
   largest unknown in the plan.
2. **Never convert a view before the service it consumes exists**, or you write throwaway mocks.
3. **Tokens and locales before any component.** Both are scripted and everything downstream
   depends on them.
4. **Security fixes land inside the rewrite of their own module**, never as a separate pass:
   `execFile` with `ext_player`, loopback binds with the servers, `Buffer.from` with the updater.
5. **Widest-seam modules last.** `App.Device` (52 references across 16 files) and
   `App.Providers` (47 across 19) touch the most call sites; convert them when the
   surrounding code is already typed.

---

## Sizing

Phases 0–2 are a few weeks of focused work. Phases 3–5 are the real project and dominate
everything else; Phase 4 alone may equal Phase 3. Treat any estimate past Phase 2 as a
guess until the torrent service is built and Effect's ergonomics are known first-hand.
