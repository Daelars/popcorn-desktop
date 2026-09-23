/**
 * `Updater.onlyNotification(mode)` from updater.js: a check the user asked for reports
 * success or failure, an automatic one stays quiet unless there is something to install.
 */

let manualCheck = false

export function markManualCheck(): void {
  manualCheck = true
}

export function consumeManualCheck(): boolean {
  const value = manualCheck
  manualCheck = false
  return value
}
