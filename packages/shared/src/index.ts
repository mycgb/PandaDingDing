/** 统一域模型与 IPC 契约 —— 主进程与渲染进程共用 */

export * from './market-calendar.ts'
export * from './breath.ts'
export * from './ds-state.ts'
export * from './position.ts'

/** 市场号，与东方财富 MktNum / secid 前缀一致 */
export type MarketType =
  | 0 | 1          // 0=深市 1=沪市（A股/场内ETF）
  | 116            // 港股
  | 105 | 106 | 107 // 美股（105=纳斯达克 106=纽交所 107=美交所）
  | 150            // 场外基金（净值型）

/** 资产类别：由 market 号推导，用于 UI 展示与数据源路由 */
export type AssetCategory = 'stock' | 'etf' | 'hk' | 'us' | 'fund'

/** 由市场号推导资产类别（唯一事实来源，避免各端各写一套） */
export function categoryOf(market: MarketType): AssetCategory {
  if (market === 116) return 'hk'
  if (market === 105 || market === 106 || market === 107) return 'us'
  if (market === 150) return 'fund'
  // 场内 ETF/LOF 与股票共用 push2 通道，统一归 stock（搜索结果用 type 字段单独标注基金）
  return 'stock'
}

/** 该市场号是否需要走特殊行情通道（场外基金 push2 不支持） */
export function isOtcFund(market: MarketType): boolean { return market === 150 }

export interface SecId { market: MarketType; code: string }

/**
 * 指数温度条盯的 4 个大盘指数。
 * 主进程用于订阅行情，渲染层用于取中文简称——放 shared 里保证两边一致。
 */
export const MARKET_INDICES: { secId: string; market: MarketType; code: string; short: string }[] = [
  { secId: '1.000001', market: 1, code: '000001', short: '上证' },
  { secId: '0.399001', market: 0, code: '399001', short: '深成' },
  { secId: '0.399006', market: 0, code: '399006', short: '创业板' },
  { secId: '1.000688', market: 1, code: '000688', short: '科创50' },
]

export interface QuoteSnapshot {
  secId: string          // '1.600519'
  code: string
  name: string
  market: MarketType
  price: number | null
  changePct: number | null
  change: number | null
  volume: number | null      // 手（当日累计）
  amount: number | null     // 元
  high: number | null
  low: number | null
  open: number | null
  prevClose: number | null
  fetchedAt: number         // epoch ms
  source: string            // 'eastmoney' | 'tencent'
  /** 派生指标：近 N 日同期均量（手），由主进程根据日K注入，用于 volumeMultiple 规则判定 */
  volumeBaseline?: number | null
  /** 派生指标：连涨（正）/连跌（负）天数，由主进程根据日K注入，用于 streakUp/streakDown 判定 */
  streakDays?: number | null
  /** 派生指标：近 3 分钟涨跌 %，由主进程价格环形缓冲算出（异动雷达） */
  speedPct?: number | null
  /** 派生指标：当前是否封在涨停/跌停（atLimit 规则用） */
  atLimit?: 'up' | 'down' | null
}

export interface WatchItem {
  secId: string
  code: string
  name: string
  market: MarketType
  weight: number
  sortOrder: number
  createdAt: string
  /** 持仓股数（0 = 只观察，不参与盈亏统计） */
  shares: number
  /** 持仓成本价（0 = 未填成本，累计盈亏不计算） */
  costPrice: number
}

/**
 * 提醒指标。
 * volumeMultiple=成交量倍数；streakUp/streakDown=连涨/连跌天数（阈值为天数）；
 * speedPct=近 3 分钟涨跌 %（异动雷达）；atLimit=触及涨停/跌停（阈值忽略）
 */
export type AlertMetric =
  | 'changePct' | 'price' | 'volumeMultiple' | 'streakUp' | 'streakDown'
  | 'speedPct' | 'atLimit'
export type AlertOp = 'above' | 'below' | 'absAbove'
export type AlertCooldown = 'oncePerDay' | string  // 'minutes:30'

export interface AlertRule {
  id: string
  scope: 'global' | 'security'
  secId?: string
  metric: AlertMetric
  op: AlertOp
  threshold: number
  cooldown: AlertCooldown
  enabled: boolean
}

export type AlertDirection = 'up' | 'down'

/** 定时时点提醒：到点喊你一声（如 9:25 看集合竞价、14:45 决定是否过夜） */
export interface TimeAlert {
  id: string
  /** 'HH:mm'（24 小时制） */
  time: string
  label: string
  enabled: boolean
  /** 仅在交易日触发（关闭后每天都响，含周末） */
  workdayOnly: boolean
}

