// dev 模式下注入 dayPnl，端到端验证「今日收益」开关对胶囊 + has-pnl 气泡让位的门控
// 注意：dev 的 setupState 对 ref 自动解包，ss.state 是 reactive 对象、ss.pnlChipEnabled 是布尔，直接赋值即可触发响应式更新
const list = await (await fetch('http://127.0.0.1:9223/json/list')).json()
const target = list.find((t) => t.type === 'page' && t.url.includes('window=pet'))
if (!target) { console.error('pet target not found'); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
const send = (method, params = {}) => new Promise((resolve) => {
  const n = ++id
  pending.set(n, resolve)
  ws.send(JSON.stringify({ id: n, method, params }))
})
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg.result); pending.delete(msg.id) }
}
await new Promise((r) => { ws.onopen = r })

const evalJs = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r?.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails?.exception?.description || r.exceptionDetails))
  return r?.result?.value
}

await evalJs(`
  window.__petroot = (() => {
    const app = document.querySelector('#app').__vue_app__
    let pr = null
    function walk(v, d) {
      if (!v || d > 12 || pr) return
      const c = v.component
      if (c) { if ((c.type?.__name||c.type?.name) === 'PetRoot') { pr = c; return } if (c.subTree) walk(c.subTree, d+1) }
      if (Array.isArray(v.children)) v.children.forEach(ch => { if (ch && typeof ch === 'object') walk(ch, d+1) })
    }
    walk(app._container._vnode, 0)
    return pr.setupState
  })()
`)

const read = async (tag) => {
  const s = await evalJs(`(() => {
    const ss = window.__petroot
    const chip = document.querySelector('.pnl-chip')
    return {
      enabled: ss.pnlChipEnabled,
      dayPnl: ss.state.dayPnl,
      chipText: chip ? chip.textContent.trim() : null,
      hasPnlClass: document.querySelector('.pet-root').classList.contains('has-pnl'),
    }
  })()`)
  console.log(tag, JSON.stringify(s))
  return s
}

// 1) 开关开 + 注入 dayPnl
await evalJs(`window.__petroot.pnlChipEnabled = true; window.__petroot.state.dayPnl = 123.45`)
await new Promise((r) => setTimeout(r, 250))
const on = await read('开关开 + dayPnl=123.45:')

// 2) 关掉开关
await evalJs(`window.__petroot.pnlChipEnabled = false`)
await new Promise((r) => setTimeout(r, 250))
const off = await read('开关关:')

// 3) 重新开
await evalJs(`window.__petroot.pnlChipEnabled = true`)
await new Promise((r) => setTimeout(r, 250))
const on2 = await read('再开:')

console.log('\n判定:')
console.log('  开→胶囊显示「今日 +123.45 元」:', on.chipText === '今日 +123.45 元')
console.log('  开→has-pnl 生效（气泡让位）:', on.hasPnlClass === true)
console.log('  关→胶囊消失:', off.chipText === null)
console.log('  关→has-pnl 撤销:', off.hasPnlClass === false)
console.log('  再开→胶囊恢复:', on2.chipText === '今日 +123.45 元' && on2.hasPnlClass === true)

// 还原注入
await evalJs(`window.__petroot.state.dayPnl = null; window.__petroot.pnlChipEnabled = true`)
ws.close()
process.exit(0)
