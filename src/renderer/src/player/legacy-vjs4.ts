import { popcorn } from '../bridge'
import videojs from './videojs'

/**
 * The legacy player's video.js customisation, transcribed from `videojsplugins.js` and
 * `videojshooks.js`. The player runs on video.js 4, the version the legacy theme and these
 * hooks were written for, so the skin in views.css applies as designed.
 */

export interface SubtitleStyleSettings {
  readonly size: string
  readonly color: string
  readonly font: string
  readonly decoration: string
  readonly bold: boolean
  readonly position: string
}

type LegacyPlayer = ReturnType<typeof videojs>

let installed = false
let lastStyle: { settings: SubtitleStyleSettings; fullscreen: boolean } | undefined

/** `subsParams()` from videojshooks.js: subtitle styling read from the settings. */
export function applySubtitleStyles(settings: SubtitleStyleSettings, fullscreen: boolean): void {
  lastStyle = { settings, fullscreen }
  const subtitles = document.querySelector<HTMLElement>('.vjs-subtitles')
  const textTrack = document.querySelector<HTMLElement>('.vjs-text-track')
  const display = document.querySelector<HTMLElement>('.vjs-text-track-display')
  if (subtitles === null || textTrack === null || display === null) return

  textTrack.style.display = 'inline-block'
  display.style.fontSize = settings.size
  if (fullscreen) textTrack.style.fontSize = '140%'
  subtitles.style.color = settings.color
  subtitles.style.fontFamily = settings.font
  if (settings.decoration === 'None') textTrack.style.textShadow = 'none'
  else if (settings.decoration === 'Opaque Background') textTrack.style.background = '#000'
  else if (settings.decoration === 'See-through Background') {
    textTrack.style.background = 'rgba(0,0,0,.5)'
  }
  if (settings.bold) textTrack.style.fontWeight = 'bold'
  textTrack.style.zIndex = 'auto'
  textTrack.style.position = 'relative'
  textTrack.style.top = settings.position
}

/**
 * `videojshooks.js` replaces vjs4's text track loader outright: "This is a custom way of
 * loading subtitles, since we can't use src (CORS blocks it and we can't disable it)". The
 * legacy read the file with `fs`; here the served subtitle is fetched over loopback (our
 * subtitle server allows the app's own origin) and the WebVTT text goes to `parseCues`.
 */
function installSubtitleLoadingHook(): void {
  const TextTrack = videojs.TextTrack
  TextTrack.prototype.load = function (this: {
    readyState_: number
    src: () => string
    parseCues: (content: string) => void
    player: () => LegacyPlayer
  }) {
    // Only load if not loaded yet, matching the legacy guard.
    if (this.readyState_ !== 0) return
    this.readyState_ = 1
    const source = this.src()
    void fetch(source)
      .then((response) => (response.ok ? response.text() : Promise.reject(response.status)))
      .then((text) => {
        this.readyState_ = 2
        this.parseCues(text)
        // The display element only exists once cues are in; the legacy restyled it here.
        if (lastStyle !== undefined) applySubtitleStyles(lastStyle.settings, lastStyle.fullscreen)
        this.player().trigger('loaded')
      })
      .catch((error: unknown) => {
        this.readyState_ = 3
        console.error('[subtitles] failed to load', source, error)
      })
  }
}

/** `biggerSubtitle` / `smallerSubtitle` from videojsplugins.js: A+ / A- control bar buttons. */
function installSubtitleSizePlugins(): void {
  const step = (delta: number) => () => {
    const display = document.querySelector<HTMLElement>('.vjs-text-track-display')
    if (display === null) return
    const current = Number.parseInt(display.style.fontSize, 10)
    const next = (Number.isFinite(current) ? current : 38) + delta
    display.style.fontSize = `${next}px`
  }

  for (const [name, className, label, delta] of [
    ['biggerSubtitle', 'vjs_biggersub_button', 'A+', 2],
    ['smallerSubtitle', 'vjs_smallersub_button', 'A-', -2],
  ] as const) {
    videojs.plugin(name, function (this: LegacyPlayer) {
      const button = document.createElement('div')
      button.className = `${className} vjs-control`
      button.setAttribute('role', 'button')
      button.setAttribute('aria-live', 'polite')
      button.tabIndex = 0
      button.innerHTML = `<div class="vjs-control-content"><span class="vjs-control-text">${label}</span></div>`
      button.addEventListener('click', step(delta))
      this.controlBar.el().appendChild(button)
    })
  }
}

/**
 * `CustomTrackMenuItem.loadSubtitle`: one custom track at a time replaces the previous one,
 * then shows it. A subtitle dropped onto the window (`videojs:drop_sub`) lands here too.
 */
export function loadCustomSubtitle(player: LegacyPlayer, url: string): void {
  const id = 'vjs_subtitles_00_track'
  // `loadSubtitle` cleaned the previous custom track before adding the new one.
  const tracks = player.textTracks()
  const previous = tracks.findIndex((track) => track.id() === id)
  if (previous !== -1) {
    tracks[previous]?.el?.()?.remove()
    tracks.splice(previous, 1)
  }
  const track = player.addTextTrack('subtitles', 'Custom...', '00', { src: url })
  ;(track as { id_: string }).id_ = id
  // video.js 4 sets the mode through the menu item's click (`showTextTrack`), not `mode()`.
  player.showTextTrack(id, 'subtitles')
}

