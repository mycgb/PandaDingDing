import { app, BrowserWindow, Tray, Menu, screen, nativeImage } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { DataStore } from './store/DataStore.ts'
import { DataSourceManager } from './data-source/DataSourceManager.ts'
import { bindFetch as bindEM } from './data-source/EastmoneyAdapter.ts'
import { bindFetch as bindTX } from './data-source/TencentAdapter.ts'
import { QuoteScheduler } from './scheduler/QuoteScheduler.ts'
import { AlertEngine, isDndNow } from './alert/AlertEngine.ts'
import { portfolioPct, resolvePetState, type MoodThresholds } from './pet/petState.ts'
import { registerIpc } from './ipc/handlers.ts'
import { suggest, BUILTIN_ETF } from './search/suggest.ts'
import { setPetWindow } from './windows/petWindowAccess.ts'
import { KlineService, bindFetch as bindKline } from './kline/KlineService.ts'
import { IPC, phaseOf, DEFAULT_SETTINGS, type AppSettings, type QuoteSnapshot, type WatchItem, type PetState } from '../../../packages/shared/src/index.ts'
import { pathToFileURL } from 'node:url'

const IS_DEV = !!process.env.PETTICKER_DEV
let ROOT = ''
/** 主进程产物目录（preload/migrations 所在处）：dev 为 apps/main，打包后为 app.asar/apps/main */
let APP_DIR = ''
let RENDERER_URL = ''
function computePaths(): void {
  const appPath = app.getAppPath()
  if (app.isPackaged) {
    // appPath = <install>/resources/app.asar；静态资源由 extraResources 放到 <install>/resources
    APP_DIR = path.join(appPath, 'apps', 'main')
    ROOT = path.dirname(process.resourcesPath)
    RENDERER_URL = process.env.PETTICKER_RENDERER_URL
      ?? pathToFileURL(path.join(appPath, 'apps/renderer/dist/index.html')).href
  } else {
    // 入口 = apps/main/dist/index.cjs → appPath = apps/main → 工程根 = apps 的上级
    APP_DIR = appPath
    ROOT = path.resolve(appPath, '..', '..')
    RENDERER_URL = process.env.PETTICKER_RENDERER_URL
      ?? (IS_DEV ? 'http://127.0.0.1:5173' : pathToFileURL(path.join(ROOT, 'apps/renderer/dist/index.html')).href)
  }
  log('ROOT =', ROOT, 'APP_DIR =', APP_DIR)
}

// 静态资源目录（皮肤/图标）
function res(...p: string[]): string { return path.join(ROOT, 'resources', ...p) }

let tray: Tray | null = null
let petWin: BrowserWindow | null = null
let panelWin: BrowserWindow | null = null
let store: DataStore
let dsm: DataSourceManager
let scheduler: QuoteScheduler
let alertEngine: AlertEngine
let settings: AppSettings
let latestSnapshots: QuoteSnapshot[] = []
let alertHoldUntil = 0
let lastAlertDirection: 'up' | 'down' | null = null
/** 桌宠窗口本次交互是否发生过位移（用于区分单击/拖拽） */
let petMoved = false

/** 桌宠窗口尺寸（含气泡区）；与渲染层 PetStage 的 STAGE_W/H 保持一致 */
const PET_W = 160
const PET_H = 210

/**
 * 主进程日志。
 *  EPIPE 防护：当父进程（终端/启动脚本）退出后 stdout 管道断裂，
 *  console.log 会抛 "Uncaught Exception: EPIPE: broken pipe"，
 * 而 Electron 会把它弹成错误对话框。桌宠是脱离终端运行的 GUI 应用，
 * 管道随时可能断裂，因此这里统一捕获并静默。
 */
const log = (...a: unknown[]): void => {
  try {
    const write = (process.stdout as unknown as { write?: (chunk: string, cb?: (err: Error | null) => void) => boolean }).write
    if (!write) return
    // 传入回调让 EPIPE 走异步回调而非同步抛出
    const ok = write.call(process.stdout, a.map(String).join(' ') + '\n', (err) => { void err })
    if (ok === false) { /* 背压：丢弃本条，不影响应用 */ }
  } catch { /* stdout 不可用：静默 */ }
}

