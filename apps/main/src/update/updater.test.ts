/** 更新检查的纯函数单测：版本比较、安装包匹配、Release → UpdateInfo */
import assert from 'node:assert/strict'
import {
  compareVersions, normalizeVersion, pickAsset, isInstallable,
  toUpdateInfo, failedUpdateInfo, assetCandidates, parseLatestTag,
  parseAtomLatest, assetNameCandidates,
} from './updater.ts'

// 版本号归一
assert.equal(normalizeVersion('v0.2.2'), '0.2.2')
assert.equal(normalizeVersion(' 0.2.2 '), '0.2.2')
assert.equal(normalizeVersion('V1.0.0'), '1.0.0')

// 逐段数字比较：字符串比较会把 0.2.10 判成小于 0.2.9
assert.equal(compareVersions('0.2.10', '0.2.9'), 1)
assert.equal(compareVersions('0.3.0', '0.2.9'), 1)
assert.equal(compareVersions('1.0.0', '0.9.9'), 1)
assert.equal(compareVersions('0.2.2', '0.2.2'), 0)
assert.equal(compareVersions('v0.2.2', '0.2.2'), 0)
assert.equal(compareVersions('1.2', '1.2.0'), 0)
assert.equal(compareVersions('0.1.9', '0.2.0'), -1)

// 安装包匹配：与 CI 的 artifactName 对应
const assets = [
  { name: 'PandaDingDing-0.3.0-win-x64-portable.exe', size: 1, browser_download_url: 'u1' },
  { name: 'PandaDingDing-0.3.0-win-x64-nsis.exe', size: 2, browser_download_url: 'u2' },
  { name: 'PandaDingDing-0.3.0-mac-arm64.dmg', size: 3, browser_download_url: 'u3' },
  { name: 'PandaDingDing-0.3.0-mac-x64.dmg', size: 4, browser_download_url: 'u4' },
  { name: 'PandaDingDing-0.3.0-linux-x64.AppImage', size: 5, browser_download_url: 'u5' },
  { name: 'PandaDingDing-0.3.0-linux-x64.deb', size: 6, browser_download_url: 'u6' },
]
assert.deepEqual(assetCandidates('win32', 'x64'), ['-win-x64-nsis.exe', '-win-x64-portable.exe'])
assert.equal(pickAsset(assets, 'win32', 'x64')?.url, 'u2')      // 优先 NSIS 安装版
assert.equal(pickAsset(assets, 'darwin', 'arm64')?.url, 'u3')
assert.equal(pickAsset(assets, 'darwin', 'x64')?.url, 'u4')
// Linux 产物被 electron-builder 改写成 x86_64 / amd64，两种命名都要能匹配
const linuxReal = [
  { name: 'PandaDingDing-0.3.0-linux-x86_64.AppImage', size: 1, browser_download_url: 'a' },
  { name: 'PandaDingDing-0.3.0-linux-amd64.deb', size: 2, browser_download_url: 'b' },
]
assert.equal(pickAsset(linuxReal, 'linux', 'x64')?.url, 'a')
assert.equal(pickAsset(assets, 'linux', 'x64')?.url, 'u5')      // 老命名 -linux-x64.AppImage 也认
assert.equal(pickAsset(assets, 'win32', 'arm64'), null)          // 没有对应架构就是 null

// 只有 Windows 的 NSIS 能静默安装
assert.equal(isInstallable({ name: 'a-win-x64-nsis.exe', size: 1, url: 'u' }, 'win32'), true)
assert.equal(isInstallable({ name: 'a-win-x64-portable.exe', size: 1, url: 'u' }, 'win32'), false)
assert.equal(isInstallable({ name: 'a-mac-arm64.dmg', size: 1, url: 'u' }, 'darwin'), false)
assert.equal(isInstallable(null, 'win32'), false)

// Release → UpdateInfo
const info = toUpdateInfo({
  release: {
    tag_name: 'v0.3.0',
    published_at: '2026-11-20T00:00:00Z',
    html_url: 'https://github.com/mycgb/PandaDingDing/releases/tag/v0.3.0',
    body: '  更新内容  ',
    assets,
  },
  current: '0.2.2',
  platform: 'win32',
  arch: 'x64',
  checkedAt: 123,
})
assert.equal(info.current, '0.2.2')
assert.equal(info.latest, '0.3.0')
assert.equal(info.hasUpdate, true)
assert.equal(info.installable, true)
assert.equal(info.asset?.name, 'PandaDingDing-0.3.0-win-x64-nsis.exe')
assert.equal(info.notes, '更新内容')
assert.equal(info.error, null)

// Release 说明去掉 markdown 标记，列表用「·」代替「-」
const md = toUpdateInfo({
  release: { tag_name: 'v0.3.0', body: '## 新增\n- **托盘温度条开关** — 右键即可\n' },
  current: '0.2.2', platform: 'win32', arch: 'x64', checkedAt: 1,
})
assert.equal(md.notes, '新增\n· 托盘温度条开关 — 右键即可')

