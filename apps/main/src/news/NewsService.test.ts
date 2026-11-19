/** 今日新闻的纯函数单测：解析容错、详情页 URL、关联个股过滤、去重 */
import assert from 'node:assert/strict'
import { parseNewsRow, parseNewsResponse } from './NewsService.ts'

// 单条解析：字段齐全
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
assert.deepEqual(row.stocks, ['0.000672', '1.600801'])

// 无 code / 无标题 → 无效
assert.equal(parseNewsRow({ code: '', title: 'x' }), null)
assert.equal(parseNewsRow({ code: '123', title: '  ' }), null)
assert.equal(parseNewsRow({ title: '只有标题' }), null)

// 关联个股过滤掉非法 secId（如港股完整代码、脏数据）
const filtered = parseNewsRow({ code: 'c1', title: 't1', stockList: ['0.000672', 'bad', 'SH600000', 123, '105.AAPL'] })
assert.deepEqual(filtered?.stocks, ['0.000672', '105.AAPL'])

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

console.log('NewsService 单测通过')
