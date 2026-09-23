import { useState } from 'react'

/** `App.Localization.nativeName`: the language name in its own language, e.g. `Français`. */
function nativeName(code: string): string {
  if (code === 'none') return ''
  const base = code.split('|')[0] ?? code
  try {
    return new Intl.DisplayNames([base], { type: 'language' }).of(base) ?? base
  } catch {
    return base
  }
}

export interface LangDropdownProps {
  readonly title: string
  readonly values: ReadonlyArray<string>
  readonly selected: string
  /** The subtitle dropdown adds a "none" flag, as `lang_dropdown.js` did. */
  readonly hasNull?: boolean
  readonly onChange: (value: string) => void
}

/**
 * `lang-dropdown.tpl` with the behaviour from `lang_dropdown.js`: a dropup whose flags pick
 * the selected language, shown as a flag beside the title.
 */
export function LangDropdown({
  title,
  values,
  selected,
  hasNull = false,
  onChange,
}: LangDropdownProps) {
  const [open, setOpen] = useState(false)
  const entries = hasNull ? ['none', ...values] : values
  const selectedClass = selected === 'none' ? 'none' : selected.slice(0, 2)

  const pick = (value: string) => {
    setOpen(false)
    onChange(value)
  }

  return (
    <div className={`dropup${open ? ' open' : ''}`}>
      <div
        className="dropdown-toggle lang-dropdown"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') setOpen(!open)
        }}
      >
        <span className="lang-name">{title}</span>
        <div
          className={`selected-lang flag toggle flag-icon flag ${selectedClass}`}
          title={nativeName(selected)}
        />
        <div className="caret" />
      </div>
      <div className="dropdown-menu" role="menu">
        <div className="flag-container">
          {entries.map((lang) => (
            <div
              key={lang}
              className={`flag-icon flag ${lang === 'none' ? 'none' : lang.slice(0, 2)}`}
              data-lang={lang}
              title={nativeName(lang)}
              onClick={() => pick(lang)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
