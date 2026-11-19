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
          <td>
            <span v-if="r.id === 'discipline-chase'" class="tag-sys">交易纪律</span>
            <template v-else>{{ r.scope === 'global' ? '—' : nameOf(r.secId!) }}</template>
          </td>
          <td>{{ metricLabel(r.metric) }}</td>
          <td class="mono">{{ r.metric === 'atLimit' ? '触发即报' : `${opLabel(r.op)} ${r.threshold}${unitOf(r.metric)}` }}</td>
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

    <!-- 编辑规则：浮层弹窗。此前是渲染在页面底部的内联卡片，容易被当成页面内容、
         点「编辑」后还要往下滚才看得到，改弹窗后动作和反馈在同一处。 -->
    <transition name="modal">
      <div v-if="editing" class="modal-mask" @click.self="closeEditor" @wheel.prevent.self>
        <div class="modal" role="dialog" aria-modal="true" :aria-label="isNew ? '新建规则' : '编辑规则'">
          <div class="modal-head">
            <h3>{{ isNew ? '新建规则' : '编辑规则' }}</h3>
            <button class="icon-btn" type="button" title="关闭（Esc）" @click="closeEditor">✕</button>
          </div>
          <form ref="formEl" class="modal-body" @submit.prevent="save">
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
                <option value="speedPct">3 分钟急涨急跌 %（异动雷达）</option>
                <option value="atLimit">触及涨停 / 跌停</option>
              </select>
            </label>
            <label>条件
              <select v-model="editing.op" :disabled="editing.metric === 'atLimit'">
                <option value="absAbove">绝对值达到 ±</option>
                <option value="above">高于 / 达到</option>
                <option value="below">低于</option>
              </select>
            </label>
            <label>阈值{{ thresholdUnitHint }}
              <input v-if="editing.metric !== 'atLimit'" v-model.number="editing.threshold" type="number" step="0.1" min="0.1"
                     :max="editing.metric === 'changePct' || editing.metric === 'speedPct' ? 20 : 100" required />
              <input v-else disabled value="无需填写" />
            </label>
            <label>冷却
              <select v-model="editing.cooldown">
                <option value="oncePerDay">当日同向一次</option>
                <option value="minutes:30">30 分钟</option>
              </select>
            </label>
            <p v-if="editing.id === 'discipline-chase'" class="modal-note">
              这是「设置 → 交易纪律」自动同步的防追高规则：改阈值会写回设置页，停用后重启不会被重新打开；把阈值设成 0 或在这里删除即等于关闭该纪律。
            </p>
          </form>
          <div class="modal-foot">
            <button type="button" @click="closeEditor">取消</button>
            <button class="primary" type="button" @click="save">保存</button>
          </div>
        </div>
      </div>
    </transition>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { api } from '../../api'
import type { AlertRule, WatchItem, TimeAlert } from '@shared/index'

const rules = ref<AlertRule[]>([])
const watchlist = ref<WatchItem[]>([])
const editing = ref<Partial<AlertRule> | null>(null)
const isNew = ref(false)
const formEl = ref<HTMLFormElement | null>(null)
const timeAlerts = ref<TimeAlert[]>([])
const newTime = ref('09:25')
const newLabel = ref('')

/** 防追高这条是「设置 → 交易纪律」同步生成的，改它要回写设置，否则重启后会与设置不一致 */
const DISCIPLINE_ID = 'discipline-chase'

/** 阈值输入框的单位后缀 */
const thresholdUnitHint = computed(() => {
  const m = editing.value?.metric
  if (m === 'streakUp' || m === 'streakDown') return '（天）'
  if (m === 'volumeMultiple') return '（倍）'
  if (m === 'changePct' || m === 'speedPct') return '（%）'
  if (m === 'atLimit') return ''
  return '（元）'
})

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
  focusEditor()
}

/** 编辑现有规则：加载其字段到表单 */
function editRule(r: AlertRule): void {
  isNew.value = false
  editing.value = { ...r }
  focusEditor()
}