// 兜底：任何漏网的 EPIPE / 管道错误都不弹窗（GUI 应用脱离终端运行，管道断裂是常态）
process.stdout?.on?.('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') return; throw e })
process.stderr?.on?.('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') return; throw e })
process.on('uncaughtException', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE' || e.code === 'ERR_STREAM_DESTROYED' || e.code === 'ERR_STREAM_WRITE_AFTER_END') return
  // 非管道类未捕获异常：记录后保持运行，避免单个模块异常炸掉整个桌宠
  try { console.error('[main] uncaught:', e) } catch { /* stdout 也可能已断 */ }
})

// Windows 透明窗口相关。本项目实测：透明失效的根因是渲染层未 scoped 的 body 背景样式
// （桌宠与管理面板共用同一份产物），已修复。
// 仍保留降级开关以应对个别显卡/驱动下的黑底问题（开发文档 §14 R3）：
//   PETTICKER_NO_GPU=1 → 禁用硬件加速与 GPU 合成，改走软件合成
app.commandLine.appendSwitch('enable-transparent-visuals')
if (process.env.PETTICKER_NO_GPU === '1') {
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu-compositing')
}

// appPath/ROOT 等 app 依赖统一延迟到 boot 内求值（模块加载期 app 未必就绪）
if (app.requestSingleInstanceLock()) boot()
else app.quit()

function boot(): void {
  // 顶层常量延迟求值：app.getAppPath 在模块加载期可能未初始化
  computePaths()
  registerResourceScheme()
  app.whenReady().then(() => { registerResourceHandler(); start() })
    .catch((e) => { log('boot fail', e); app.quit() })
}

/** pt-resource://skins/<name>/... → resources/skins/...（打包后皮肤加载通道） */
function registerResourceScheme(): void {
  const { protocol } = require('electron') as typeof import('electron')
  protocol.registerSchemesAsPrivileged([
    { scheme: 'pt-resource', privileges: { standard: true, supportFetchAPI: true, stream: true, bypassCSP: true } },
  ])
}

function registerResourceHandler(): void {
  const { protocol, net } = require('electron') as typeof import('electron')
  protocol.handle('pt-resource', (req) => {
    const u = new URL(req.url)
    // pt-resource://skins/mascot-cat/x.png → host=skins, pathname=/mascot-cat/x.png
    const rel = decodeURIComponent(`${u.hostname}${u.pathname}`.replace(/^\/+/, ''))
    const root = res()
    const target = path.normalize(path.join(root, rel))
    if (!target.startsWith(root)) return new Response('forbidden', { status: 403 })
    const mime = target.endsWith('.json') ? 'application/json' : 'image/png'
    return net.fetch(`file:///${target.replace(/\\/g, '/')}`)
      .then((r) => {
        const h = new Headers(r.headers)
        h.set('content-type', mime)
        return new Response(r.body, { status: r.status, headers: h })
      })
      .catch(() => new Response('not found', { status: 404 }))
  })
}

function start(): void {
  // net.fetch（主进程原生，走系统代理）
  const { net } = require('electron') as typeof import('electron')
  const doFetch: typeof fetch = ((u: string, init?: RequestInit) => net.fetch(u, init)) as typeof fetch
  bindEM(doFetch)
  bindTX(doFetch)
  bindKline(doFetch)

  store = new DataStore(
    path.join(app.getPath('userData'), 'pandadingding.db'),
    path.join(APP_DIR, 'migrations'),
  )
  settings = store.getSettings()
  // 历史遗留：早期版本曾把 clickThrough=true 写入数据库，导致桌宠无法拖动/双击。
  // 穿透功能价值小、故障率高（已多次导致"桌宠点不动"），启动时强制复位为可交互。
  // 用户如需临时穿透，可用托盘菜单（当次运行有效，不再持久化）。
  if (settings.clickThrough) {
    settings.clickThrough = false
    store.setSetting('clickThrough', false)
    log('启动时复位点击穿透为 false（历史数据清理）')
  }
  // 历史遗留：曾短暂支持 theme='system'（跟随系统），撤销后数据库可能残留该值，
  // 归一回 light，避免渲染层拿到非法主题值。
  if ((settings.theme as string) === 'system') {
    settings.theme = 'light'
    store.setSetting('theme', 'light')
    log('启动时归一 theme=system → light（历史数据清理）')
  }
  ensureDefaultRule()
  ensureDefaultSkin()

  dsm = new DataSourceManager(log)
  dsm.on('notice', (n) => broadcast(IPC.push.systemNotice, n))

  alertEngine = new AlertEngine({
    getRules: () => store.listRules(),
    getWatchlist: () => store.listWatchlist(),
    hasFiredToday: (secId, dir) => store.hasFiredToday(secId, dir),
    insertEvent: (e) => store.insertAlertEvent(e),
    isDndNow: (now) => isDndNow(settings.dndRanges, settings.dndEnabled, now ?? new Date()),
  })
  alertEngine.on('alert', onAlertFired)

  scheduler = new QuoteScheduler(async () => { await pollOnce() }, log)
  scheduler.on('phaseChange', onPhaseChange)

  registerIpc({
    store, dsm, scheduler,
    getSnapshots: () => latestSnapshots,
    onSettingChanged: (s) => { settings = s },
    getSettingsRef: () => settings,
    openPanel: () => createPanelWindow(),
    closePanel: () => { panelWin?.close() },
    minimizePanel: () => { panelWin?.minimize() },
    kline: new KlineService(),
    listSkins: () => listSkins(),
    setPetVisible: (visible) => setPetVisible(visible),
    refreshTray: () => refreshTray(),
  })

  createTray()
  createPetWindow()
  scheduler.start(settings.pollIntervalMs)

  app.on('online', () => { dsm.setOnline(true); scheduler.start(settings.pollIntervalMs) })
  app.on('offline', () => { dsm.setOnline(false); broadcast(IPC.push.systemNotice, { type: 'network', message: '网络已断开' }) })
  app.on('window-all-closed', () => { /* 托盘常驻 */ })
  app.on('before-quit', () => { scheduler.stop(); dsm.dispose(); store.close() })
}

