# Stack — Popcorn Time (Electron + TypeScript rebuild)

Technology choices for the rebuild of this fork, with the reasoning behind each. The
phased execution plan lives in [`plan.md`](./plan.md).

Guiding constraint: **preserve the current look and feature set.** The visual design and
the feature surface are not being redesigned. What changes is the implementation
underneath them.

---

## Summary

| Layer | Choice |
|---|---|
| Runtime | Electron |
| Language | TypeScript, strict |
| Package manager | pnpm |
| Build | electron-vite (Vite + esbuild) |
| Main process | Effect — services as `Layer`s, tagged errors, scoped resources |
| IPC | typed channel contracts validated with `effect/Schema` |
| Renderer | React |
| Server state | TanStack Query |
| Virtualisation | TanStack Virtual |
| Routing | TanStack Router (or react-router) |
| Client state | zustand (or TanStack Store) |
| Styling | Tailwind + CSS-variable themes |
| Components | Radix or Headless UI |
| i18n | i18next + react-i18next + rtl-detect |
| Database | better-sqlite3 |
| Torrent | webtorrent 3.x |
| Player | video.js 8 |
| Lint / format | Biome |
| Test | Vitest + Testing Library + Playwright |
| Package | electron-builder |

---

## Runtime — Electron

**Chosen over NW.js and Tauri.**

The deciding measurement: the dependency tree contains exactly **one native module** —
`sodium-native`, reached through `bittorrent-dht-sodium`, and used solely by the updater's
DHT config fetch. Everything else in the torrent, cast and media path is pure JavaScript:
`webtorrent`, `chromecast-api`, `dlnacasts2`, `airplayer`, `nedb`, `jschardet`,
`iconv-lite`, `adm-zip`.

That means the entire protocol layer moves into Electron's main process **verbatim**. None
of the hard, field-tested networking code needs rewriting.

- **Against NW.js:** no first-party TypeScript types, a shrinking ecosystem, and node
  integration in the renderer — which is the specific architectural flaw this rebuild
  exists to remove. The current CI also maintains a 2×3 build matrix including NW.js
  0.44.5 (Chromium 81 / Node 13, 2020), which caps the language and CSS feature set.
- **Against Tauri:** would require reimplementing webtorrent, Chromecast and DLNA in Rust.
  That is a different product, not a port. It is also what upstream chose, which is why
  their rebuild is a separate application rather than a continuation.

Electron additionally provides the main/renderer split, `contextIsolation`, and
`safeStorage` for the Trakt OAuth tokens currently held in plaintext.

---

## Main process — Effect

**The highest-risk choice in this stack, taken deliberately.**

The Node-side code has three problems that Effect addresses structurally rather than by
discipline:

1. **Cancellation is hand-rolled and leaky.** `streamer.js` carries 14 `this.stopped`
   checks and throws a bare string literal (`throw 'interrupt'`, line 551) as control flow.
   Effect has real structured interruption; the checks disappear.
2. **Resource lifecycles leak.** The streamer sequence is torrent → server → port bind →
   subtitle fetch → serve → teardown. Two structural defects live there: servers leak on
   failure, and the `listen()` retry at line 565 is unreachable because `listen` reports
   `EADDRINUSE` asynchronously through an `'error'` event, so the surrounding `try/catch`
   never fires. `Scope` and `acquireRelease` make both un-expressible.
3. **Nothing is testable.** Services become `Layer`s, which makes them injectable, which
   makes them testable. The current code is untestable by construction — there are zero
   tests in the repository.

Tagged errors additionally let provider, torrent and subtitle failures cross the IPC
boundary with their types intact, so the renderer handles them exhaustively.

`effect/Schema` is used rather than zod, so validation shares the same error channel.

**Scope:** main process only. See *Renderer* below.

**Known costs.** Effect colours everything it touches — Effect code and plain `async/await`
do not interleave freely, so this is a commit-or-don't decision. Every retained Node
library is callback or EventEmitter based (`webtorrent`, `chromecast-api`, `dlnacasts2`,
`airplayer`) and needs wrapping in `Effect.async` / `Stream.async` first. That wrapping is
genuinely useful — it is where the typed lifecycle comes from — but it is front-loaded, and
it lands on the exact module built first.

**Mitigation:** Phase 1.4 (TorrentService) is an explicit gate. If the ergonomics are wrong
after that module, the decision is reversible at the cost of one service rather than the
architecture.

---

## Renderer — React

27 templates containing 693 lines of embedded JavaScript become typed components. React is
chosen for ecosystem depth and the quality of its TypeScript story; the component libraries
below assume it.

