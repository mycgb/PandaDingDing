// 用 CDP Input.dispatchMouseEvent 模拟真实鼠标拖拽（经过 OS 输入管道，比 JS dispatchEvent 真实）
import { setTimeout as sleep } from 'node:timers/promises'

const [, , winPart = 'window=pet'] = process.argv
const list = await (await fetch('http://127.0.0.1:9223/json/list')).json()
const target = list.find((t) => t.type === 'page' && t.url.includes(winPart))
if (!target) { console.error('target not found'); process.exit(1) }

const ws = new WebSocket(target.webSocketDebuggerUrl)
let id = 0
const pending = new Map()
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
}
await new Promise((r) => { ws.onopen = r })

function send(method, params = {}) {
  return new Promise((resolve) => {
    const myId = ++id
    pending.set(myId, resolve)
    ws.send(JSON.stringify({ id: myId, method, params }))
  })
}

// 先拿到桌宠窗口的视口坐标（client 坐标），从画布中心偏下（熊猫身体）开始拖
const box = await send('Page.getLayoutMetrics')
const vw = box.result.layoutViewport?.clientWidth ?? 300
const vh = box.result.layoutViewport?.clientHeight ?? 380
const startX = Math.round(vw / 2)
const startY = Math.round(vh / 2)
console.log(`viewport ${vw}x${vh}, drag from (${startX},${startY})`)

const mouse = (type, x, y, button = 'left', buttons = 1) =>
  send('Input.dispatchMouseEvent', { type, x, y, button, buttons, clickCount: 1 })

await mouse('mousePressed', startX, startY)
for (let i = 1; i <= 10; i++) {
  await mouse('mouseMoved', startX + i * 25, startY + i * 15)
  await sleep(30)
}
await mouse('mouseReleased', startX + 250, startY + 150, 'left', 0)
await sleep(300)
console.log('drag sequence dispatched')
ws.close()
process.exit(0)
