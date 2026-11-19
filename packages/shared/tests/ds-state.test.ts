import assert from 'node:assert/strict'
import { dsSourceLabel, dsStateLabel, dsStateTone } from '../src/ds-state.ts'

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

// 源标识 → 中文名：界面上一律不出现 eastmoney / tencent 这类内部标识
assert.equal(dsSourceLabel('eastmoney'), '东方财富')
assert.equal(dsSourceLabel('tencent'), '腾讯')
assert.equal(dsSourceLabel('eastmoney-fund'), '东方财富基金')
assert.equal(dsSourceLabel(''), '—')
assert.equal(dsSourceLabel(null), '—')
assert.equal(dsSourceLabel(undefined), '—')
// 未来新增的源没配映射时原样保留，不能显示成空白
assert.equal(dsSourceLabel('sina'), 'sina')

console.log('ds-state: all tests passed')
