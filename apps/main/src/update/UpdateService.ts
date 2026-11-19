/**
 * 更新服务：查 GitHub Releases → 选安装包 → 流式下载 → 运行安装程序。
 *
 * 为什么不用 electron-updater：
 *  1) 本项目没有签名证书（mac 关闭签名、NSIS 无签名），electron-updater 的
 *     校验/差分链路会更别扭；
 *  2) 只需要「发现新版本 → 下载官方 Release 资产 → 跑安装包」这一条简单路径，
 *     自己实现反而更透明（进度、错误都能原样展示给用户）。
 *
 * 网络走 Electron 的 net.fetch：它会使用系统代理设置，墙内挂代理也能查/下载。
 */
import { app, net, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { IPC } from '../../../../packages/shared/src/index.ts'
import type { UpdateAsset, UpdateInfo, UpdateProgress, UpdateStatus } from '../../../../packages/shared/src/index.ts'
import {
  UPDATE_API, UPDATE_REPO, assetNameCandidates, compareVersions, failedUpdateInfo,
  normalizeVersion, parseAtomLatest, toUpdateInfo,
} from './updater.ts'

export interface UpdateServiceDeps {
  log: (...args: unknown[]) => void
  /** 把进度/提示推给所有窗口 */
  push: (channel: string, payload: unknown) => void
  /** 发现新版本时通知用户（面板提示条 + 桌面通知入口都在 index.ts 里接） */
  notify: (info: UpdateInfo) => void
}

const UA = `PandaDingDing (+https://github.com/mycgb/PandaDingDing)`

export class UpdateService {
  private info: UpdateInfo | null = null
  private progress: UpdateProgress | null = null
  private downloadedFile: string | null = null
  /** 已经提示过的版本，避免每 6 小时轮询都弹一次同样的提示 */
  private notifiedVersion: string | null = null
  private busy = false

  constructor(private readonly deps: UpdateServiceDeps) {}

  status(): UpdateStatus {
    return { info: this.info, progress: this.progress }
  }

  /**
   * 检查更新。
   * @param silent 静默模式（自动轮询用）：网络失败时不打扰用户，只记日志；
   *               发现新版本仍然会提示一次。
   *
   * 两条通道：
   *  1) GitHub API —— 一次请求拿到版本、说明、资产大小（未登录 60 次/小时/IP，
   *     挂代理时常常 403）；
   *  2) 兜底 releases.atom —— 不受 API 限流，能拿到最新 tag、发布时间和正文；
   *     资产列表拿不到，但下载地址是确定的，按命名规则 HEAD 探测即可。
   */
  async check(silent = false): Promise<UpdateInfo> {
    const current = app.getVersion()
    const checkedAt = Date.now()
    let apiError = ''
    try {
      const info = await this.checkViaApi(current, checkedAt)
      this.applyInfo(info)
      return info
    } catch (e) {
      apiError = e instanceof Error ? e.message : String(e)
      this.deps.log('API 检查失败，改用 atom 兜底:', apiError)
    }
    try {
      const info = await this.checkViaAtom(current, checkedAt)
      this.applyInfo(info)
      return info
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (!silent) this.deps.log('检查更新失败:', msg, '(API:', apiError, ')')
      const info = failedUpdateInfo({ current, error: apiError ? `${apiError} / ${msg}` : msg, checkedAt, previous: this.info })
      this.info = info
      return info
    }
  }

  private async checkViaApi(current: string, checkedAt: number): Promise<UpdateInfo> {
    if (process.env.PETTICKER_UPDATE_FORCE_FALLBACK === '1') throw new Error('强制走兜底通道（调试）')
    const res = await net.fetch(UPDATE_API, {
      headers: { 'User-Agent': UA, Accept: 'application/vnd.github+json' },
    })
    if (!res.ok) throw new Error(`GitHub HTTP ${res.status}`)
    const release = (await res.json()) as Parameters<typeof toUpdateInfo>[0]['release']
    return toUpdateInfo({ release, current, platform: process.platform, arch: process.arch, checkedAt })
  }

  private async checkViaAtom(current: string, checkedAt: number): Promise<UpdateInfo> {
    const res = await net.fetch(`https://github.com/${UPDATE_REPO}/releases.atom`, {
      headers: { 'User-Agent': UA, Accept: 'application/atom+xml, application/xml;q=0.9, */*;q=0.8' },
    })
    if (!res.ok) throw new Error(`atom HTTP ${res.status}`)
    const parsed = parseAtomLatest(await res.text())
    if (!parsed) throw new Error('atom 未解析出版本号')
    const version = normalizeVersion(parsed.tag)
    const htmlUrl = `https://github.com/${UPDATE_REPO}/releases/tag/${parsed.tag}`
    // 无新版本就不用探测安装包，省一次请求
    const asset = compareVersions(version, current) > 0
      ? await this.probeAsset(parsed.tag, version)
      : null
    return toUpdateInfo({
      release: {
        tag_name: parsed.tag,
        published_at: parsed.publishedAt,
        html_url: htmlUrl,
        body: parsed.notes,
        assets: asset ? [{ name: asset.name, size: asset.size, browser_download_url: asset.url }] : [],
      },
      current, platform: process.platform, arch: process.arch, checkedAt,
    })
  }

  /** 按发布命名规则探测当前平台安装包是否存在（HEAD，失败再试 Range 取首字节） */
  private async probeAsset(tag: string, version: string): Promise<UpdateAsset | null> {
    for (const name of assetNameCandidates(version, process.platform, process.arch)) {
      const url = `https://github.com/${UPDATE_REPO}/releases/download/${tag}/${name}`
      try {
        let res = await net.fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA } })
        if (!res.ok) res = await net.fetch(url, { headers: { 'User-Agent': UA, Range: 'bytes=0-0' } })
        if (res.ok || res.status === 206) {
          const size = Number(res.headers.get('content-range')?.split('/').pop() ?? res.headers.get('content-length') ?? 0)
          return { name, size: Number.isFinite(size) ? size : 0, url }
        }
      } catch { /* 试下一个候选名 */ }
    }
    return null
  }

  /** 记录状态并在首次发现新版本时提示用户 */
  private applyInfo(info: UpdateInfo): void {
    this.info = info
    this.deps.log('检查更新：当前', info.current, '最新', info.latest, info.hasUpdate ? '有更新' : '已最新')
    if (info.hasUpdate && info.asset && this.notifiedVersion !== info.latest) {
      this.notifiedVersion = info.latest
      this.deps.notify(info)
    } else if (info.hasUpdate && !info.asset) {
      this.deps.log('有新版本但没有匹配当前平台的安装包，跳过提示')
    }
  }

  /** 下载当前平台匹配的安装包，进度通过 update:progress 推送 */
  async download(): Promise<UpdateProgress> {
    if (this.busy) return this.progress ?? { phase: 'idle', percent: 0, receivedBytes: 0, totalBytes: 0 }
    const info = this.info
    const asset = info?.asset
    if (!info?.hasUpdate || !asset) throw new Error('没有可下载的更新包')
    this.busy = true
    const totalBytes = asset.size || 0
    try {
      this.emit({ phase: 'downloading', percent: 0, receivedBytes: 0, totalBytes, message: `正在下载 ${asset.name}` })
      const res = await net.fetch(asset.url, { headers: { 'User-Agent': UA } })
      if (!res.ok || !res.body) throw new Error(`下载失败 HTTP ${res.status}`)
      const total = Number(res.headers.get('content-length')) || totalBytes

      // 落到临时目录：不放安装目录（无写权限、也容易被杀软盯着）
      const file = path.join(app.getPath('temp'), asset.name)
      const ws = fs.createWriteStream(file)
      const reader = res.body.getReader()
      let received = 0
      let lastTick = 0
      // 分块写盘而不是 arrayBuffer()：130MB 全塞内存没必要，而且拿不到进度
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (value) {
          ws.write(Buffer.from(value))
          received += value.byteLength
        }
        const now = Date.now()
        if (now - lastTick >= 200) {
          lastTick = now
          this.emit({
            phase: 'downloading',
            percent: total > 0 ? Math.min(99, Math.round((received / total) * 100)) : 0,
            receivedBytes: received,
            totalBytes: total || received,
          })
        }
      }
      await new Promise<void>((ok, fail) => {
        ws.on('error', fail)
        ws.on('finish', () => ok())
        ws.end()
      })
      this.downloadedFile = file
      const done: UpdateProgress = {
        phase: 'ready',
        percent: 100,
        receivedBytes: received,
        totalBytes: total || received,
        message: file,
      }
      this.emit(done)
      this.deps.log('更新包已下载:', file, received, 'bytes')
      return done
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.deps.log('下载更新包失败:', msg)
      const err: UpdateProgress = {
        phase: 'error', percent: 0, receivedBytes: 0, totalBytes, message: msg,
      }
      this.emit(err)
      throw e
    } finally {
      this.busy = false
    }
  }

  /** 运行已下载的安装包：Windows 静默安装并退出应用；其他平台用系统方式打开 */
  install(): void {
    const file = this.downloadedFile
    if (!file || !fs.existsSync(file)) throw new Error('安装包不存在，请重新下载')
    this.emit({ phase: 'installing', percent: 100, receivedBytes: 0, totalBytes: 0, message: '正在启动安装程序…' })
    if (process.platform === 'win32') {
      // /S = NSIS 静默安装；先起安装器再退出，避免文件被自身占用
      const child = spawn(file, ['/S'], { detached: true, stdio: 'ignore' })
      child.unref()
      setTimeout(() => app.quit(), 800)
    } else {
      void shell.openPath(file)
    }
  }

  /** 打开 Release 页面（无匹配安装包时的兜底） */
  openReleasePage(): void {
    const url = this.info?.htmlUrl ?? `https://github.com/mycgb/PandaDingDing/releases/latest`
    void shell.openExternal(url)
  }

  private emit(p: UpdateProgress): void {
    this.progress = p
    this.deps.push(IPC.push.updateProgress, p)
  }
}
