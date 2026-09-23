const SHELL_OVERRIDES = `
/* The legacy stylesheet floats the filter bar and expects anchors; keep it one 35px row. */
.filter-bar { display: flex; align-items: center; height: 35px; font-size: 13px; }
.filter-bar .nav, .filter-bar .nav.filters, .filter-bar .nav.right {
  float: none; display: flex; align-items: center; margin: 0; gap: 2px;
}
.filter-bar .nav.filters { margin-left: 14px; }
.filter-bar .nav.right { margin-left: auto; margin-right: 6px; gap: 10px; }
.filter-bar .filter { padding: 0; margin-left: 20px; }
.filter-bar .filter > button {
  display: inline-flex; align-items: center; gap: 6px; padding: 0;
  color: var(--FilterBarText); background-color: transparent; border: 0;
  cursor: pointer; font: inherit; font-size: 13px;
}
.filter-bar .filter > button:hover { color: var(--FilterBarTextHover); }
.filter-bar .filter .value { color: var(--FilterBarActive); padding-left: 8px; }
.filter-bar .source { padding: 0 14px; }
.filter-bar .source a { color: inherit; text-decoration: none; font-size: 13px; }
.filter-bar .source.active { border-bottom: 4px solid var(--FilterBarActive); }
.filter-bar .nav.right a, .filter-bar .nav.right button {
  display: inline-flex; align-items: center; color: var(--FilterBarText);
}
.filter-bar .nav.right a:hover, .filter-bar .nav.right button:hover { color: var(--FilterBarTextHover); }
.filter-bar .nav.right button { background: transparent; border: 0; padding: 0; cursor: pointer; }
.filter-bar .nav.right svg { width: 20px; height: 20px; }
/* The legacy FA glyphs (i elements) sized like the old bar; the svg rule above only covers
   the caret. */
.filter-bar .nav.right i { font-size: 1.5em; margin: 0; padding: 2px; color: var(--FilterBarIcon); }
.filter-bar .nav.right i:hover { color: var(--FilterBarIconHover); }
.filter-bar .nav.right a.active i { color: var(--FilterBarActive); }
/* The form's before glyph is absolutely positioned: without a containing block the
   magnifier lands on the first tab instead of the search box. */
.filter-bar .search { position: relative; }
/* The legacy clear is an FA div; it shows only while the form carries the edited class. */
.filter-bar .search .clear { cursor: pointer; }
.filter-bar .search form.edited .clear { display: block; }
.filter-bar .dropdown { position: relative; }
.filter-bar .dropdown:not(.open) .dropdown-menu { display: none; }
.filter-bar .dropdown-menu {
  position: absolute; top: 100%; left: 0; z-index: 20; min-width: 140px;
  max-height: 445px; overflow-y: auto; background-color: var(--DropDownBg);
  list-style: none; margin: 0; padding: 4px 0;
  box-shadow: 0 6px 16px rgba(0, 0, 0, 0.5);
}
.filter-bar .dropdown-menu button {
  display: block; width: 100%; text-align: left; padding: 5px 12px;
  background: transparent; border: 0; color: var(--FilterBarText); cursor: pointer; font: inherit;
}
.filter-bar .dropdown-menu button:hover { background-color: var(--DropDownBgHover); color: var(--DropDownTextHover); }

/*
 * Settings: the legacy container is fixed to the viewport with a 42px offset for the
 * legacy 32px titlebar. Our titlebar is 24px, and the native frame has none at all.
 */
.settings-container-contain { padding-top: 34px; }
.default-frame .settings-container-contain { padding-top: 0; }
/* The tab toggles share one row; the legacy template spaced them with &nbsp; runs. */
.settings-container #user-interface .settings-tabs .settings-label { margin-right: 28px; }
/* Tailwind's preflight resets buttons; the legacy icon buttons carry their own styling. */
.settings-container .close-icon,
.about-container .close-icon,
.keyboard-container .close-icon { padding: 0; background: transparent; border: 0; }
.settings-container #title .content a,
.settings-container #title .content button { display: inline-block; background: transparent; border: 0; }
.settings-container .content .open-folder {
  background: transparent; border: 0; padding: 3px; cursor: pointer;
  color: var(--SettingsText2); transition: color 0.3s;
}
.settings-container .content .open-folder:hover { color: var(--ButtonBgActive); }

/* The legacy seedbox shows the overview from script and lays rows out with floats. */
.seedbox-container .content .seedbox-details .seedbox-overview { display: block; }
.seedbox-container .seedbox-torrent-list ul li { display: flex; align-items: center; gap: 10px; text-align: left; }
.seedbox-container .seedbox-torrent-list ul li > button { background: transparent; border: 0; cursor: pointer; padding: 0; }
.seedbox-container .seedbox-torrent-list ul li > button.torrent-name {
  flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  color: var(--EpisodeListText); font-family: var(--MainFont); font-size: inherit; text-align: left;
}
.seedbox-container .seedbox-torrent-list ul li.active > button.torrent-name { color: var(--EpisodeSelectorText); }
.seedbox-container .seedbox-torrent-list ul li > span.watched { flex: 0 0 auto; white-space: nowrap; }
.seedbox-container .seedbox-infos-synopsis ul li .file-name { display: inline-block; width: calc(100% - 90px); }
.seedbox-container .seedbox-infos-synopsis ul li .filesize { float: right; opacity: 0.6; }

/* External player choices reuse the file-selector rows, which style anchors. */
.file-selector-container .content ul li.file-item > button.player-choice {
  background: transparent; border: 0; cursor: pointer; font: inherit; text-align: left;
  width: 100%; padding: 12px 160px 13px 20px; color: var(--EpisodeListText);
}
.file-selector-container .content ul li.file-item > button.player-choice:hover {
  background: color-mix(in srgb, var(--EpisodeSelectorHoverTran) 20%, transparent);
}

/*
 * The legacy shell stacks fixed views in #content; the titlebar, filter bar and player
 * chrome have to stay above it or they become unclickable.
 */
#main-window #content { z-index: 1; }
#main-window .windows-titlebar,
#main-window .titlebar,
#main-window #header { z-index: 100; }
#main-window .filter-bar { z-index: 90; }
#main-window .player { z-index: 80; }

/*
 * main-window.tpl renders the player into its own #player region, last in the window, so
 * it covers the filter bar while the titlebar is hidden; that is what makes the player
 * header visible at the top instead of being buried under the shell bars.
 */
#main-window #player { position: absolute; inset: 0; z-index: 95; }

/*
 * The legacy theme letterboxes the video with an oversized .vjs-tech box and a 50vh black
 * border. Modern Chromium contains video inside that box (the old default filled it), which
 * pushes the picture off-centre; this reproduces the theme's intent: the video covers the
 * player, cropping the overflow, with no bars.
 */
.vjs-popcorn-skin .vjs-tech {
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  border: 0;
  object-fit: cover;
}

/* The play/pause indicator the player script scaled and faded over the video. */
.player .state-info-player {
  position: absolute; display: none; opacity: 0; z-index: 3;
  left: 50%; top: 50%; margin: -32px 0 0 -32px; font-size: 65px; color: #fff;
  transition: opacity 400ms ease, transform 400ms ease;
}
.player .state-info-player:fullscreen { font-size: 50px; }

/* The legacy detail views use spans/divs for the torrent rows and quality chips. */
.movie-detail #torrent-list button.item-play {
  background: transparent; border: 0; cursor: pointer; font: inherit; color: inherit; padding: 0;
}
.movie-detail .toggles-container button { background: transparent; border: 0; font: inherit; cursor: pointer; }
.movie-detail .play-control .button.play-selector { border: 0; cursor: pointer; }
.movie-detail .dropdowns-container button.connect-opensubtitles {
  background: transparent; border: 0; cursor: pointer; font: inherit;
  color: var(--DropDownText, inherit); padding: 0 15px; height: 35px;
}

/*
 * The watch bar used Bootstrap dropups; these are the parts of Bootstrap the theme's
 * dropdown rules assume (positioning, the open state and the caret). Every dropup in
 * the app wants this: the player chooser in the movie bar and the show overview, and the
 * subtitle/audio dropdowns on the detail headers.
 */
.dropup { position: relative; }
.dropup .dropdown-menu {
  position: absolute; bottom: 100%; left: 0; z-index: 1000; display: none;
  min-width: 160px; padding: 5px 0; margin: 0 0 2px; list-style: none;
  border-radius: 4px; box-shadow: 0 6px 12px rgba(0, 0, 0, 0.175);
}
.dropup.open .dropdown-menu { display: block; }
/* Bootstrap's dropdown links are block, 20px line-height and never wrap; without these the
   absolutely positioned player icons anchor to the baseline and spill out of their row. */
.dropup .dropdown-menu > li > a { display: block; white-space: nowrap; line-height: 20px; }
/* The theme leaves the chooser icons' vertical position to the static layout, which this
   engine resolves to the text baseline, dropping them into the next row; centre them in
   their own row instead. */
.dropup .dropdown-menu > li { position: relative; }
.dropup .playerchoicemenu > li > a img { top: 50%; transform: translateY(-50%); }
/* The theme right-aligns the player chooser menu to its button. */
.dropup .playerchoicemenu { left: auto; right: -2px; }
.dropup .caret {
  display: inline-block; width: 0; height: 0; margin-left: 2px; vertical-align: middle;
  border-top: 4px dashed; border-right: 4px solid transparent; border-left: 4px solid transparent;
}

/* The poster cover is a link layer under the overlay; the legacy bound a click to it. */
.item .cover { position: relative; }
.item .cover > a.cover-link { position: absolute; inset: 0; display: block; z-index: 1; }
.item .cover .cover-overlay { position: relative; z-index: 2; }

/* Screen-reader-only text for icon links whose meaning is visual. */
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
}

/* The legacy collection shows the saved list from script; ours renders it when non-empty. */
.torrent-collection-container .content { overflow-y: auto; height: 100%; }
.torrent-collection-container .content .torrents-info { display: block; }
/* Both sections are fixed-height and script-toggled in the legacy layout; ours scroll. */
.torrent-collection-container .content .torrents-info,
.torrent-collection-container .content .onlinesearch-info {
  height: auto; min-height: 0; overflow: visible; margin: 24px auto;
}
/* The engine toggles are a hidden popover in the legacy markup; ours are always visible. */
.torrent-collection-container .content .onlinesearch .search_in {
  position: static; display: flex; flex-wrap: wrap; gap: 12px; flex-basis: 100%;
  background: transparent; margin: 0; padding: 0; height: auto; min-width: 0;
}
.torrent-collection-container .content .onlinesearch #online-form { flex-wrap: wrap; }
/* The saved-torrent list sits under the legacy watermark. */
.torrent-collection-container .content .torrents-info { margin-top: 96px; }

/* The collection rows are anchors and icons in the legacy markup; ours are buttons. */
.torrent-collection-container .content .torrents-info ul li.file-item { display: flex; align-items: center; gap: 10px; }
.torrent-collection-container .content .torrents-info ul li.file-item > button {
  background: transparent; border: 0; cursor: pointer; color: inherit; padding: 0;
}
.torrent-collection-container .content .torrents-info ul li.file-item > button.collection-name {
  flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  text-align: left; font: inherit; color: var(--EpisodeListText);
}
.torrent-collection-container .content .torrents-info ul li.file-item > button.collection-name:hover {
  color: var(--ButtonBgActive);
}
.torrent-collection-container .content .torrents-info ul li.file-item > button.item-delete,
.torrent-collection-container .content .torrents-info ul li.file-item > button.item-rename {
  position: static; left: auto; top: auto; flex: 0 0 auto; opacity: 0.4;
}
.torrent-collection-container .content .torrents-info ul li.file-item > button.item-delete:hover,
.torrent-collection-container .content .torrents-info ul li.file-item > button.item-rename:hover {
  opacity: 1;
}
.torrent-collection-container .content .torrents-info ul li.file-item > .item-icon { position: static; flex: 0 0 auto; }
.torrent-collection-container .content .torrents-info ul li.file-item > input.collection-rename-input {
  flex: 1 1 auto; min-width: 0; margin: 0; height: 26px;
}
.torrent-collection-container .content .onlinesearch #online-form { display: flex; align-items: center; gap: 8px; }
.torrent-collection-container .content .onlinesearch .search_in { display: flex; align-items: center; gap: 12px; }
.torrent-collection-container .content .onlinesearch .search_in span { display: inline-flex; align-items: center; gap: 4px; }
.torrent-collection-container .content .onlinesearch .search_in label {
  cursor: pointer; color: var(--SettingsText1); font-size: 12px; white-space: nowrap;
}

/* Search results reuse the saved-torrent rows. */
.torrent-collection-container .content .onlinesearch-info { display: block; }
.torrent-collection-container .content .onlinesearch-info .search-failures {
  color: var(--WarningColor); font-size: 12px; text-align: center;
}
.torrent-collection-container .content .onlinesearch-info ul li.result-item {
  display: flex; align-items: center; gap: 10px; text-align: left;
}
.torrent-collection-container .content .onlinesearch-info ul li.result-item > button.result-name {
  flex: 1 1 auto; min-width: 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  background: transparent; border: 0; cursor: pointer; text-align: left; font: inherit;
  color: var(--EpisodeListText); padding: 0;
}
.torrent-collection-container .content .onlinesearch-info ul li.result-item > button.result-name:hover {
  color: var(--ButtonBgActive);
}
.torrent-collection-container .content .onlinesearch-info ul li.result-item > span { flex: 0 0 auto; opacity: 0.6; font-size: 12px; }
.torrent-collection-container .content .onlinesearch-info ul li.result-item > span.result-info { width: 90px; text-align: right; }
.torrent-collection-container .content .onlinesearch-info ul li.result-item > span.result-provider { width: 130px; text-align: right; }
.torrent-collection-container .content .onlinesearch-info ul li.result-item > button.item-download {
  flex: 0 0 auto; background: transparent; border: 0; cursor: pointer; color: var(--SettingsText1);
}
.torrent-collection-container .content .onlinesearch .collection-paste,
.torrent-collection-container .content .onlinesearch .collection-import {
  background: transparent; border: 0; cursor: pointer; color: var(--FilterBarText); padding: 4px;
}
.torrent-collection-container .content .onlinesearch .collection-paste:hover,
.torrent-collection-container .content .onlinesearch .collection-import:hover { color: var(--ButtonBgActive); }
`

/**
 * Appends the shell overrides after every imported stylesheet. Tailwind's CSS pipeline
 * reorders rules added in index.css, which lets the legacy floats win; a style element
 * appended at runtime is guaranteed to come last.
 */
export function applyShellStyles(): void {
  const style = document.createElement('style')
  style.dataset.shell = 'overrides'
  style.textContent = SHELL_OVERRIDES
  document.head.append(style)
}
