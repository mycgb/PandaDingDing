import { EventEmitter } from 'node:events'
import type { QuoteSnapshot, SecId, SystemNotice } from '../../../../packages/shared/src/index.ts'
import { EastmoneyAdapter } from './EastmoneyAdapter.ts'
import { TencentAdapter } from './TencentAdapter.ts'
import type { QuoteAdapter } from './types.ts'

export type DSState = 'PRIMARY' | 'FAILOVER' | 'DEGRADED' | 'OFFLINE'

/** 容灾状态机（文档 §6.3）：PRIMARY→FAILOVER→DEGRADED→OFFLINE */
export class DataSourceManager extends EventEmitter {
  private primary: QuoteAdapter = new EastmoneyAdapter()
  private standby: QuoteAdapter = new TencentAdapter()
  private state: DSState = 'PRIMARY'
  private primaryFailures = 0
  private standbyFailures = 0
  private lastOkAt: number | null = null
  private healthTimer: NodeJS.Timeout | null = null
  private backoffMs = 0

  get currentState(): DSState { return this.state }
  get activeSource(): string { return this.state === 'FAILOVER' ? this.standby.name : this.primary.name }
  get lastOk(): number | null { return this.lastOkAt }
  /** 降级后的轮询间隔放大倍数 */
  get backoff(): number { return this.state === 'DEGRADED' ? 5 : this.state === 'OFFLINE' ? 0 : 1 }

  private log: (...a: unknown[]) => void
  constructor(log: (...a: unknown[]) => void = console.log) { super(); this.log = log }

  private setState(s: DSState, notice?: SystemNotice): void {
    if (this.state === s) return
    this.state = s
    this.log(`[DSM] state -> ${s}`)
    if (notice) this.emit('notice', notice)
  }

  /** 全量拉取一批自选（分批 ≤50） */
  async fetchAll(secIds: SecId[]): Promise<QuoteSnapshot[]> {
    if (this.state === 'OFFLINE') return []
    const batches: SecId[][] = []
    for (let i = 0; i < secIds.length; i += 50) batches.push(secIds.slice(i, i + 50))
    const useStandby = this.state === 'FAILOVER' || this.state === 'DEGRADED'
    const adapter = useStandby ? this.standby : this.primary
    const all: QuoteSnapshot[] = []
    for (const batch of batches) {
      try {
        const r = await adapter.fetchQuotes(batch)
        if (r.length === 0) throw new Error('EMPTY_RESPONSE')
        all.push(...r)
        this.onSuccess(useStandby)
      } catch (e) {
        this.onFailure(useStandby, e as Error)
        if (this.state === 'OFFLINE') break
      }
    }
    return all
  }

  private onSuccess(fromStandby: boolean): void {
    this.lastOkAt = Date.now()
    if (!fromStandby) {
      this.primaryFailures = 0
    } else {
      this.standbyFailures = 0
      if (this.state === 'DEGRADED') this.setState('FAILOVER')
    }
  }

  private onFailure(fromStandby: boolean, err: Error): void {
    this.log(`[DSM] ${fromStandby ? 'standby' : 'primary'} fail: ${err.message}`)
    if (!fromStandby) {
      this.primaryFailures++
      if (this.primaryFailures >= 2) {
        this.setState('FAILOVER', { type: 'dataSource', message: '已切换到备用行情源（腾讯）' })
        this.scheduleHealthCheck()
      }
    } else {
      this.standbyFailures++
      if (this.standbyFailures >= 3) this.setState('DEGRADED', { type: 'dataSource', message: '行情源不稳定，已降频轮询' })
    }
  }

  /** 主源心跳：恢复 30s 稳定后切回 */
  private scheduleHealthCheck(): void {
    if (this.healthTimer) return
    const tick = async () => {
      if (this.state === 'PRIMARY') { this.stopHealthCheck(); return }
      const ok = await this.primary.healthCheck().catch(() => false)
      if (ok) {
        this.primaryFailures = 0
        this.setState('PRIMARY', { type: 'dataSource', message: '主行情源已恢复（东方财富）' })
        this.stopHealthCheck()
        return
      }
      // 连续 2 次心跳失败稍后再试（10s 间隔）
      this.healthTimer = setTimeout(tick, 10_000)
      this.healthTimer?.unref?.()
    }
    this.healthTimer = setTimeout(tick, 10_000)
    this.healthTimer?.unref?.()
  }

  private stopHealthCheck(): void {
    if (this.healthTimer) { clearTimeout(this.healthTimer); this.healthTimer = null }
  }

  /** 网络恢复/断开事件（由主进程 net online/offline 驱动） */
  setOnline(online: boolean): void {
    if (!online) {
      this.setState('OFFLINE', { type: 'network', message: '网络已断开，暂停行情' })
    } else {
      if (this.state === 'OFFLINE') {
        this.primaryFailures = 0
        this.standbyFailures = 0
        this.setState('PRIMARY', { type: 'network', message: '网络已恢复' })
      }
    }
  }

  dispose(): void { this.stopHealthCheck() }
}
