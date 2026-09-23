import manifest from '../../../resources/themes/themes.json'

export const themes: string[] = manifest.themes
export const defaultTheme: string = manifest.default

export function applyTheme(theme: string): void {
  document.documentElement.dataset.theme = theme
}
