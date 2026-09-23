import { QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
// The legacy index.html loaded video-js.min.css before the theme, so the popcorn skin wins.
import 'video.js/dist/video-js/video-js.min.css'
import './index.css'
// Imported outside `index.css` so Tailwind's CSS pipeline cannot rewrite the legacy
// `content: '\f002'` escapes into empty strings; the skin must come after the preflight.
import '../../../resources/themes/views.css'
import App from './App'
import { initI18n } from './i18n'
import { createQueryClient } from './query'
import { applyShellStyles } from './shell-styles'

async function bootstrap(): Promise<void> {
  await initI18n()

  // The legacy app sets the font on a container we no longer render; apply the token here.
  document.documentElement.style.fontFamily = 'var(--Font), sans-serif'
  applyShellStyles()

  const root = document.getElementById('root')
  if (!root) {
    throw new Error('Root element not found')
  }

  createRoot(root).render(
    <StrictMode>
      <QueryClientProvider client={createQueryClient()}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  )
}

void bootstrap()
