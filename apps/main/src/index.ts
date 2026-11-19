import { app, BrowserWindow, Tray, Menu, screen, nativeImage, clipboard, globalShortcut } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { DataStore } from './store/DataStore.ts'
import { DataSourceManager } from './data-source/DataSourceManager.ts'
import { bindFetch as bindEM } from './data-source/EastmoneyAdapter.ts'
import { bindFetch as bindTX } from './data-source/TencentAdapter.ts'
import { bindFetch as bindFund } from './data-source/FundAdapter.ts'
import { QuoteScheduler } from './scheduler/QuoteScheduler.ts'
import { AlertEngine, isDndNow } from './alert/AlertEngine.ts'
import { enrichDerived } from './alert/derivedMetrics.ts'
import { portfolioPct, resolvePetState, baseMoodState, type MoodThresholds } from './pet/petState.ts'
import { RoamController } from './pet/RoamController.ts'
import { decideBadge } from './tray/trayBadge.ts'
import { registerIpc } from './ipc/handlers.ts'
import { suggest, BUILTIN_ETF, parseClipboardCode } from './search/suggest.ts'
import { setPetWindow } from './windows/petWindowAccess.ts'
import { KlineService, bindFetch as bindKline } from './kline/KlineService.ts'
import { IPC, phaseOf, isTradingDay, MARKET_INDICES, DEFAULT_SETTINGS, type AppSettings, type QuoteSnapshot, type WatchItem, type PetState, type ClosingReport, type TimeAlert } from '../../../packages/shared/src/index.ts'
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
/** 托盘当前使用的图标文件（用于角标态去重，避免每轮 setImage 闪烁） */
let trayIconFile: string | null = null
let roamCtrl: RoamController | null = null
let petWin: BrowserWindow | null = null
let panelWin: BrowserWindow | null = null
let store: DataStore
let dsm: DataSourceManager
let scheduler: QuoteScheduler
let alertEngine: AlertEngine
/** K线服务单例：IPC 查询与提醒派生指标共用同一份 10 分钟缓存 */
let klineSvc: KlineService
let settings: AppSettings
let latestSnapshots: QuoteSnapshot[] = []
/** 大盘指数（温度条用，与自选分开存，避免混入组合涨跌计算） */
let latestIndexQuotes: QuoteSnapshot[] = []
let alertHoldUntil = 0
let lastAlertDirection: 'up' | 'down' | null = null
/** 桌宠窗口本次交互是否发生过位移（用于区分单击/拖拽） */
let petMoved = false
/** 老板键隐身态：只影响当前运行期，不写 petVisible，避免下次启动"桌宠不见了" */
let bossHidden = false
/** 当前已注册的老板键组合（用于改键时精确解绑） */
let bossAccel: string | null = null

/** 桌宠窗口尺寸（含气泡区）；与渲染层 PetStage 的 STAGE_W/H 保持一致 */
const PET_W = 160
const PET_H = 210

