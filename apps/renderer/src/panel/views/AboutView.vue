<template>
  <section class="about">
    <div class="card hero">
      <div class="logo">🐼</div>
      <h1>PandaDingDing · 熊猫盯盯</h1>
      <p class="tagline">常驻桌面的股票基金监控精灵</p>
      <p class="version">版本 v{{ version }}</p>
    </div>

    <div class="card follow-card">
      <h2>关注公众号</h2>
      <div class="qr-wrap">
        <img :src="qrImage" alt="PandaDingDing 公众号二维码" class="qr" />
      </div>
      <p class="qr-tip">扫码关注公众号，获取 PandaDingDing 的最新动态与使用教程</p>
    </div>

    <div class="card">
      <h2>数据来源</h2>
      <p>行情数据来自 <strong>东方财富</strong>（主数据源），并在异常时自动切换到 <strong>腾讯财经</strong>（备用数据源）。</p>
      <p>场外基金净值数据来自 <strong>东方财富基金</strong>。</p>
      <p class="dim">数据可能存在延迟，具体以交易所及基金公司官方发布为准。</p>
    </div>

    <div class="card">
      <h2>功能简介</h2>
      <ul>
        <li>实时关注自选股票 / 基金 / 港美股行情，按交易时段智能轮询</li>
        <li>涨跌幅 / 价格 / 成交量倍数 / 连涨连跌 / 3 分钟涨速 / 涨跌停 六类提醒规则</li>
        <li>桌宠情绪随组合涨跌变化，动画实时反馈</li>
        <li>上班模式：老板键一键隐身、桌面指数温度条、定时时点提醒</li>
        <li>持仓盈亏、异动雷达、盘后日报与交易纪律（防追高 / 每日提醒上限）</li>
        <li>K 线与分时图速览，多皮肤随心切换</li>
      </ul>
    </div>

    <div class="card disclaimer">
      <h2>免责声明</h2>
      <p>本软件为个人学习与技术交流项目，所展示的行情、数据、提醒等信息<strong>仅供参考，不构成任何投资建议</strong>。</p>
      <p>任何依据本软件信息做出的投资决策及由此产生的盈亏，均由使用者自行承担。投资有风险，入市需谨慎。</p>
      <p class="dim">本软件与东方财富、腾讯财经等数据提供方无任何隶属或合作关系。</p>
    </div>

    <div class="card source-card">
      <h2>开源地址</h2>
      <p class="source-desc">PandaDingDing 是完全开源的项目，欢迎 Star、提 Issue 与贡献代码。</p>
      <a class="source-link" href="https://github.com/mycgb/PandaDingDing" @click.prevent="openRepo">
        <span class="source-icon">🔗</span>
        <span class="source-url">https://github.com/mycgb/PandaDingDing</span>
        <span class="source-arrow">↗</span>
      </a>
    </div>

    <!-- 当前版本已经在顶部 hero 里显示，这里不再重复，只放「检查/下载/安装」这条链路 -->
    <div class="card update-card">
      <h2>软件更新</h2>
      <div class="row">
        <span class="label">检查结果</span>
        <span class="ver" :class="{ 'has-new': info?.hasUpdate, 'has-err': !!info?.error }">{{ updateStatusText }}</span>
      </div>
      <div v-if="downloading" class="row">
        <span class="label">下载进度</span>
        <div class="update-bar">
          <i :style="{ width: `${percent}%` }" />
          <em>{{ percent }}%</em>
        </div>
        <span class="dim size">{{ mbText }}</span>
      </div>
      <div class="row actions">
        <button class="mini" :disabled="checking" @click="checkUpdate">{{ checking ? '检查中…' : '检查更新' }}</button>
        <button v-if="info?.hasUpdate && info.asset" class="mini primary" :disabled="downloading"
                @click="downloadOrInstall">
          {{ downloading ? '下载中…' : (ready ? '立即安装并重启' : (info.installable ? '下载并安装' : '下载安装包')) }}
        </button>
        <button v-if="info?.hasUpdate" class="mini" @click="openRelease">打开发布页</button>
      </div>
      <div v-if="info?.notes && info.hasUpdate" class="update-notes">{{ info.notes }}</div>
      <label class="row check">
        <input type="checkbox" v-model="autoCheck" @change="saveAutoCheck" />
        <span>启动后自动检查新版本</span>
      </label>
      <p class="hint">
        检查走 GitHub 官方 Releases（需要能访问 github.com / api.github.com）。Windows 支持下载后静默安装并自动重启；
        macOS / Linux 会下载安装包或打开发布页，按系统方式安装。
      </p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { api, onUpdateProgress } from '../../api'
