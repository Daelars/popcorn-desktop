import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useSettings } from '../settings'

/**
 * The first-run terms of service, shown until accepted. Acceptance is a meta flag,
 * not a setting: the legacy stored it beside the app database for the same reason.
 */
export function DisclaimerPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const settings = useSettings().data
  const projectName = settings?.projectName ?? 'Popcorn Time'

  const status = useQuery({
    queryKey: ['disclaimer'],
    queryFn: async () => {
      const bridge = window.popcorn
      if (bridge === undefined) return { accepted: true }
      return bridge.invoke('disclaimer:status', {})
    },
  })

  const accept = useMutation({
    mutationFn: async () => {
      await window.popcorn?.invoke('disclaimer:accept', {})
    },
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['disclaimer'] })
    },
  })

  if (status.data?.accepted !== false) return null

  return (
    <div id="disclaimer-container">
      <div className="disclaimer">
        <div className="loading-backdrop" />
        <div className="disclaimer-loading" />
        <img className="icon-disclaimer" src="images/icon.png" alt="" />
        <div className="disclaimer-state">
          <div className="disclaimer-content">
            <h1>{t('Terms of Service')}</h1>
            <div className="disclaimer-text">
              <h2>Your Acceptance</h2>
              <p>
                By using the &apos;{projectName}&apos; app you signify your agreement to (1) these
                terms and conditions (the &apos;Terms of Service&apos;).
              </p>

              <h2>Privacy Policy.</h2>
              <p>
                You understand that by using &apos;{projectName}&apos; you may encounter material
                that you may deem to be offensive, indecent, or objectionable, and that such content
                may or may not be identified as having explicit material. &apos;
                {projectName}&apos; will have no liability to you for such material - you agree that
                your use of &apos;{projectName}&apos; is at your sole risk.
              </p>

              <h2>DISCLAIMERS</h2>
              <p>
                YOU EXPRESSLY AGREE THAT YOUR USE OF &apos;{projectName}&apos; IS AT YOUR SOLE RISK.
                &apos;{projectName}&apos; AND ALL PRODUCTS ARE PROVIDED TO YOU &apos;AS IS&apos;
                WITHOUT WARRANTIES OF ANY KIND, EITHER EXPRESS OR IMPLIED. &apos;
                {projectName}&apos; MAKES ABSOLUTELY NO WARRANTIES WHATSOEVER, EXPRESS OR IMPLIED.
              </p>

              <h2>LIMITATION OF LIABILITY</h2>
              <p>
                &apos;{projectName}&apos; IS NOT RESPONSIBLE FOR ANY PROBLEMS OR TECHNICAL
                MALFUNCTION OF ANY WEBSITE, NETWORK, COMPUTER SYSTEMS, SERVERS, PROVIDERS, COMPUTER
                EQUIPMENT, OR SOFTWARE, OR FOR ANY FAILURE DUE TO TECHNICAL PROBLEMS OR TRAFFIC
                CONGESTION ON THE INTERNET. UNDER NO CIRCUMSTANCES WILL &apos;{projectName}
                &apos; BE LIABLE FOR ANY LOSS OR DAMAGE, INCLUDING PERSONAL INJURY OR DEATH,
                RESULTING FROM YOUR USE OF &apos;{projectName}&apos;.
              </p>

              <h2>SOURCE MATERIAL</h2>
              <p>
                ALL MOVIES ARE NOT HOSTED ON ANY SERVER AND ARE STREAMED USING THE P2P BIT TORRENT
                PROTOCOL. ALL MOVIES ARE PULLED IN FROM OPEN PUBLIC APIS. BY WATCHING A MOVIE WITH
                THIS APPLICATION YOU MIGHT BE COMMITTING COPYRIGHT VIOLATIONS DEPENDING ON YOUR
                COUNTRY&apos;S LAWS. WE DO NOT TAKE ANY RESPONSIBILITIES.
              </p>

              <h2>Ability to Accept Terms of Service</h2>
              <p>
                By using &apos;{projectName}&apos; or accessing this site you affirm that you are
                either more than 18 years of age, or an emancipated minor, or possess legal parental
                or guardian consent, and are fully able and competent to enter into the terms,
                conditions, obligations, affirmations, representations, and warranties set forth in
                these Terms of Service, and to abide by and comply with these Terms of Service.
              </p>
            </div>
            <br />
            <button type="button" className="btn-accept" onClick={() => accept.mutate()}>
              {t('I Accept')}
            </button>{' '}
            <button
              type="button"
              className="btn-close"
              onClick={() => void window.popcorn?.invoke('window:close', {})}
            >
              {t('Leave')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
