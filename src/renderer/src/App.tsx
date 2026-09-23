import { useEffect, useRef, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router'
import { popcorn } from './bridge'
import { FilterBar } from './components/FilterBar'
import { HeaderBar } from './components/HeaderBar'
import { Initializing } from './components/Initializing'
import { TitleBar } from './components/TitleBar'
import { UpdatePrompt } from './components/UpdatePrompt'
import { Notifications } from './notify'
import { AboutPage } from './routes/AboutPage'
import { BrowsePage } from './routes/BrowsePage'
import { DetailPage } from './routes/DetailPage'
import { DisclaimerPage } from './routes/DisclaimerPage'
import { FileSelectorPage } from './routes/FileSelectorPage'
import { KeyboardPage } from './routes/KeyboardPage'
import { LibraryPage } from './routes/LibraryPage'
import { PlayerPage } from './routes/PlayerPage'
import { SeedboxPage } from './routes/SeedboxPage'
import { SettingsPage } from './routes/SettingsPage'
import { TorrentCollectionPage } from './routes/TorrentCollectionPage'
import { useSetting, useSettings } from './settings'
import { applyTheme, defaultTheme } from './theme'

/** The legacy `startScreen` values map onto routes; "Last Open" falls back to Movies. */
const START_ROUTES: Readonly<Record<string, string>> = {
  Movies: '/movies',
  'TV Series': '/series',
  Anime: '/anime',
  Favorites: '/favorites',
  Watched: '/watched',
  Watchlist: '/favorites',
  'Torrent Collection': '/torrent-collection',
  Seedbox: '/seedbox',
  'Last Open': '/movies',
}

/** The filter bar persists outside the browse tabs, as it did in the original shell. */
function ShellFilterBar() {
  const location = useLocation()
  const browse = ['/movies', '/series', '/anime', '/favorites', '/watched'].includes(
    location.pathname,
  )
  // `settings_container.js` hid the filter bar while the settings view was open.
  if (browse || location.pathname === '/settings') return null
  return <FilterBar />
}

/** Sends the app to the configured start screen once the settings have loaded. */
function StartScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const startScreen = useSetting('startScreen').data
  const applied = useRef(false)

  useEffect(() => {
    if (applied.current || startScreen === undefined) return
    applied.current = true
    const path = START_ROUTES[startScreen]
    if (path !== undefined && path !== location.pathname) {
      navigate(path, { replace: true })
    }
  }, [startScreen, navigate, location.pathname])

  return null
}

/** The global shortcuts the legacy app bound through Mousetrap; the player owns its own. */
function GlobalKeys() {
  const navigate = useNavigate()
  const location = useLocation()
  const inPlayer = location.pathname.startsWith('/player')

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLSelectElement ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return
      }
      if (event.key === '?' || event.key === '/') {
        event.preventDefault()
        navigate('/keyboard')
      }
    }
    if (inPlayer) return
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate, inPlayer])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.key === ',') {
        event.preventDefault()
        navigate('/settings')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])

  return null
}

/** `isVideo` from app.js: the extensions `handleVideoFile` accepted. */
const VIDEO_EXTENSIONS = ['.mp4', '.avi', '.mov', '.mkv', '.wmv']
const SUBTITLE_EXTENSIONS = ['.srt', '.vtt']

