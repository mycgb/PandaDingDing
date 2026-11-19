<template>
  <section class="settings" v-if="s">
    <div class="card">
      <h2>外观</h2>
      <label class="row">
        <span>界面主题</span>
        <div class="segmented">
          <button :class="{ selected: s.theme === 'light' }" @click="setThemeValue('light')">☀️ 浅色</button>
          <button :class="{ selected: s.theme === 'dark' }" @click="setThemeValue('dark')">🌙 深色</button>
        </div>
      </label>
      <label class="row">
        <span>桌宠皮肤</span>
        <select v-model="s.skin" @change="save">
          <option v-for="sk in skins" :key="sk.id" :value="sk.id">{{ sk.name }}</option>
        </select>
      </label>
      <label class="row">
        <span>气泡常显并轮播自选</span>
        <input type="checkbox" :checked="s.bubbleAlwaysOn" @change="onBubbleAlwaysChange" />
      </label>
      <label class="row">
        <span>行情气泡背景色</span>
        <div class="color-picker">
          <input type="color" :value="s.bubbleColor" @input="onBubbleColorInput" @change="save" />
          <span class="color-value">{{ s.bubbleColor }}</span>
        </div>
      </label>
      <label class="row">
        <span>气泡文字大小</span>
        <input type="number" class="size-input" min="8" max="20" step="1"
               :value="s.bubbleFontSize || 11" @change="onFontSizeChange" /> px
      </label>
    </div>

    <div class="card">
      <h2>基本</h2>
      <label class="row">
        <span>盘中轮询间隔</span>
        <select v-model.number="s.pollIntervalMs" @change="save">
          <option :value="1000">1 秒（激进）</option>
          <option :value="3000">3 秒（默认）</option>
          <option :value="5000">5 秒</option>
          <option :value="10000">10 秒</option>
        </select>
      </label>
      <label class="row">
        <span>提醒音效</span>
        <input type="checkbox" v-model="s.soundEnabled" @change="save" />
      </label>
      <label class="row">
        <span>行情源切换提示（切备用源 / 主源恢复）</span>
        <input type="checkbox" v-model="s.dsNoticeEnabled" @change="save" />
      </label>
      <label class="row">
        <span>开机自启</span>
        <input type="checkbox" v-model="s.autoStart" @change="save" />
      </label>
      <label class="row">
        <span>复制代码自动加自选</span>
        <input type="checkbox" v-model="s.clipboardWatch" @change="save" />
      </label>
      <label class="row">
        <span>收盘生成总结报告</span>
        <input type="checkbox" v-model="s.closingReport" @change="save" />
      </label>
    </div>

    <div class="card">
      <h2>桌宠情绪阈值</h2>
      <label class="row">
        <span>开心阈值（组合涨幅 ≥）</span>
        <input type="number" step="0.1" v-model.number="s.moodUpThreshold" @change="save" /> %
      </label>
      <label class="row">
        <span>低落阈值（组合涨幅 ≤）</span>
        <input type="number" step="0.1" v-model.number="s.moodDownThreshold" @change="save" /> %
      </label>
    </div>

    <div class="card">
      <h2>休息 / 免打扰</h2>
      <label class="row">
        <span>启用（时段内小熊躺下休息，提醒也静默）</span>
        <input type="checkbox" v-model="s.dndEnabled" @change="save" />
      </label>
      <div v-for="(r, i) in s.dndRanges" :key="i" class="row range-row">
        <input type="time" v-model="r.start" @change="save" /> —
        <input type="time" v-model="r.end" @change="save" />
        <span class="range-tag">{{ rangeLabel(r) }}</span>
        <button class="mini" @click="removeRange(i)">删除</button>
      </div>
      <div class="row range-row actions">
        <button class="mini" @click="addRange">＋ 添加时段</button>
        <button class="mini" @click="restoreRestRanges">恢复默认休息时段</button>
      </div>
      <div class="hint">
        默认两段：午休 11:30–13:00、夜间 15:00–次日 09:25（跨午夜自动识别）。交易日只有 09:25–11:30 和 13:00–15:00
        小熊是活动的，其余时间按这里的时段躺下休息；时段可以随便改、加、删，<b>全部删掉它就一直在活动中</b>（周末与节假日仍会休息）。
      </div>
    </div>

    <div class="card">
      <h2>桌宠</h2>
      <label class="row">
        <span>显示桌宠</span>
        <input type="checkbox" :checked="s.petVisible" @change="togglePetVisible" />
      </label>
      <label class="row">
        <span>点击穿透</span>
        <input type="checkbox" v-model="s.clickThrough" @change="toggleClickThrough" />
      </label>
      <label class="row">
        <span>🚶 桌宠自动漫游（关闭则固定在原地）</span>
        <input type="checkbox" v-model="s.roamEnabled" @change="save" />
      </label>
      <label class="row">
        <span>托盘涨跌角标 + hover 快览</span>
        <input type="checkbox" v-model="s.trayBadge" @change="save" />
      </label>
      <div class="hint">漫游：空闲约 45 秒后桌宠走到屏幕底部来回散步，撞边自动折返翻面；有提醒、拖动或盘后会自动停下。托盘角标遵循红涨绿跌，鼠标悬停可看组合涨跌概览。</div>
    </div>

    <div class="card">
      <h2>上班模式</h2>
      <label class="row">
        <span>老板键（全局一键隐藏）</span>
        <input type="checkbox" v-model="s.bossKeyEnabled" @change="save" />
      </label>
      <label class="row">
        <span>隐藏 / 恢复组合键</span>
        <select v-model="s.bossKeyAccelerator" @change="save" :disabled="!s.bossKeyEnabled">
          <option value="CommandOrControl+Shift+H">Ctrl + Shift + H</option>
          <option value="CommandOrControl+Shift+D">Ctrl + Shift + D</option>
          <option value="CommandOrControl+Alt+H">Ctrl + Alt + H</option>
          <option value="CommandOrControl+Alt+P">Ctrl + Alt + P</option>
        </select>
      </label>
      <label class="row">
        <span>指数温度条（大盘常驻一角）</span>
        <input type="checkbox" v-model="s.indexBarEnabled" @change="save" />
      </label>
      <div class="hint">
        老板键：按一次把桌宠、面板和温度条一起藏起来，再按一次恢复；隐身态只影响本次运行，不改「显示桌宠」的设置。组合键被其他软件占用时会静默失效。<br />
        指数温度条：桌面右侧常驻上证 / 深成 / 创业板 / 科创50，红涨绿跌、横条长度表示幅度（±1.5% 打满）。可直接拖到任意角落，位置会记住。
      </div>
    </div>

    <div class="card">
      <h2>交易纪律</h2>
      <label class="row">
        <span>防追高阈值（涨幅 ≥ 则提醒，0 = 关闭）</span>
        <input type="number" class="size-input" min="0" max="20" step="0.5"
               v-model.number="s.chaseHighPct" @change="save" /> %
      </label>
      <label class="row">
        <span>每日提醒上限（0 = 不限）</span>
        <input type="number" class="size-input" min="0" max="50" step="1"
               v-model.number="s.maxAlertsPerDay" @change="save" /> 条
      </label>
      <div class="hint">
        防追高到点会提醒一次（当日一次），并在提醒规则页标记为「交易纪律」，可自行调阈值或停用。<br />
        每日提醒上限用于防止轰炸：当天触发满额后不再弹气泡，次日自动恢复。
      </div>
    </div>

    <div class="card">
      <h2>收盘总结报告</h2>
      <button class="mini" @click="loadReports">刷新</button>
      <div v-if="reports.length === 0" class="empty">暂无收盘报告（每个交易日收盘后自动生成）</div>
      <div v-for="r in reports" :key="r.date" class="report">
        <div class="report-head">
          <strong>{{ r.date }}</strong>
          <span :class="(r.portfolioPct ?? 0) >= 0 ? 'up' : 'down'">
            组合 {{ r.portfolioPct === null ? '--' : ((r.portfolioPct >= 0 ? '+' : '') + r.portfolioPct.toFixed(2) + '%') }}
          </span>
        </div>
        <div class="report-body">{{ r.headline }}</div>
        <div v-if="r.topGainers.length" class="report-line">
          领涨：<span v-for="g in r.topGainers" :key="g.code" class="up">{{ g.name }} {{ g.changePct >= 0 ? '+' : '' }}{{ g.changePct }}% </span>
        </div>
        <div v-if="r.topLosers.length" class="report-line">
          领跌：<span v-for="l in r.topLosers" :key="l.code" class="down">{{ l.name }} {{ l.changePct }}% </span>
        </div>
        <div v-if="r.alertCount" class="report-line">当日触发提醒 {{ r.alertCount }} 次</div>
      </div>
    </div>

    <div class="card">
      <h2>提醒历史</h2>
      <button class="mini" @click="loadHistory">刷新</button>
      <table class="history">
        <thead><tr><th>时间</th><th>标的</th><th>方向</th><th>消息</th></tr></thead>
        <tbody>
          <tr v-for="e in history" :key="e.id">
            <td class="mono dim">{{ e.triggeredAt }}</td>
            <td>{{ e.secName }}</td>
            <td :class="e.direction === 'up' ? 'up' : 'down'">{{ e.direction === 'up' ? '↑' : '↓' }}</td>
            <td>{{ e.message }}</td>
          </tr>
          <tr v-if="history.length === 0"><td colspan="4" class="empty">今日暂无提醒触发</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { api } from '../../api'