/** 指数温度条：窗口尺寸（指数列表见 shared 的 MARKET_INDICES） */
const INDEX_W = 134
const INDEX_H = 92
const INDEX_ITEMS = MARKET_INDICES
let indexWin: BrowserWindow | null = null

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
  bindFund(doFetch)
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
  ensureDefaultTimeAlerts()

  dsm = new DataSourceManager(log)
  dsm.on('notice', (n) => broadcast(IPC.push.systemNotice, n))
  klineSvc = new KlineService()

  alertEngine = new AlertEngine({
    getRules: () => store.listRules(),
    getWatchlist: () => store.listWatchlist(),
    hasFiredToday: (secId, dir) => store.hasFiredToday(secId, dir),
    lastFiredAt: (ruleId, secId, dir) => store.lastFiredAt(ruleId, secId, dir),
    insertEvent: (e) => store.insertAlertEvent(e),
    isDndNow: (now) => isDndNow(settings.dndRanges, settings.dndEnabled, now ?? new Date()),
  })
  alertEngine.on('alert', onAlertFired)

  scheduler = new QuoteScheduler(async () => { await pollOnce() }, log)
  scheduler.on('phaseChange', onPhaseChange)

  registerIpc({
    store, dsm, scheduler,
    getSnapshots: () => latestSnapshots,
    getIndexSnapshots: () => latestIndexQuotes,
    onSettingChanged: (s) => {
      const prevSkin = settings.skin
      const prevBossEnabled = settings.bossKeyEnabled
      const prevBossAccel = settings.bossKeyAccelerator
      const prevIndexBar = settings.indexBarEnabled
      settings = s
      // 皮肤更换：基础托盘图可能变化，强制重建图标
      if (s.skin !== prevSkin) {
        trayIconFile = null
        const base = trayBasePath()
        if (base && tray && fs.existsSync(base)) tray.setImage(nativeImage.createFromPath(base))
      }
      // 角标开关变化后立即刷新（开→显示角标，关→回基础图）
      updateTrayBadge(portfolioPct(latestSnapshots, store.listWatchlist()), Date.now() < alertHoldUntil)
      // 老板键开关或组合键变了：立即重新注册，不必重启应用
      if (s.bossKeyEnabled !== prevBossEnabled || s.bossKeyAccelerator !== prevBossAccel) {
        registerBossKey()
        refreshTray()
      }
      // 指数温度条开关：即时建/销窗口，并立刻拉一次指数（不必等下一轮轮询）
      if (s.indexBarEnabled !== prevIndexBar) {
        if (s.indexBarEnabled) { createIndexWindow(); void pollOnce() }
        else { indexWin?.close(); indexWin = null; latestIndexQuotes = [] }
      }
      // 免打扰时段改了要立刻反映到桌宠（否则要等下一轮轮询才躺下/起身）
      pushPetState()
    },
    getSettingsRef: () => settings,
    openPanel: () => createPanelWindow(),
    closePanel: () => { panelWin?.close() },
    minimizePanel: () => { panelWin?.minimize() },
    kline: klineSvc,
    listSkins: () => listSkins(),
    setPetVisible: (visible) => setPetVisible(visible),
    refreshTray: () => refreshTray(),
    setAutoStart: (enabled) => applyAutoStart(enabled),
    refreshTimeAlerts: () => checkTimeAlerts(),
  })
  // 启动时同步一次自启设置，防止系统侧被外部改动后与设置页不一致
  try { applyAutoStart(settings.autoStart) } catch (e) { log('同步开机自启失败:', e) }

  createTray()
  createPetWindow()
  createIndexWindow()
  createRoamController()
  registerBossKey()
  startTimeAlerts()
  scheduler.start(settings.pollIntervalMs)
  startClipboardWatch()

  app.on('online', () => { dsm.setOnline(true); scheduler.start(settings.pollIntervalMs) })
  app.on('offline', () => { dsm.setOnline(false); broadcast(IPC.push.systemNotice, { type: 'network', message: '网络已断开' }) })
  app.on('window-all-closed', () => { /* 托盘常驻 */ })
  app.on('before-quit', () => { try { globalShortcut.unregisterAll() } catch { /* 已退出 */ } stopTimeAlerts(); scheduler.stop(); dsm.dispose(); stopClipboardWatch(); roamCtrl?.stop(); store.close() })
}

/* ---------- 剪贴板侦听（P2） ---------- */
let clipboardTimer: NodeJS.Timeout | null = null
let lastClipboardText = ''

/** 轮询剪贴板：复制股票代码时识别并自动加入自选（开关开启时），广播提示。 */
function startClipboardWatch(): void {
  stopClipboardWatch()
  // 初始化基线，避免启动时把已有剪贴板内容当作新复制
  try { lastClipboardText = clipboard.readText() } catch { lastClipboardText = '' }
  clipboardTimer = setInterval(() => {
    if (!settings.clipboardWatch) return
    let text: string
    try { text = clipboard.readText() } catch { return }
    if (!text || text === lastClipboardText) return
    lastClipboardText = text
    const parsed = parseClipboardCode(text)
    if (!parsed) return
    const secId = `${parsed.market}.${parsed.code}`
    // 已在自选则跳过
    if (store.listWatchlist().some((w) => w.secId === secId)) return
    try {
      // 名称尽力从内置清单补齐，缺失则用代码
      const name = BUILTIN_ETF.find((b) => b.code === parsed.code)?.name ?? parsed.code
      store.addWatchlist(secId, name, parsed.market)
      broadcast(IPC.push.systemNotice, {
        type: 'info', message: `已从剪贴板添加 ${parsed.code}（${name}）到自选`,
      })
      log('剪贴板检测到代码并加入自选:', secId)
      pollOnce() // 立即拉一次行情
    } catch (e) { log('剪贴板加入自选失败:', e) }
  }, 1500)
  clipboardTimer?.unref?.()
}
function stopClipboardWatch(): void {
  if (clipboardTimer) { clearInterval(clipboardTimer); clipboardTimer = null }
}

