<template>
  <section>
    <div class="page-head">
      <div class="page-title">
        <h1>提醒规则</h1>
        <span class="count">{{ rules.length }} 条</span>
      </div>
      <button class="primary" @click="newRule">＋ 新建规则</button>
    </div>
    <p class="hint">全局规则对所有自选生效；标的级规则只对单只生效。成交量倍数 = 当日量 / 近 5 日均量（盘中按时间折算），连涨连跌基于日 K 收盘价。</p>

    <table class="rules-table">
      <colgroup>
        <col style="width:72px" /><col style="width:150px" /><col style="width:120px" />
        <col style="width:132px" /><col style="width:132px" /><col style="width:96px" /><col />
      </colgroup>
      <thead>
        <tr><th>范围</th><th>标的</th><th>指标</th><th>条件</th><th>冷却</th><th>状态</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rules" :key="r.id">
          <td>{{ r.scope === 'global' ? '全局' : '标的' }}</td>
          <td>{{ r.scope === 'global' ? '—' : nameOf(r.secId!) }}</td>
          <td>{{ metricLabel(r.metric) }}</td>
          <td class="mono">{{ opLabel(r.op) }} {{ r.threshold }}{{ unitOf(r.metric) }}</td>
          <td>{{ cooldownLabel(r.cooldown) }}</td>
          <td><span class="state-pill" :class="{ on: r.enabled }">{{ r.enabled ? '启用中' : '已停用' }}</span></td>
          <td class="ops">
            <button class="mini" @click="editRule(r)">编辑</button>
            <button class="mini" @click="toggle(r)">{{ r.enabled ? '停用' : '启用' }}</button>
            <button class="mini danger" @click="remove(r.id)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="!rules.length" class="empty">还没有规则，点右上角「＋ 新建规则」开始。</div>

    <div class="section-head">
      <h2>定时提醒</h2>
      <span class="count">{{ timeAlerts.length }} 条</span>
    </div>
    <p class="hint">到点响一次，专治“一忙就错过时点”。桌宠会跳一下并显示气泡；命中免打扰时段时静默跳过，同一时点当天不会重复响。</p>

    <table class="rules-table">
      <colgroup>
        <col style="width:88px" /><col /><col style="width:104px" />
        <col style="width:92px" /><col style="width:220px" />
      </colgroup>
      <thead>
        <tr><th>时间</th><th>提醒内容</th><th>触发日</th><th>状态</th><th>操作</th></tr>
      </thead>
      <tbody>
        <tr v-for="t in timeAlerts" :key="t.id">
          <td class="mono">{{ t.time }}</td>
          <td><input class="inline-input" v-model="t.label" maxlength="40" @change="saveTimeAlert(t)" /></td>
          <td>{{ t.workdayOnly ? '仅交易日' : '每天' }}</td>
          <td><span class="state-pill" :class="{ on: t.enabled }">{{ t.enabled ? '启用中' : '已停用' }}</span></td>
          <td class="ops">
            <button class="mini" @click="toggleTimeAlert(t)">{{ t.enabled ? '停用' : '启用' }}</button>
            <button class="mini" @click="toggleTimeDay(t)">{{ t.workdayOnly ? '改每天' : '改交易日' }}</button>
            <button class="mini danger" @click="removeTimeAlert(t.id)">删除</button>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="!timeAlerts.length" class="empty">还没有定时提醒，下面加一条。</div>

    <div class="add-row">
      <input type="time" v-model="newTime" />
      <input class="label-input" v-model="newLabel" maxlength="40" placeholder="提醒内容，如：决定今天是否过夜" />
      <button class="primary" @click="addTimeAlert">＋ 添加</button>
    </div>

    <div v-if="editing" class="editor">
      <h3>{{ isNew ? '新建规则' : '编辑规则' }}</h3>
      <form @submit.prevent="save">
        <label>范围
          <select v-model="editing.scope">
            <option value="global">全局（全部自选）</option>
            <option value="security">单只标的</option>
          </select>
        </label>
        <label v-if="editing.scope === 'security'">
          标的
          <select v-model="editing.secId">
            <option v-for="w in watchlist" :key="w.secId" :value="w.secId">{{ w.name }} ({{ w.code }})</option>
          </select>
        </label>
        <label>指标
          <select v-model="editing.metric">
            <option value="changePct">涨跌幅 %</option>
            <option value="price">价格（元）</option>
            <option value="volumeMultiple">成交量倍数（相对近5日均量）</option>
            <option value="streakUp">连涨天数</option>
            <option value="streakDown">连跌天数</option>
          </select>
        </label>
        <label>条件
          <select v-model="editing.op">
            <option value="absAbove">绝对值达到 ±</option>
            <option value="above">高于 / 达到</option>
            <option value="below">低于</option>
          </select>
        </label>
        <label>阈值{{ editing.metric === 'streakUp' || editing.metric === 'streakDown' ? '（天）' : editing.metric === 'volumeMultiple' ? '（倍）' : '' }}
          <input v-model.number="editing.threshold" type="number" step="0.1" min="0.1" :max="editing.metric === 'changePct' ? 20 : 100" required />
        </label>
        <label>冷却
          <select v-model="editing.cooldown">
            <option value="oncePerDay">当日同向一次</option>
            <option value="minutes:30">30 分钟</option>
          </select>
        </label>
        <div class="btns">
          <button class="primary" type="submit">保存</button>
          <button type="button" @click="editing = null; isNew = false">取消</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { api } from '../../api'