import { setTheme as applyTheme } from '../theme'
import { DEFAULT_REST_RANGES } from '@shared/index'
import type { AlertEvent, AppSettings, SkinInfo, ClosingReport } from '@shared/index'

const s = ref<AppSettings | null>(null)
const skins = ref<SkinInfo[]>([])
const history = ref<AlertEvent[]>([])
const reports = ref<ClosingReport[]>([])

onMounted(async () => {
  s.value = await api.settingsGet()
  if (s.value?.theme) applyTheme(s.value.theme as 'light' | 'dark')
  try { skins.value = await api.skinsList() } catch { skins.value = [] }
  history.value = await api.alertHistory()
  reports.value = await api.closingReports()
  window.addEventListener('focus', refreshSettings)
})
onBeforeUnmount(() => {
  window.removeEventListener('focus', refreshSettings)
})

async function refreshSettings(): Promise<void> {
  s.value = await api.settingsGet()
  if (s.value?.theme) applyTheme(s.value.theme as 'light' | 'dark')
}

async function save(): Promise<void> {
  if (!s.value) return
  s.value = await api.settingsSet(JSON.parse(JSON.stringify(s.value)) as AppSettings)
}

/** 气泡常显开关：立即同步到桌宠窗口并持久化 */
async function onBubbleAlwaysChange(e: Event): Promise<void> {
  if (!s.value) return
  s.value.bubbleAlwaysOn = (e.target as HTMLInputElement).checked
  await save()
}

