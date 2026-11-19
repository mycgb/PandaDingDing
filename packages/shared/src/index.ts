/** 统一域模型与 IPC 契约 —— 主进程与渲染进程共用 */

export * from './market-calendar.ts'
export * from './breath.ts'
export * from './ds-state.ts'

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
}

export interface WatchItem {
  secId: string
  code: string
  name: string
  market: MarketType
  weight: number
  sortOrder: number
  createdAt: string
}

/** 提醒指标。volumeMultiple=成交量倍数；streakUp/streakDown=连涨/连跌天数（阈值为天数） */
export type AlertMetric = 'changePct' | 'price' | 'volumeMultiple' | 'streakUp' | 'streakDown'
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
  action: 'idle' | 'idle-smile' | 'idle-frown' | 'happy' | 'sad' | 'panic-happy' | 'panic-sad' | 'sleep' | 'walk' | 'offline'
  reason?: string
  /** 漫游朝向：渲染层据此水平翻转 walk 帧；'left' 时朝左 */
  facing?: 'left' | 'right'
}

export interface SystemNotice {
  type: 'dataSource' | 'network' | 'phase' | 'info' | 'reminder'
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
}

export const DEFAULT_SETTINGS: AppSettings = {
  pollIntervalMs: 3000,
  moodUpThreshold: 0.5,
  moodDownThreshold: -0.5,
  dndEnabled: true,
  dndRanges: [{ start: '12:00', end: '13:00' }],
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
}

/* ---------- IPC channel 白名单 ---------- */

export const IPC = {
  invoke: {
    watchlistList: 'watchlist/list',
    watchlistAdd: 'watchlist/add',
    watchlistRemove: 'watchlist/remove',
    watchlistReorder: 'watchlist/reorder',
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
  } as const,
  push: {
    quoteSnapshot: 'quote:snapshot',
    alertTriggered: 'alert:triggered',
    systemNotice: 'system:notice',
    petState: 'pet:state',
    settingsChanged: 'settings:changed',
    indexQuotes: 'index:quotes',
  } as const,
}

export type IpcInvokeMap = {
  [IPC.invoke.watchlistList]: () => WatchItem[]
  [IPC.invoke.watchlistAdd]: (secId: string, name: string, market: MarketType) => WatchItem
  [IPC.invoke.watchlistRemove]: (secId: string) => void
  [IPC.invoke.watchlistReorder]: (secIds: string[]) => void
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
