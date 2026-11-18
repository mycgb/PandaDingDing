// 冒烟：启动 Electron，等待 N 秒，输出进程状态与日志尾部
import { spawn } from 'node:child_process'
import { createWriteStream, readFileSync, existsSync } from 'node:fs'

const EL = 'D:/vue/股票监控/node_modules/.pnpm/electron@38.8.6/node_modules/electron/dist/electron.exe'
const OUT = 'D:/vue/股票监控/smoke-app.log'
const ERR = 'D:/vue/股票监控/smoke-app-err.log'
const out = createWriteStream(OUT, { flags: 'w' })
const err = createWriteStream(ERR, { flags: 'w' })

const env = { ...process.env, PETTICKER_RENDERER_URL: 'file:///D:/vue/股票监控/apps/renderer/dist/index.html' }
delete env.ELECTRON_RUN_AS_NODE

const p = spawn(EL, ['.', '--enable-logging'], {
  cwd: 'D:/vue/股票监控/apps/main',
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})
p.stdout.pipe(out)
p.stderr.pipe(err)

let exited = null
p.on('exit', (c, sig) => { exited = { code: c, sig } })

await new Promise((r) => setTimeout(r, 12000))

console.log('pid:', p.pid, 'exited:', JSON.stringify(exited))
console.log('--- stdout tail ---')
console.log(readFileSync(OUT, 'utf8').split('\n').slice(-15).join('\n'))
console.log('--- stderr tail ---')
const e = readFileSync(ERR, 'utf8')
console.log(e.split('\n').slice(-25).join('\n'))
