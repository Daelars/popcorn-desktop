import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { getLangDir } from 'rtl-detect'

type LocaleBundle = Record<string, string>

const localeLoaders = import.meta.glob<{ default: LocaleBundle }>(
  '../../../resources/locales/*.json',
)

function loaderKey(language: string): string {
  return `../../../resources/locales/${language}.json`
}

export const languages: string[] = Object.keys(localeLoaders)
  .map((path) => path.replace(/^.*\//, '').replace(/\.json$/, ''))
  .sort()

async function loadBundle(language: string): Promise<LocaleBundle> {
  const load = localeLoaders[loaderKey(language)]
  if (!load) {
    throw new Error(`no locale file for "${language}"`)
  }
  const module = await load()
  return module.default
}

/** Sets dir/lang on <html>; ar, fa, he, ur resolve to rtl. */
export function applyDirection(language: string): void {
  document.documentElement.lang = language
  document.documentElement.dir = getLangDir(language)
}

/** Loads a bundle on demand and switches language, re-rendering subscribed components. */
export async function changeLanguage(language: string): Promise<void> {
  const bundle = await loadBundle(language)
  i18n.addResourceBundle(language, 'translation', bundle, true, true)
  await i18n.changeLanguage(language)
  applyDirection(language)
}

export async function initI18n(language = 'en'): Promise<void> {
  // keySeparator/nsSeparator off: keys are natural-language English containing "." and ":".
  await i18n.use(initReactI18next).init({
    lng: language,
    fallbackLng: 'en',
    keySeparator: false,
    nsSeparator: false,
    interpolation: { escapeValue: false },
    resources: {
      en: { translation: await loadBundle('en') },
      [language]: { translation: await loadBundle(language) },
    },
  })
  applyDirection(language)
}