/**
 * 开机自启落地（P0 假开关修复）。
 * - Windows/macOS：Electron 官方 setLoginItemSettings，打包后直接注册当前 exe。
 * - Linux：无统一 API，写 XDG autostart 桌面项（~/.config/autostart）。
 * 开发态（未打包）不注册真实自启，避免把 node/Electron 调试进程写进系统。
 */
function applyAutoStart(enabled: boolean): void {
  const { app } = require('electron') as typeof import('electron')
  if (process.platform !== 'linux') {
    if (!app.isPackaged) { log(`开机自启=${enabled}（开发态跳过系统注册）`); return }
    app.setLoginItemSettings({
      openAtLogin: enabled,
      // macOS 用隐藏方式启动，避免登录后弹出面板；桌宠窗口仍会显示
      openAsHidden: process.platform === 'darwin' ? true : undefined,
    })
    log(`开机自启已设为 ${enabled}`)
    return
  }
  // Linux: XDG autostart
  try {
    const dir = path.join(app.getPath('home'), '.config', 'autostart')
    const file = path.join(dir, 'pandadingding.desktop')
    if (!enabled) {
      if (fs.existsSync(file)) fs.unlinkSync(file)
      return
    }
    fs.mkdirSync(dir, { recursive: true })
    const exec = app.isPackaged
      ? `"${process.execPath}"`
      : `"${process.execPath}" "${path.join(ROOT, 'scripts', 'dev.mjs')}"`
    const content = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=PandaDingDing',
      'Comment=熊猫盯盯 股票桌宠',
      `Exec=${exec}`,
      'X-GNOME-Autostart-enabled=true',
      'NoDisplay=false',
      '',
    ].join('\n')
    fs.writeFileSync(file, content, 'utf8')
    log('Linux 开机自启已写入', file)
  } catch (e) { log('Linux 开机自启写入失败:', e) }
}

function ensureDefaultRule(): void {
  if (store.listRules().length === 0) {
    store.upsertRule({
      id: 'global-default', scope: 'global', metric: 'changePct', op: 'absAbove',
      threshold: 3, cooldown: 'oncePerDay', enabled: true,
    })
  }
}

/* ---------- 定时时点提醒 ---------- */

/** 上班盯盘最容易错过的几个时点（首次启动写入，用户可改可删） */
const DEFAULT_TIME_ALERTS: { time: string; label: string }[] = [
  { time: '09:25', label: '集合竞价，看今日开盘' },
  { time: '11:20', label: '午盘前，是否调整仓位' },
  { time: '14:45', label: '决定今天是否持股过夜' },
  { time: '14:55', label: '尾盘 5 分钟' },
]

function ensureDefaultTimeAlerts(): void {
  try {
    if (store.listTimeAlerts().length > 0) return
    for (const d of DEFAULT_TIME_ALERTS) {
      store.upsertTimeAlert({
        id: `builtin-${d.time.replace(':', '')}`,
        time: d.time, label: d.label, enabled: true, workdayOnly: true,
      })
    }
    log('已写入默认定时提醒', DEFAULT_TIME_ALERTS.length, '条')
  } catch (e) { log('写入默认定时提醒失败:', e) }
}

let timeAlertTimer: NodeJS.Timeout | null = null

