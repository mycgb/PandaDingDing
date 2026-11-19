/**
 * 软件更新相关的纯函数（不依赖 Electron，便于单测）：
 *  - 版本号比较（0.2.10 > 0.2.9，字符串比较会错）
 *  - 按平台/架构从 Release 资产里挑安装包
 *  - 把 GitHub Release 响应整理成渲染层要的 UpdateInfo
 */
import type { UpdateAsset, UpdateInfo } from '../../../../packages/shared/src/index.ts'

export const UPDATE_REPO = 'mycgb/PandaDingDing'
export const UPDATE_API = `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`
export const UPDATE_PAGE = `https://github.com/${UPDATE_REPO}/releases`

/** 'v0.2.2' → '0.2.2' */
export function normalizeVersion(tag: string): string {
  return String(tag ?? '').trim().replace(/^v/i, '')
}

/**
 * 比较两个版本号：a > b 返回 1，相等 0，a < b 返回 -1。
 * 逐段按数字比较，缺失段按 0 处理（'1.2' 等价于 '1.2.0'）。
 */
export function compareVersions(a: string, b: string): number {
  const pa = normalizeVersion(a).split('.')
  const pb = normalizeVersion(b).split('.')
  const len = Math.max(pa.length, pb.length)
  for (let i = 0; i < len; i++) {
    const na = parseInt(pa[i] ?? '0', 10)
    const nb = parseInt(pb[i] ?? '0', 10)
    const da = Number.isFinite(na) ? na : 0
    const db = Number.isFinite(nb) ? nb : 0
    if (da !== db) return da > db ? 1 : -1
  }
  return 0
}

/** GitHub Release 资产（只取用得到的字段） */
export interface ReleaseAsset {
  name: string
  size: number
  browser_download_url: string
}

export interface ReleaseLike {
  tag_name?: string
  name?: string | null
  published_at?: string | null
  html_url?: string | null
  body?: string | null
  assets?: ReleaseAsset[]
}

/**
 * 当前平台优先匹配的资产名后缀，按优先级排列。
 * 与 .github/workflows/release.yml 里的 artifactName 一一对应：
 *   win   → PandaDingDing-0.2.2-win-x64-nsis.exe / -portable.exe
 *   mac   → PandaDingDing-0.2.2-mac-arm64.dmg
 *   linux → PandaDingDing-0.2.2-linux-x86_64.AppImage / -linux-amd64.deb
 * 注意 Linux 的 arch 会被 electron-builder 改写成 amd64 / x86_64，
 * 所以两种写法都要列上（先试真实产物名，再兜底 x64）。
 */
export function assetCandidates(platform: NodeJS.Platform | string, arch: string): string[] {
  if (platform === 'win32') return [`-win-${arch}-nsis.exe`, `-win-${arch}-portable.exe`]
  if (platform === 'darwin') return [`-mac-${arch}.dmg`, `-mac-${arch}.zip`]
  const linuxApp = arch === 'x64'
    ? ['-linux-x86_64.AppImage', '-linux-x64.AppImage', '-linux-amd64.AppImage']
    : [`-linux-${arch}.AppImage`]
  const linuxDeb = arch === 'x64'
    ? ['-linux-amd64.deb', '-linux-x64.deb']
    : [`-linux-${arch}.deb`]
  return [...linuxApp, ...linuxDeb]
}

export function pickAsset(
  assets: ReleaseAsset[],
  platform: NodeJS.Platform | string,
  arch: string,
): UpdateAsset | null {
  for (const suffix of assetCandidates(platform, arch)) {
    const hit = assets.find((a) => String(a.name).toLowerCase().endsWith(suffix.toLowerCase()))
    if (hit) return { name: hit.name, size: hit.size, url: hit.browser_download_url }
  }
  return null
}

/** 只有 Windows 的 NSIS 安装包支持下载后静默安装；其余平台只能下载后手动装 */
export function isInstallable(asset: UpdateAsset | null, platform: NodeJS.Platform | string): boolean {
  return platform === 'win32' && !!asset && /-nsis\.exe$/i.test(asset.name)
}

/**
 * Release 正文太长会把设置页撑爆，截到前 600 字；顺手把 markdown 标记去掉（纯文本展示）。
 *
 * 正文里有不少 CI 自动生成的样板（构建时间、提交号、下载清单），对「有新版本」卡片
 * 没有信息量，还会把真正的更新内容挤出 600 字之外，所以先砍掉再截断。
 */
