// CDP 求值工具：node cdp-eval.mjs "<urlSubstr>" @exprfile.js
const [, , urlPart = 'window=pet', exprArg = 'document.body.innerHTML.length'] = process.argv

const { readFileSync } = await import('node:fs')
const expr = exprArg.startsWith('@') ? readFileSync(exprArg.slice(1), 'utf8') : exprArg

const list = await (await fetch('http://127.0.0.1:9223/json/list')).json()
const target = list.find((t) => t.type === 'page' && t.url.includes(urlPart))
if (!target) {
  console.error('target not found. pages:', list.map((t) => `${t.type} ${t.url}`))
  process.exit(1)
}

const ws = new WebSocket(target.webSocketDebuggerUrl)
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('timeout')), 15000)
  ws.onopen = () => {
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true },
    }))
  }
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id === 1) {
      clearTimeout(timer)
      resolve(msg.result)
      ws.close()
    }
  }
  ws.onerror = (e) => reject(new Error('ws error'))
})

console.log(JSON.stringify(result, null, 2))
process.exit(0)
