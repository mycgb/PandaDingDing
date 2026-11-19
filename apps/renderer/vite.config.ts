import { defineConfig } from 'vite'
import type { Plugin, Connect } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, resolve, sep } from 'node:path'

const isPet = process.env.PETTICKER_WINDOW === 'pet'

/**
 * 开发模式下把 resources/skins 挂到 /skins、resources/sounds 挂到 /sounds：
 * 渲染层用 `location.protocol === 'file:'` 判断资源地址（file → pt-resource://，
 * http → /skins 或 /sounds），生产由主进程的 pt-resource 协议处理，开发则必须由 vite 提供。
 * 没有这段中间件时这些路径会落进 SPA fallback 返回 index.html（200 + HTML），
 * 导致 manifest.json 解析失败（桌宠"消失"）或音效加载失败。
 */
function skinsDevServer(): Plugin {
  const SKINS = resolve(__dirname, '../../resources/skins')
  const SOUNDS = resolve(__dirname, '../../resources/sounds')
  const MIME: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
    '.json': 'application/json', '.gif': 'image/gif', '.wav': 'audio/wav',
  }
  const serve = (root: string): Connect.NextHandleFunction => (req, res, next) => {
    const rel = decodeURIComponent((req.url ?? '').split('?')[0])
    const file = resolve(root, '.' + rel)
    // 防目录穿越，且只服务真实文件
    if (!file.startsWith(root + sep) || !existsSync(file) || !statSync(file).isFile()) {
      next()
      return
    }
    res.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream')
    res.setHeader('Cache-Control', 'no-cache')
    createReadStream(file).pipe(res)
  }
  return {
    name: 'pandadingding-resources-dev',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/skins', serve(SKINS))
      server.middlewares.use('/sounds', serve(SOUNDS))
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
