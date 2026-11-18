#!/usr/bin/env node
/**
 * 生产模式启动器：直接以 file:// 加载已构建的渲染产物并启动 Electron。
 * 前提：已执行 `pnpm build`（生成 apps/renderer/dist 与 apps/main/dist/index.cjs）。
 *
 * 注意 stdio 选择：
 *   - 用 'ignore' 而非 'inherit'：Electron 是长生命周期 GUI 应用，启动脚本
 *    退出后 inherited 的 stdout 管道会断裂，主进程每次 console.log 都会抛
 *    EPIPE（Electron 还会弹错误对话框）。桌宠的日志写自己的文件即可。
 *   - 如需在终端看日志：设置 PETTICKER_LOG_FILE 指定路径（默认写入
 *    用户数据目录 logs/main.log）。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, createWriteStream } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { homedir } from 'node:os'

const ROOT = resolve(import.meta.dirname, '..')
// electron 包的 index.js 导出二进制路径字符串，兼容 pnpm 的 .pnpm 虚拟 store 布局
const ELECTRON = (await import(pathToFileURL(join(ROOT, 'apps/main/node_modules/electron/index.js')).href)).default
const MAIN = join(ROOT, 'apps/main/dist/index.cjs')
const RENDERER = join(ROOT, 'apps/renderer/dist/index.html')

for (const [label, p] of [['Electron', ELECTRON], ['主进程产物', MAIN], ['渲染产物', RENDERER]]) {
  if (!existsSync(p)) {
    console.error(`[start] 缺少${label}：${p}\n请先运行 pnpm install && pnpm build`)
    process.exit(1)
  }
}

const env = { ...process.env, PETTICKER_RENDERER_URL: `file://${RENDERER}` }
delete env.ELECTRON_RUN_AS_NODE
delete env.PETTICKER_DEV

// 桌宠日志写入独立文件（不依赖父进程管道）
const logFile = process.env.PETTICKER_LOG_FILE
  ?? join(homedir(), 'AppData/Roaming/petticker/logs/main.log')
if (process.env.PETTICKER_LOG_FILE !== '-') {
  try {
    mkdirSync(dirname(logFile), { recursive: true })
    const stream = createWriteStream(logFile, { flags: 'a' })
    stream.on('error', () => {})   // 日志文件写失败不影响启动
  } catch { /* 忽略：日志不可用不是致命错误 */ }
}

const el = spawn(ELECTRON, ['.'], {
  cwd: join(ROOT, 'apps/main'),
  env: { ...env, PETTICKER_LOG_FILE: logFile },
  stdio: 'ignore',       // 关键：不继承父进程管道，避免 EPIPE
  detached: false,
})
el.on('exit', (c) => process.exit(c ?? 0))
el.on('error', (e) => { console.error('[start] 启动失败:', e.message); process.exit(1) })

console.log(`[start] PetTicker 已启动（日志: ${logFile}）`)