function ensureDefaultRule(): void {
  if (store.listRules().length === 0) {
    store.upsertRule({
      id: 'global-default', scope: 'global', metric: 'changePct', op: 'absAbove',
      threshold: 3, cooldown: 'oncePerDay', enabled: true,
    })
  }
}

/**
 * 皮肤可用性保障 + 默认皮肤升级：
 *  1. 从未设置过皮肤（首次启动）→ 写入当前默认皮肤
 *  2. 老用户皮肤目录被删 → 回退到当前默认皮肤
 *  3. 老用户仍在使用「历史默认皮肤」（未主动改过）→ 一次性升级到新默认；
 *     若用户主动选过其他皮肤则尊重其选择
 * 注意：每次更换默认皮肤时，把上一个默认值加入 LEGACY_DEFAULTS。
 */
const LEGACY_DEFAULTS = ['panda-mycgb', 'panda-wave-blink', 'panda-shake-rest']

function ensureDefaultSkin(): void {
  const stored = store.getSettings().skin
  if (LEGACY_DEFAULTS.includes(stored) && stored !== DEFAULT_SETTINGS.skin) {
    log(`默认皮肤升级：${stored} → ${DEFAULT_SETTINGS.skin}`)
    store.setSetting('skin', DEFAULT_SETTINGS.skin)
    return
  }
  if (!fs.existsSync(res('skins', stored))) {
    log(`皮肤 "${stored}" 不存在，回退到默认 ${DEFAULT_SETTINGS.skin}`)
    store.setSetting('skin', DEFAULT_SETTINGS.skin)
  }
}

/** 扫描 resources/skins，返回可用皮肤（含 manifest 里的显示名） */
function listSkins(): { id: string; name: string }[] {
  const root = res('skins')
  if (!fs.existsSync(root)) return []
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const mf = path.join(root, d.name, 'manifest.json')
      let name = d.name
      try {
        if (fs.existsSync(mf)) {
          const m = JSON.parse(fs.readFileSync(mf, 'utf8')) as { name?: string }
          if (m.name) name = m.name
        }
      } catch { /* 用目录名兜底 */ }
      return { id: d.name, name }
    })
    .sort((a, b) => a.id.localeCompare(b.id))
}

/* ---------- 窗口 ---------- */

/** 把窗口位置约束到工作区内，至少保留 minVisible px 在屏内（防桌宠丢失） */
function clampToWorkArea(x: number, y: number, w: number, h: number, minVisible = 80): [number, number] {
  const target = screen.getDisplayNearestPoint({ x, y })
  const wa = target.workArea
  const maxX = wa.x + wa.width - minVisible
  const maxY = wa.y + wa.height - minVisible
  const cx = Math.min(Math.max(x, wa.x - w + minVisible), maxX)
  const cy = Math.min(Math.max(y, wa.y - h + minVisible), maxY)
  return [Math.round(cx), Math.round(cy)]
}

