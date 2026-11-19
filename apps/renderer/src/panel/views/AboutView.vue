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
  </section>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '../../api'

// 版本号由主进程 app.getVersion() 提供（打包后读 app.asar 内的 package.json），
// 避免像以前那样写死字符串、发版后关于页仍显示旧版本。
const version = ref('0.2.0')
onMounted(() => {
  api.appVersion().then((v) => { if (v) version.value = v }).catch(() => { /* 读不到就用兜底 */ })
})
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
</style>