export interface AlertEvent {
  id: number
  secId: string
  secName: string
  ruleId: string
  direction: AlertDirection
  value: number
  message: string
  triggeredAt: string
}

export interface PetState {
  action: 'idle' | 'idle-smile' | 'idle-frown' | 'happy' | 'sad' | 'panic-happy' | 'panic-sad' | 'alert-time' | 'sleepy' | 'sleep' | 'walk' | 'offline'
  reason?: string
  /** 漫游朝向：渲染层据此水平翻转 walk 帧；'left' 时朝左 */
  facing?: 'left' | 'right'
  /**
   * 提醒类型：'up' 涨（欢呼抖动）/ 'down' 跌（摇头抖动）/ 'time' 定时时点（慢摇催办）。
   * 缺省时按 alertDirection 推断，渲染层据此选动作。
   */
  alertKind?: 'up' | 'down' | 'time'
  /**
   * 收盘后给桌宠显示「今日收益」小胶囊（元）；null/undefined 表示不显示。
   * 只在 15:00 之后推送，且必须已填持仓股数（否则没有意义）。
   */
  dayPnl?: number | null
}

export interface SystemNotice {
  type: 'dataSource' | 'network' | 'phase' | 'info' | 'reminder' | 'update'
  message: string
  /**
   * 'alert' = 按提醒处理：桌宠气泡在免打扰/睡觉期间也显示，并伴随动作（定时时点提醒用）。
   * 缺省为普通提示，睡觉时被拦掉。
   */
  level?: 'info' | 'alert'
}

export interface SuggestItem {
  secId: string
  code: string
  name: string
  market: MarketType
  type: AssetCategory  // 资产类别（含港美股/场外基金）
}

/** 数据源状态（监控页用，带延迟指标） */
export interface DataSourceStatus {
  source: string
  state: string
  lastOkAt: number | null
  latencyMs: number | null
  primaryName: string
  standbyName: string
  failoverCount: number
}

/** 收盘总结报告（收盘时生成，可持久化/回看） */
export interface ClosingReport {
  date: string              // YYYY-MM-DD
  generatedAt: string       // ISO
  total: number
  upCount: number
  downCount: number
  flatCount: number
  portfolioPct: number | null
  topGainers: { name: string; code: string; changePct: number }[]
  topLosers: { name: string; code: string; changePct: number }[]
  headline: string
  /** 持仓当日盈亏（元）；未记录持仓时为 null */
  dayPnl?: number | null
  /** 当日触发提醒次数 */
  alertCount?: number
  /** 沪深300 当日涨跌 %，用于对比是否跑赢大盘 */
  indexPct?: number | null
}

/* ---------- 软件更新（GitHub Releases） ---------- */

/** 从 Release 里挑出来的安装包 */
export interface UpdateAsset {
  name: string
  size: number
  url: string
}

/** 一次检查的结果（无论成功失败都会返回，失败时 error 有值） */
export interface UpdateInfo {
  /** 当前运行版本，如 0.2.2 */
  current: string
  /** 远端最新版本（去掉 v 前缀）；检查失败为 null */
  latest: string | null
  /** 是否有更新 */
  hasUpdate: boolean
  publishedAt: string | null
  /** Release 页面地址（浏览器打开用） */
  htmlUrl: string | null
  /** Release 说明正文（markdown，取前若干行展示） */
  notes: string | null
  /** 当前平台/架构匹配到的安装包；无匹配为 null */
  asset: UpdateAsset | null
  /** 是否支持「下载后静默安装」（目前仅 Windows NSIS） */
  installable: boolean
  /** 检查失败原因（网络/限流等），成功为 null */
  error: string | null
  /** 检查时间戳（ms） */
  checkedAt: number
}

export type UpdatePhase = 'idle' | 'downloading' | 'ready' | 'installing' | 'error'

/** 下载进度（push 到渲染层） */
export interface UpdateProgress {
  phase: UpdatePhase
  /** 0–100，长度未知时为 0 */
  percent: number
  receivedBytes: number
  totalBytes: number
  /** 出错或提示文案 */
  message?: string
}

/** 更新状态快照：设置页打开时回读，避免错过 push */
export interface UpdateStatus {
  info: UpdateInfo | null
  progress: UpdateProgress | null
}

