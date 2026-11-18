import { test } from 'node:test'
import assert from 'node:assert/strict'
import { categoryOf, isOtcFund } from '../../../../packages/shared/src/index.ts'
import { parseClipboardCode } from '../search/suggest.ts'
import { FundAdapter } from './FundAdapter.ts'
import { TencentAdapter } from './TencentAdapter.ts'

test('市场分类', () => {
  assert.equal(categoryOf(0), 'stock')
  assert.equal(categoryOf(1), 'stock')
  assert.equal(categoryOf(116), 'hk')
  assert.equal(categoryOf(105), 'us')
  assert.equal(categoryOf(107), 'us')
  assert.equal(categoryOf(150), 'fund')
  assert.equal(isOtcFund(150), true)
  assert.equal(isOtcFund(116), false)
})

test('剪贴板代码识别', () => {
  assert.deepEqual(parseClipboardCode('600519'), { code: '600519', market: 1 })
  assert.deepEqual(parseClipboardCode('000001'), { code: '000001', market: 0 })
  assert.deepEqual(parseClipboardCode('sh600519'), { code: '600519', market: 1 })
  assert.deepEqual(parseClipboardCode('sz000001'), { code: '000001', market: 0 })
  assert.deepEqual(parseClipboardCode('00700.HK'), { code: '00700', market: 116 })
  assert.deepEqual(parseClipboardCode('hk00700'), { code: '00700', market: 116 })
  assert.deepEqual(parseClipboardCode('usAAPL'), { code: 'AAPL', market: 105 })
  assert.equal(parseClipboardCode('今天天气不错'), null)
  assert.equal(parseClipboardCode(''), null)
  assert.equal(parseClipboardCode('a'.repeat(30)), null)
})

test('场外基金净值解析', () => {
  const fa = new FundAdapter()
  const js = 'var fS_name = "华夏成长混合";var Data_netWorthTrend = [{"x":100,"y":1.0,"equityReturn":0},{"x":101,"y":0.96,"equityReturn":-4.0}];'
  const snap = fa.parse(js, { market: 150, code: '000001' })
  assert.ok(snap)
  assert.equal(snap.name, '华夏成长混合')
  assert.equal(snap.price, 0.96)
  assert.equal(snap.changePct, -4.0)
  assert.equal(snap.secId, '150.000001')
  assert.equal(fa.parse('not a fund script', { market: 150, code: 'x' }), null)
})

test('腾讯港股/美股解析', () => {
  const ta = new TencentAdapter()
  const hk = ta.parse('v_hk00700="100~腾讯控股~00700~372.800~376.000~374.000~21333340.0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~~2026/11/18 16:08:10~-3.200~-0.85~378.000~370.000~372.800~21333340.0~7956175438.684~0";')
  assert.equal(hk.length, 1)
  assert.equal(hk[0].market, 116)
  assert.equal(hk[0].price, 372.8)
  assert.equal(hk[0].changePct, -0.85)
  const us = ta.parse('v_usAAPL="200~苹果~AAPL.OQ~353.84~351.91~351.87~1946686~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~~2026-11-18 09:30:59~1.93~0.55~353.91~351.87~USD~1946686~685256082~0.01";')
  assert.equal(us.length, 1)
  assert.equal(us[0].price, 353.84)
  assert.equal(us[0].changePct, 0.55)
})