/** `customSubtitles` from videojsplugins.js: the "Custom..." item in the subtitles menu. */
function installCustomSubtitlesPlugin(): void {
  videojs.plugin('customSubtitles', function (this: LegacyPlayer) {
    const subtitlesButton = this.controlBar
      .children()
      .find((child) => child.name() === 'subtitlesButton')
    if (subtitlesButton === undefined) return

    const CustomTrackMenuItem = videojs.TextTrackMenuItem.extend({
      init(
        this: { fileInput_: HTMLInputElement; loadSubtitle: (url: string) => void },
        player: LegacyPlayer,
        options: Record<string, unknown>,
      ) {
        const initOptions = {
          ...options,
          track: {
            kind: () => 'subtitles',
            player,
            label: () => 'Custom...',
            dflt: () => false,
            mode: () => 0,
          },
        }
        videojs.TextTrackMenuItem.call(this, player, initOptions)

        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.srt, .ssa, .ass, .txt'
        input.style.display = 'none'
        this.fileInput_ = input
        ;(this as unknown as { el: () => HTMLElement }).el().appendChild(input)
        input.addEventListener('change', () => {
          player.play()
          const file = input.files?.[0]
          if (file !== undefined) this.loadSubtitle(URL.createObjectURL(file))
          input.value = ''
        })
      },
      onClick(this: { player_: LegacyPlayer; fileInput_: HTMLInputElement }) {
        this.player_.pause()
        this.fileInput_.click()
      },
      loadSubtitle(
        this: {
          player_: LegacyPlayer
          track?: { el?: () => HTMLElement }
          player: () => LegacyPlayer
        },
        url: string,
      ) {
        const player = (this.player_ ?? this.player()) as LegacyPlayer
        loadCustomSubtitle(player, url)
        videojs.TextTrackMenuItem.prototype.onClick.call(this)
      },
    })

    subtitlesButton.menu.addItem(new CustomTrackMenuItem(this))
    subtitlesButton.show()
  })
}

