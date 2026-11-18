import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'

const isPet = process.env.PETTICKER_WINDOW === 'pet'

/**
 * 开发模式下把 resources/skins 挂到 /skins：
 * 渲染层用 `location.protocol === 'file:'` 判断皮肤地址（file → pt-resource://，
 * http → /skins/...），生产由主进程的 pt-resource 协议处理，开发则必须由 vite 提供。
 * 没有这段中间件时 /skins/... 会落进 SPA fallback 返回 index.html（200 + HTML），
 * 导致 manifest.json 解析失败 → 桌宠精灵不渲染，只剩气泡（桌宠"消失"）。
 */
function skinsDevServer(): Plugin {
  const SKINS = resolve(__dirname, '../../resources/skins')
  const MIME: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
    '.json': 'application/json', '.gif': 'image/gif',
  }
  return {
    name: 'petticker-skins-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/skins', (req, res, next) => {
        const rel = decodeURIComponent((req.url ?? '').split('?')[0])
        const file = resolve(SKINS, '.' + rel)
        // 防目录穿越，且只服务真实文件
        if (!file.startsWith(SKINS + sep) || !existsSync(file) || !statSync(file).isFile()) {
          next()
          return
        }
        res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
        res.setHeader('Cache-Control', 'no-cache')
        createReadStream(file).pipe(res)
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [vue(), skinsDevServer()],
  resolve: {
    alias: { '@shared': resolve(__dirname, '../../packages/shared/src') },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'index.html'),
    },
  },
})