/** 弹窗打开后把焦点放进第一个可操作控件，方便纯键盘改完回车保存 */
function focusEditor(): void {
  void nextTick(() => {
    const el = formEl.value?.querySelector<HTMLElement>('select, input')
    el?.focus()
  })
}

function closeEditor(): void {
  editing.value = null
  isNew.value = false
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape' && editing.value) {
    e.preventDefault()
    closeEditor()
  }
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))

async function save(): Promise<void> {
  if (!editing.value) return
  try {
    // 必须转普通对象：Vue ref 是 Proxy，IPC 结构化克隆会报
    // "An object could not be cloned"；id 由 newRule 预生成。
    const plain = JSON.parse(JSON.stringify(editing.value)) as AlertRule
    if (!plain.id) plain.id = `rule-${Date.now()}`
    // 触及涨跌停是开关型信号：不读阈值，但 DB/IPC 要求 >= 0.1，统一存 1
    if (plain.metric === 'atLimit') { plain.threshold = 1; plain.op = 'above' }
    // 防追高规则与「设置 → 交易纪律」是同一份数据：改阈值要写回设置，
    // 否则主进程启动时会用设置里的旧值把它覆盖掉。
    if (plain.id === DISCIPLINE_ID) {
      await api.settingsSet({ chaseHighPct: plain.metric === 'changePct' ? Number(plain.threshold) : 0 })
    }
    await api.rulesUpsert(plain)
    rules.value = await api.rulesList()
    closeEditor()
  } catch (e) {
    alert('保存失败：' + (e as Error).message)
  }
}

async function remove(id: string): Promise<void> {
  // 删掉防追高规则等同于关闭该纪律，否则下次启动会被同步逻辑重新建出来
  if (id === DISCIPLINE_ID) await api.settingsSet({ chaseHighPct: 0 })
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
    speedPct: '3 分钟涨速', atLimit: '涨跌停',
  }
  return map[m] ?? m
}
function unitOf(m: string): string {
  if (m === 'changePct' || m === 'speedPct') return '%'
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
/* ---------- 规则编辑弹窗 ---------- */
.modal-mask {
  position: fixed; inset: 0; z-index: 100;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  background: rgba(0, 0, 0, .32);
}
.modal {
  width: 520px; max-width: 100%; max-height: 100%;
  display: flex; flex-direction: column;
  background: var(--surface); border: 1px solid var(--border-soft); border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, .28);
  overflow: hidden;
  animation: modal-pop .16s ease-out;
}
@keyframes modal-pop {
  from { opacity: 0; transform: translateY(8px) scale(.985); }
  to { opacity: 1; transform: none; }
}
.modal-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: 1px solid var(--border-soft);
}
.modal-head h3 { font-size: 14px; font-weight: 600; color: var(--text); margin: 0; }
.icon-btn {
  border: none; background: transparent; color: var(--text-tertiary);
  font-size: 13px; line-height: 1; padding: 5px 7px; border-radius: 6px; cursor: pointer;
}
.icon-btn:hover { background: var(--hover); color: var(--text); }
.modal-body {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  padding: 18px; overflow: auto;
}
.modal-body label { display: flex; flex-direction: column; gap: 5px; font-size: 11px; color: var(--text-secondary); font-weight: 600; }
.modal-body select, .modal-body input {
  padding: 6px 9px; border-radius: 6px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); font-size: 13px; min-width: 0;
}
.modal-body select:focus, .modal-body input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px rgba(11,100,214,0.15); }
.modal-note {
  grid-column: 1 / -1; margin: 2px 0 0; padding: 9px 11px;
  font-size: 11px; line-height: 1.65; color: var(--text-secondary);
  background: var(--bg); border-radius: 8px;
}
.modal-foot {
  display: flex; justify-content: flex-end; gap: 8px;
  padding: 12px 18px; border-top: 1px solid var(--border-soft); background: var(--surface);
}
.modal-enter-active, .modal-leave-active { transition: opacity .14s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
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
.tag-sys { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: rgba(255,159,10,.14); color: #d98500; white-space: nowrap; }
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
