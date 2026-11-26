<template>
  <div class="panel-root" :class="`theme-${theme}`">
    <!-- Windows 风格标题栏：左侧标题 + 右侧最小化/最大化/关闭 + 可拖拽区 -->
    <header class="titlebar" @dblclick.self="toggleMaximize">
      <div class="titlebar-label" @dblclick="toggleMaximize">熊猫盯盯</div>
      <div class="win-controls">
        <button class="wc-btn minimize" title="最小化" @click="api.panelMinimize()">
          <span>−</span>
        </button>
        <button class="wc-btn maximize" :title="isMaximized ? '还原' : '最大化'" @click="toggleMaximize">
          <span>{{ isMaximized ? '❐' : '□' }}</span>
        </button>
        <button class="wc-btn close" title="关闭" @click="api.panelClose()">
          <span>×</span>
        </button>
      </div>
    </header>

    <!-- 行情源/网络事件提示：独立提示条，不再污染 source 字段 -->
    <transition name="notice-fade">
      <div v-if="notice" class="notice-bar">{{ notice }}</div>
    </transition>

    <div class="content">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-icon">🐼</span>
          <span>熊猫盯盯</span>
        </div>
        <nav class="nav">
          <button v-for="t in tabs" :key="t.key" :class="{ active: tab === t.key }" @click="tab = t.key">
            <span class="nav-icon">{{ t.icon }}</span>
            {{ t.label }}
            <!-- 更新入口在「关于」页底部，红点跟着入口走，否则点进去找不到 -->
            <span v-if="t.key === 'about' && hasUpdate" class="nav-dot" title="有新版本可用" />
          </button>
        </nav>
        <footer class="src-status">
          <span class="status-dot" :class="dsStateTone(ds.state)" />
          数据源 {{ dsSourceLabel(ds.source) }} · {{ dsStateLabel(ds.state) }}<br />
          <span v-if="ds.lastOkAt" class="dim">更新于 {{ timeago(ds.lastOkAt) }}</span>
        </footer>
      </aside>

      <main class="main">
        <WatchlistView v-if="tab === 'watchlist'" />
        <RulesView v-else-if="tab === 'rules'" />
        <NewsView v-else-if="tab === 'news'" />
        <DataSourceView v-else-if="tab === 'datasource'" />
        <SettingsView v-else-if="tab === 'settings'" />
        <AboutView v-else />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import WatchlistView from './views/WatchlistView.vue'
import RulesView from './views/RulesView.vue'
import NewsView from './views/NewsView.vue'
import DataSourceView from './views/DataSourceView.vue'
import SettingsView from './views/SettingsView.vue'
import AboutView from './views/AboutView.vue'
import { api, onNotice } from '../api'
import { dsSourceLabel, dsStateLabel, dsStateTone } from '@shared/index'
import { theme, setTheme } from './theme'
import type { DataSourceStatus } from '@shared/index'

const tabs = [
  { key: 'watchlist', label: '自选列表', icon: '📈' },
  { key: 'rules', label: '提醒规则', icon: '🔔' },
  { key: 'news', label: '今日新闻', icon: '📰' },
  { key: 'datasource', label: '数据源', icon: '🔌' },
  { key: 'settings', label: '设置', icon: '⚙️' },
  { key: 'about', label: '关于', icon: 'ℹ️' },
] as const

const tab = ref<(typeof tabs)[number]['key']>('watchlist')
const ds = ref<DataSourceStatus>({ source: '-', state: '-', lastOkAt: null, latencyMs: null, primaryName: '-', standbyName: '-', failoverCount: 0 })
let off: (() => void) | null = null
let statusTimer: ReturnType<typeof setInterval> | null = null
/** 行情源/网络事件提示（原来的实现把它写进 ds.source，导致侧栏显示整句话） */
const notice = ref('')
let noticeTimer: ReturnType<typeof setTimeout> | null = null
/** 有新版本时在「设置」旁边点一个小红点，避免提示条一闪而过就找不到了 */
const hasUpdate = ref(false)

