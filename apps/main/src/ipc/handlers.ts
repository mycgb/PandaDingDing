import { z } from 'zod'
import { IPC } from '../../../../packages/shared/src/index.ts'
import type { DataStore } from '../store/DataStore.ts'
import type { DataSourceManager } from '../data-source/DataSourceManager.ts'
import type { QuoteScheduler } from '../scheduler/QuoteScheduler.ts'
import { suggest, parseClipboardCode, BUILTIN_ETF } from '../search/suggest.ts'

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
  /** 开机自启落地（跨平台：win/mac setLoginItemSettings，linux XDG autostart） */
  setAutoStart?(enabled: boolean): void
}

// secId = 市场号.代码。市场号含 A股0/1、港股116、美股105/106/107、场外基金150；
// 代码为 5-6 位数字（A股/港股）或 1-10 位字母数字（美股，如 AAPL/BRK.B）。
const secIdSchema = z.string().regex(/^(0|1|105|106|107|116|150)\.[A-Za-z0-9.]{1,10}$/)
const ruleSchema = z.object({
  id: z.string().min(1),
  scope: z.enum(['global', 'security']),
  secId: z.string().regex(/^(0|1|105|106|107|116|150)\.[A-Za-z0-9.]{1,10}$/).optional().nullable(),
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
    const m = z.number().int().refine((v) => [0, 1, 105, 106, 107, 116, 150].includes(v)).parse(market)
    return store.addWatchlist(secId, name, m as import('../../../../packages/shared/src/index.ts').MarketType)
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
    // 开机自启：仅在值真正变化时落地到系统（避免每次改设置都写注册表/autostart）
    if (Object.prototype.hasOwnProperty.call(safePatch, 'autoStart')
        && typeof safePatch.autoStart === 'boolean'
        && safePatch.autoStart !== cur.autoStart) {
      try { deps.setAutoStart?.(safePatch.autoStart) }
      catch (e) { console.error('[settings] setAutoStart failed:', e) }
    }
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
    latencyMs: dsm.latencyMs, primaryName: dsm.primaryName, standbyName: dsm.standbyName,
    failoverCount: dsm.failoverTimes,
  }))
  // 收盘报告回看
  on(IPC.invoke.closingReports, (_e, limit?: number) => store.listClosingReports(limit))
  // 剪贴板代码识别：先本地正则解析，再从内置清单/网络搜索补名称
  on(IPC.invoke.clipboardCheck, async (_e, text: string) => {
    const parsed = parseClipboardCode(text)
    if (!parsed) return null
    const builtin = BUILTIN_ETF.find((b) => b.code === parsed.code)
    if (builtin) return builtin
    try {
      const hits = await suggest(parsed.code)
      const exact = hits.find((h) => h.code === parsed.code)
      if (exact) return exact
    } catch { /* 网络失败时用兜底 */ }
    // 无网络结果：返回最小可加入项（名称=代码）
    return { secId: `${parsed.market}.${parsed.code}`, code: parsed.code, name: parsed.code, market: parsed.market, type: 'stock' as const }
  })
}
