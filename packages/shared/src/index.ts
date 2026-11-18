/** 统一域模型与 IPC 契约 —— 主进程与渲染进程共用 */

export * from './market-calendar.ts'

export type MarketType = 0 | 1  // 1=沪 0=深（与东财 secid 前缀一致）

export interface SecId { market: MarketType; code: string }

export interface QuoteSnapshot {
  secId: string          // '1.600519'
  code: string
  name: string
  market: MarketType
  price: number | null
  changePct: number | null
  change: number | null
  volume: number | null      // 手
  amount: number | null     // 元
  high: number | null
  low: number | null
  open: number | null
  prevClose: number | null
  fetchedAt: number         // epoch ms
  source: string            // 'eastmoney' | 'tencent'
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

export type AlertMetric = 'changePct' | 'price' | 'volumeMultiple'
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
}

export interface SystemNotice {
  type: 'dataSource' | 'network' | 'phase' | 'info'
  message: string
}

export interface SuggestItem {
  secId: string
  code: string
  name: string
  market: MarketType
  type: string   // 'stock' | 'fund'
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
  } as const,
  push: {
    quoteSnapshot: 'quote:snapshot',
    alertTriggered: 'alert:triggered',
    systemNotice: 'system:notice',
    petState: 'pet:state',
    settingsChanged: 'settings:changed',
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
  [IPC.invoke.dataSourceStatus]: () => { source: string; state: string; lastOkAt: number | null }
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
