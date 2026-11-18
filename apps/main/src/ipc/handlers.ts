import { z } from 'zod'
import { IPC } from '../../../../packages/shared/src/index.ts'
import type { DataStore } from '../store/DataStore.ts'
import type { DataSourceManager } from '../data-source/DataSourceManager.ts'
import type { QuoteScheduler } from '../scheduler/QuoteScheduler.ts'
import { suggest } from '../search/suggest.ts'

export interface IpcDeps {
  store: DataStore
  dsm: DataSourceManager
  scheduler: QuoteScheduler
  getSnapshots(): import('../../../../packages/shared/src/index.ts').QuoteSnapshot[]
  onSettingChanged(s: import('../../../../packages/shared/src/index.ts').AppSettings): void
  getSettingsRef(): import('../../../../packages/shared/src/index.ts').AppSettings
  openPanel(): void
  closePanel(): void
  minimizePanel(): void
  kline: import('../kline/KlineService.ts').KlineService
  listSkins(): import('../../../../packages/shared/src/index.ts').SkinInfo[]
  setPetVisible(visible: boolean): void
  refreshTray?(): void
}

const secIdSchema = z.string().regex(/^[01]\.\d{5,6}$/)
const ruleSchema = z.object({
  id: z.string().min(1),
  scope: z.enum(['global', 'security']),
  secId: z.string().regex(/^[01]\.\d{5,6}$/).optional().nullable(),
  metric: z.enum(['changePct', 'price', 'volumeMultiple']),
  op: z.enum(['above', 'below', 'absAbove']),
  threshold: z.number().min(0.1).max(20),
  cooldown: z.string(),
  enabled: z.boolean(),
})

export function registerIpc(deps: IpcDeps): void {
  const { ipcMain } = require('electron') as typeof import('electron')
  const { getCurrentPetWindow } = require('../windows/petWindowAccess.js') as typeof import('../windows/petWindowAccess.ts')
  const { store, dsm, scheduler } = deps
  const petWin = () => getCurrentPetWindow()

  const on = (ch: string, fn: (e: unknown, ...args: unknown[]) => unknown) => {
    ipcMain.handle(ch, (e, ...args) => fn(e, ...args))
  }

  on(IPC.invoke.watchlistList, () => store.listWatchlist())
  on(IPC.invoke.watchlistAdd, (_e, secId: string, name: string, market: number) => {
    secIdSchema.parse(secId)
    return store.addWatchlist(secId, name, market as 0 | 1)
  })
  on(IPC.invoke.watchlistRemove, (_e, secId: string) => { secIdSchema.parse(secId); store.removeWatchlist(secId) })
  on(IPC.invoke.watchlistReorder, (_e, secIds: string[]) => {
    z.array(z.string()).parse(secIds)
    store.reorderWatchlist(secIds)
  })
  on(IPC.invoke.searchSuggest, (_e, kw: string) => {
    z.string().min(1).max(40).parse(kw)
    return suggest(kw)
  })
  on(IPC.invoke.rulesList, () => store.listRules())
  on(IPC.invoke.rulesUpsert, (_e, rule: unknown) => {
    const r = ruleSchema.parse(rule)
    if (r.scope === 'security' && !r.secId) throw new Error('SEC_REQUIRED')
    store.upsertRule({ ...r, secId: r.secId ?? undefined })
  })
  on(IPC.invoke.rulesDelete, (_e, ruleId: string) => { z.string().min(1).parse(ruleId); store.deleteRule(ruleId) })
  on(IPC.invoke.settingsGet, () => store.getSettings())
  on(IPC.invoke.settingsSet, (_e, patch: Record<string, unknown>) => {
    const cur = store.getSettings()
    // clickThrough 必须经 petSetInteraction 修改（那里会同步 setIgnoreMouseEvents 与托盘状态）。
    // 设置页的 save() 传的是整个 settings 对象，若不过滤，旧值会被写回，
    // 造成"从托盘恢复交互后，一改设置又变回穿透"的反复故障。
    const safePatch = { ...patch }
    delete safePatch.clickThrough
    // 可见性必须连同 BrowserWindow 同步，不允许普通 settings/set 偷改持久状态。
    delete safePatch.petVisible
    const next = { ...cur, ...safePatch }
    for (const k of Object.keys(safePatch)) store.setSetting(k, (safePatch as Record<string, unknown>)[k])
    deps.onSettingChanged(next)
    scheduler.start(next.pollIntervalMs)
    // 广播给桌宠窗口（气泡颜色、皮肤等设置实时生效）
    const { webContents } = require('electron') as typeof import('electron')
    for (const wc of webContents.getAllWebContents()) {
      if (!wc.isDestroyed() && wc.getURL().includes('window=pet')) {
        wc.send(IPC.push.settingsChanged, next)
      }
    }
    return next
  })
  on(IPC.invoke.quoteLatest, () => deps.getSnapshots())
  on(IPC.invoke.alertHistory, (_e, date?: string) => store.listAlertEvents(date))
  on(IPC.invoke.alertResetCooldown, (_e, secId: string) => { secIdSchema.parse(secId); store.resetCooldown(secId) })
  on(IPC.invoke.petSetInteraction, (_e, mode: string) => {
    z.enum(['normal', 'clickThrough']).parse(mode)
    const win = petWin()
    if (win) win.setIgnoreMouseEvents(mode === 'clickThrough', { forward: true })
    const s = deps.getSettingsRef()
    s.clickThrough = mode === 'clickThrough'
    // 不持久化：穿透仅当次运行有效，重启后自动恢复可交互
    deps.refreshTray?.()
  })
  on(IPC.invoke.petSetVisible, (_e, visible: unknown) => {
    deps.setPetVisible(z.boolean().parse(visible))
  })
  on(IPC.invoke.petMove, (_e, x: number, y: number) => {
    z.number().finite().parse(x); z.number().finite().parse(y)
    const win = petWin()
    if (win) win.setPosition(Math.round(x), Math.round(y))
    store.setSetting('petPosition', { x: Math.round(x), y: Math.round(y) })
  })
  on(IPC.invoke.petNudge, (_e, dx: number, dy: number) => {
    z.number().finite().parse(dx); z.number().finite().parse(dy)
    const win = petWin()
    if (!win) return
    const [px, py] = win.getPosition()
    const nx = px + Math.round(dx)
    const ny = py + Math.round(dy)
    win.setPosition(nx, ny)
    store.setSetting('petPosition', { x: nx, y: ny })
  })
  on(IPC.invoke.panelOpen, () => { deps.openPanel() })
  on(IPC.invoke.panelClose, () => { deps.closePanel() })
  on(IPC.invoke.panelMinimize, () => { deps.minimizePanel() })
  on(IPC.invoke.klineFetch, (_e, secId: string, klt: number, lmt?: number) => {
    secIdSchema.parse(secId)
    const k = z.number().int().refine((v) => [5, 15, 30, 60, 101, 102, 103].includes(v)).parse(klt)
    const limit = lmt === undefined ? 120 : z.number().int().min(20).max(500).parse(lmt)
    return deps.kline.fetch(secId, k, limit)
  })
  on(IPC.invoke.trendsFetch, (_e, secId: string) => {
    secIdSchema.parse(secId)
    return deps.kline.fetchTrends(secId)
  })
  on(IPC.invoke.skinsList, () => deps.listSkins())
  on(IPC.invoke.dataSourceStatus, () => ({
    source: dsm.activeSource, state: dsm.currentState, lastOkAt: dsm.lastOk,
  }))
}