function startTimeAlerts(): void {
  stopTimeAlerts()
  // 20 秒扫一次而不是整分一次：系统休眠/时钟漂移时不会整天跳过某个时点
  timeAlertTimer = setInterval(checkTimeAlerts, 20_000)
  timeAlertTimer.unref?.()
  checkTimeAlerts()
}

function stopTimeAlerts(): void {
  if (timeAlertTimer) { clearInterval(timeAlertTimer); timeAlertTimer = null }
}

function checkTimeAlerts(): void {
  try {
    const now = new Date()
    const hm = fmtHM(now)
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    for (const a of store.dueTimeAlerts(hm, today)) {
      // 工作日限定：周末与节假日不响
      if (a.workdayOnly && !isTradingDay(now)) continue
      // 先落标记再判断免打扰：20 秒扫描会在同一分钟命中 3 次，必须先占位
      store.markTimeAlertFired(a.id, today)
      if (isDndNow(settings.dndRanges, settings.dndEnabled, now)) {
        log('定时提醒命中免打扰，静默:', a.time, a.label)
        continue
      }
      fireTimeAlert(a)
    }
  } catch (e) { log('定时提醒检查失败:', e) }
}

function fireTimeAlert(a: TimeAlert): void {
  log('定时提醒触发:', a.time, a.label)
  // 气泡里不再重复时间（列表里已有），避免 11px 字号下折成三行
  broadcast(IPC.push.systemNotice, { type: 'reminder', message: `⏰ ${a.label}`, level: 'alert' })
  // 复用提醒的 8 秒保持窗口：桌宠跳一下，气泡停留足够看完
  alertHoldUntil = Date.now() + 8000
  lastAlertDirection = 'up'
  pushPetState()
  setTimeout(pushPetState, 8000).unref?.()
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
  petWin.on('will-move', () => { if (!isRoamProgrammatic()) petMoved = false })
  petWin.on('moved', () => {
    if (isRoamProgrammatic()) return   // 漫游程序化移动：不落盘、不打断、不污染单击判断
    petMoved = true
    roamCtrl?.notifyUserActivity()     // 用户手动拖拽：立即中断漫游
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

/** 最近这次窗口移动是否来自漫游调度器（避免程序化移动被当成用户拖拽） */
function isRoamProgrammatic(): boolean {
  return !!roamCtrl?.isProgrammaticMove()
}

/**
 * 桌宠漫游调度器：空闲时沿桌面底部来回散步，撞边翻面。
 * canRoam 只在中性的"无事可做"时段放行（提醒/离线/盘后/隐藏/穿透/拖拽中均不漫游）；
 * 真正是否显示为 walk 仍由 resolvePetState 的优先级链决定，二者一致。
 */
function createRoamController(): void {
  roamCtrl = new RoamController({
    getPosition: () => {
      const [x, y] = petWin && !petWin.isDestroyed() ? petWin.getPosition() : [0, 0]
      return { x, y }
    },
    setPosition: (x, y) => { if (petWin && !petWin.isDestroyed()) petWin.setPosition(x, y) },
    getWorkArea: () => {
      const [x, y] = petWin && !petWin.isDestroyed() ? petWin.getPosition() : [0, 0]
      return screen.getDisplayNearestPoint({ x, y }).workArea
    },
    isEnabled: () => settings.roamEnabled,
    canRoam: () => {
      if (!settings.petVisible || settings.clickThrough) return false
      if (petMoved) return false                       // 正在/刚被用户拖拽
      if (Date.now() < alertHoldUntil) return false    // 提醒展示中
      if (dsm.currentState === 'OFFLINE') return false
      const phase = phaseOf(new Date())
      if (phase === 'closed' || phase === 'weekend' || phase === 'holiday') return false
      // 仅在组合情绪中性（idle）时漫游；有明确涨跌情绪时保持站立表达
      const pct = portfolioPct(latestSnapshots, store.listWatchlist())
      return baseMoodState(pct, moodThresholds()).action === 'idle'
    },
    onFacingChange: () => pushPetState(),  // 让渲染层拿到最新 facing 翻面
    onActivity: () => pushPetState(),
    persistPosition: (p) => store.setSetting('petPosition', { x: Math.round(p.x), y: Math.round(p.y) }),
    log,
  })
  roamCtrl.start()
}

function createPanelWindow(): void {
  // 老板键隐身期间用户主动打开面板 = 要退出隐身，否则会"面板出现了桌宠还藏着"
  if (bossHidden) {
    bossHidden = false
    if (settings.petVisible) petWin?.showInactive()
    if (settings.indexBarEnabled) indexWin?.showInactive()
    refreshTray()
  }
  roamCtrl?.notifyUserActivity()   // 用户交互：中断漫游
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
    title: '熊猫盯盯 · 管理面板',
    webPreferences: {
      preload: path.join(APP_DIR, 'dist/preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
    },
  })
  panelWin.loadURL(RENDERER_URL + '?window=panel')
  panelWin.on('closed', () => { panelWin = null })
}

/** 指数温度条窗口：桌面角落常驻的 4 行大盘指数，可拖动，位置落库 */
function createIndexWindow(): void {
  if (!settings.indexBarEnabled) {
    if (indexWin && !indexWin.isDestroyed()) indexWin.close()
    indexWin = null
    return
  }
  if (indexWin && !indexWin.isDestroyed()) return
  const wa = screen.getPrimaryDisplay().workArea
  const pos = settings.indexBarPosition
  const x = pos ? pos.x : wa.x + wa.width - INDEX_W - 16
  const y = pos ? pos.y : wa.y + 140
  indexWin = new BrowserWindow({
    width: INDEX_W, height: INDEX_H, x, y,
    transparent: true, frame: false, alwaysOnTop: true, hasShadow: false,
    backgroundColor: '#00000000', skipTaskbar: true, resizable: false,
    webPreferences: {
      preload: path.join(APP_DIR, 'dist/preload.cjs'),
      contextIsolation: true, nodeIntegration: false, sandbox: false,
      backgroundThrottling: false,
    },
  })
  indexWin.setAlwaysOnTop(true, 'screen-saver')
  indexWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  indexWin.loadURL(RENDERER_URL + '?window=index')
  // Windows 只在拖动结束时触发 moved，不会造成高频写库
  indexWin.on('moved', () => {
    if (!indexWin || indexWin.isDestroyed()) return
    const [px, py] = indexWin.getPosition()
    store.setSetting('indexBarPosition', { x: px, y: py })
  })
  indexWin.on('closed', () => { indexWin = null })
}

function setPetVisible(visible: boolean): void {
  // 显式要求显示 → 同时退出老板键隐身态，避免"点了显示却看不到"
  if (visible && bossHidden) { bossHidden = false; refreshTray() }
  if (visible) { petWin?.showInactive(); if (settings.indexBarEnabled) indexWin?.showInactive() }
  else { petWin?.hide(); indexWin?.hide() }
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

/* ---------- 老板键 ---------- */

/**
 * 老板键：全局热键一键隐藏桌宠 + 管理面板，再按一次恢复。
 * 隐身态只存在于本次运行（bossHidden），不改 settings.petVisible——
 * 否则用户下次启动会发现"桌宠不见了"，却不知道是被老板键写的。
 */
function toggleBossHidden(): void {
  bossHidden = !bossHidden
  if (bossHidden) {
    petWin?.hide()
    panelWin?.hide()
    indexWin?.hide()
    roamCtrl?.notifyUserActivity()   // 隐身时停止漫游，避免后台继续移动
    log('老板键：隐藏')
  } else {
    if (settings.petVisible) petWin?.showInactive()
    if (settings.indexBarEnabled) indexWin?.showInactive()
    if (panelWin && !panelWin.isDestroyed()) { panelWin.show(); panelWin.focus() }
    log('老板键：恢复')
  }
  refreshTray()
}

/** 注册/更新老板键；组合键被占用时保持静默失败并记日志（不阻塞启动） */
function registerBossKey(): void {
  if (bossAccel) {
    try { globalShortcut.unregister(bossAccel) } catch { /* 已失效 */ }
    bossAccel = null
  }
  if (!settings.bossKeyEnabled) { log('老板键已关闭'); return }
  const accel = (settings.bossKeyAccelerator || DEFAULT_SETTINGS.bossKeyAccelerator).trim()
  if (!accel) return
  try {
    const ok = globalShortcut.register(accel, () => toggleBossHidden())
    if (ok) {
      bossAccel = accel
      log('老板键已注册:', accel)
    } else {
      log('老板键注册失败（组合键可能已被其他程序占用）:', accel)
    }
  } catch (e) {
    log('老板键注册异常:', e)
  }
}

/* ---------- 托盘 ---------- */

/** 解析托盘基础图标路径：优先皮肤自带 tray.png，其次全局 icons/tray.png */
function trayBasePath(): string | null {
  const candidates = [
    res('skins', settings.skin, 'tray.png'),
    res('icons', 'tray.png'),
  ]
  return candidates.find((p) => fs.existsSync(p)) ?? null
}

/** 角标图统一取全局 icons（基于默认熊头生成），保证四态一致 */
function trayBadgePath(file: string): string { return res('icons', file) }

function createTray(): void {
  const iconPath = trayBasePath()
  const img = iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
  tray = new Tray(img)
  trayIconFile = null
  refreshTray()
}

/**
 * 按组合涨跌/提醒/离线切换托盘角标 + 动态 tooltip（hover 快览）。
 * 仅在图标文件变化时 setImage，避免轮询每轮重建托盘图导致闪烁。
 */
function updateTrayBadge(pct: number | null, alerting: boolean): void {
  if (!tray) return
  const decision = decideBadge({
    pct, alerting,
    offline: dsm.currentState === 'OFFLINE',
    enabled: settings.trayBadge,
    source: dsm.activeSource === '东方财富' ? '东财' : dsm.activeSource,
    snapshots: latestSnapshots,
    clickThrough: settings.clickThrough,
  })
  if (decision.iconFile !== trayIconFile) {
    const path = decision.iconFile ? trayBadgePath(decision.iconFile) : trayBasePath()
    if (path && fs.existsSync(path)) tray.setImage(nativeImage.createFromPath(path))
    trayIconFile = decision.iconFile
  }
  tray.setToolTip(decision.tooltip)
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
    {
      label: bossHidden
        ? '🔒 已隐藏（点击恢复显示）'
        : `🔒 一键隐藏（${shortAccel(settings.bossKeyAccelerator)}）`,
      click: () => toggleBossHidden(),
    },
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
  // tooltip / 角标统一由 updateTrayBadge 维护（含穿透态提示），这里同步刷新一次
  updateTrayBadge(portfolioPct(latestSnapshots, store.listWatchlist()), Date.now() < alertHoldUntil)
  // 穿透态下左键单击托盘 = 快速恢复交互；否则打开面板
  tray.on('click', () => {
    if (settings.clickThrough) { setClickThrough(false); refreshTray() }
    else createPanelWindow()
  })
}

function fmtHM(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/** Accelerator → 托盘里的短标签（CommandOrControl+Shift+H → Ctrl+Shift+H） */
function shortAccel(a: string): string {
  return (a || DEFAULT_SETTINGS.bossKeyAccelerator)
    .replace(/CommandOrControl|CmdOrCtrl/gi, 'Ctrl')
    .replace(/\s+/g, '')
}

/* ---------- 轮询与提醒 ---------- */

async function pollOnce(): Promise<void> {
  const wl = store.listWatchlist()
  const withIndex = settings.indexBarEnabled
  if (wl.length === 0 && !withIndex) { latestSnapshots = []; return }
  // 指数与自选合并到同一次批量请求（东财一次可带 50 个 secid），不增加请求数
  const targets = [
    ...wl.map((w) => ({ market: w.market, code: w.code })),
    ...(withIndex ? INDEX_ITEMS.map((i) => ({ market: i.market, code: i.code })) : []),
  ]
  const snaps = await dsm.fetchAll(targets)
  if (snaps.length === 0) return
  const indexIds = new Set(INDEX_ITEMS.map((i) => i.secId))
  const indexSnaps = snaps.filter((s) => indexIds.has(s.secId))
  latestSnapshots = snaps.filter((s) => !indexIds.has(s.secId))
  broadcast(IPC.push.quoteSnapshot, latestSnapshots)
  if (withIndex && indexSnaps.length > 0) {
    latestIndexQuotes = indexSnaps
    broadcast(IPC.push.indexQuotes, indexSnaps)
  }
  scheduler.setBackoff(dsm.backoff)
  // 成交量倍数 / 连涨连跌规则需要日K派生数据；无相关规则时零开销，K线有 10 分钟缓存
  await enrichDerived(latestSnapshots, store.listRules(), klineSvc, new Date(), log)
  alertEngine.feed(latestSnapshots)
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
  if (p === 'closed') generateClosingReport()
}

/** 收盘总结报告（P2）：统计红绿盘、组合涨跌、领涨领跌，落库并可回看 */
function generateClosingReport(): void {
  if (!settings.closingReport) { log('收盘报告已关闭，跳过'); return }
  const snaps = latestSnapshots.filter((s) => s.changePct !== null && s.changePct !== undefined)
  if (snaps.length === 0) { log('收盘报告：无有效快照，跳过'); return }
  const wl = store.listWatchlist()
  const up = snaps.filter((s) => (s.changePct ?? 0) > 0)
  const down = snaps.filter((s) => (s.changePct ?? 0) < 0)
  const flat = snaps.length - up.length - down.length
  const pct = portfolioPct(latestSnapshots, wl)
  const byPct = (a: QuoteSnapshot, b: QuoteSnapshot) => (b.changePct ?? 0) - (a.changePct ?? 0)
  const topGainers = [...up].sort(byPct).slice(0, 5)
    .map((s) => ({ name: s.name, code: s.code, changePct: s.changePct as number }))
  const topLosers = [...down].sort((a, b) => (a.changePct ?? 0) - (b.changePct ?? 0)).slice(0, 5)
    .map((s) => ({ name: s.name, code: s.code, changePct: s.changePct as number }))
  const pctStr = pct === null ? '--' : `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
  const report: ClosingReport = {
    date: new Date().toISOString().slice(0, 10),
    generatedAt: new Date().toISOString(),
    total: snaps.length, upCount: up.length, downCount: down.length, flatCount: flat,
    portfolioPct: pct, topGainers, topLosers,
    headline: `今日自选 ${up.length}红${down.length}绿${flat ? ` ${flat}平` : ''}，组合 ${pctStr}`,
  }
  try {
    store.upsertClosingReport(report)
    broadcast(IPC.push.systemNotice, { type: 'phase', message: `收盘总结：${report.headline}` })
    log('收盘报告已生成:', report.headline)
  } catch (e) { log('收盘报告生成失败:', e) }
}

const PHASE_LABEL: Record<string, string> = {
  preOpen: '开盘啦（集合竞价）', continuous: '连续竞价', lunch: '午间休市',
  closed: '已收盘', weekend: '周末休市', holiday: '节假日休市',
}

const moodThresholds = (): MoodThresholds => ({ up: settings.moodUpThreshold, down: settings.moodDownThreshold })

function pushPetState(): void {
  const wl = store.listWatchlist()
  const pct = portfolioPct(latestSnapshots, wl)
  const now = new Date()
  const state: PetState = resolvePetState({
    alertActive: Date.now() < alertHoldUntil,
    alertDirection: lastAlertDirection ?? 'up',
    offline: dsm.currentState === 'OFFLINE',
    // 与提醒静默同源：免打扰时段桌宠也躺下睡觉（设置页 dndEnabled + dndRanges）
    dnd: isDndNow(settings.dndRanges, settings.dndEnabled, now),
    phase: phaseOf(now),
    pct,
    thresholds: moodThresholds(),
    roamActive: roamCtrl?.isRoaming ?? false,
    roamFacing: roamCtrl?.roamFacing ?? 'right',
  })
  broadcast(IPC.push.petState, state)
  updateTrayBadge(pct, Date.now() < alertHoldUntil)
}

function broadcast(channel: string, payload: unknown): void {
  // indexWin 必须在内：温度条没有轮询能力，只靠 index:quotes 推送更新
  for (const w of [petWin, panelWin, indexWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

export { createPanelWindow, suggest, BUILTIN_ETF, settings as _settings }