/** 气泡字号：限制 8-20px，change 时保存并实时同步到桌宠 */
async function onFontSizeChange(e: Event): Promise<void> {
  if (!s.value) return
  const raw = Number((e.target as HTMLInputElement).value)
  const size = Math.min(20, Math.max(8, Number.isFinite(raw) ? Math.round(raw) : 11))
  ;(e.target as HTMLInputElement).value = String(size)
  s.value.bubbleFontSize = size
  await save()
}

/** 颜色选择器输入时更新本地值，change 时统一 save */
function onBubbleColorInput(e: Event): void {
  if (!s.value) return
  s.value.bubbleColor = (e.target as HTMLInputElement).value
}

/** 切换主题：立即应用 + 独立持久化 */
async function setThemeValue(t: 'light' | 'dark'): Promise<void> {
  if (!s.value || s.value.theme === t) return
  s.value.theme = t
  applyTheme(t)
  s.value = await api.settingsSet({ theme: t })
}

async function togglePetVisible(e: Event): Promise<void> {
  if (!s.value) return
  const visible = (e.target as HTMLInputElement).checked
  try {
    await api.petSetVisible(visible)
    s.value = await api.settingsGet()
  } catch (error) {
    s.value = await api.settingsGet()
    alert('切换桌宠显示状态失败：' + (error as Error).message)
  }
}

async function toggleClickThrough(): Promise<void> {
  if (!s.value) return
  await api.petSetInteraction(s.value.clickThrough ? 'clickThrough' : 'normal')
  s.value = await api.settingsGet()
}

