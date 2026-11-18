import type { QuoteSnapshot, SecId, MarketType } from '../../../../packages/shared/src/index.ts'

export interface QuoteAdapter {
  readonly name: string
  fetchQuotes(secIds: SecId[]): Promise<QuoteSnapshot[]>
  healthCheck(): Promise<boolean>
}

/** 数值防御：停牌/未开盘时字段可能是 "-" */
export function num(v: unknown): number | null {
  if (v === '-' || v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

export function mkSnapshot(base: Omit<QuoteSnapshot, 'fetchedAt' | 'source'>, source: string): QuoteSnapshot {
  return { ...base, fetchedAt: Date.now(), source }
}

export const EM_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Referer: 'https://quote.eastmoney.com/',
}

export const TX_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  Referer: 'https://gu.qq.com/',
}

export type { QuoteSnapshot, SecId, MarketType }