export interface AppSettings {
  pollIntervalMs: number          // 盘中轮询间隔，默认 3000
  moodUpThreshold: number          // 组合情绪 happy 阈值 %，默认 0.5
  moodDownThreshold: number        // sad 阈值 %，默认 -0.5
  dndEnabled: boolean
  dndRanges: { start: string; end: string }[]   // 'HH:mm'
  soundEnabled: boolean
  petPosition: { x: number; y: number } | null
  clickThrough: boolean
  petVisible: boolean
  skin: string
  autoStart: boolean
  theme: 'light' | 'dark'
  bubbleColor: string   // 桌宠头顶 tick 气泡背景色（CSS 颜色值）
  bubbleAlwaysOn: boolean  // 气泡常显：轮流显示每只自选，而不是随机弹出
  bubbleFontSize: number    // 气泡文字大小（px），默认 11
  clipboardWatch: boolean  // 剪贴板侦听：复制股票代码时提示加入自选
  closingReport: boolean   // 收盘自动生成总结报告
  roamEnabled: boolean     // 桌宠漫游：空闲时在桌面底部来回散步（默认开）
  trayBadge: boolean       // 托盘角标：显示组合涨跌红绿点 + hover 快览（默认开）
  bossKeyEnabled: boolean  // 老板键：全局热键一键隐藏桌宠与面板（默认开）
  bossKeyAccelerator: string  // 老板键组合键（Electron Accelerator 格式）
  indexBarEnabled: boolean // 指数温度条：桌面角落常驻一条大盘指数（默认开）
  indexBarPosition: { x: number; y: number } | null  // 温度条窗口位置
  /** 交易纪律：防追高阈值（自选涨幅 ≥ 该值提醒一次），0 = 关闭 */
  chaseHighPct: number
  /** 交易纪律：每日提醒条数上限，0 = 不限（防提醒轰炸） */
  maxAlertsPerDay: number
  /** 行情源切换提示：切到备用源 / 主源恢复时是否弹提示条（默认开） */
  dsNoticeEnabled: boolean
  /** 启动后自动检查新版本（发现新版本时提示，默认开） */
  updateCheckEnabled: boolean
  /** 默认休息时段是否已并入免打扰列表（一次性迁移标记，避免用户删光后又被塞回来） */
  restRangesSeeded?: boolean
}

/**
 * 默认休息时段：午休 + 收盘后到次日开盘前。
 * 桌宠只在这两段之外、且是交易日的 09:25–11:30 / 13:00–15:00 保持活动；
 * 时段存在免打扰列表里，用户可以自己改时间或整条删掉（删光后桌宠就一直按情绪活动）。
 * 15:00–09:25 跨午夜，isDndNow 已按 t >= start || t < end 处理。
 */
export const DEFAULT_REST_RANGES: { start: string; end: string }[] = [
  { start: '11:30', end: '13:00' },
  { start: '15:00', end: '09:25' },
]

export const DEFAULT_SETTINGS: AppSettings = {
  pollIntervalMs: 3000,
  moodUpThreshold: 0.5,
  moodDownThreshold: -0.5,
  dndEnabled: true,
  // 拷贝一份：UI 里 push/splice 这个数组，不能改动模块级常量
  dndRanges: DEFAULT_REST_RANGES.map((r) => ({ ...r })),
  soundEnabled: true,
  petPosition: null,
  clickThrough: false,
  petVisible: true,
  skin: 'panda-shake-v4',
  autoStart: false,
  theme: 'light',
  bubbleColor: '#14181e',
  bubbleAlwaysOn: false,
  bubbleFontSize: 11,
  clipboardWatch: false,
  closingReport: true,
  roamEnabled: true,
  trayBadge: true,
  bossKeyEnabled: true,
  bossKeyAccelerator: 'CommandOrControl+Shift+H',
  indexBarEnabled: true,
  indexBarPosition: null,
  chaseHighPct: 7,
  maxAlertsPerDay: 0,
  dsNoticeEnabled: true,
  updateCheckEnabled: true,
}

/* ---------- IPC channel 白名单 ---------- */

export const IPC = {
  invoke: {
    watchlistList: 'watchlist/list',
    watchlistAdd: 'watchlist/add',
    watchlistRemove: 'watchlist/remove',
    watchlistReorder: 'watchlist/reorder',
    watchlistSetPosition: 'watchlist/setPosition',
    searchSuggest: 'search/suggest',
    rulesUpsert: 'rules/upsert',
    rulesDelete: 'rules/delete',
    rulesList: 'rules/list',
    settingsGet: 'settings/get',
    settingsSet: 'settings/set',
    quoteLatest: 'quote/latest',
    alertHistory: 'alert/history',
    alertResetCooldown: 'alert/resetCooldown',
    timeAlertsList: 'time-alerts/list',
    timeAlertsUpsert: 'time-alerts/upsert',
    timeAlertsDelete: 'time-alerts/delete',
    petSetInteraction: 'pet/setInteraction',
    petSetVisible: 'pet/setVisible',
    petMove: 'pet/move',
    petNudge: 'pet/nudge',
    panelOpen: 'panel/open',
    panelClose: 'panel/close',
    panelMinimize: 'panel/minimize',
    klineFetch: 'kline/fetch',
    trendsFetch: 'trends/fetch',
    skinsList: 'skins/list',
    dataSourceStatus: 'data-source/status',
    closingReports: 'closing/reports',
    clipboardCheck: 'clipboard/check',
    openExternal: 'shell/openExternal',
    indexLatest: 'index/latest',
    appVersion: 'app/version',
    updateCheck: 'update/check',
    updateDownload: 'update/download',
    updateInstall: 'update/install',
    updateStatus: 'update/status',
  } as const,
  push: {
    quoteSnapshot: 'quote:snapshot',
    alertTriggered: 'alert:triggered',
    systemNotice: 'system:notice',
    petState: 'pet:state',
    settingsChanged: 'settings:changed',
    indexQuotes: 'index:quotes',
    updateProgress: 'update:progress',
  } as const,
}