/** `progressTips` from videojsplugins.js: the time tooltip above the progress bar. */
function installProgressTipsPlugin(): void {
  videojs.plugin('progressTips', function (this: LegacyPlayer) {
    const init = () => {
      const progressControl = this.controlBar.progressControl.el()
      const tip = document.createElement('div')
      tip.id = 'vjs-tip'
      tip.innerHTML = '<div id="vjs-tip-arrow"></div><div id="vjs-tip-inner"></div>'
      tip.style.top = '-25px'
      progressControl.prepend(tip)
      progressControl.addEventListener('mousemove', (event: MouseEvent) => {
        const seekBar = this.controlBar.progressControl.seekBar
        let timeInSeconds = seekBar.calculateDistance(event) * this.duration()
        if (timeInSeconds === this.duration()) timeInSeconds -= 0.1
        const hours = Math.floor(timeInSeconds / 60 / 60)
        let minutes = Math.floor(timeInSeconds / 60)
        let seconds = Math.floor(timeInSeconds - minutes * 60)
        if (seconds < 10) seconds = Number(`0${seconds}`)
        let time: string
        if (hours > 0) {
          minutes %= 60
          time = `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
        } else {
          time = `${minutes}:${String(seconds).padStart(2, '0')}`
        }
        const inner = document.getElementById('vjs-tip-inner')
        if (inner !== null) inner.textContent = time
        const box = progressControl.getBoundingClientRect()
        const left = event.clientX - box.left - tip.offsetWidth / 2
        tip.style.left = `${left}px`
        tip.style.visibility = 'visible'
      })
      const hide = () => {
        tip.style.visibility = 'hidden'
      }
      progressControl.addEventListener('mouseout', hide)
      this.controlBar.playToggle.el().addEventListener('mouseout', hide)
    }
    this.on('loadedmetadata', init)
  })
}

/** The behavioural hooks from videojshooks.js that shape the legacy player UI. */
function installPlayerHooks(): void {
  const proto = videojs.Player.prototype as unknown as Record<string, unknown>

  // The legacy removed the big play button and hid the load progress bar until player.js
  // drove it from the torrent's downloaded percent.
  videojs.options.children = {
    mediaLoader: {},
    posterImage: {},
    textTrackDisplay: {},
    loadingSpinner: {},
    controlBar: {},
    errorDisplay: {},
  }

  // The legacy inactivity timeout is 2s and ignores zero-movement mousemove events.
  proto.debugMouse_ = false
  proto.reportUserActivity = function (
    this: { debugMouse_?: boolean; userActivity_?: boolean },
    event?: MouseEvent,
  ) {
    if (event !== undefined && event.type === 'mousemove') {
      if (event.movementX === 0 && event.movementY === 0) return
    }
    this.userActivity_ = true
  }
  proto.listenForUserActivity = function (this: {
    reportUserActivity: (event?: MouseEvent) => void
    userActivity_: boolean
    userActive: (active: boolean) => void
    on: (name: string, handler: (event?: MouseEvent) => void) => void
  }) {
    const onActivity = this.reportUserActivity.bind(this)
    let mouseInProgress = 0
    let inactivityTimeout = 0
    this.on('mousedown', (event) => {
      onActivity(event)
      window.clearInterval(mouseInProgress)
      mouseInProgress = window.setInterval(() => onActivity(), 250)
    })
    this.on('mousemove', onActivity)
    this.on('mouseup', (event) => {
      onActivity(event)
      window.clearInterval(mouseInProgress)
    })
    this.on('keydown', onActivity)
    this.on('keyup', onActivity)
    const activityCheck = window.setInterval(() => {
      if (this.userActivity_) {
        this.userActivity_ = false
        this.userActive(true)
        window.clearTimeout(inactivityTimeout)
        inactivityTimeout = window.setTimeout(() => {
          if (!this.userActivity_) this.userActive(false)
        }, 2000)
      }
    }, 250)
    this.on('dispose', () => {
      window.clearInterval(activityCheck)
      window.clearTimeout(inactivityTimeout)
    })
  }

  // Subtitles grow in fullscreen and the play/pause OSD grows with them.
  proto.onFullscreenChange = function (this: {
    isFullscreen: () => boolean
    addClass: (name: string) => void
    removeClass: (name: string) => void
  }) {
    const textTrack = document.querySelector<HTMLElement>('.vjs-text-track')
    const osd = document.querySelectorAll<HTMLElement>('.state-info-player')
    if (this.isFullscreen()) {
      this.addClass('vjs-fullscreen')
      if (textTrack !== null) textTrack.style.fontSize = '140%'
      for (const icon of osd) icon.style.fontSize = '65px'
    } else {
      this.removeClass('vjs-fullscreen')
      if (textTrack !== null) textTrack.style.fontSize = ''
      for (const icon of osd) icon.style.fontSize = '50px'
    }
  }

  // The legacy marks the player as started as soon as loading begins.
  proto.onLoadStart = function (this: {
    error: (error?: unknown) => unknown
    el_: HTMLElement
    trigger: (name: string) => void
  }) {
    if (this.error()) this.error(null)
    this.el_.classList.add('vjs-has-started')
    this.trigger('volumechange')
  }

  // player.js drives `.vjs-load-progress` from the torrent's downloaded percent.
  const LoadProgressBar = videojs.Component.extend({
    init(
      this: { on: (target: unknown, name: string, handler: () => void) => void },
      player: LegacyPlayer,
    ) {
      videojs.Component.call(this, player, {})
      this.on(player, 'progress', () => undefined)
    },
  }) as unknown as { prototype: { createEl: () => HTMLElement } }
  LoadProgressBar.prototype.createEl = function (this: { localize: (text: string) => string }) {
    const element = document.createElement('div')
    element.className = 'vjs-load-progress'
    element.innerHTML = `<span class="vjs-control-text"><span>${this.localize('Loaded')}</span>: 0%</span>`
    return element
  }

  // The legacy volume writes `playerVolume` back to the settings.
  proto.volume = function (
    this: {
      cache_: { volume?: number }
      techCall: (name: string, value: number) => void
      techGet: (name: string) => number
    },
    percentAsDecimal?: number,
  ) {
    if (percentAsDecimal !== undefined) {
      const volume = Math.max(0, Math.min(1, Number.parseFloat(String(percentAsDecimal))))
      this.cache_.volume = volume
      this.techCall('setVolume', volume)
      window.localStorage.setItem('volume', String(volume))
      void popcorn().invoke('settings:set', { key: 'playerVolume', value: volume.toFixed(2) })
      return this
    }
    const volume = Number.parseFloat(String(this.techGet('volume')))
    return Number.isNaN(volume) ? 1 : volume
  }

  // The legacy replaces the error text with a suggestion to use VLC.
  const errorDisplay = videojs.ErrorDisplay.prototype as unknown as {
    update: () => void
    player: () => LegacyPlayer
    contentEl_: HTMLElement
  }
  errorDisplay.update = function (this: {
    player: () => LegacyPlayer
    contentEl_: HTMLElement
  }) {
    const error = this.player().error()
    if (error) {
      this.contentEl_.textContent = error.message ?? ''
    }
  }

  // The legacy disables video.js keyboard handling and guards disposal/hasData.
  const button = videojs.Button.prototype as unknown as { onKeyPress: () => void }
  button.onKeyPress = () => undefined
}

/**
 * Applies the legacy player customisation once per renderer. Safe to call on every mount.
 */
export function installLegacyPlayer(): void {
  if (installed) return
  installed = true
  installSubtitleSizePlugins()
  installSubtitleLoadingHook()
  installCustomSubtitlesPlugin()
  installProgressTipsPlugin()
  installPlayerHooks()
}
