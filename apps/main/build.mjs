import { build } from 'esbuild'
import { join } from 'node:path'

// 用脚本自身目录解析路径，保证从任意 cwd 调用都能构建
const DIR = import.meta.dirname

const opts = {
  entryPoints: [join(DIR, 'src/index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(DIR, 'dist/index.cjs'),
  sourcemap: false,
  external: ['electron', 'better-sqlite3', 'node:*'],
  logLevel: 'info',
}

build(opts).catch((e) => { console.error(e); process.exit(1) })
