/** 行情源状态的展示文案与色调（面板多处共用，避免各页面各写一份映射） */
export type DsTone = 'ok' | 'warn' | 'bad' | ''

const LABEL: Record<string, string> = {
  PRIMARY: '正常',
  FAILOVER: '备用源',
  DEGRADED: '降级',
  OFFLINE: '离线',
}

export function dsStateLabel(state: string | null | undefined): string {
  if (!state) return '未知'
  return LABEL[state] ?? state
}

/** 行情源标识 → 中文名（适配器内部仍用 eastmoney / tencent 做标识，展示层统一走这里） */
const SOURCE_LABEL: Record<string, string> = {
  eastmoney: '东方财富',
  tencent: '腾讯',
  'eastmoney-fund': '东方财富基金',
}

export function dsSourceLabel(source: string | null | undefined): string {
  if (!source) return '—'
  return SOURCE_LABEL[source] ?? source
}

export function dsStateTone(state: string | null | undefined): DsTone {
  switch (state) {
    case 'PRIMARY': return 'ok'
    case 'FAILOVER':
    case 'DEGRADED': return 'warn'
    case 'OFFLINE': return 'bad'
    default: return ''
  }
}