import type { UpdateInfo, UpdateProgress } from '@shared/index'

// 版本号由主进程 app.getVersion() 提供（打包后读 app.asar 内的 package.json），
// 避免像以前那样写死字符串、发版后关于页仍显示旧版本。
const version = ref('0.2.0')

/* ---------- 软件更新（原来在设置页顶部，挪到关于页底部） ---------- */
const info = ref<UpdateInfo | null>(null)
const progress = ref<UpdateProgress | null>(null)
const checking = ref(false)
const autoCheck = ref(true)
let offUpdate: (() => void) | null = null

const downloading = computed(() => progress.value?.phase === 'downloading')
const ready = computed(() => progress.value?.phase === 'ready')
const percent = computed(() => {
  const p = progress.value
  if (!p) return 0
  if (p.phase === 'ready' || p.phase === 'installing') return 100
  return Math.max(0, Math.min(100, p.percent))
})
const mbText = computed(() => {
  const p = progress.value
  if (!p) return ''
  const f = (n: number) => (n / 1048576).toFixed(1)
  return `${f(p.receivedBytes)} / ${f(p.totalBytes)} MB`
})
const updateStatusText = computed(() => {
  if (checking.value) return '检查中…'
  if (!info.value) return '尚未检查'
  if (info.value.error) return `检查失败：${info.value.error}`
  if (info.value.hasUpdate) return `发现新版本 v${info.value.latest}${info.value.asset ? '' : '（当前平台暂无安装包）'}`
  return '已是最新版本'
})

onMounted(async () => {
  api.appVersion().then((v) => { if (v) version.value = v }).catch(() => { /* 读不到就用兜底 */ })
  try {
    const st = await api.settingsGet()
    autoCheck.value = st.updateCheckEnabled !== false
  } catch { /* 老版本没有这个字段：按默认开启显示 */ }
  try {
    // 面板窗口常常晚于启动时的自动检查打开，这里回读主进程里的结果
    const st = await api.updateStatus()
    info.value = st.info
    progress.value = st.progress
  } catch { /* 老版本没有更新接口时忽略 */ }
  offUpdate = onUpdateProgress((p) => { progress.value = p })
})
onBeforeUnmount(() => { offUpdate?.() })

async function saveAutoCheck(): Promise<void> {
  try { await api.settingsSet({ updateCheckEnabled: autoCheck.value }) } catch { /* 保存失败不影响本次操作 */ }
}

async function checkUpdate(): Promise<void> {
  checking.value = true
  try {
    info.value = await api.updateCheck(false)
  } catch (e) {
    alert('检查更新失败：' + (e as Error).message)
  } finally {
    checking.value = false
  }
}

/** 已下载 → 直接安装；否则先下载（进度由 update:progress 推送） */
async function downloadOrInstall(): Promise<void> {
  try {
    if (ready.value) { await api.updateInstall(); return }
    progress.value = { phase: 'downloading', percent: 0, receivedBytes: 0, totalBytes: info.value?.asset?.size ?? 0 }
    progress.value = await api.updateDownload()
  } catch (e) {
    alert('下载更新失败：' + (e as Error).message)
    progress.value = { phase: 'error', percent: 0, receivedBytes: 0, totalBytes: 0, message: (e as Error).message }
  }
}

async function openRelease(): Promise<void> {
  const url = info.value?.htmlUrl || 'https://github.com/mycgb/PandaDingDing/releases'
  try { await api.openExternal(url) } catch (e) { alert('打开链接失败：' + (e as Error).message) }
}

// 公众号二维码：放渲染层 public 目录，dev 由 vite 服务、打包随 dist 复制。
// 相对路径以适配 file:// 与 http:// 两种加载方式（base='./'）。
const qrImage = './wechat-official-account.jpg'

