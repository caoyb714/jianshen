import { test, expect, type Page } from '@playwright/test'

/** 把每周天数改成 7 并生成计划，这样任意日期都有训练可做，测试不依赖运行当天是星期几。 */
async function ensurePlan(page: Page) {
  await page.goto('/me')
  await page.getByRole('button', { name: '编辑身体档案' }).click()
  await page.getByLabel('每周可安排天数').fill('7')
  // 档案表单要求每次编辑都重新确认身体限制，否则保存会被拦下
  await page.getByLabel('我已检查并确认上述身体限制').check()
  await page.getByRole('button', { name: '保存本机档案' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.goto('/training')
  await page.getByRole('button', { name: '生成我的计划' }).click()
  await page.getByRole('button', { name: '确认使用此计划' }).click()
  await expect(page.getByRole('link', { name: '开始今天的训练' })).toBeVisible()
}

async function startSession(page: Page) {
  await ensurePlan(page)
  await page.getByRole('link', { name: '开始今天的训练' }).click()
  await page.getByRole('button', { name: '开始今天的训练' }).click()
  await expect(page.getByText('本次训练')).toBeVisible()
}

test('five routes render, no overflow or runtime error', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  for (const [route, title] of [
    ['/', '慢慢来，也在变好。'],
    ['/training', '把时间留给身体。'],
    ['/exercises', '动作库'],
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

test('generates a rule-based plan and records per-set work', async ({ page }) => {
  await startSession(page)
  // 计划由固定规则生成：同一档案两次生成结果一致
  const first = await page.locator('.exercise-row h2').allInnerTexts()
  expect(first.length).toBeGreaterThan(2)

  await page
    .getByRole('button', { name: /第 1 组完成/ })
    .first()
    .click()
  await expect(page.getByText('组间休息')).toBeVisible()
  await page.getByRole('button', { name: '结束并填写反馈' }).click()
  await page.getByRole('button', { name: '保存本机训练记录' }).click()
  await expect(page).toHaveURL(/records/)
  await expect(page.getByText('部分完成').first()).toBeVisible()
  await page.locator('.history-row summary').first().click()
  await expect(page.getByText(/1 组 · \d+ 次/).first()).toBeVisible()
})

test('completing every set marks the session complete', async ({ page }) => {
  await startSession(page)
  const sets = page.getByRole('button', { name: /第 \d+ 组完成/ })
  const total = await sets.count()
  for (let i = 0; i < total; i += 1) await sets.nth(i).click()
  await page.getByRole('button', { name: '结束并填写反馈' }).click()
  await page.getByRole('button', { name: '保存本机训练记录' }).click()
  await expect(page.getByText('已完成').first()).toBeVisible()
})

test('discomfort stops activity and is saved explicitly', async ({ page }) => {
  await startSession(page)
  await page.getByRole('button', { name: '身体不适，停止训练' }).click()
  await expect(page.getByRole('alert')).toContainText('停止')
  await page.getByRole('button', { name: '保存本机训练记录' }).click()
  await expect(page.getByText('因不适停止').first()).toBeVisible()
})

test('deletes a single workout record only after confirmation', async ({ page }) => {
  await startSession(page)
  await page
    .getByRole('button', { name: /第 1 组完成/ })
    .first()
    .click()
  await page.getByRole('button', { name: '结束并填写反馈' }).click()
  await page.getByRole('button', { name: '保存本机训练记录' }).click()
  await expect(page).toHaveURL(/records/)

  const rows = page.locator('.history-row')
  await expect(rows.first()).toBeVisible()
  const before = await rows.count(),
    first = rows.first()
  await first.locator('summary').click()
  // 先取消：条数不变
  await first.getByRole('button', { name: '删除这条记录' }).click()
  await first.getByRole('button', { name: '取消' }).click()
  await expect(rows).toHaveCount(before)
  // 二次确认后才删除，并写入本机存储
  await first.getByRole('button', { name: '删除这条记录' }).click()
  await first.getByRole('button', { name: '确认删除' }).click()
  await expect(rows).toHaveCount(before - 1)
  await page.reload()
  await expect(rows).toHaveCount(before - 1)
})

test('swaps an exercise mid-session without losing the plan', async ({ page }) => {
  await startSession(page)
  const before = await page.locator('.exercise-row h2').first().innerText()
  await page.getByRole('button', { name: '换个动作' }).first().click()
  await page.getByRole('dialog').getByRole('button').filter({ hasText: '·' }).first().click()
  await expect(page.locator('.exercise-row h2').first()).not.toHaveText(before)
  await expect(page.getByText('已替换').first()).toBeVisible()
})

test('settings hide weight and clear only the current profile records', async ({ page }) => {
  await page.goto('/me')
  await page.getByRole('switch', { name: '显示体重记录' }).click()
  await page.goto('/records')
  await expect(page.getByLabel('体重（kg）')).toBeVisible()
  await page.goto('/me')
  await page.getByRole('switch', { name: '显示体重记录' }).click()
  await page.getByRole('button', { name: '清空当前档案的记录' }).click()
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
  await expect(page.getByRole('heading', { name: /测试档案/ })).toBeVisible()
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

test('a second profile slot can be filled and switched to', async ({ page }) => {
  await page.goto('/me')
  await page.getByRole('button', { name: /档案位 2/ }).click()
  await expect(page.getByRole('heading', { name: '建立档案位 2' })).toBeVisible()
  await page.getByLabel('昵称').fill('另一位')
  await page.getByLabel('我已检查并确认上述身体限制').check()
  await page.getByRole('button', { name: '保存本机档案' }).click()
  await page.goto('/me')
  await expect(page.getByRole('heading', { name: /另一位/ })).toBeVisible()
  await page.getByRole('button', { name: /档案位 1/ }).click()
  await expect(page.getByRole('heading', { name: /小禾/ })).toBeVisible()
})

test('an unconfirmed restriction blocks plan generation', async ({ page }) => {
  await page.goto('/me')
  await page.getByRole('button', { name: '编辑身体档案' }).click()
  await page.getByLabel('我已检查并确认上述身体限制').uncheck()
  await page.getByLabel('伤病和运动限制（如无，请留空）').fill('膝盖不适')
  await page.getByLabel('我已检查并确认上述身体限制').check()
  await page.getByRole('button', { name: '保存本机档案' }).click()
  await page.goto('/training')
  await page.getByRole('button', { name: '生成我的计划' }).click()
  await expect(page.getByText('入门、低冲击')).toBeVisible()
  await expect(page.getByText('不能替代专业评估')).toBeVisible()
})

test('explain failure degrades quietly without touching the plan', async ({ page }) => {
  await ensurePlan(page)
  const week = page.locator('.week-days.week-plan')
  await expect(week).toBeVisible()
  const before = await week.innerText()

  // 本地开发没有 Pages Functions，/api/explain 必然 404：这正是在测降级路径
  await page.getByRole('button', { name: '生成今日说明' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '同意并生成' }).click()
  await expect(page.getByText('暂时无法生成说明，训练计划不受影响。')).toBeVisible()

  // 不弹错误横幅、不改周计划、不拦训练入口
  await expect(page.getByRole('alert')).toHaveCount(0)
  // 用 innerText 精确比对：toHaveText 会把空白折叠，看不出格子结构是否被改动
  expect(await week.innerText()).toBe(before)
  await expect(page.getByRole('link', { name: '开始今天的训练' })).toBeVisible()
  await expect(page.getByRole('button', { name: '重新生成计划' })).toBeVisible()

  // 说明失败后仍可正常进入打卡
  await page.getByRole('link', { name: '开始今天的训练' }).click()
  await page.getByRole('button', { name: '开始今天的训练' }).click()
  await expect(page.getByText('本次训练')).toBeVisible()
})

test('an interrupted session is restored after reload', async ({ page }) => {
  await startSession(page)
  await page
    .getByRole('button', { name: /第 1 组完成/ })
    .first()
    .click()
  const first = await page.locator('.exercise-row h2').first().innerText()
  await page.reload()
  await expect(page.getByText(/已恢复上次未保存的训练/)).toBeVisible()
  await expect(page.locator('.exercise-row h2').first()).toHaveText(first)
  await expect(page.getByRole('button', { name: /第 1 组完成/ }).first()).toHaveAttribute(
    'aria-pressed',
    'true',
  )
})

test('discarding a session removes the draft for good', async ({ page }) => {
  await startSession(page)
  await page
    .getByRole('button', { name: /第 1 组完成/ })
    .first()
    .click()
  await page.getByRole('button', { name: '放弃本次' }).click()
  await page.getByRole('button', { name: '确认放弃' }).click()
  await expect(page.getByRole('button', { name: '开始今天的训练' })).toBeVisible()
  await page.reload()
  await expect(page.getByText(/已恢复上次未保存的训练/)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '开始今天的训练' })).toBeVisible()
})

test('rest duration is adjustable and a skipped exercise survives reload', async ({ page }) => {
  await startSession(page)
  await expect(page.getByLabel('组间休息时长')).toBeVisible()
  await page.getByLabel('组间休息时长').selectOption('30')
  await page.getByRole('button', { name: '今天跳过' }).first().click()
  await expect(page.getByRole('button', { name: '恢复这个动作' }).first()).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '恢复这个动作' }).first()).toBeVisible()
})

test('weekly review states facts on the growth page', async ({ page }) => {
  await page.goto('/growth')
  const panel = page.locator('.review-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('这周练了')
})
