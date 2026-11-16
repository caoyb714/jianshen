import { test, expect } from '@playwright/test'
test('five routes render, no overflow or runtime error', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  for (const [route, title] of [
    ['/', '慢慢来，也在变好。'],
    ['/training', '把时间留给身体。'],
    ['/records', '留住身体的小变化。'],
    ['/growth', '每一点，都算进步。'],
    ['/me', '照顾自己，从了解开始。'],
  ]) {
    await page.goto(route)
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  }
  expect(errors).toEqual([])
})
test('water saves locally and survives refresh', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: '记录 250 ml 饮水' }).click()
  await expect(page.getByRole('status')).toContainText('已保存到本机')
  await page.reload()
  await expect(page.getByTestId('water-total')).toContainText('1,000')
})
test('training writes actual completed exercise history', async ({ page }) => {
  await page.goto('/training/full')
  await page.getByRole('button', { name: '开始体验训练' }).click()
  await page.getByLabel('椅子坐站已完成').check()
  await page.getByRole('button', { name: '结束并填写反馈' }).click()
  await page.getByRole('button', { name: '保存本机训练记录' }).click()
  await expect(page).toHaveURL(/records/)
  await expect(page.getByText('部分完成').first()).toBeVisible()
})
test('discomfort stops activity and is saved explicitly', async ({ page }) => {
  await page.goto('/training/full')
  await page.getByRole('button', { name: '开始体验训练' }).click()
  await page.getByRole('button', { name: '身体不适，停止训练' }).click()
  await expect(page.getByRole('alert')).toContainText('停止')
  await page.getByRole('button', { name: '保存本机训练记录' }).click()
  await expect(page.getByText('因不适停止').first()).toBeVisible()
})
test('settings hide weight and clear history with confirmation', async ({ page }) => {
  await page.goto('/me')
  await page.getByRole('switch', { name: '显示体重记录' }).click()
  await page.goto('/records')
  await expect(page.getByLabel('体重（kg）')).toBeVisible()
  await page.goto('/me')
  await page.getByRole('switch', { name: '显示体重记录' }).click()
  await page.getByRole('button', { name: '清空本机记录' }).click()
  await page.getByRole('button', { name: '确认清空' }).click()
  await page.goto('/records')
  await expect(page.getByLabel('体重（kg）')).toHaveCount(0)
  await expect(page.getByText('还没有训练记录')).toBeVisible()
})
test('profile requires restriction confirmation and preserves edits', async ({ page }) => {
  await page.goto('/me')
  await page.getByRole('button', { name: '编辑身体档案' }).click()
  await page.getByLabel('昵称').fill('测试档案')
  await page.getByLabel('我已检查并确认上述身体限制').uncheck()
  await page.getByRole('button', { name: '保存本机档案' }).click()
  await expect(page.getByText('请主动确认身体限制')).toBeVisible()
  await page.getByLabel('我已检查并确认上述身体限制').check()
  await page.getByRole('button', { name: '保存本机档案' }).click()
  await page.reload()
  await expect(page.getByRole('heading', { name: '测试档案' })).toBeVisible()
})
test('export produces versioned demo JSON', async ({ page }) => {
  await page.goto('/me')
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出本机数据' }).click()
  expect((await download).suggestedFilename()).toMatch(/^herfit-demo-.*\.json$/)
})
test('midnight water increments the new day without copying yesterday', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-16T23:59:59') })
  await page.goto('/')
  await page.clock.setSystemTime(new Date('2026-11-17T00:00:01'))
  await page.getByRole('button', { name: '记录 250 ml 饮水' }).click()
  await page.reload()
  await expect(page.getByTestId('water-total')).toContainText('250')
})
test('stopped workout can correct invalid numbers without removing discomfort', async ({
  page,
}) => {
  await page.goto('/training/full')
  await page.getByRole('button', { name: '开始体验训练' }).click()
  await page.getByLabel('椅子坐站已完成').check()
  await page.getByLabel('重量（kg）', { exact: true }).first().fill('')
  await page.getByRole('button', { name: '身体不适，停止训练' }).click()
  await page.getByRole('button', { name: '保存本机训练记录' }).click()
  await expect(page.getByText('请检查实际组数、次数和重量', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '修正动作记录' }).click()
  await page.getByLabel('重量（kg）', { exact: true }).first().fill('0')
  await page.getByRole('button', { name: '返回训练反馈' }).click()
  await expect(page.getByRole('checkbox', { name: '训练中有疼痛、头晕或其他不适' })).toBeChecked()
  await page.getByRole('button', { name: '保存本机训练记录' }).click()
  await expect(page.getByText('因不适停止').first()).toBeVisible()
})
test('restriction confirmation is explicit and invalidates when limits change', async ({
  page,
}) => {
  await page.goto('/me')
  await page.getByRole('button', { name: '编辑身体档案' }).click()
  const check = page.getByLabel('我已检查并确认上述身体限制')
  await expect(check).not.toBeChecked()
  await check.check()
  await page.getByLabel('伤病和运动限制（如无，请留空）').fill('示例限制')
  await expect(check).not.toBeChecked()
})
