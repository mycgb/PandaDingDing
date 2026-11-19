#!/usr/bin/env node
/** 全量构建：preload → main → renderer（顺序有依赖，勿并行） */
import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..')
const NODE = process.execPath

function runStep(label, script, cwd) {
  return new Promise((ok, fail) => {
    console.log(`\n== ${label} ==`)
    const p = spawn(NODE, [script], { cwd, stdio: 'inherit' })
    p.on('exit', (c) => (c === 0 ? ok() : fail(new Error(`${label} 失败（exit ${c}）`))))
  })
}

async function main() {
  await runStep('preload', join(ROOT, 'apps/preload/build.mjs'), join(ROOT, 'apps/preload'))
  await runStep('main', join(ROOT, 'apps/main/build.mjs'), join(ROOT, 'apps/main'))
  // vite 的 .bin 启动器跨平台命名不同：Windows 是 vite.cmd，Unix 是 vite（无扩展名）。
  // 写死 vite.cmd 会导致 Linux/macOS 上 /bin/sh: vite.cmd: not found（exit 127）。
  const viteBin = join(ROOT, 'apps/renderer/node_modules/.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')
  await new Promise((ok, fail) => {
    console.log('\n== renderer ==')
    const p = spawn(viteBin, ['build'], { cwd: join(ROOT, 'apps/renderer'), stdio: 'inherit', shell: process.platform === 'win32' })
    p.on('exit', (c) => (c === 0 ? ok() : fail(new Error(`renderer 构建失败（exit ${c}）`))))
  })
  console.log('\n✅ 构建完成：pnpm start 启动应用')
}

main().catch((e) => { console.error('\n❌', e.message); process.exit(1) })