// CI 自动生成的样板（构建时间 / 提交号 / 下载清单）不能混进升级卡片
const boiler = toUpdateInfo({
  release: {
    tag_name: 'v0.3.0',
    body: [
      'PandaDingDing · 熊猫盯盯  0.3.0',
      '',
      '构建时间：2026-11-20 00:00 UTC',
      '提交：`abcdef1`',
      '',
      '## 更新内容',
      '',
      '_v0.2.2 → v0.3.0_',
      '',
      '- feat: 提醒动作强化',
      '- fix: 托盘菜单点不开',
      '',
      '## 下载',
      '',
      '- Windows 安装版 (NSIS) — [a.exe](https://x/a.exe)（130 MB）',
      '',
      '> 行情数据仅供参考，不构成投资建议。',
    ].join('\n'),
  },
  current: '0.2.2', platform: 'win32', arch: 'x64', checkedAt: 1,
})
assert.ok(!boiler.notes.includes('构建时间'), boiler.notes ?? '')
assert.ok(!boiler.notes.includes('提交：'), boiler.notes ?? '')
assert.ok(!boiler.notes.includes('下载'), boiler.notes ?? '')
assert.ok(!boiler.notes.includes('不构成投资建议'), boiler.notes ?? '')
assert.ok(boiler.notes.includes('· feat: 提醒动作强化'), boiler.notes ?? '')
assert.ok(boiler.notes.includes('· fix: 托盘菜单点不开'), boiler.notes ?? '')

// 同版本 / 更旧的 Release：不算更新，且不能带出安装包（否则可能被降级重装）
const same = toUpdateInfo({
  release: { tag_name: 'v0.2.2', assets }, current: '0.2.2', platform: 'win32', arch: 'x64', checkedAt: 1,
})
assert.equal(same.hasUpdate, false)
assert.equal(same.asset, null)
assert.equal(same.installable, false)
const older = toUpdateInfo({
  release: { tag_name: 'v0.2.1', assets }, current: '0.2.2', platform: 'win32', arch: 'x64', checkedAt: 1,
})
assert.equal(older.hasUpdate, false)
assert.equal(older.asset, null)

// 检查失败：保留上次结果，只记录错误
const failed = failedUpdateInfo({ current: '0.2.2', error: 'GitHub HTTP 403', checkedAt: 9, previous: info })
assert.equal(failed.error, 'GitHub HTTP 403')
assert.equal(failed.latest, '0.3.0')
assert.equal(failed.hasUpdate, true)
const noPrev = failedUpdateInfo({ current: '0.2.2', error: 'offline', checkedAt: 9 })
assert.equal(noPrev.hasUpdate, false)
assert.equal(noPrev.latest, null)

// atom 兜底：从 releases.atom 第一条 entry 取 tag / 时间 / 正文
assert.equal(parseLatestTag('https://github.com/mycgb/PandaDingDing/releases/tag/v0.2.2'), 'v0.2.2')
assert.equal(parseLatestTag('https://github.com/o/r/releases/tag/v1.0.0-beta.1'), 'v1.0.0-beta.1')
assert.equal(parseLatestTag('https://github.com/o/r/releases'), null)
assert.equal(parseLatestTag(null), null)

const atom = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Release notes from PandaDingDing</title>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.3.0</id>
    <updated>2026-11-20T01:02:03Z</updated>
    <link rel="alternate" type="text/html" href="https://github.com/mycgb/PandaDingDing/releases/tag/v0.3.0"/>
    <title>PandaDingDing 0.3.0</title>
    <content type="html">&lt;h2&gt;新增&lt;/h2&gt;
&lt;ul&gt;
&lt;li&gt;&lt;strong&gt;提醒动作&lt;/strong&gt; — 抓狂抖动&lt;/li&gt;
&lt;/ul&gt;</content>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.2.2</id>
    <link rel="alternate" type="text/html" href="https://github.com/mycgb/PandaDingDing/releases/tag/v0.2.2"/>
  </entry>
</feed>`
const atomLatest = parseAtomLatest(atom)
assert.equal(atomLatest?.tag, 'v0.3.0')                          // 只认第一条
assert.equal(atomLatest?.publishedAt, '2026-11-20T01:02:03Z')
assert.equal(atomLatest?.notes, '新增\n\n· 提醒动作 — 抓狂抖动')     // HTML 解码 + 去标签（标题后保留空行）
assert.equal(parseAtomLatest('<feed></feed>'), null)

// atom 兜底拿不到资产列表：按命名规则拼出候选文件名，交给 HEAD 探测
assert.deepEqual(assetNameCandidates('0.3.0', 'win32', 'x64'), [
  'PandaDingDing-0.3.0-win-x64-nsis.exe',
  'PandaDingDing-0.3.0-win-x64-portable.exe',
])
assert.deepEqual(assetNameCandidates('v0.3.0', 'darwin', 'arm64'), [
  'PandaDingDing-0.3.0-mac-arm64.dmg',
  'PandaDingDing-0.3.0-mac-arm64.zip',
])
assert.deepEqual(assetNameCandidates('0.3.0', 'linux', 'x64'), [
  'PandaDingDing-0.3.0-linux-x86_64.AppImage',
  'PandaDingDing-0.3.0-linux-x64.AppImage',
  'PandaDingDing-0.3.0-linux-amd64.AppImage',
  'PandaDingDing-0.3.0-linux-amd64.deb',
  'PandaDingDing-0.3.0-linux-x64.deb',
])

// atom 兜底 + HEAD 探测出来的单个资产，也能走通「可静默安装」判断
const atomInfo = toUpdateInfo({
  release: {
    tag_name: 'v0.3.0',
    html_url: 'https://github.com/mycgb/PandaDingDing/releases/tag/v0.3.0',
    body: atomLatest?.notes,
    assets: [{ name: assetNameCandidates('0.3.0', 'win32', 'x64')[0], size: 136676304, browser_download_url: 'https://github.com/x/y/releases/download/v0.3.0/a.exe' }],
  },
  current: '0.2.2', platform: 'win32', arch: 'x64', checkedAt: 5,
})
assert.equal(atomInfo.hasUpdate, true)
assert.equal(atomInfo.installable, true)
assert.equal(atomInfo.notes, '新增\n\n· 提醒动作 — 抓狂抖动')

console.log('updater: all tests passed')
