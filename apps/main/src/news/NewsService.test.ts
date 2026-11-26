/** 今日新闻的纯函数单测：解析容错、详情页 URL、关联个股过滤、名称映射、去重 */
import assert from 'node:assert/strict'
import { parseNewsRow, parseNewsResponse, parseStockNames, applyStockNames } from './NewsService.ts'

// 单条解析：字段齐全。stocks 的 name 初始用 secId 占位，等查名阶段回填
const row = parseNewsRow({
  code: '202611203935440867',
  title: '淡季叠加成本上升 水泥行业频发涨价函',
  summary: '11月以来，水泥行业涨价函频发。',
  showTime: '2026-11-20 07:31:41',
  stockList: ['0.000672', '1.600801'],
})
assert.ok(row)
assert.equal(row.id, '202611203935440867')
assert.equal(row.url, 'https://finance.eastmoney.com/a/202611203935440867.html')
assert.deepEqual(row.stocks, [
  { id: '0.000672', name: '0.000672' },
  { id: '1.600801', name: '1.600801' },
])

// 无 code / 无标题 → 无效
assert.equal(parseNewsRow({ code: '', title: 'x' }), null)
assert.equal(parseNewsRow({ code: '123', title: '  ' }), null)
assert.equal(parseNewsRow({ title: '只有标题' }), null)

// 关联个股过滤掉非法 secId（如港股完整代码、脏数据、板块 90）
const filtered = parseNewsRow({ code: 'c1', title: 't1', stockList: ['0.000672', 'bad', 'SH600000', 123, '105.AAPL'] })
assert.deepEqual(filtered?.stocks, [
  { id: '0.000672', name: '0.000672' },
  { id: '105.AAPL', name: '105.AAPL' },
])

// 字段缺失用空串兜底，不抛错
const minimal = parseNewsRow({ code: 'c2', title: '标题' })
assert.equal(minimal?.summary, '')
assert.equal(minimal?.time, '')
assert.deepEqual(minimal?.stocks, [])

// 整体解析：正常结构
const payload = {
  code: '1', message: 'success',
  data: { sortEnd: '1795', fastNewsList: [
    { code: 'a', title: 'A', showTime: '2026-11-20 07:00:00', stockList: ['1.600519'] },
    { code: 'b', title: 'B', summary: '摘要' },
  ] },
}
assert.equal(parseNewsResponse(payload).length, 2)
assert.deepEqual(parseNewsResponse(payload).map((n) => n.id), ['a', 'b'])

// 去重：相同 code 只留第一条
const dup = { data: { fastNewsList: [{ code: 'x', title: '1' }, { code: 'x', title: '2' }] } }
assert.equal(parseNewsResponse(dup).length, 1)
assert.equal(parseNewsResponse(dup)[0].title, '1')

// 异常结构一律返回空数组，不抛
assert.deepEqual(parseNewsResponse(null), [])
assert.deepEqual(parseNewsResponse(undefined), [])
assert.deepEqual(parseNewsResponse({}), [])
assert.deepEqual(parseNewsResponse({ data: null }), [])
assert.deepEqual(parseNewsResponse({ data: { fastNewsList: 'oops' } }), [])
assert.deepEqual(parseNewsResponse({ data: { fastNewsList: [null, 123, { noCode: 1 }] } }), [])

// 名称接口返回：f13=市场号、f12=代码、f14=名称，拼回 secId。
// 实测 0.928803（已失效）不会出现在 diff 里，因此查不到 → 后续被剔除。
const nameJson = { data: { total: 3, diff: [
  { f12: '688012', f13: 1, f14: '中微公司' },
  { f12: 'AAPL', f13: 105, f14: '苹果' },
  { f12: 'BK0809', f13: 90, f14: 'AI智能体' },
] } }
assert.deepEqual(parseStockNames(nameJson), {
  '1.688012': '中微公司',
  '105.AAPL': '苹果',
  '90.BK0809': 'AI智能体',
})
assert.deepEqual(parseStockNames({ data: { diff: 'oops' } }), {})
assert.deepEqual(parseStockNames(null), {})

// 查名成功：名称回填 + 无效代码剔除（0.928803 查不到名字 → 消失）
const withNames = applyStockNames([
  { id: 'n1', title: 't', summary: '', time: '', url: '', stocks: [
    { id: '1.688012', name: '1.688012' },
    { id: '0.928803', name: '0.928803' },
    { id: '105.AAPL', name: '105.AAPL' },
  ] },
], { '1.688012': '中微公司', '105.AAPL': '苹果' })
assert.deepEqual(withNames[0].stocks, [
  { id: '1.688012', name: '中微公司' },
  { id: '105.AAPL', name: '苹果' },
])

// 查名整体失败（names=null）：保留全部标的、回退显示 secId，不误删有效数据
const fallback = applyStockNames([
  { id: 'n2', title: 't', summary: '', time: '', url: '', stocks: [{ id: '0.000672', name: '0.000672' }] },
], null)
assert.deepEqual(fallback[0].stocks, [{ id: '0.000672', name: '0.000672' }])

// 全部标的都无效时 stocks 变空，前端会隐藏「相关」行
const allInvalid = applyStockNames([
  { id: 'n3', title: 't', summary: '', time: '', url: '', stocks: [{ id: '0.928803', name: '0.928803' }] },
], {})
assert.deepEqual(allInvalid[0].stocks, [])

console.log('NewsService 单测通过')