function trimNotes(body: string | null | undefined): string | null {
  if (!body) return null
  let text = body
    .replace(/^#{1,6}\s+/gm, '')        // 标题
    .replace(/\*\*(.+?)\*\*/g, '$1')    // 粗体
    .replace(/^_(.+?)_\s*$/gm, '$1')    // 斜体（版本区间那一行）
    .replace(/^\s*[-*]\s+/gm, '· ')     // 列表
    .replace(/^\s*>\s?/gm, '')          // 引用块
    .replace(/^构建时间：.*$/gm, '')     // 自动生成的元信息
    .replace(/^提交：.*$/gm, '')
    // 首行「PandaDingDing · 熊猫盯叮  0.2.3」纯冗余：卡片上已经标了版本号。
    // 只匹配行首，正文里以「· 」开头的提交条目不受影响。
    .replace(/^PandaDingDing.*$/gm, '')
    .trim()
  // 「下载」及之后是按产物生成的链接清单（见 .github/workflows/release.yml）
  const cut = text.search(/^下载\s*$/m)
  if (cut >= 0) text = text.slice(0, cut).trim()
  text = text.replace(/\n{3,}/g, '\n\n').trim()
  if (!text) return null
  return text.length > 600 ? `${text.slice(0, 600)}…` : text
}

export function toUpdateInfo(input: {
  release: ReleaseLike
  current: string
  platform: NodeJS.Platform | string
  arch: string
  checkedAt: number
}): UpdateInfo {
  const { release, current, platform, arch, checkedAt } = input
  const latest = normalizeVersion(release.tag_name ?? '')
  const assets = Array.isArray(release.assets) ? release.assets : []
  const hasUpdate = !!latest && compareVersions(latest, current) > 0
  // 没有新版本就绝不带 asset：否则「有 asset 就下载安装」的代码会把用户
  // 重装甚至降级回旧版本（例如本地是未发布的 0.2.4，线上最新还是 0.2.3）
  const asset = hasUpdate ? pickAsset(assets, platform, arch) : null
  return {
    current: normalizeVersion(current),
    latest: latest || null,
    hasUpdate,
    publishedAt: release.published_at ?? null,
    htmlUrl: release.html_url ?? UPDATE_PAGE,
    notes: trimNotes(release.body),
    asset,
    installable: isInstallable(asset, platform),
    error: null,
    checkedAt,
  }
}

/** 检查失败时也返回一个结构完整的对象，渲染层不用判空 */
export function failedUpdateInfo(input: {
  current: string
  error: string
  checkedAt: number
  previous?: UpdateInfo | null
}): UpdateInfo {
  return {
    current: normalizeVersion(input.current),
    latest: input.previous?.latest ?? null,
    hasUpdate: input.previous?.hasUpdate ?? false,
    publishedAt: input.previous?.publishedAt ?? null,
    htmlUrl: input.previous?.htmlUrl ?? UPDATE_PAGE,
    notes: input.previous?.notes ?? null,
    asset: input.previous?.asset ?? null,
    installable: input.previous?.installable ?? false,
    error: input.error,
    checkedAt: input.checkedAt,
  }
}

/* ---------- HTML 兜底解析（GitHub API 未登录限流 60 次/小时/IP，很容易 403） ---------- */

/**
 * 从 `https://github.com/owner/repo/releases/tag/v0.2.2` 或
 * 重定向响应头里取出 tag。
 */
export function parseLatestTag(urlOrLocation: string | null | undefined): string | null {
  if (!urlOrLocation) return null
  // 排除引号/尖括号/空白：同一套正则既用于裸 URL，也用于 XML/HTML 里的 href 属性
  const m = /\/releases\/tag\/([^/?#"'\s<>]+)/.exec(urlOrLocation)
  if (!m) return null
  try { return decodeURIComponent(m[1]) } catch { return m[1] }
}

/**
 * releases.atom（RSS）兜底：GitHub 的 Release Atom 源不受 API 限流，
 * 第一条 entry 就是最新版本，带 tag、发布时间和正文（HTML 转义）。
 */
export interface AtomRelease {
  tag: string
  publishedAt: string | null
  notes: string | null
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ',
  }
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&(lt|gt|amp|quot|#39|apos|nbsp);/g, (m) => named[m] ?? m)
}

function htmlToText(html: string): string {
  return html
    .replace(/<\s*li[^>]*>/gi, '· ')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(p|h[1-6]|ul|ol|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function parseAtomLatest(xml: string): AtomRelease | null {
  const entry = /<entry>([\s\S]*?)<\/entry>/.exec(xml)?.[1]
  if (!entry) return null
  const tag = parseLatestTag(entry)   // <link rel="alternate" href=".../releases/tag/v0.2.2"/>
  if (!tag) return null
  const publishedAt = /<updated>([^<]+)<\/updated>/.exec(entry)?.[1]?.trim() ?? null
  const content = /<content[^>]*>([\s\S]*?)<\/content>/.exec(entry)?.[1] ?? ''
  const text = htmlToText(decodeEntities(content))
  return { tag, publishedAt, notes: text ? (text.length > 600 ? `${text.slice(0, 600)}…` : text) : null }
}

/**
 * 按发布命名规则直接拼出当前平台可能的安装包文件名。
 * 兜底通道拿不到资产列表，但 Release 资产地址是确定的：
 *   https://github.com/<owner>/<repo>/releases/download/<tag>/<name>
 * 用 HEAD 探测第一个存在的即可，这样即使 API 被限流也能一键更新。
 */
export function assetNameCandidates(version: string, platform: NodeJS.Platform | string, arch: string): string[] {
  const v = normalizeVersion(version)
  return assetCandidates(platform, arch).map((suffix) => `PandaDingDing-${v}${suffix}`)
}
