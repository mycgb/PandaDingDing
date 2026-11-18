/**
 * 托盘角标 + hover 快览的纯决策逻辑（可单测，不依赖 electron）。
 * 遵循 A 股配色：涨红、跌绿；无数据灰；提醒橙色高优先。
 * 真实图标为预生成 PNG：resources/icons/tray-{up,down,flat,alert}.png。
 */
import type { QuoteSnapshot } from '../../../../packages/shared/src/index.ts'

export type BadgeKind = 'up' | 'down' | 'flat' | 'alert' | 'none'

export interface BadgeInput {
  /** 组合加权涨跌 %（null = 无数据） */
  pct: number | null
  /** 当前是否有提醒在展示（高优先） */
  alerting: boolean
  /** 数据源是否离线 */
  offline: boolean
  /** 是否显示角标（设置开关） */
  enabled: boolean
  /** 当前行情源名称（如"东方财富"） */
  source: string
  /** 快照列表：用于统计红/绿/平家数 */
  snapshots: QuoteSnapshot[]
  /** 点击穿透中（tooltip 追加恢复提示） */
  clickThrough?: boolean
}

export interface BadgeDecision {
  kind: BadgeKind
  /** 角标图文件名；kind='none' 时用基础 tray.png（或皮肤自带） */
  iconFile: string | null
  /** hover tooltip 文案 */
  tooltip: string
}

const ICONS: Record<Exclude<BadgeKind, 'none'>, string> = {
  up: 'tray-up.png',
  down: 'tray-down.png',
  flat: 'tray-flat.png',
  alert: 'tray-alert.png',
}

/** 红涨绿跌的档位判定：|pct| < 0.005 视为平 */
export function badgeKindOf(pct: number | null, alerting: boolean, offline: boolean, enabled: boolean): BadgeKind {
  if (!enabled) return 'none'
  if (alerting) return 'alert'
  if (offline || pct === null || !Number.isFinite(pct)) return 'flat'
  if (pct >= 0.005) return 'up'
  if (pct <= -0.005) return 'down'
  return 'flat'
}

/** 统计红/绿/平家数（停牌 null 不计入） */
export function tally(snapshots: QuoteSnapshot[]): { up: number; down: number; flat: number } {
  let up = 0, down = 0, flat = 0
  for (const s of snapshots) {
    const p = s.changePct
    if (p === null || p === undefined || !Number.isFinite(p)) continue
    if (p >= 0.005) up++
    else if (p <= -0.005) down++
    else flat++
  }
  return { up, down, flat }
}

function fmtPct(pct: number | null): string {
  if (pct === null || !Number.isFinite(pct)) return '--'
  return `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
}

/** 生成 hover 快览文案（控制长度，兼顾 macOS tooltip 限制） */
export function buildTooltip(input: BadgeInput): string {
  const { pct, snapshots, source, offline, alerting, clickThrough } = input
  const { up, down, flat } = tally(snapshots)
  const parts: string[] = ['熊猫盯盯']
  if (offline) parts.push('数据源离线')
  else parts.push(`组合 ${fmtPct(pct)}`)
  const tallyText = `${up}红${down}绿${flat ? ` ${flat}平` : ''}`
  parts.push(tallyText)
  if (source) parts.push(`源 ${source}`)
  if (alerting) parts.push('🔔提醒中')
  if (clickThrough) parts.push('点击穿透中')
  return parts.join(' · ')
}

export function decideBadge(input: BadgeInput): BadgeDecision {
  const kind = badgeKindOf(input.pct, input.alerting, input.offline, input.enabled)
  return {
    kind,
    iconFile: kind === 'none' ? null : ICONS[kind],
    tooltip: buildTooltip(input),
  }
}
