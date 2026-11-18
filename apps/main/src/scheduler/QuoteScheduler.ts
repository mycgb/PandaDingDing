import { EventEmitter } from 'node:events'
import { PHASE_INTERVAL, phaseOf, nextPhaseBoundary, type MarketPhase } from '../../../../packages/shared/src/index.ts'

/** 行情调度器：按交易时段驱动轮询（文档 §8.1） */
export class QuoteScheduler extends EventEmitter {
  private pollTimer: NodeJS.Timeout | null = null
  private boundaryTimer: NodeJS.Timeout | null = null
  private _phase: MarketPhase = 'closed'
  private _intervalMs = PHASE_INTERVAL.continuous
  private _extraBackoff = 1   // DSM 降级倍数
  private running = false

  private onTick: () => Promise<void> | void
  private log: (...a: unknown[]) => void
  constructor(onTick: () => Promise<void> | void, log: (...a: unknown[]) => void = console.log) {
    super()
    this.onTick = onTick
    this.log = log
  }

  get phase(): MarketPhase { return this._phase }
  get intervalMs(): number { return this._intervalMs * this._extraBackoff }

  start(userIntervalMs?: number): void {
    this.running = true
    if (userIntervalMs && userIntervalMs >= 1000) {
      this._userInterval = userIntervalMs
    }
    this.evaluatePhase()
    this.scheduleBoundary()
    this.scheduleNextPoll(true)
  }

  private _userInterval: number | null = null

  stop(): void {
    this.running = false
    this.clearTimers()
  }

  setBackoff(multiplier: number): void {
    this._extraBackoff = multiplier
    if (this.running) this.scheduleNextPoll(true)
  }

  private evaluatePhase(): void {
    const p = phaseOf(new Date())
    if (p !== this._phase) {
      this._phase = p
      this.log(`[Scheduler] phase -> ${p}`)
      this.emit('phaseChange', p)
      const base = this._userInterval ?? PHASE_INTERVAL.continuous
      if (p === 'weekend' || p === 'holiday') {
        this._intervalMs = 0
      } else if (p === 'continuous' || p === 'preOpen') {
        this._intervalMs = Math.max(base, 1000)
      } else {
        this._intervalMs = PHASE_INTERVAL[p]
      }
    }
  }

  private scheduleBoundary(): void {
    const next = nextPhaseBoundary(new Date())
    const delay = Math.max(1000, next.getTime() - Date.now())
    this.boundaryTimer = setTimeout(() => {
      this.evaluatePhase()
      this.scheduleBoundary()
      if (this._intervalMs > 0) this.scheduleNextPoll(true)
    }, delay)
    this.boundaryTimer.unref?.()
  }

  private scheduleNextPoll(immediate = false): void {
    if (!this.running) return
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null }
    if (this._intervalMs <= 0) return   // 停市
    const delay = immediate ? 0 : this.intervalMs
    this.pollTimer = setTimeout(async () => {
      if (!this.running) return
      this.evaluatePhase()
      try { await this.onTick() } catch (e) { this.log('[Scheduler] tick error:', e) }
      this.scheduleNextPoll()
    }, delay)
    this.pollTimer.unref?.()
  }

  private clearTimers(): void {
    if (this.pollTimer) { clearTimeout(this.pollTimer); this.pollTimer = null }
    if (this.boundaryTimer) { clearTimeout(this.boundaryTimer); this.boundaryTimer = null }
  }
}