onMounted(async () => {
  const s = await api.settingsGet()
  setTheme(s.theme ?? 'light')
  await refreshMaximized()
  ds.value = await api.dataSourceStatus()
  statusTimer = setInterval(async () => { ds.value = await api.dataSourceStatus() }, 10_000)
  // 更新状态可能在本窗口打开前就已查出（后台 15 秒检查），这里补读一次
  try { hasUpdate.value = (await api.updateStatus()).info?.hasUpdate === true } catch { /* 忽略 */ }
  off = onNotice((n) => {
    if (n.type === 'update') {
      hasUpdate.value = true
    } else if (n.type !== 'dataSource' && n.type !== 'network') {
      return
    }
    notice.value = n.message
    if (noticeTimer) clearTimeout(noticeTimer)
    noticeTimer = setTimeout(() => { notice.value = '' }, 6000)
  })
  // 窗口重新聚焦时回读主题（设置页可能在别处改过）
  window.addEventListener('focus', onFocus)
})
onBeforeUnmount(() => {
  off?.()
  if (statusTimer) clearInterval(statusTimer)
  if (noticeTimer) clearTimeout(noticeTimer)
  window.removeEventListener('focus', onFocus)
})

async function onFocus(): Promise<void> {
  const s = await api.settingsGet()
  setTheme(s.theme ?? 'light')
  await refreshMaximized()
}

function timeago(t: number): string {
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 5) return '刚刚'
  return `${s}s 前`
}

/** 当前窗口是否最大化（用于最大化/还原图标切换） */
const isMaximized = ref(false)

async function refreshMaximized(): Promise<void> {
  try { isMaximized.value = await api.panelIsMaximized() } catch { /* 老版本主进程无此通道，忽略 */ }
}

async function toggleMaximize(): Promise<void> {
  await api.panelMaximize()
  await refreshMaximized()
}
</script>

<!-- 样式全部限定在 .panel-root 内：
     桌宠窗口与管理面板共用同一份打包产物，任何作用到 body/html 的全局样式
     都会让透明桌宠窗口出现不透明底色（踩过坑）。 -->
