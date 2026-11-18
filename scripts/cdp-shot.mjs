// CDP 截图：node cdp-shot.mjs "<urlSubstr>" <outfile.png>
import { writeFileSync } from 'node:fs'

const [, , urlPart = 'window=panel', outFile = 'shot.png'] = process.argv

const list = await (await fetch('http://127.0.0.1:9223/json/list')).json()
const target = list.find((t) => t.type === 'page' && t.url.includes(urlPart))
if (!target) {
  console.error('target not found:', list.map((t) => `${t.type} ${t.url}`))
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout')), 20000)
  ws.onopen = () => {
    ws.send(JSON.stringify({ id: 1, method: 'Page.captureScreenshot', params: { format: 'png' } }))
  }
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id === 1) {
      clearTimeout(timer)
      resolve(msg.result)
      ws.close()
    }
  }
  ws.onerror = () => reject(new Error('ws error'))
})

if (!result?.data) {
  console.error('no screenshot data:', JSON.stringify(result))
  process.exit(1)
}
writeFileSync(outFile, Buffer.from(result.data, 'base64'))
console.log('saved', outFile, 'from', target.url)
process.exit(0)