import type { AlertRule, WatchItem, TimeAlert } from '@shared/index'

const rules = ref<AlertRule[]>([])
const watchlist = ref<WatchItem[]>([])
const editing = ref<Partial<AlertRule> | null>(null)
const isNew = ref(false)
const timeAlerts = ref<TimeAlert[]>([])
const newTime = ref('09:25')
const newLabel = ref('')

onMounted(async () => {
  rules.value = await api.rulesList()
  watchlist.value = await api.watchlistList()
  timeAlerts.value = await api.timeAlertsList()
})

/** ref 元素是 Proxy，IPC 结构化克隆会报错，统一转普通对象 */
function plain<T>(v: T): T { return JSON.parse(JSON.stringify(v)) as T }

async function reloadTimeAlerts(): Promise<void> { timeAlerts.value = await api.timeAlertsList() }

async function saveTimeAlert(t: TimeAlert): Promise<void> {
  try { await api.timeAlertsUpsert(plain(t)) } catch (e) { alert('保存失败：' + (e as Error).message) }
  await reloadTimeAlerts()
}
async function toggleTimeAlert(t: TimeAlert): Promise<void> {
  await saveTimeAlert({ ...plain(t), enabled: !t.enabled })
}
async function toggleTimeDay(t: TimeAlert): Promise<void> {
  await saveTimeAlert({ ...plain(t), workdayOnly: !t.workdayOnly })
}
async function removeTimeAlert(id: string): Promise<void> {
  await api.timeAlertsDelete(id)
  await reloadTimeAlerts()
}
async function addTimeAlert(): Promise<void> {
  const label = newLabel.value.trim() || '看盘'
  if (!newTime.value) return
  await api.timeAlertsUpsert({
    id: `time-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    time: newTime.value, label, enabled: true, workdayOnly: true,
  })
  newLabel.value = ''
  await reloadTimeAlerts()
}

function newRule(): void {
  isNew.value = true
  editing.value = {
    id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    scope: 'global', metric: 'changePct', op: 'absAbove',
    threshold: 3, cooldown: 'oncePerDay', enabled: true,
  }
}

/** 编辑现有规则：加载其字段到表单 */
function editRule(r: AlertRule): void {
  isNew.value = false
  editing.value = { ...r }
}

async function save(): Promise<void> {
  if (!editing.value) return
  try {
    // 必须转普通对象：Vue ref 是 Proxy，IPC 结构化克隆会报
    // "An object could not be cloned"；id 由 newRule 预生成。
    const plain = JSON.parse(JSON.stringify(editing.value)) as AlertRule
    if (!plain.id) plain.id = `rule-${Date.now()}`
    await api.rulesUpsert(plain)
    rules.value = await api.rulesList()
    editing.value = null
  } catch (e) {
    alert('保存失败：' + (e as Error).message)
  }
}

async function remove(id: string): Promise<void> {
  await api.rulesDelete(id)
  rules.value = rules.value.filter((r) => r.id !== id)
}

async function toggle(r: AlertRule): Promise<void> {
  const plain = JSON.parse(JSON.stringify(r)) as AlertRule
  await api.rulesUpsert({ ...plain, enabled: !plain.enabled })
  rules.value = await api.rulesList()
}

function nameOf(secId: string): string {
  return watchlist.value.find((w) => w.secId === secId)?.name ?? secId
}
function cooldownLabel(cooldown: string): string {
  if (cooldown === 'oncePerDay') return '当日同向一次'
  const match = /^minutes:(\d+)$/.exec(cooldown)
  if (match) return `${Number(match[1])} 分钟`
  return cooldown
}
function metricLabel(m: string): string {
  const map: Record<string, string> = {
    changePct: '涨跌幅', price: '价格', volumeMultiple: '成交量倍数',
    streakUp: '连涨天数', streakDown: '连跌天数',
  }
  return map[m] ?? m
}
function unitOf(m: string): string {
  if (m === 'changePct') return '%'
  if (m === 'volumeMultiple') return ' 倍'
  if (m === 'streakUp' || m === 'streakDown') return ' 天'
  return ''
}
function opLabel(o: string): string {
  return o === 'absAbove' ? '|值|≥' : o === 'above' ? '≥' : '<'
}
</script>

<style scoped>
.page-head { display: flex; align-items: center; justify-content: space-between; gap: 16px; margin-bottom: 6px; }
.page-title { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
.page-title h1 { font-size: 15px; font-weight: 600; color: var(--text); margin: 0; }
.page-title .count { font-size: 11px; color: var(--text-tertiary); }
.hint { font-size: 11px; color: var(--text-tertiary); line-height: 1.6; margin: 0 0 16px; }
button.primary {
  background: var(--accent); border: none; color: #ffffff; border-radius: 7px; padding: 7px 14px;
  cursor: pointer; font-weight: 600; transition: background .15s;
  flex: none;          /* 关键：不允许被同级说明文字压缩 */
  white-space: nowrap;
}
button.primary:hover { background: var(--accent-hover); }
.rules-table { width: 100%; border-collapse: collapse; font-size: 13px; background: var(--surface); border-radius: 8px; overflow: hidden; }
.rules-table th, .rules-table td { padding: 9px 12px; border-bottom: 1px solid var(--border-soft); text-align: left; }
.rules-table th:last-child, .rules-table td:last-child { text-align: right; }
.rules-table th { color: var(--text-secondary); font-weight: 600; font-size: 11px; background: var(--surface); }
.rules-table tr:last-child td { border-bottom: none; }
.rules-table tbody tr:hover { background: var(--hover); }
.mono { font-family: 'SF Mono', Consolas, monospace; }
.editor {
  margin-top: 20px; background: var(--surface); border: 1px solid var(--border); border-radius: 10px;
  padding: 18px; max-width: 460px; box-shadow: 0 2px 8px rgba(0,0,0,0.04);
}
.editor h3 { font-size: 14px; font-weight: 600; margin-bottom: 14px; }
.editor form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.editor label { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: var(--text-secondary); font-weight: 600; }
.editor select, .editor input {
  padding: 6px 9px; border-radius: 6px; border: 1px solid var(--border); background: var(--surface); color: var(--text); font-size: 13px;
}
.editor select:focus, .editor input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(11,100,214,0.15); }
.btns { grid-column: 1 / -1; display: flex; gap: 8px; margin-top: 8px; }
button {
  background: var(--surface); border: 1px solid var(--border); color: var(--text); border-radius: 6px;
  padding: 6px 14px; cursor: pointer; font-size: 13px;
}
button:hover { background: var(--hover); }
.mini {
  padding: 3px 10px; font-size: 11px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); cursor: pointer;
}
.mini:hover { background: var(--hover); }
.mini.danger { color: #e2493b; }
.mini.danger:hover { background: rgba(226,73,59,.1); border-color: rgba(226,73,59,.4); }
.ops { white-space: nowrap; }
.ops .mini + .mini { margin-left: 6px; }
.state-pill { font-size: 11px; padding: 2px 9px; border-radius: 10px; background: var(--bg); color: var(--text-tertiary); white-space: nowrap; }
.state-pill.on { background: rgba(29,185,84,.12); color: #1db954; }
.empty { padding: 26px 0; text-align: center; font-size: 12px; color: var(--text-tertiary); }
.section-head { display: flex; align-items: baseline; gap: 8px; margin: 28px 0 6px; }
.section-head h2 { font-size: 15px; font-weight: 600; color: var(--text); margin: 0; }
.section-head .count { font-size: 11px; color: var(--text-tertiary); }
.inline-input {
  width: 100%; padding: 4px 8px; border: 1px solid transparent; border-radius: 6px;
  background: transparent; color: var(--text); font-size: 13px;
}
.inline-input:hover { border-color: var(--border); }
.inline-input:focus { outline: none; border-color: var(--accent); background: var(--surface); }
.add-row { display: flex; align-items: center; gap: 10px; margin-top: 14px; }
.add-row input {
  padding: 6px 9px; border: 1px solid var(--border); border-radius: 6px;
  background: var(--surface); color: var(--text); font-size: 13px;
}
.add-row .label-input { flex: 1; max-width: 340px; }
</style>
