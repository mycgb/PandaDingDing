import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  RoamController, computeRoamNext, ROAM_IDLE_MS, ROAM_RUN_MS, ROAM_REST_MS,
  type Point, type Rect,
} from './RoamController.ts'

const WA: Rect = { x: 0, y: 0, width: 1000, height: 800 }

// 纯函数：边界折返 + 翻面
{
  const mid = computeRoamNext({ x: 500, y: 590 }, 1, WA, 160, 210, 2)
  assert.deepEqual(mid.point, { x: 502, y: 590 })
  assert.equal(mid.facing, 'right')
  assert.equal(mid.bounced, false)

  // 撞右边界 → dir 反转、facing 变 left、x 夹在 maxX
  const right = computeRoamNext({ x: 840, y: 590 }, 1, WA, 160, 210, 2)
  assert.equal(right.point.x, 840)      // maxX = 1000-160 = 840
  assert.equal(right.dir, -1)
  assert.equal(right.facing, 'left')
  assert.equal(right.bounced, true)

  // 撞左边界 → dir 反转、facing 变 right
  const left = computeRoamNext({ x: 1, y: 590 }, -1, WA, 160, 210, 2)
  assert.equal(left.point.x, 0)
  assert.equal(left.dir, 1)
  assert.equal(left.facing, 'right')
  assert.equal(left.bounced, true)

  // 垂直向底边缓动：目标 y = 800-210 = 590
  const v = computeRoamNext({ x: 500, y: 500 }, 1, WA, 160, 210, 2)
  assert.equal(v.point.y, 502)
}

// 调度器：假时钟 + 假窗口
test('RoamController: 空闲触发 → 移动 → 停歇 → 回到 idle', () => {
  let now = 0
  let pos: Point = { x: 300, y: 300 }
  let enabled = true
  let canRoam = true
  let facingChanges = 0
  let activity = 0
  let persisted = 0
  const ctrl = new RoamController({
    now: () => now,
    getPosition: () => ({ ...pos }),
    setPosition: (x, y) => { pos = { x, y } },
    getWorkArea: () => WA,
    isEnabled: () => enabled,
    canRoam: () => canRoam,
    onFacingChange: () => { facingChanges++ },
    onActivity: () => { activity++ },
    persistPosition: () => { persisted++ },
  })

  const advance = (ms: number) => { now += ms; (ctrl as unknown as { tick(): void }).tick() }

  // 空闲未满阈值：不漫游
  advance(ROAM_IDLE_MS - 1)
  assert.equal(ctrl.isRoaming, false)
  // 到达阈值：进入漫游（x=300 < 中心 500 → 朝右）
  advance(1)
  assert.equal(ctrl.isRoaming, true)
  assert.equal(ctrl.roamFacing, 'right')
  assert.ok(activity >= 1)

  // 移动若干拍：x 增加、y 向 590 靠拢
  const x0 = pos.x, y0 = pos.y
  for (let i = 0; i < 10; i++) advance(50)
  assert.ok(pos.x > x0, 'x 应向右移动')
  assert.ok(pos.y > y0, 'y 应向底边靠拢')

  // 程序化移动标记生效
  assert.equal(ctrl.isProgrammaticMove(), true)

  // 达到运行时长 → 停歇
  advance(ROAM_RUN_MS)
  assert.equal(ctrl.isRoaming, false)
  assert.equal((ctrl as unknown as { phase: string }).phase, 'resting')
  assert.ok(persisted >= 1)

  // 停歇结束 → idle
  advance(ROAM_REST_MS)
  assert.equal((ctrl as unknown as { phase: string }).phase, 'idle')
})

test('RoamController: 高优先级状态与用户交互立即中断漫游', () => {
  let now = 0
  let pos: Point = { x: 300, y: 590 }
  let canRoam = true
  const ctrl = new RoamController({
    now: () => now,
    getPosition: () => ({ ...pos }),
    setPosition: (x, y) => { pos = { x, y } },
    getWorkArea: () => WA,
    isEnabled: () => true,
    canRoam: () => canRoam,
    onFacingChange: () => {},
    onActivity: () => {},
    persistPosition: () => {},
  })
  const tick = () => (ctrl as unknown as { tick(): void }).tick()
  now = ROAM_IDLE_MS; tick()
  assert.equal(ctrl.isRoaming, true)

  // 用户交互：立即回 idle
  ctrl.notifyUserActivity()
  assert.equal(ctrl.isRoaming, false)
  assert.equal((ctrl as unknown as { phase: string }).phase, 'idle')

  // 重新空闲触发后，canRoam=false（如有提醒）应立刻中断
  now += ROAM_IDLE_MS; tick()
  assert.equal(ctrl.isRoaming, true)
  canRoam = false
  tick()
  assert.equal(ctrl.isRoaming, false)
})

test('RoamController: 开关关闭时不漫游，漫游中关闭立即停止', () => {
  let now = 0
  let pos: Point = { x: 300, y: 590 }
  let enabled = false
  const ctrl = new RoamController({
    now: () => now,
    getPosition: () => ({ ...pos }),
    setPosition: (x, y) => { pos = { x, y } },
    getWorkArea: () => WA,
    isEnabled: () => enabled,
    canRoam: () => true,
    onFacingChange: () => {},
    onActivity: () => {},
    persistPosition: () => {},
  })
  const tick = () => (ctrl as unknown as { tick(): void }).tick()

  // 开关关闭：即便空闲超时也不进入漫游
  now = ROAM_IDLE_MS * 3
  tick()
  assert.equal(ctrl.isRoaming, false, '关闭开关后不应漫游')
  const frozen = { ...pos }

  // 打开开关：下一拍进入漫游
  enabled = true
  tick()
  assert.equal(ctrl.isRoaming, true, '打开开关后应开始漫游')
  now += 50; tick()
  assert.ok(pos.x > frozen.x, '漫游中 x 应移动')

  // 漫游中关闭开关：下一拍立即停下并回 idle
  enabled = false
  tick()
  assert.equal(ctrl.isRoaming, false, '关闭开关应立即停止漫游')
  assert.equal((ctrl as unknown as { phase: string }).phase, 'idle')
})

test('RoamController: 撞边界翻面计数', () => {
  let now = 0
  // 从右边界附近出发，朝左
  let pos: Point = { x: 840, y: 590 }
  let changes = 0
  const ctrl = new RoamController({
    now: () => now,
    getPosition: () => ({ ...pos }),
    setPosition: (x, y) => { pos = { x, y } },
    getWorkArea: () => WA,
    isEnabled: () => true,
    canRoam: () => true,
    onFacingChange: () => { changes++ },
    onActivity: () => {},
    persistPosition: () => {},
  })
  now = ROAM_IDLE_MS
  // x=840 < 中心 500? 否 → 朝左，facing 初始 left
  ;(ctrl as unknown as { tick(): void }).tick()
  assert.equal(ctrl.roamFacing, 'left')
  // 走到底左边界需要很多拍；直接把位置设到边界，再走一拍触发折返
  pos = { x: 1, y: 590 }
  for (let i = 0; i < 3; i++) { now += 50; (ctrl as unknown as { tick(): void }).tick() }
  assert.equal(ctrl.roamFacing, 'right')
  assert.ok(changes >= 1, 'facing 变化应通知渲染层')
})

console.log('roam-controller: all tests passed')
