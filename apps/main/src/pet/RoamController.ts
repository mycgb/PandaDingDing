/**
 * 桌宠漫游调度器（文档 §7 / 待办 #1）。
 *
 * 空闲一段时间后，桌宠走到桌面底部并沿底边来回散步，碰到边界折返并翻面（facing）；
 * 漫游一段后停歇，再回到空闲计时。用户拖拽/点击、提醒、离线、隐藏桌宠等高优先级
 * 状态会立即中断漫游。窗口移动与 index.ts 的 petPosition 落盘通过时间窗区分，避免打架。
 *
 * 本类不直接依赖 electron：所有窗口/屏幕操作通过依赖注入，便于用假时钟单测。
 */

export type RoamPhase = 'idle' | 'roaming' | 'resting'
export type Facing = 'left' | 'right'

export interface Rect { x: number; y: number; width: number; height: number }
export interface Point { x: number; y: number }

export const ROAM_IDLE_MS = 45_000      // 空闲多久后开始漫游
export const ROAM_RUN_MS = 30_000       // 单次漫游持续时长
export const ROAM_REST_MS = 20_000      // 漫游后停歇时长
export const ROAM_STEP_PX = 2           // 每 tick 水平移动像素
export const ROAM_TICK_MS = 50          // 调度节拍
const PROGRAMMATIC_WINDOW_MS = 400      // 程序化移动标记有效期

/**
 * 计算下一帧漫游位置（纯函数）。
 * - 水平按 dir 前进，碰到工作区左右边界折返并返回新的 dir/facing
 * - 垂直向"窗口底边贴工作区底边"的目标缓动靠拢
 */
export function computeRoamNext(
  cur: Point,
  dir: 1 | -1,
  wa: Rect,
  petW: number,
  petH: number,
  step: number,
): { point: Point; dir: 1 | -1; facing: Facing; bounced: boolean } {
  let x = cur.x + dir * step
  const minX = wa.x
  const maxX = wa.x + wa.width - petW
  let bounced = false
  if (x > maxX) { x = maxX; dir = -1; bounced = true }
  else if (x < minX) { x = minX; dir = 1; bounced = true }

  const targetY = wa.y + wa.height - petH
  const dy = targetY - cur.y
  const y = cur.y + Math.sign(dy) * Math.min(Math.abs(dy), step)

  return { point: { x, y }, dir, facing: dir > 0 ? 'right' : 'left', bounced }
}

export interface RoamDeps {
  getPosition(): Point
  setPosition(x: number, y: number): void
  getWorkArea(): Rect
  /** 设置里的漫游开关 */
  isEnabled(): boolean
  /** 是否允许漫游（桌宠可见、未穿透、未拖拽、无提醒/离线、时段合适） */
  canRoam(): boolean
  /** facing 变化时通知渲染层翻面 */
  onFacingChange(facing: Facing): void
  /** 状态变化（进入/退出漫游）时通知主进程重算并广播 petState */
  onActivity(): void
  /** 停歇/结束时的位置落盘 */
  persistPosition(point: Point): void
  now?(): number
  log?: (...a: unknown[]) => void
  petW?: number
  petH?: number
}

export class RoamController {
  private phase: RoamPhase = 'idle'
  private dir: 1 | -1 = 1
  private facing: Facing = 'right'
  private lastActivityAt = 0
  private phaseStartAt = 0
  private lastProgrammaticAt = -Infinity
  private timer: NodeJS.Timeout | null = null
  private readonly petW: number
  private readonly petH: number
  private clock: () => number
  private deps: RoamDeps

  constructor(deps: RoamDeps) {
    this.deps = deps
    this.petW = deps.petW ?? 160
    this.petH = deps.petH ?? 210
    this.clock = deps.now ?? Date.now
    this.lastActivityAt = this.clock()
    this.phaseStartAt = this.clock()
  }

  get roamPhase(): RoamPhase { return this.phase }
  get isRoaming(): boolean { return this.phase === 'roaming' }
  get roamFacing(): Facing { return this.facing }

  /** 最近的窗口位移是否由本控制器程序化触发（moved 事件据此跳过落盘） */
  isProgrammaticMove(): boolean {
    return this.clock() - this.lastProgrammaticAt < PROGRAMMATIC_WINDOW_MS
  }

  start(): void {
    this.stop()
    this.timer = setInterval(() => this.tick(), ROAM_TICK_MS)
    this.timer?.unref?.()
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    if (this.phase !== 'idle') this.leaveRoam()
  }

  /** 用户拖拽/点击桌宠：重置空闲计时，若在漫游则立即中断 */
  notifyUserActivity(): void {
    this.lastActivityAt = this.clock()
    if (this.phase !== 'idle') this.leaveRoam()
  }

  private enterRoam(): void {
    this.phase = 'roaming'
    this.phaseStartAt = this.clock()
    // 从当前位置朝工作区水平中心走，避免一上来就贴边折返
    const wa = this.deps.getWorkArea()
    const pos = this.deps.getPosition()
    const centerX = wa.x + wa.width / 2
    this.dir = pos.x < centerX ? 1 : -1
    this.setFacing(this.dir > 0 ? 'right' : 'left')
    this.deps.log?.('[roam] enter roam, dir =', this.dir)
    this.deps.onActivity()
  }

  private enterRest(): void {
    this.phase = 'resting'
    this.phaseStartAt = this.clock()
    this.deps.persistPosition(this.deps.getPosition())
    this.deps.log?.('[roam] enter rest')
    this.deps.onActivity()
  }

  private leaveRoam(): void {
    this.phase = 'idle'
    this.phaseStartAt = this.clock()
    this.lastActivityAt = this.clock()
    this.deps.persistPosition(this.deps.getPosition())
    this.deps.onActivity()
  }

  private setFacing(next: Facing): void {
    if (next === this.facing) return
    this.facing = next
    this.deps.onFacingChange(next)
  }

  private tick(): void {
    const now = this.clock()
    if (!this.deps.isEnabled() || !this.deps.canRoam()) {
      if (this.phase !== 'idle') this.leaveRoam()
      return
    }

    if (this.phase === 'idle') {
      if (now - this.lastActivityAt >= ROAM_IDLE_MS) this.enterRoam()
      return
    }

    if (this.phase === 'resting') {
      if (now - this.phaseStartAt >= ROAM_REST_MS) this.leaveRoam()
      return
    }

    // roaming
    if (now - this.phaseStartAt >= ROAM_RUN_MS) { this.enterRest(); return }
    const next = computeRoamNext(
      this.deps.getPosition(), this.dir, this.deps.getWorkArea(),
      this.petW, this.petH, ROAM_STEP_PX,
    )
    this.dir = next.dir
    this.setFacing(next.facing)
    this.lastProgrammaticAt = now
    this.deps.setPosition(next.point.x, next.point.y)
  }
}