**Effect is not used in the renderer.** TanStack Query already owns async UI state and does
it well. Running both would have two systems competing for the same job.

---

## TanStack

### Query — replaces four cache layers

The current codebase caches the same data four different ways:

| Where | Mechanism |
|---|---|
| `butter-provider/generic.js` | `memoizee`, 10 min `maxAge`, `preFetch: 0.5` |
| watchlist providers | 11 `localStorage` cache references |
| `lib/providers/torrent_cache.js` | bespoke provider cache |
| `database.js` | 24h TTL constant |

TanStack Query replaces all four: deduplication, stale-while-revalidate, retry policy, and
`useInfiniteQuery` for the browse pagination currently hand-rolled in
`generic_browser.js`.

### Virtual — new capability

`list.js` (639 LOC) renders the poster grid with infinite scroll and **no virtualisation**,
so thousands of DOM nodes accumulate. This is a straightforward performance win.

### Router and Store — optional

Router replaces the `App.ViewStack` string array with typed routes. Store is
interchangeable with zustand. Both are preference rather than necessity; pick one state
library and do not ship two.

**Note:** TanStack has no i18n package. It does not replace i18next.

---

## Styling — Tailwind + CSS-variable themes

The existing Stylus is already token-architected, which makes this close to mechanical:

- **7 theme files, 99 design tokens each** (101 in one), pure declarations:
  `$BgColor1 = #17181b`, `$FilterBarActive = #2d72d9`. Each theme ends by importing the
  shared view styles.
- **100 distinct tokens referenced 525 times** across 7,540 lines of view styling.
- Plus 208 hardcoded hex and 113 `rgba()` values that escaped the token set — folded in
  during conversion.

Tokens become `:root[data-theme="x"]` custom properties at their **exact hex values**, and
Tailwind's colour scale references them. Theme switching is one `data-theme` attribute. The
look is preserved by construction rather than by eye.

**Why not keep Stylus.** The 951 token lines port trivially either way. The other 7,540
lines are selectors bound to Backbone/Marionette markup (`.item .cover-overlay
.actions-favorites`) — once views become React components those selectors stop matching, so
they need re-expressing regardless of framework. Given that, utilities are less work than
re-authoring Stylus against new markup.

**Escape hatch.** A small hand-written CSS file remains for things utilities handle badly:
the video.js player skin, and the runtime-computed poster sizing driven by a settings
slider (`postersJump [134…294]`, `postersSizeRatio`).

---

## Components — Radix / Headless UI

Bootstrap 3 is referenced by 93 class occurrences in templates, concentrated in buttons,
modals, dropdowns and tooltips. Its JavaScript components require jQuery.

Replacing them with headless primitives is what lets **jQuery leave the codebase entirely**,
taking 833 call sites with it. This is the single largest structural cleanup available, and
it only opens up if Bootstrap 3 goes.

---

## i18n — i18next

A string lookup table with a current-language setting. It is a direct replacement for
`i18n.__()` across all 631 call sites.

| Today | After |
|---|---|
| `i18n.setLocale('fr')` | `i18n.changeLanguage('fr')` |
| `i18n.__('Movies')` | `t('Movies')` |
| `i18n.__('Season %s', 3)` | `t('Season {{0}}', { 0: 3 })` |

The 63 dictionaries in `src/app/language/` transfer as-is.

**Why not the current `i18n` package:** i18n-node is built for Express — filesystem loading
and per-request locale state. Wrong shape for a desktop renderer.

**What it actually buys:**

- **Live language switching.** Underscore templates are compiled strings, so today the UI
  does not update when the locale changes. That is what `$('[data-translate]')` at
  `language.js:15` was for — and it is now dead code, since no template carries the
  attribute. `react-i18next` subscribes components to the locale, so a change re-renders
  the whole UI.
- **RTL.** The app ships **ar, fa, he, ur** while the only `direction: rtl` in 8,491 lines
  of styling is one text-truncation rule in `show_detail.styl`. So RTL users currently get
  RTL text in an LTR layout. `rtl-detect` plus Tailwind logical properties fixes this at
  rebuild time, cheaply. Retrofitting later is not cheap.
- **Lazy loading** one locale instead of bundling 63.

**Conversion cost is small:** 20 keys contain `%s`, none contain `%d`, and there are zero
`__n()` plural calls. A scripted pass over 20 keys.

**Required config:** `keySeparator: false` and `nsSeparator: false`. Keys are
natural-language English containing `.` and `:`, which i18next would otherwise parse as
nesting and namespace separators — silently mangling a large share of 534 keys.

