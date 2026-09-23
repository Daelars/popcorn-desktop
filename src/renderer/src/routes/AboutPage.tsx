import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { useSettings } from '../settings'
import { markManualCheck } from '../updates'

function hostOf(url: string | undefined): string | undefined {
  if (url === undefined || url === '') return undefined
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return undefined
  }
}

/** The legacy about screen: version, update check, project text and the social links. */
export function AboutPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const settings = useSettings().data
  const projectName = settings?.projectName ?? 'Popcorn Time'
  const [checking, setChecking] = useState(false)

  // The prompt itself lives in the shell (`UpdatePrompt`); this only spins the icon.
  useEffect(() => {
    const bridge = window.popcorn
    if (bridge === undefined) return
    return bridge.onUpdateStatus((status) => {
      setChecking(status.state === 'checking')
    })
  }, [])

  const checkForUpdates = () => {
    markManualCheck()
    setChecking(true)
    void window.popcorn?.invoke('updates:check', { manual: true }).catch(() => setChecking(false))
  }

  const social = [
    { className: 'site_icon', url: settings?.projectUrl },
    { className: 'github_icon', url: settings?.sourceUrl },
    { className: 'reddit_icon', url: settings?.projectForum },
    { className: 'blog_icon', url: settings?.projectBlog },
    { className: 'forum_icon', url: settings?.projectBlog },
  ].filter((link) => hostOf(link.url) !== undefined)

  return (
    <div className="about-container">
      <div className="fa fa-times close-icon" onClick={() => navigate(-1)} />
      <div className="overlay-content" />
      <div className="margintop" />
      <img className="icon-title" src="images/popcorn-time-logo.svg" alt="" />
      <div className="content">
        <div className="title-version">
          <a
            id="changelog"
            href={settings?.changelogUrl}
            target="_blank"
            rel="noreferrer"
            title={t('Changelog')}
          >
            {settings?.version} &quot;{settings?.releaseName}&quot; Beta
          </a>
          <small>
            &nbsp;&nbsp;&nbsp;
            <a className="update-app" href="#" onClick={checkForUpdates}>
              <i className={checking ? 'fa fa-spinner fa-spin' : 'fa fa-rotate'} />{' '}
              {t('Check for updates')}
            </a>
          </small>
          <small>
            &nbsp;&nbsp;&nbsp;
            <a href={settings?.issuesUrl} target="_blank" rel="noreferrer">
              <i className="fa fa-exclamation-circle" /> {t('Report an issue')}
            </a>
          </small>
        </div>

        <div className="text-about">
          <div className="full-text">
            {t(
              '{{0}} is the result of many developers and designers putting a bunch of APIs together to make the experience of watching torrent movies as simple as possible.',
              { 0: projectName },
            )}
            <br />
            {t(
              'We are an open source project. We are from all over the world. We love our movies. And boy, do we love popcorn.',
            )}
          </div>
        </div>

        <div className="icons_social">
          {social.map((link) => (
            <a
              key={link.className}
              className={`links ${link.className}`}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              title={hostOf(link.url)}
            >
              <span className="sr-only">{hostOf(link.url)}</span>
            </a>
          ))}
        </div>

        <div className="last-line">
          {t('Made with')} <span className="heart">&#10084;</span>{' '}
          {t('by a bunch of geeks from All Around The World')}
        </div>
      </div>
    </div>
  )
}
