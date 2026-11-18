#!/usr/bin/env node
/**
 * 开发模式启动器：
 *   1) 生成占位皮肤（若无）
 *   2) 构建 preload + 主进程
 *   3) 启动 vite dev server（127.0.0.1:5173）
 *   4) 等端口就绪后启动 Electron（PETTICKER_DEV=1，指向 dev server）
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createConnection } from 'node:net'

const ROOT = resolve(import.meta.dirname, '..')
const NODE = process.execPath
const PYTHON = process.env.PETTICKER_PYTHON ?? 'python'
// pnpm 会把 electron 链接到包的 node_modules 下，根目录不一定有（不能只认一条路径）
const ELECTRON = [
  join(ROOT, 'apps/main/node_modules/electron/dist/electron.exe'),
  join(ROOT, 'node_modules/electron/dist/electron.exe'),
].find((p) => existsSync(p))
// 直接跑 vite 的 JS 入口：.bin/vite.cmd 是批处理，spawn 时必须走 shell，
// 一旦安装路径含空格就会被拆开（本机就是 C:\Program Files\...）
const VITE = join(ROOT, 'apps/renderer/node_modules/vite/bin/vite.js')
const HOST = '127.0.0.1'
const PORT = 5173

const env = { ...process.env, PETTICKER_DEV: '1' }
delete env.ELECTRON_RUN_AS_NODE

/** 用当前 node 直接执行脚本：不经 shell，避免路径含空格被拆开 */
function runNode(script, cwd) {
  return new Promise((ok, fail) => {
    const p = spawn(NODE, [script], { cwd, env, stdio: 'inherit' })
    p.on('exit', (c) => (c === 0 ? ok() : fail(new Error(`${script} -> exit ${c}`))))
  })
}

function waitPort(port, timeoutMs = 30000) {
  const started = Date.now()
  return new Promise((ok, fail) => {
    const attempt = () => {
      const sock = createConnection({ port, host: HOST })
      sock.once('connect', () => { sock.destroy(); ok() })
      sock.once('error', () => {
        sock.destroy()
        if (Date.now() - started > timeoutMs) fail(new Error(`port ${port} not ready`))
        else setTimeout(attempt, 400)
      })
    }
    attempt()
  })
}

async function main() {
  if (!existsSync(join(ROOT, 'resources/skins/mascot-cat/manifest.json'))) {
    console.log('[dev] 生成占位皮肤…')
    await new Promise((ok, fail) => {
      const p = spawn(PYTHON, [join(ROOT, 'scripts/gen_skin.py')], { cwd: ROOT, env, stdio: 'inherit' })
      p.on('exit', (c) => (c === 0 ? ok() : fail(new Error('gen_skin.py -> exit ' + c))))
    })
  }
  if (!ELECTRON) {
    console.error('[dev] 找不到 electron，请先在项目根目录执行 pnpm install')
    process.exit(1)
  }

  console.log('[dev] 构建 preload + main…')
  await runNode(join(ROOT, 'apps/preload/build.mjs'), join(ROOT, 'apps/preload'))
  await runNode(join(ROOT, 'apps/main/build.mjs'), join(ROOT, 'apps/main'))

  console.log('[dev] 启动 vite dev server…')
  const vite = spawn(NODE, [VITE, '--host', HOST, '--port', String(PORT), '--strictPort'], {
    cwd: join(ROOT, 'apps/renderer'), env, stdio: 'inherit',
  })
  vite.on('exit', (c) => {
    if (c) { console.error('[dev] vite 退出，code', c); process.exit(c) }
  })
  process.on('SIGINT', () => { vite.kill(); process.exit(0) })

  await waitPort(PORT)
  console.log('[dev] 启动 Electron…')
  const el = spawn(ELECTRON, ['.'], {
    cwd: join(ROOT, 'apps/main'),
    env: { ...env, PETTICKER_RENDERER_URL: `http://${HOST}:${PORT}` },
    stdio: 'inherit',
  })
  el.on('exit', (c) => { vite.kill(); process.exit(c ?? 0) })
}

main().catch((e) => { console.error('[dev] 失败:', e.message); process.exit(1) })