<style>
/* ===== 主题变量：浅色（macOS 默认） ===== */
.panel-root {
  --bg: #f6f6f8;
  --surface: #ffffff;
  --text: #1d1d1f;
  --text-secondary: #6e6e73;
  --text-tertiary: #8e8e93;
  --border: #d2d2d7;
  --border-soft: #ececf0;
  --accent: #0b64d6;
  --accent-hover: #004db3;   /* 浅色主题：hover 变深 */
  --accent-bg: #ffffff;
  --hover: rgba(0,0,0,0.05);
  --titlebar-bg: linear-gradient(180deg, #f0f0f2, #e8e8ea);
  --sidebar-bg: rgba(236,236,240,0.86);
  --input-bg: #ffffff;
  --up: #d70015;
  --down: #248a3d;
}
/* ===== 主题变量：深色 ===== */
.panel-root.theme-dark {
  --bg: #1c1c1e;
  --surface: #2c2c2e;
  --text: #f5f5f7;
  --text-secondary: #a1a1a6;
  --text-tertiary: #86868b;
  --border: #48484a;
  --border-soft: #3a3a3c;
  --accent: #0a84ff;
  --accent-hover: #409cff;   /* 深色主题：hover 变亮 */
  --accent-bg: #2c2c2e;
  --hover: rgba(255,255,255,0.07);
  --titlebar-bg: linear-gradient(180deg, #3a3a3c, #2c2c2e);
  --sidebar-bg: rgba(44,44,46,0.86);
  --input-bg: #1c1c1e;
  --up: #ff453a;
  --down: #30d158;
}
.panel-root * { box-sizing: border-box; margin: 0; }
.panel-root {
  display: flex;
  flex-direction: column;
  position: relative;          /* 事件提示条以此为定位基准 */
  /* 窗口由 DWM 画原生圆角 + 阴影，内容铺满即可 */
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  border-radius: 0;            /* 交给系统窗口圆角，避免双层圆角 */
  background: var(--bg);
  color: var(--text);
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Helvetica Neue', sans-serif;
  font-size: 13px;
  -webkit-font-smoothing: antialiased;
  /* 窗口圆角与阴影由 Windows DWM 绘制（transparent:false + roundedCorners），
     这里不再用 CSS 阴影/filter，避免遮住系统圆角 */
}
.panel-root button { font: inherit; }

/* 标题栏：Windows 风格（标题左、控制按钮右） */
.titlebar {
  height: 36px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 0 14px;
  background: var(--titlebar-bg);
  border-bottom: 1px solid var(--border-soft);
  -webkit-app-region: drag;
  app-region: drag;
  user-select: none;
}
.titlebar-label {
  font-size: 12px; font-weight: 600; color: var(--text-secondary);
  -webkit-app-region: drag; app-region: drag;
}
.win-controls {
  display: flex; align-self: stretch;
  -webkit-app-region: no-drag; app-region: no-drag;
}
.wc-btn {
  width: 46px; height: 100%; border: 0; background: transparent;
  color: var(--text-secondary); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; line-height: 1; padding: 0;
  transition: background .12s, color .12s;
}
.wc-btn:hover { background: var(--hover); color: var(--text); }
.wc-btn.close:hover { background: #e81123; color: #fff; }

.content { flex: 1; display: flex; min-height: 0; }

/* 磨砂 sidebar */
.sidebar {
  width: 190px; flex-shrink: 0;
  display: flex; flex-direction: column; gap: 6px;
  padding: 14px 12px;
  background: var(--sidebar-bg);
  backdrop-filter: saturate(180%) blur(20px);
  border-right: 1px solid var(--border-soft);
}
.brand {
  display: flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 700; padding: 4px 8px 14px;
  letter-spacing: -0.2px; color: var(--text);
}
.brand-icon { font-size: 20px; }
.nav { display: flex; flex-direction: column; gap: 3px; }
.nav button {
  display: flex; align-items: center; gap: 8px;
  text-align: left; padding: 7px 10px; border: none; border-radius: 7px;
  background: transparent; color: var(--text); cursor: pointer;
  transition: background .12s;
}
.nav button:hover { background: var(--hover); }
.nav button.active {
  background: var(--accent-bg); color: var(--accent); font-weight: 600;
  box-shadow: 0 1px 3px rgba(0,0,0,0.06);
}
.nav-icon { font-size: 14px; width: 18px; text-align: center; }
/* 有新版本的小红点 */
.nav-dot {
  width: 7px; height: 7px; border-radius: 50%; margin-left: auto;
  background: #ff453a; box-shadow: 0 0 0 2px var(--sidebar-bg);
}

.src-status {
  margin-top: auto; padding: 8px; font-size: 11px; color: var(--text-secondary); line-height: 1.6;
  border-top: 1px solid var(--border-soft);
}
.status-dot {
  display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  background: var(--text-tertiary); margin-right: 4px;
}
.status-dot.ok { background: #30d158; }
.status-dot.warn { background: #ff9f0a; }
.status-dot.bad { background: #e2493b; }
.src-status .dim { color: var(--text-tertiary); }

.main { flex: 1; padding: 20px 14px 20px 24px; overflow: auto; background: var(--bg); }

/* 行情源/网络事件提示条：浮在标题栏下方居中，6 秒自动消失 */
.notice-bar {
  position: absolute; top: 46px; left: 50%; transform: translateX(-50%);
  z-index: 20; max-width: 72%;
  padding: 6px 14px; border-radius: 8px;
  background: var(--text); color: var(--bg);
  font-size: 12px; line-height: 1.5; text-align: center;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
}
.notice-fade-enter-active, .notice-fade-leave-active { transition: opacity .2s ease, transform .2s ease; }
.notice-fade-enter-from, .notice-fade-leave-to { opacity: 0; transform: translate(-50%, -6px); }

/* 滚动条跟随主题。Chromium 数字滚动条占 10px 宽度，右 padding 相应减去 10px，
   使卡片左右视觉间距一致（左 24 = 右 14 + 滚动条 10）。 */
.main::-webkit-scrollbar { width: 10px; height: 10px; }
.main::-webkit-scrollbar-track { background: transparent; }
.main::-webkit-scrollbar-thumb {
  background: var(--border);
  border-radius: 6px;
}
.main::-webkit-scrollbar-thumb:hover { background: var(--text-tertiary); }
.panel-root.theme-dark .main::-webkit-scrollbar-thumb { background: #5a5a5e; }
.panel-root.theme-dark .main::-webkit-scrollbar-thumb:hover { background: #7a7a7e; }

/* 子视图通用颜色类（子视图是 scoped，用 :deep 覆盖） */
.main :deep(.up) { color: var(--up); }
.main :deep(.down) { color: var(--down); }
.main :deep(.dim) { color: var(--text-tertiary); }
.main :deep(.mono) { color: var(--text); }
</style>
