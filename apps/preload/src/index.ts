import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../../../packages/shared/src/index.ts'

const invoke = <K extends keyof typeof IPC.invoke>(ch: K) =>
  (...args: unknown[]) => ipcRenderer.invoke(IPC.invoke[ch], ...args)

const api = {
  // watchlist
  watchlistList: invoke('watchlistList'),
  watchlistAdd: invoke('watchlistAdd'),
  watchlistRemove: invoke('watchlistRemove'),
  watchlistReorder: invoke('watchlistReorder'),
  watchlistSetPosition: invoke('watchlistSetPosition'),
  // search
  searchSuggest: invoke('searchSuggest'),
  // rules
  rulesList: invoke('rulesList'),
  rulesUpsert: invoke('rulesUpsert'),
  rulesDelete: invoke('rulesDelete'),
  // settings
  settingsGet: invoke('settingsGet'),
  settingsSet: invoke('settingsSet'),
  // quotes / alerts
  quoteLatest: invoke('quoteLatest'),
  indexLatest: invoke('indexLatest'),
  alertHistory: invoke('alertHistory'),
  alertResetCooldown: invoke('alertResetCooldown'),
  timeAlertsList: invoke('timeAlertsList'),
  timeAlertsUpsert: invoke('timeAlertsUpsert'),
  timeAlertsDelete: invoke('timeAlertsDelete'),
  // pet / dsm
  petSetInteraction: invoke('petSetInteraction'),
  petSetVisible: invoke('petSetVisible'),
  petMove: invoke('petMove'),
  petNudge: invoke('petNudge'),
  panelOpen: invoke('panelOpen'),
  panelClose: invoke('panelClose'),
  panelMinimize: invoke('panelMinimize'),
  panelMaximize: invoke('panelMaximize'),
  panelIsMaximized: invoke('panelIsMaximized'),
  klineFetch: invoke('klineFetch'),
  trendsFetch: invoke('trendsFetch'),
  skinsList: invoke('skinsList'),
  dataSourceStatus: invoke('dataSourceStatus'),
  closingReports: invoke('closingReports'),
  clipboardCheck: invoke('clipboardCheck'),
  openExternal: invoke('openExternal'),
  appVersion: invoke('appVersion'),
  updateCheck: invoke('updateCheck'),
  updateDownload: invoke('updateDownload'),
  updateInstall: invoke('updateInstall'),
  updateStatus: invoke('updateStatus'),
  newsFetch: invoke('newsFetch'),
  // push 订阅
  on: (channel: string, cb: (...args: unknown[]) => void) => {
    const valid = Object.values(IPC.push as Record<string, string>)
    if (!valid.includes(channel)) throw new Error(`Invalid channel: ${channel}`)
    const wrapped = (_e: unknown, ...a: unknown[]) => cb(...a)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  },
}

contextBridge.exposeInMainWorld('petApi', api)