**Counterpoint, recorded honestly.** With 534 flat keys, no namespaces, no plurals and 20
interpolations, a typed `t()` helper over the same JSON plus a React context is roughly 40
lines and no dependency — and would give autocomplete on key names, which i18next only
reaches through extra type generation. i18next is chosen for the RTL and live-switching
plumbing, not because the usage demands it. Picking the small custom version would not be
wrong.

---

## Data — better-sqlite3

Replaces `nedb-promises` 5, which wraps `nedb` — unmaintained since 2016, with no
crash-safety guarantees.

Synchronous, transactional, and well typed. It is a native module, so it needs a rebuild
step against Electron's ABI; that is a one-time build configuration.

A migration reads the legacy NeDB files and `localStorage` from `nw.App.dataPath`. Users
have years of watch history there, and losing it is not acceptable. This is rehearsed in
Phase 1, not deferred to Phase 6.

---

## Player — video.js 8

The current pin is **video.js 4.11.4**, released 2014.

The player's own API surface is small — roughly 15 calls (`volume`, `currentTime`,
`playbackRate`, `userActive`, `on`, `muted`, `options`, `trigger`, `el`) — and ports nearly
verbatim.

What breaks is the v4 class system. `vjs.Component.extend({})` and `vjs.MenuItem.extend({})`
were removed in v5 in favour of ES classes and `videojs.registerComponent`. Four custom
components (`TextTrackMenuItem`, `LoadProgressBar`, `SmallerSubtitleButton`,
`BiggerSubtitleButton`) and four `videojs.plugin` registrations need re-authoring.

`videojs-youtube` 1.2.10 is dropped — it is pinned to the dead v4 line, so trailer playback
needs a different path.

---

## Tooling

- **pnpm** — workspaces available if the app is later split into packages.
- **electron-vite** — Vite for both processes; HMR in the renderer.
- **Biome** — one tool replacing JSHint, `jshint-stylish`, `gulp-jsbeautifier` and
  `.jsbeautifyrc`. The existing setup has two formatters that disagree, which is why
  indentation is inconsistent across the tree.
- **Vitest + Testing Library** for units and components, **Playwright** for smoke tests.
  The repository currently has zero tests; `yarn test` runs JSHint and a stylesheet compile.
- **electron-builder** replacing `nw-builder`, the 17KB `gulpfile.js`, `make_popcorn.sh`
  and the `dist/` shell scripts.

---

## Dropped

| Dropped | Reason |
|---|---|
| NW.js | node-in-renderer; no TS types; the 0.44.5 leg caps the feature set |
| jQuery (833 call sites) | superseded by React + headless components |
| Backbone / Marionette / Radio / Wreqr / Babysitter | replaced by React + TanStack |
| Bootstrap 3 | EOL 2019; its JS requires jQuery |
| Underscore templates (27 files) | become JSX |
| `request` | deprecated February 2020; most of the codebase already uses `fetch` |
| `memoizee`, ad-hoc localStorage caches | TanStack Query |
| `nedb` / `nedb-promises` | unmaintained since 2016 |
| `gulp` + 12 gulp plugins | electron-vite + electron-builder |
| JSHint, jsbeautifier, Bower | Biome |
| `mv`, `node-tvdb` | declared but referenced nowhere |
| `sodium-native` | replaced by `@noble/ed25519`; removes the last native dependency |
| `videojs-youtube` | pinned to the dead video.js 4 line |

### Dependency hygiene to carry forward

Nine packages are `require()`d from `src/app` but **not declared** in `package.json`,
resolving only as hoisted transitive dependencies: `escape-html`, `pump`, `range-parser`,
`queue-microtask`, `network-address`, `airplay-xbmc`, `fs-extra`, `parse-torrent`,
`bittorrent-dht`. (`gulpfile.js:88` hardcodes a tenth, `cheerio`, into the packaging globs
with the comment *"not know why it not add"*.) Each must be declared explicitly in the new
tree — upgrading webtorrent alone would remove several from the tree and break the app at
runtime rather than at build time.

`mkdirp` is currently pinned to `"*"`, an unbounded range on a runtime dependency.

---

## Open decisions

1. **JSON-RPC HTTP API** (`httpapi.js`, 838 LOC) — keep or drop? Disabled by default, but
   ships `popcorn`/`popcorn` as default credentials over cleartext Basic auth and binds all
   interfaces. If kept: loopback bind, generated token instead of Basic auth.
2. **Router and state library** — TanStack Router + Store, or react-router + zustand. Either
   is defensible; decide once, in Phase 2.
3. **Effect commitment** — resolved at the Phase 1.4 gate, not before.
