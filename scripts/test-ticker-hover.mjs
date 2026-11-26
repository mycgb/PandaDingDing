// 验证新闻跑马灯 hover 暂停：发 mouseMoved 到跑马灯，读 animationPlayState + transform
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
  return r?.result?.value
}

// 跑马灯中心坐标（相对视口）
const rect = await evalJs(`(() => { const r = document.querySelector('.news-ticker').getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height} })()`)
console.log('跑马灯区域:', JSON.stringify(rect))

const read = async (tag) => {
  const s = await evalJs(`(() => { const t = document.querySelector('.ticker-track'); return t ? { state: getComputedStyle(t).animationPlayState, transform: getComputedStyle(t).transform, hovered: document.querySelector('.news-ticker').matches(':hover') } : null })()`)
  console.log(tag, JSON.stringify(s))
  return s
}

await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
const before = await read('移开时(5,5):')

// 移到跑马灯上
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(rect.x), y: Math.round(rect.y) })
await new Promise((r) => setTimeout(r, 300))
const onHover = await read('悬停跑马灯:')
await new Promise((r) => setTimeout(r, 1200))
const onHoverLater = await read('悬停1.2秒后:')

// 移开
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 })
await new Promise((r) => setTimeout(r, 300))
const after = await read('再次移开:')

console.log('\n判定:')
console.log('  hover 状态命中:', onHover?.hovered)
console.log('  悬停时 paused:', onHover?.state === 'paused')
console.log('  悬停期间 transform 不变:', onHover?.transform === onHoverLater?.transform)
console.log('  移开后 running:', after?.state === 'running')

ws.close()
process.exit(0)
