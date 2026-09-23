import i18next from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import { changeLanguage, initI18n, languages } from '../src/renderer/src/i18n'

beforeAll(async () => {
  await initI18n()
})

describe('i18n', () => {
  it('loads every locale file', () => {
    expect(languages).toHaveLength(64)
    expect(languages).toContain('ar')
    expect(languages).toContain('de')
  })

  it('resolves a key containing both "." and ":"', () => {
    expect(i18next.t('Initializing {{0}}. Please Wait...', { 0: 'Database' })).toBe(
      'Initializing Database. Please Wait...',
    )
  })

  it('interpolates positional placeholders from the transformed locales', () => {
    expect(i18next.t('Season {{0}}', { 0: 3 })).toBe('Season 3')
  })

  it('switches language in place', async () => {
    await changeLanguage('de')
    expect(i18next.t('Movies')).toBe('Filme')
    await changeLanguage('en')
    expect(i18next.t('Movies')).toBe('Movies')
  })

  it('applies rtl direction for ar, fa, he, ur and ltr otherwise', async () => {
    for (const language of ['ar', 'fa', 'he', 'ur']) {
      await changeLanguage(language)
      expect(document.documentElement.dir, language).toBe('rtl')
    }
    await changeLanguage('en')
    expect(document.documentElement.dir).toBe('ltr')
  })
})