function createPetWindow(): void {
  const pos = settings.petPosition
  // 启动时也做一次边界修正（显示器配置可能已变）
  const [sx, sy] = pos ? clampToWorkArea(pos.x, pos.y, PET_W, PET_H) : [undefined, undefined]
  petWin = new BrowserWindow({
    width: PET_W, height: PET_H,
    x: sx, y: sy,
    show: settings.petVisible,
    transparent: true, frame: false, alwaysOnTop: true, hasShadow: false,
    backgroundColor: '#00000000',
    skipTaskbar: true, resizable: false,
    webPreferences: {
      preload: path.join(APP_DIR, 'dist/preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      // 关键：桌宠窗口常驻桌面，被其他窗口大面积遮挡时会触发 Chromium 后台节流，
      // rAF 被降到约 1Hz，动画看起来像"卡住/不动"。关闭后动画持续按帧率播放。
      backgroundThrottling: false,
    },
  })
  setPetWindow(petWin)
  petWin.setAlwaysOnTop(true, 'screen-saver')
  petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  // 区分「单击」与「拖拽」：app-region 让 OS 接管移动，这里用 moved 距离判断。
  // 未移动 → 视为单击 → 打开管理面板；移动过 → 视为拖拽 → 落盘位置。
  petWin.on('will-move', () => { petMoved = false })
  petWin.on('moved', () => {
    petMoved = true
    const [rx, ry] = petWin!.getPosition()
    // 边界约束：至少保留 80px 可见，防止桌宠被拖出屏幕后"丢失"
    const [cx, cy] = clampToWorkArea(rx, ry, PET_W, PET_H)
    if (cx !== rx || cy !== ry) petWin!.setPosition(cx, cy)
    store.setSetting('petPosition', { x: cx, y: cy })
    log('pet moved →', cx, cy)
  })
  petWin.loadURL(RENDERER_URL + '?window=pet')
  if (settings.clickThrough) setClickThrough(true)
  petWin.on('closed', () => { petWin = null })
}

function createPanelWindow(): void {
  if (panelWin) { panelWin.show(); panelWin.focus(); return }
  const primary = screen.getPrimaryDisplay()
  panelWin = new BrowserWindow({
    width: 980, height: 640,
    x: Math.round(primary.workArea.x + (primary.workArea.width - 980) / 2),
    y: Math.round(primary.workArea.y + (primary.workArea.height - 640) / 2),
    // Windows 11 原生圆角：Electron 的 roundedCorners 只对「非透明」无边框窗口生效。
    // transparent:true 会走分层窗口路径，DWM 不画圆角（四角是直角）。
    // 因此这里用 transparent:false + backgroundColor，让 DWM 真正裁出圆角；
    // 交通灯按钮仍由渲染层绘制，macOS 观感由 CSS 负责。
    frame: false, transparent: false, hasShadow: true,
    // 窗口原生背景跟随主题，避免无边框窗口边缘与内容色不一致
    backgroundColor: settings.theme === 'dark' ? '#1c1c1e' : '#f6f6f8',
    roundedCorners: true,
    title: 'PandaDingDing 管理面板',
    webPreferences: {
      preload: path.join(APP_DIR, 'dist/preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  })
  panelWin.loadURL(RENDERER_URL + '?window=panel')
  panelWin.on('closed', () => { panelWin = null })
}

function setPetVisible(visible: boolean): void {
  if (visible) petWin?.showInactive()
  else petWin?.hide()
  settings.petVisible = visible
  store.setSetting('petVisible', visible)
  refreshTray()
}

function setClickThrough(on: boolean): void {
  settings.clickThrough = on
  // 不再持久化：穿透仅当次运行有效，重启后自动恢复可交互，避免"桌宠点不动"卡死
  petWin?.setIgnoreMouseEvents(on, { forward: true })
  refreshTray()
}

/* ---------- 托盘 ---------- */

function createTray(): void {
  // 托盘图标：优先皮肤自带的 tray.png，其次全局 icons/tray.png
  const candidates = [
    res('skins', settings.skin, 'tray.png'),
    res('icons', 'tray.png'),
  ]
  const iconPath = candidates.find((p) => fs.existsSync(p))
  const img = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  tray = new Tray(img)
  refreshTray()
}

/** 重建托盘菜单：动态显示点击穿透状态（穿透时置顶显示"恢复交互"，避免用户卡死） */
function refreshTray(): void {
  if (!tray) return
  const ct = settings.clickThrough
  const items: Electron.MenuItemConstructorOptions[] = []
  if (ct) {
    // 穿透态置顶：这是唯一的恢复入口，必须一眼可见
    items.push({ label: '⚠ 当前为点击穿透（桌宠不可拖动）', enabled: false })
    items.push({ label: '✅ 恢复鼠标交互', click: () => { setClickThrough(false); refreshTray() } })
    items.push({ type: 'separator' })
  }
  items.push(
    { label: '打开管理面板', click: () => createPanelWindow() },
    { label: settings.petVisible ? '隐藏桌宠' : '显示桌宠', click: () => setPetVisible(!settings.petVisible) },
    { label: ct ? '（已开启点击穿透）' : '开启点击穿透', click: () => { setClickThrough(!ct); refreshTray() } },
    { label: '免打扰 30 分钟', click: () => {
      const r = { start: fmtHM(new Date()), end: fmtHM(new Date(Date.now() + 30 * 60_000)) }
      settings.dndEnabled = true
      settings.dndRanges = [...settings.dndRanges, r]
      store.setSetting('dndRanges', r)
    } },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() },
  )
  tray.setContextMenu(Menu.buildFromTemplate(items))
  tray.setToolTip(ct ? 'PandaDingDing（点击穿透中 · 托盘可恢复）' : 'PandaDingDing 股票桌宠')
  // 穿透态下左键单击托盘 = 快速恢复交互；否则打开面板
  tray.on('click', () => {
    if (settings.clickThrough) { setClickThrough(false); refreshTray() }
    else createPanelWindow()
  })
}

function fmtHM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/* ---------- 轮询与提醒 ---------- */

async function pollOnce(): Promise<void> {
  const wl = store.listWatchlist()
  if (wl.length === 0) { latestSnapshots = []; return }
  const snaps = await dsm.fetchAll(wl.map((w) => ({ market: w.market, code: w.code })))
  if (snaps.length === 0) return
  latestSnapshots = snaps
  broadcast(IPC.push.quoteSnapshot, snaps)
  scheduler.setBackoff(dsm.backoff)
  alertEngine.feed(snaps)
  pushPetState()
}

function onAlertFired(e: import('../../../packages/shared/src/index.ts').AlertEvent): void {
  alertHoldUntil = Date.now() + 8000
  lastAlertDirection = e.direction
  broadcast(IPC.push.alertTriggered, e)
  pushPetState()
  setTimeout(pushPetState, 8000).unref?.()
}

function onPhaseChange(p: import('../../../packages/shared/src/index.ts').MarketPhase): void {
  broadcast(IPC.push.systemNotice, { type: 'phase', message: PHASE_LABEL[p] ?? p })
  if (p === 'closed') {
    // 收盘总结（15:00 后首次进入 closed）
    const pct = portfolioPct(latestSnapshots, store.listWatchlist())
    const up = latestSnapshots.filter((s) => (s.changePct ?? 0) > 0).length
    const down = latestSnapshots.filter((s) => (s.changePct ?? 0) < 0).length
    const msg = `今日自选 ${up}红${down}绿，组合 ${pct === null ? '--' : (pct >= 0 ? '+' : '') + pct.toFixed(2)}%`
    broadcast(IPC.push.systemNotice, { type: 'phase', message: msg })
  }
}

const PHASE_LABEL: Record<string, string> = {
  preOpen: '开盘啦（集合竞价）', continuous: '连续竞价', lunch: '午间休市',
  closed: '已收盘', weekend: '周末休市', holiday: '节假日休市',
}

const moodThresholds = (): MoodThresholds => ({ up: settings.moodUpThreshold, down: settings.moodDownThreshold })

function pushPetState(): void {
  const wl = store.listWatchlist()
  const pct = portfolioPct(latestSnapshots, wl)
  const state: PetState = resolvePetState({
    alertActive: Date.now() < alertHoldUntil,
    alertDirection: lastAlertDirection ?? 'up',
    offline: dsm.currentState === 'OFFLINE',
    phase: phaseOf(new Date()),
    pct,
    thresholds: moodThresholds(),
  })
  broadcast(IPC.push.petState, state)
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of [petWin, panelWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

export { createPanelWindow, suggest, BUILTIN_ETF, settings as _settings }
