(async () => {
  const out = { steps: [] }
  // 切到提醒规则 tab
  const tab = [...document.querySelectorAll('.nav button')].find((b) => b.textContent.includes('提醒规则'))
  if (tab) tab.click()
  await new Promise((r) => setTimeout(r, 300))
  out.steps.push('rules count before: ' + document.querySelectorAll('.rules-table tbody tr').length)

  // 点新建规则
  const newBtn = [...document.querySelectorAll('.toolbar button')].find((b) => b.textContent.includes('新建规则'))
  if (!newBtn) return JSON.stringify({ error: 'no new button' })
  newBtn.click()
  await new Promise((r) => setTimeout(r, 200))
  out.steps.push('editor shown: ' + !!document.querySelector('.editor'))
  out.steps.push('editor title: ' + document.querySelector('.editor h3')?.textContent)

  // 改阈值
  const input = document.querySelector('.editor input[type=number]')
  if (input) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, '7.5')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    input.dispatchEvent(new Event('change', { bubbles: true }))
  }
  await new Promise((r) => setTimeout(r, 100))

  // 点保存
  const saveBtn = [...document.querySelectorAll('.editor button')].find((b) => b.textContent.includes('保存'))
  if (!saveBtn) return JSON.stringify({ error: 'no save button' })
  saveBtn.click()
  await new Promise((r) => setTimeout(r, 500))

  const after = await window.petApi.rulesList()
  out.steps.push('rules after save: ' + JSON.stringify(after.map((r) => `${r.threshold}/${r.op}`)))
  out.steps.push('editor closed: ' + !document.querySelector('.editor'))
  out.steps.push('edit buttons: ' + [...document.querySelectorAll('.rules-table .mini')].filter((b) => b.textContent === '编辑').length)

  // 点最后一条的编辑按钮
  const editBtns = [...document.querySelectorAll('.rules-table .mini')].filter((b) => b.textContent === '编辑')
  if (editBtns.length > 0) {
    editBtns[editBtns.length - 1].click()
    await new Promise((r) => setTimeout(r, 200))
    out.steps.push('edit title: ' + document.querySelector('.editor h3')?.textContent)
    out.steps.push('edit threshold value: ' + document.querySelector('.editor input[type=number]')?.value)
  }
  return JSON.stringify(out, null, 2)
})()