const REPO_URL = 'https://github.com/mycgb/PandaDingDing'
// 交给主进程 shell.openExternal，用系统默认浏览器打开（而非应用内窗口）。
function openRepo(): void {
  api.openExternal(REPO_URL).catch(() => { /* 打开失败静默处理 */ })
}
</script>

<style scoped>
.about { width: 100%; max-width: 760px; }
.card {
  background: var(--surface); border: 1px solid var(--border-soft);
  border-radius: 12px; padding: 18px 22px; margin-bottom: 18px;
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
.hero { text-align: center; padding: 28px 22px; }
.hero .logo { font-size: 48px; line-height: 1; margin-bottom: 8px; }
h1 { font-size: 20px; margin: 0 0 4px; color: var(--text); }
.tagline { color: var(--text-secondary); font-size: 13px; margin: 0 0 12px; }
.version { color: var(--text-tertiary); font-size: 12px; margin: 0; font-family: 'SF Mono', Consolas, monospace; }
h2 { font-size: 12px; color: var(--text-secondary); margin: 0 0 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .4px; }
p { font-size: 13px; line-height: 1.7; color: var(--text); margin: 6px 0; }
ul { margin: 6px 0; padding-left: 20px; }
li { font-size: 13px; line-height: 1.8; color: var(--text); }
.dim { color: var(--text-tertiary); font-size: 12px; }
.disclaimer { border-left: 3px solid var(--accent); }
.follow-card { text-align: center; }
.source-desc { color: var(--text-secondary); font-size: 12px; margin: 0 0 12px; }
.source-link {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 14px; border: 1px solid var(--border-soft); border-radius: 8px;
  background: var(--surface-2, var(--bg)); text-decoration: none;
  color: var(--accent); cursor: pointer; transition: border-color .15s, background .15s;
}
.source-link:hover { border-color: var(--accent); background: var(--surface-hover, var(--surface)); }
.source-icon { font-size: 16px; line-height: 1; }
.source-url {
  flex: 1; min-width: 0; font-size: 13px;
  font-family: 'SF Mono', Consolas, monospace;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.source-arrow { font-size: 15px; opacity: .7; }
.qr-wrap {
  display: inline-block; padding: 10px; background: #fff;
  border: 1px solid var(--border-soft); border-radius: 12px; line-height: 0;
}
.qr { width: 180px; height: 180px; display: block; image-rendering: auto; }
.qr-tip { color: var(--text-secondary); font-size: 12px; margin: 10px 0 0; }

/* ---------- 软件更新 ---------- */
.row { display: flex; align-items: center; gap: 10px; margin: 8px 0; font-size: 13px; }
.row .label { min-width: 96px; color: var(--text-secondary); }
.ver { font: 12px 'SF Mono', Consolas, monospace; color: var(--text-secondary); }
.ver.has-new { color: var(--up); font-weight: 700; }
.ver.has-err { color: #ff9f0a; }
.actions { flex-wrap: wrap; margin-left: 106px; }
.check { margin-top: 10px; font-size: 12px; color: var(--text-secondary); cursor: pointer; }
.check input { accent-color: var(--accent); cursor: pointer; }
.mini {
  padding: 4px 12px; font-size: 11px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); cursor: pointer;
}
.mini:hover { background: var(--hover); }
.mini.primary { background: var(--accent); color: #fff; border-color: var(--accent); }
.mini.primary:hover:not(:disabled) { background: var(--accent-hover); }
.mini:disabled { opacity: .55; cursor: default; }
.update-bar {
  position: relative; width: 260px; height: 12px; border-radius: 6px;
  background: var(--bg); border: 1px solid var(--border); overflow: hidden;
}
.update-bar i { display: block; height: 100%; background: var(--accent); transition: width .2s ease; }
.update-bar em {
  position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
  font: 600 9px/1 'SF Mono', Consolas, monospace; color: var(--text); font-style: normal;
}
.size { font-size: 11px; }
.update-notes {
  margin: 8px 0 0; max-height: 160px; overflow: auto;
  padding: 8px 10px; border-radius: 8px; background: var(--bg);
  border: 1px solid var(--border-soft);
  font: 11px/1.6 'SF Mono', Consolas, monospace; color: var(--text-secondary);
  white-space: pre-wrap;
}
.hint { font-size: 11px; line-height: 1.6; color: var(--text-tertiary); margin: 8px 0 0; }
</style>