/** The window shell from `main-window.tpl`: the player lives in its own `#player` region. */
function Shell({ nativeFrame, isWindows }: { nativeFrame: boolean; isWindows: boolean }) {
  const location = useLocation()
  const inPlayer = location.pathname.startsWith('/player')
  const settings = useSettings()
  const navigate = useNavigate()
  const [dragging, setDragging] = useState(false)

  // Drag n' Drop from app.js: videos play, `.torrent` files open the selector, subtitles
  // join the running player, and a dragged magnet link starts a stream. Pasting a magnet
  // link anywhere but a text field does the same.
  useEffect(() => {
    const onDragOver = (event: DragEvent) => {
      event.preventDefault()
      setDragging(true)
    }
    const onDragLeave = (event: DragEvent) => {
      if (event.relatedTarget === null) setDragging(false)
    }
    const onDrop = (event: DragEvent) => {
      event.preventDefault()
      setDragging(false)
      const dropped = event.dataTransfer?.files[0]
      if (dropped !== undefined) {
        const path = popcorn().pathForFile(dropped)
        const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
        if (VIDEO_EXTENSIONS.includes(extension)) {
          navigate(`/player?local=${encodeURIComponent(path)}`)
          return
        }
        if (extension === '.torrent') {
          // `handleTorrent` showed the file list; the bytes are read where the file sits.
          navigate(`/select?source=${encodeURIComponent(`file:${path}`)}`)
          return
        }
        if (SUBTITLE_EXTENSIONS.includes(extension)) {
          // `videojs:drop_sub` served the dropped subtitle to the player; the Player adds
          // it to the running instance without restarting playback.
          void popcorn()
            .invoke('local:subtitle', { path, origin: window.location.origin })
            .then((track) => {
              window.dispatchEvent(new CustomEvent('popcorn:subtitle', { detail: track }))
            })
            .catch(() => undefined)
          return
        }
      }
      const magnet = event.dataTransfer?.getData('text/plain') ?? ''
      if (magnet !== '') navigate(`/select?source=${encodeURIComponent(magnet)}`)
    }
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
      const magnet = event.clipboardData?.getData('text/plain') ?? ''
      if (magnet === '') return
      event.preventDefault()
      navigate(`/select?source=${encodeURIComponent(magnet)}`)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('paste', onPaste)
    }
  }, [navigate])

  // `nw.App.on('open')` / `nw.App.argv`: the OS asked the app to open a file or link.
  useEffect(() => {
    const bridge = popcorn()
    return bridge.onOpenFile((target) => {
      const extension = target.slice(target.lastIndexOf('.')).toLowerCase()
      if (VIDEO_EXTENSIONS.includes(extension)) {
        navigate(`/player?local=${encodeURIComponent(target)}`)
        return
      }
      // A `.torrent` file is read where it sits; a magnet or url streams the same way.
      const source = extension === '.torrent' ? `file:${target}` : target
      navigate(`/select?source=${encodeURIComponent(source)}`)
    })
  }, [navigate])

  // `initializing.tpl` was shown while the app booted; our boot ends when settings arrive.
  if (settings.isLoading) {
    return (
      <Initializing
        progress={0.5}
        status="Loading database"
        onFix={() => window.location.reload()}
      />
    )
  }

  return (
    <div id="main-window">
      {/* `main-window.tpl` has an `#header` region; it fills the strip under the 24px
          titlebar (the filter bar starts at 32px) and is the window drag region. */}
      {nativeFrame || inPlayer ? null : (
        <header id="header">{isWindows ? <TitleBar /> : <HeaderBar />}</header>
      )}
      <div className="dragzone" id="player_drag" />
      {/* `#drop-mask` from views.css: the blur overlay the legacy showed while dragging. */}
      <div id="drop-mask" style={{ display: dragging ? 'block' : 'none' }} />
      <ShellFilterBar />
      <GlobalKeys />
      <StartScreen />
      <UpdatePrompt />
      <div id="notification">
        <Notifications />
      </div>
      <div id="disclaimer-container">
        <DisclaimerPage />
      </div>
      <div id="content">
        <Routes>
          <Route path="/" element={<Navigate to="/movies" replace />} />
          <Route path="/movies" element={<BrowsePage title="Movies" type="movie" />} />
          <Route path="/series" element={<BrowsePage title="Series" type="tvshow" />} />
          <Route path="/anime" element={<BrowsePage title="Anime" type="anime" />} />
          <Route path="/favorites" element={<LibraryPage kind="favorites" title="Favorites" />} />
          <Route path="/watched" element={<LibraryPage kind="watched" title="Watched" />} />
          <Route path="/detail/:imdbId" element={<DetailPage />} />
          <Route path="/select" element={<FileSelectorPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/keyboard" element={<KeyboardPage />} />
          <Route path="/torrent-collection" element={<TorrentCollectionPage />} />
          <Route path="/seedbox" element={<SeedboxPage />} />
          <Route path="*" element={inPlayer ? null : <Navigate to="/movies" replace />} />
        </Routes>
      </div>
      {inPlayer ? (
        <div id="player">
          <PlayerPage />
        </div>
      ) : null}
    </div>
  )
}

export default function App() {
  const nativeFrame = useSetting('nativeWindowFrame').data ?? false
  const theme = useSetting('theme').data ?? defaultTheme
  const isWindows = navigator.userAgent.includes('Windows')

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <HashRouter>
      <Shell nativeFrame={nativeFrame} isWindows={isWindows} />
    </HashRouter>
  )
}
