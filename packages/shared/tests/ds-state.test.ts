import assert from 'node:assert/strict'
import { dsStateLabel, dsStateTone } from '../src/ds-state.ts'

// 已知状态 → 中文文案 + 色调（面板卡片/侧栏共用）
assert.equal(dsStateLabel('PRIMARY'), '正常')
assert.equal(dsStateLabel('FAILOVER'), '备用源')
assert.equal(dsStateLabel('DEGRADED'), '降级')
assert.equal(dsStateLabel('OFFLINE'), '离线')
assert.equal(dsStateTone('PRIMARY'), 'ok')
assert.equal(dsStateTone('FAILOVER'), 'warn')
assert.equal(dsStateTone('DEGRADED'), 'warn')
assert.equal(dsStateTone('OFFLINE'), 'bad')

// 未知/空值：不能把原始英文或 undefined 直接甩到界面上
assert.equal(dsStateLabel(''), '未知')
assert.equal(dsStateLabel(null), '未知')
assert.equal(dsStateLabel(undefined), '未知')
assert.equal(dsStateLabel('HEALTHY'), 'HEALTHY')
assert.equal(dsStateTone(''), '')
assert.equal(dsStateTone(null), '')

console.log('ds-state: all tests passed')
