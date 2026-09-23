import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Download, FileUp, Magnet, Pencil, Search, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import type { IpcResponse } from '../../../shared/ipc'
import { notify } from '../notify'

type SavedTorrent = IpcResponse<'collection:list'>[number]

/** The display name the legacy app derived from a magnet's `dn` parameter. */
function nameFromMagnet(link: string): string {
  const match = /[?&]dn=([^&]+)/.exec(link)
  if (match?.[1] === undefined) return link.slice(0, 60)
  try {
    return decodeURIComponent(match[1].replace(/\+/g, ' '))
  } catch {
    return match[1]
  }
}

/** Saved magnets and torrents, kept in the database and played through the file selector. */
const SEARCH_CATEGORIES = ['Movies', 'Series', 'Anime'] as const

/** Online search: which engines are on, and what the last query returned. */
function useOnlineSearch() {
  const client = useQueryClient()
  const [category, setCategory] = useState<string>(SEARCH_CATEGORIES[0])
  const [query, setQuery] = useState('')
  const engines = useQuery({
    queryKey: ['search-engines'],
    queryFn: async () => {
      const bridge = window.popcorn
      if (bridge === undefined) return []
      const settings = await bridge.invoke('settings:all', {})
      const record = settings as Record<string, unknown>
      return [
        { id: 'thepiratebay', label: 'thepiratebay.org', key: 'enableThepiratebaySearch' },
        { id: 'nyaa', label: 'nyaa.si', key: 'enableNyaaSearch' },
      ].map((engine) => ({ ...engine, enabled: record[engine.key] !== false }))
    },
  })

  const results = useQuery({
    queryKey: ['search-results', query, category],
    enabled: query !== '',
    queryFn: async () => {
      const bridge = window.popcorn
      if (bridge === undefined) return { results: [], counts: {}, failures: [] }
      return bridge.invoke('search:torrents', { query, category })
    },
  })

  const toggle = useMutation({
    mutationFn: async ({ key, enabled }: { key: string; enabled: boolean }) => {
      await window.popcorn?.invoke('settings:set', { key, value: enabled })
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['search-engines'] })
      void client.invalidateQueries({ queryKey: ['settings'] })
    },
  })

  return { category, setCategory, query, setQuery, engines, results, toggle }
}