function addRange(): void {
  s.value?.dndRanges.push({ start: '14:00', end: '15:00' })
  save()
}
function removeRange(i: number): void {
  s.value?.dndRanges.splice(i, 1)
  save()
}
/** 时段用途标签：命中预置的两段就标出来，方便用户看清哪条是午休、哪条是夜间 */
function rangeLabel(r: { start: string; end: string }): string {
  const k = `${r.start}-${r.end}`
  if (k === '11:30-13:00') return '午休'
  if (k === '15:00-09:25') return '夜间（跨午夜）'
  return '自定义'
}
/** 一键把两段默认休息时段补回来（用户删掉后想恢复时用） */
async function restoreRestRanges(): Promise<void> {
  if (!s.value) return
  const list = s.value.dndRanges
  for (const d of DEFAULT_REST_RANGES) {
    if (!list.some((x) => x.start === d.start && x.end === d.end)) list.push({ ...d })
  }
  list.sort((a, b) => a.start.localeCompare(b.start))
  s.value.dndEnabled = true
  await save()
}
async function loadHistory(): Promise<void> {
  history.value = await api.alertHistory()
}
async function loadReports(): Promise<void> {
  reports.value = await api.closingReports()
}
</script>

<style scoped>
.settings { width: 100%; max-width: 100%; }
.card {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 12px;          /* 四角圆角 */
  padding: 16px 20px 18px;
  margin-bottom: 20px;          /* 上下间隔 20px */
  box-shadow: 0 1px 3px rgba(0,0,0,0.04);
}
h2 {
  font-size: 12px; color: var(--text-secondary); margin: 0 0 10px; font-weight: 600;
  text-transform: uppercase; letter-spacing: .4px;
}
.row { display: flex; align-items: center; gap: 10px; margin: 8px 0; font-size: 13px; }
.row > span:first-child { min-width: 210px; color: var(--text); }
.row select, .row input[type='number'], .row input[type='time'] {
  padding: 5px 9px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 13px;
}
.row select:focus, .row input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(11,100,214,0.15); }
.color-picker { display: flex; align-items: center; gap: 8px; }
.color-picker input[type='color'] {
  width: 36px; height: 26px; padding: 2px; border: 1px solid var(--border);
  border-radius: 6px; background: var(--surface); cursor: pointer;
}
.color-value { font: 11px 'SF Mono', Consolas, monospace; color: var(--text-secondary); }
.size-input {
  width: 64px; padding: 5px 8px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); font-size: 13px;
}
.segmented {
  display: inline-flex; background: var(--bg); border: 1px solid var(--border);
  border-radius: 7px; padding: 2px; gap: 2px;
}
.segmented button {
  padding: 5px 14px; border: none; border-radius: 5px; background: transparent;
  color: var(--text-secondary); cursor: pointer; font-size: 12px; transition: all .15s;
}
.segmented button.selected {
  background: var(--surface); color: var(--text); font-weight: 600;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
}
.segmented button:hover:not(.selected) { color: var(--text); }
.range-row { margin-left: 220px; }
.range-row.actions { display: flex; gap: 8px; flex-wrap: wrap; }
.range-tag { font-size: 11px; color: var(--text-secondary); background: var(--bg); border-radius: 9px; padding: 2px 8px; margin-left: 2px; }
.mini {
  padding: 3px 10px; font-size: 11px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); cursor: pointer; margin: 6px 0;
}
.mini:hover { background: var(--hover); }
.history { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; background: var(--surface); border-radius: 8px; overflow: hidden; }
.history th, .history td { padding: 6px 10px; border-bottom: 1px solid var(--border-soft); text-align: left; }
.history th { color: var(--text-secondary); font-weight: 600; background: var(--surface); }
.history tr:last-child td { border-bottom: none; }
.mono { font-family: 'SF Mono', Consolas, monospace; }
.dim { color: var(--text-tertiary); }
.up { color: var(--up); }
.down { color: var(--down); }
.empty { color: var(--text-tertiary); text-align: center; padding: 20px; font-size: 12px; }
.hint { font-size: 11px; line-height: 1.6; color: var(--text-tertiary); margin: 6px 0 0 220px; }
.report { border-bottom: 1px solid var(--border-soft); padding: 10px 0; font-size: 12px; }
.report:last-child { border-bottom: none; }
.report-head { display: flex; justify-content: space-between; margin-bottom: 5px; color: var(--text); }
.report-body { color: var(--text-secondary); margin-bottom: 4px; }
.report-line { color: var(--text-tertiary); margin-top: 3px; }
</style>
