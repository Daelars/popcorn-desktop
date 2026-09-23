import { useEffect, useState } from 'react'

export interface NotificationAction {
  readonly label: string
  readonly onClick: () => void
}

export interface AppNotification {
  readonly id: number
  readonly message: string
  readonly timeout: number
  /** The legacy Notification model's buttons, used by the update prompt. */
  readonly actions?: ReadonlyArray<NotificationAction>
}

type Listener = (notification: AppNotification) => void

const listeners = new Set<Listener>()
let nextId = 1

function publish(notification: AppNotification): void {
  nextId += 1
  for (const listener of listeners) listener(notification)
}

/** Publishes one transient message; any module can call this without a React tree. */
export function notify(message: string, timeout = 4000): void {
  publish({ id: nextId, message, timeout })
}

/** A message with buttons, which stays on screen long enough to be answered. */
export function notifyAction(
  message: string,
  actions: ReadonlyArray<NotificationAction>,
  timeout = 20000,
): void {
  publish({ id: nextId, message, timeout, actions })
}

/** The legacy toast: one fixed top-right alert that replaces itself and fades out. */
export function Notifications() {
  const [current, setCurrent] = useState<AppNotification>()

  useEffect(() => {
    const listener: Listener = (notification) => {
      setCurrent(notification)
      window.setTimeout(() => {
        setCurrent((shown) => (shown?.id === notification.id ? undefined : shown))
      }, notification.timeout)
    }
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }, [])

  if (current === undefined) return null
  return (
    <div
      className="notification_alert"
      role="status"
      aria-live="polite"
      style={{ display: 'block' }}
    >
      {current.message}
      {current.actions?.map((action) => (
        <button
          key={action.label}
          type="button"
          className="export-database"
          onClick={() => {
            setCurrent(undefined)
            action.onClick()
          }}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
