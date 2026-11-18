<template>
  <div class="panel-root" :class="`theme-${theme}`">
    <!-- macOS 风格标题栏：交通灯 + 可拖拽区 -->
    <header class="titlebar">
      <div class="traffic-lights">
        <button class="light close" title="关闭" @click="api.panelClose()">
          <span>×</span>
        </button>
        <button class="light minimize" title="最小化" @click="api.panelMinimize()">
          <span>−</span>
        </button>
        <button class="light zoom" title="最大化" @click="toggleMaximize">
          <span>+</span>
        </button>
      </div>
      <div class="titlebar-label">PetTicker</div>
      <div class="titlebar-spacer" />
    </header>

    <div class="content">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-icon">🐼</span>
          <span>PetTicker</span>
        </div>
        <nav class="nav">
          <button v-for="t in tabs" :key="t.key" :class="{ active: tab === t.key }" @click="tab = t.key">
            <span class="nav-icon">{{ t.icon }}</span>
            {{ t.label }}
          </button>
        </nav>
        <footer class="src-status">
          <span class="status-dot" :class="{ ok: ds.state === 'PRIMARY' }" />
          数据源 {{ ds.source }} · {{ ds.state }}<br />
          <span v-if="ds.lastOkAt" class="dim">更新于 {{ timeago(ds.lastOkAt) }}</span>
        </footer>
      </aside>

      <main class="main">
        <WatchlistView v-if="tab === 'watchlist'" />
        <RulesView v-else-if="tab === 'rules'" />
        <SettingsView v-else />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import WatchlistView from './views/WatchlistView.vue'
import RulesView from './views/RulesView.vue'
import SettingsView from './views/SettingsView.vue'
import { api, onNotice } from '../api'
import { theme, setTheme } from './theme'

const tabs = [
  { key: 'watchlist', label: '自选列表', icon: '📈' },
  { key: 'rules', label: '提醒规则', icon: '🔔' },
  { key: 'settings', label: '设置', icon: '⚙️' },
] as const

const tab = ref<(typeof tabs)[number]['key']>('watchlist')
const ds = ref<{ source: string; state: string; lastOkAt: number | null }>({ source: '-', state: '-', lastOkAt: null })
let off: (() => void) | null = null
let statusTimer: ReturnType<typeof setInterval> | null = null

onMounted(async () => {
  const s = await api.settingsGet()
  setTheme(s.theme ?? 'light')
  ds.value = await api.dataSourceStatus()
  statusTimer = setInterval(async () => { ds.value = await api.dataSourceStatus() }, 10_000)
  off = onNotice((n) => { if (n.type === 'dataSource') ds.value = { ...ds.value, source: n.message } })
  // 窗口重新聚焦时回读主题（设置页可能在别处改过）
  window.addEventListener('focus', onFocus)
})
onBeforeUnmount(() => {
  off?.()
  if (statusTimer) clearInterval(statusTimer)
  window.removeEventListener('focus', onFocus)
})

async function onFocus(): Promise<void> {
  const s = await api.settingsGet()
  setTheme(s.theme ?? 'light')
}

function timeago(t: number): string {
  const s = Math.floor((Date.now() - t) / 1000)
  if (s < 5) return '刚刚'
  return `${s}s 前`
}

async function toggleMaximize(): Promise<void> {
  // 最大化按钮：用 IPC 让主进程切换（复用 panelMinimize 通道不够，这里直接重载窗口状态）
  // 为保持简单，macOS 风格的 zoom 按钮暂时只做 getter：通过 location.reload 无意义，
  // 因此这里用 window 尺寸的 CSS 切换模拟"缩放"效果。
  const root = document.querySelector('.panel-root') as HTMLElement | null
  if (root) root.classList.toggle('zoomed')
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

/* 标题栏：macOS traffic lights */
.titlebar {
  height: 38px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  padding: 0 14px;
  background: var(--titlebar-bg);
  border-bottom: 1px solid var(--border-soft);
  -webkit-app-region: drag;
  app-region: drag;
  user-select: none;
}
.traffic-lights { display: flex; gap: 8px; -webkit-app-region: no-drag; app-region: no-drag; }
.light {
  width: 13px; height: 13px; border-radius: 50%; border: 1px solid rgba(0,0,0,0.12);
  padding: 0; cursor: pointer; display: flex; align-items: center; justify-content: center;
  line-height: 1; font-size: 10px; color: rgba(0,0,0,0.45);
}
.light:hover { filter: brightness(0.92); }
.light.close { background: #ff5f57; }
.light.minimize { background: #febc2e; }
.light.zoom { background: #28c840; }
.light span { opacity: 0; transition: opacity .12s; }
.traffic-lights:hover .light span { opacity: 1; }

.titlebar-label {
  position: absolute; left: 0; right: 0; text-align: center;
  font-size: 12px; font-weight: 600; color: var(--text-secondary); pointer-events: none;
}

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

.src-status {
  margin-top: auto; padding: 8px; font-size: 11px; color: var(--text-secondary); line-height: 1.6;
  border-top: 1px solid var(--border-soft);
}
.status-dot {
  display: inline-block; width: 7px; height: 7px; border-radius: 50%;
  background: #ff9f0a; margin-right: 4px;
}
.status-dot.ok { background: #30d158; }
.src-status .dim { color: var(--text-tertiary); }

.main { flex: 1; padding: 20px 14px 20px 24px; overflow: auto; background: var(--bg); }

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