export type IpcInvokeMap = {
  [IPC.invoke.watchlistList]: () => WatchItem[]
  [IPC.invoke.watchlistAdd]: (secId: string, name: string, market: MarketType) => WatchItem
  [IPC.invoke.watchlistRemove]: (secId: string) => void
  [IPC.invoke.watchlistReorder]: (secIds: string[]) => void
  [IPC.invoke.watchlistSetPosition]: (secId: string, shares: number, costPrice: number) => void
  [IPC.invoke.searchSuggest]: (keyword: string) => SuggestItem[]
  [IPC.invoke.rulesUpsert]: (rule: AlertRule) => void
  [IPC.invoke.rulesDelete]: (ruleId: string) => void
  [IPC.invoke.rulesList]: () => AlertRule[]
  [IPC.invoke.settingsGet]: () => AppSettings
  [IPC.invoke.settingsSet]: (patch: Partial<AppSettings>) => AppSettings
  [IPC.invoke.quoteLatest]: () => QuoteSnapshot[]
  [IPC.invoke.alertHistory]: (date?: string) => AlertEvent[]
  [IPC.invoke.alertResetCooldown]: (secId: string) => void
  [IPC.invoke.timeAlertsList]: () => TimeAlert[]
  [IPC.invoke.timeAlertsUpsert]: (alert: TimeAlert) => void
  [IPC.invoke.timeAlertsDelete]: (id: string) => void
  [IPC.invoke.petSetInteraction]: (mode: 'normal' | 'clickThrough') => void
  [IPC.invoke.petSetVisible]: (visible: boolean) => void
  [IPC.invoke.petMove]: (x: number, y: number) => void
  [IPC.invoke.petNudge]: (dx: number, dy: number) => void
  [IPC.invoke.panelOpen]: () => void
  [IPC.invoke.panelClose]: () => void
  [IPC.invoke.panelMinimize]: () => void
  [IPC.invoke.klineFetch]: (secId: string, klt: number, lmt?: number) => KlinePoint[]
  [IPC.invoke.trendsFetch]: (secId: string) => TrendsResult
  [IPC.invoke.skinsList]: () => SkinInfo[]
  [IPC.invoke.dataSourceStatus]: () => DataSourceStatus
  [IPC.invoke.closingReports]: (limit?: number) => ClosingReport[]
  [IPC.invoke.clipboardCheck]: (text: string) => SuggestItem | null
  [IPC.invoke.openExternal]: (url: string) => void
  [IPC.invoke.indexLatest]: () => QuoteSnapshot[]
  /** 应用版本号（取自 package.json，开发态为根工程版本） */
  [IPC.invoke.appVersion]: () => string
  /** 检查 GitHub Releases 最新版本（silent=true 时不弹任何提示，仅供后台轮询） */
  [IPC.invoke.updateCheck]: (silent?: boolean) => UpdateInfo
  /** 下载匹配当前平台的安装包（进度走 update:progress 推送） */
  [IPC.invoke.updateDownload]: () => UpdateProgress
  /** 运行已下载的安装包（Windows 静默安装并退出应用） */
  [IPC.invoke.updateInstall]: () => void
  /** 读取当前更新状态（设置页首次渲染用） */
  [IPC.invoke.updateStatus]: () => UpdateStatus
}

/** 可用皮肤：目录名 + manifest 中显示名 */
export interface SkinInfo {
  id: string
  name: string
}

/** K 线数据点：时间/开/收/高/低/成交量/成交额/振幅 */
export interface KlinePoint {
  time: string
  open: number
  close: number
  high: number
  low: number
  volume: number
  amount: number
  amplitude: number
}

/** 分时数据点：时间/价格/均价/成交量 */
export interface TrendPoint {
  time: string
  price: number
  avg: number
  volume: number
}
export interface TrendsResult {
  preClose: number
  trends: TrendPoint[]
}