export function TorrentCollectionPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [magnet, setMagnet] = useState('')
  const [renaming, setRenaming] = useState<number>()
  const [draftName, setDraftName] = useState('')
  const online = useOnlineSearch()

  const items = useQuery({
    queryKey: ['collection'],
    queryFn: async (): Promise<ReadonlyArray<SavedTorrent>> => {
      const bridge = window.popcorn
      if (bridge === undefined) return []
      return bridge.invoke('collection:list', {})
    },
  })

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ['collection'] })
  }

  const add = useMutation({
    mutationFn: async ({ name, source }: { name: string; source: string }) => {
      await window.popcorn?.invoke('collection:add', { name, source })
    },
    onSuccess: () => {
      setMagnet('')
      notify(t('Download added'))
      refresh()
    },
  })

  const importFile = useMutation({
    mutationFn: async () => {
      await window.popcorn?.invoke('collection:import', {})
    },
    onSuccess: refresh,
  })

  const remove = useMutation({
    mutationFn: async (id: number) => {
      await window.popcorn?.invoke('collection:remove', { id })
    },
    onSuccess: refresh,
  })

  const rename = useMutation({
    mutationFn: async ({ id, name }: { id: number; name: string }) => {
      await window.popcorn?.invoke('collection:rename', { id, name })
    },
    onSuccess: () => {
      setRenaming(undefined)
      refresh()
    },
  })

  const list = items.data ?? []

  return (
    <div className="torrent-collection-container">
      <div className="margintop" />
      <div className="content">
        <div className="onlinesearch">
          <div className="dropdown online-categories">
            <select
              name="online-category"
              value={online.category}
              onChange={(event) => online.setCategory(event.target.value)}
            >
              {SEARCH_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {t(category)}
                </option>
              ))}
            </select>
            <div className="dropdown-arrow" />
          </div>
          <form
            id="online-form"
            onSubmit={(event) => {
              event.preventDefault()
              const source = magnet.trim()
              if (source.startsWith('magnet:')) {
                add.mutate({ name: nameFromMagnet(source), source })
                return
              }
              const keywords = source.trim()
              if (keywords === '') return
              online.setQuery(keywords)
            }}
          >
            <input
              id="online-input"
              autoComplete="off"
              size={48}
              type="text"
              name="keyword"
              placeholder={t('Paste a Magnet link')}
              value={magnet}
              onChange={(event) => setMagnet(event.target.value)}
            />
            <button type="submit" className="collection-paste" aria-label={t('Add')}>
              <Magnet size={18} aria-hidden />
            </button>
            <button
              type="button"
              className="collection-import"
              aria-label={t('Import a Torrent file')}
              title={t('Import a Torrent file')}
              onClick={() => importFile.mutate()}
            >
              <FileUp size={18} aria-hidden />
            </button>
            <div className="search_in">
              {(online.engines.data ?? []).map((engine) => (
                <span key={engine.id}>
                  <input
                    className="sengine-checkbox"
                    id={`enable-${engine.id}`}
                    type="checkbox"
                    checked={engine.enabled}
                    onChange={(event) =>
                      online.toggle.mutate({ key: engine.key, enabled: event.target.checked })
                    }
                  />
                  <label htmlFor={`enable-${engine.id}`} id={`enable${engine.id}L`}>
                    {engine.label}
                    {online.results.data === undefined
                      ? ''
                      : ` (${online.results.data.counts[engine.id] ?? 0})`}
                  </label>
                </span>
              ))}
            </div>
          </form>
        </div>

        <div className="torrents-info">
          <i className="collection-open" id="savedtorrentslabel" aria-hidden>
            <Magnet size={50} />
          </i>
          <i id="savedtorrentslabeltext">{t('Saved Torrents')}</i>
          {list.length === 0 ? (
            <div className="notorrents-info">
              <div className="notorrents-frame">
                <p className="notorrents-message">
                  {t('Search for something or drop a .torrent / magnet link...')}
                </p>
              </div>
            </div>
          ) : (
            <ul className="file-list">
              {list.map((item) => (
                <li key={item.id} className="file-item" data-file={item.id}>
                  {renaming === item.id ? (
                    <>
                      <input
                        className="collection-rename-input"
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                      />
                      <button
                        type="button"
                        className="item-rename"
                        aria-label={t('Rename')}
                        onClick={() => rename.mutate({ id: item.id, name: draftName })}
                      >
                        <Check size={14} aria-hidden />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="collection-name"
                        onClick={() => {
                          const query = new URLSearchParams({
                            source: item.source,
                            title: item.name,
                          })
                          navigate(`/select?${query.toString()}`)
                        }}
                      >
                        {item.name}
                      </button>
                      <div className="item-icon magnet-icon" />
                      <button
                        type="button"
                        className="item-delete"
                        aria-label={t('Remove')}
                        onClick={() => remove.mutate(item.id)}
                      >
                        <Trash2 size={14} aria-hidden />
                      </button>
                      <button
                        type="button"
                        className="item-rename"
                        aria-label={t('Rename')}
                        onClick={() => {
                          setRenaming(item.id)
                          setDraftName(item.name)
                        }}
                      >
                        <Pencil size={14} aria-hidden />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {online.results.data === undefined ? null : (
          <div className="onlinesearch-info">
            <i id="searchresultslabel" aria-hidden>
              <Search size={48} />
            </i>
            <i id="searchresultslabeltext">{t('Search Results')}</i>
            {online.results.data.failures.length > 0 ? (
              <p className="search-failures">
                {online.results.data.failures
                  .map((failure) => `${failure.provider}: ${failure.message}`)
                  .join(' · ')}
              </p>
            ) : null}
            <ul className="file-list">
              {online.results.data.results.map((result) => (
                <li key={result.magnet} className="result-item">
                  <button
                    type="button"
                    className="result-name"
                    onClick={() => {
                      const query = new URLSearchParams({
                        source: result.magnet,
                        title: result.title,
                      })
                      navigate(`/select?${query.toString()}`)
                    }}
                  >
                    {result.title}
                  </button>
                  <span className="result-info">{result.size}</span>
                  <span className="result-info">
                    {result.seeds} / {result.peers}
                  </span>
                  <span className="result-provider">{result.provider}</span>
                  <button
                    type="button"
                    className="item-download"
                    aria-label={t('Download')}
                    onClick={() => add.mutate({ name: result.title, source: result.magnet })}
                  >
                    <Download size={14} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
