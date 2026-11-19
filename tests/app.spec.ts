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

test('weight is visible by default and keeps the same row when updated', async ({ page }) => {
  await page.goto('/records')
  await expect(page.getByRole('heading', { name: '体重' })).toBeVisible()
  await expect(page.locator('.weight-value strong')).toHaveText('54')

  // 同天更新体重：写入同一行，且不把已有的腰围覆盖掉
  await page.getByRole('button', { name: '更新今天的体重' }).click()
  await page.getByLabel('今天的体重（kg）').fill('55.5')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.weight-value strong')).toHaveText('55.5')
  const saved = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('herfit.demo.v2') ?? '{}')
    return (raw.metrics ?? [])
      .filter((row: { weight: number | null }) => row.weight === 55.5)
      .map((row: { waist: number | null }) => row.waist)
  })
  expect(saved).toEqual([68])

  // 关闭开关：保留标题与壳，但壳内不得出现任何数字
  await page.goto('/me')
  await page.getByRole('switch', { name: '显示体重记录' }).click()
  await page.goto('/records')
  await expect(page.getByRole('heading', { name: '体重' })).toBeVisible()
  await expect(page.getByText('体重记录已隐藏')).toBeVisible()
  await expect(page.locator('.weight-panel')).not.toContainText(/\d/)

  // 重新打开：数据仍在
  await page.goto('/me')
  await page.getByRole('switch', { name: '显示体重记录' }).click()
  await page.goto('/records')
  await expect(page.locator('.weight-value strong')).toHaveText('55.5')

  // 清空当前档案的记录后回到空态
  await page.goto('/me')
  await page.getByRole('button', { name: '清空当前档案的记录' }).click()
  await page.getByRole('button', { name: '确认清空' }).click()
  await page.goto('/records')
  await expect(page.getByText('还没有记录过体重。')).toBeVisible()
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

test('adopting a suggestion stays a draft until the version is generated', async ({ page }) => {
  await ensurePlan(page)

  // 造两次「全部达标、难度不高」的记录：这样规则引擎才会给出可执行的加量建议
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('herfit.demo.v2') ?? '{}')
    const plan = (raw.plans ?? []).find((row: { status: string }) => row.status === 'active')
    const day = plan.days.find((row: { kind: string }) => row.kind === '训练')
    const slot = day.slots.find((row: { role: string }) => row.role === '主要')
    const targetMax = slot.target.type === 'reps' ? slot.target.max : 12
    const iso = (offset: number) => {
      const date = new Date()
      date.setDate(date.getDate() - offset)
      const pad = (value: number) => String(value).padStart(2, '0')
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }
    const make = (offset: number, id: string) => ({
      profileId: plan.profileId,
      id,
      date: iso(offset),
      planId: plan.id,
      planVersion: plan.version,
      title: day.focus,
      minutes: 20,
      difficulty: 6,
      discomfort: false,
      feeling: '',
      createdAt: new Date().toISOString(),
      exercises: [
        {
          exerciseId: slot.exerciseId,
          name: slot.exerciseId,
          role: slot.role,
          plannedSets: 3,
          targetReps: slot.target.type === 'reps' ? slot.target.max : null,
          targetSeconds: slot.target.type === 'hold' ? slot.target.seconds : null,
          replacedFrom: null,
          sets: [
            { reps: targetMax, load: 10, done: true },
            { reps: targetMax, load: 10, done: true },
            { reps: targetMax, load: 10, done: true },
          ],
        },
      ],
    })
    raw.workouts = [
      ...(raw.workouts ?? []),
      make(1, '11111111-1111-4111-8111-111111111111'),
      make(2, '22222222-2222-4222-8222-222222222222'),
    ]
    localStorage.setItem('herfit.demo.v2', JSON.stringify(raw))
  })
  await page.goto('/training')

  const card = page.locator('.adjust-panel')
  await expect(card).toBeVisible()
  const week = page.locator('.week-days.week-plan')
  const before = await week.innerText()

  // 采纳只是进草稿：计划文本与版本都不变
  await card.getByRole('button', { name: '采纳' }).first().click()
  await expect(card.getByText('已采纳 · 下次生成计划时应用').first()).toBeVisible()
  await expect(card.getByRole('button', { name: /按 1 条建议生成新版本/ })).toBeVisible()
  expect(await week.innerText()).toBe(before)

  // 本地开发没有 Functions，/api/explain 必然 404：理由位降级，幅度与采纳不受影响
  await card.getByRole('button', { name: '生成理由' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '同意并生成' }).click()
  await expect(card.getByRole('button', { name: '理由暂不可用，再试一次' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(card.getByRole('button', { name: /按 1 条建议生成新版本/ })).toBeVisible()

  // 移出草稿后按钮消失，计划仍未改动
  await card.getByRole('button', { name: '移出本次调整' }).first().click()
  await expect(card.getByRole('button', { name: /按 1 条建议生成新版本/ })).toHaveCount(0)
  expect(await week.innerText()).toBe(before)

  // 采纳可以用键盘完成，读屏会收到播报（按钮是原生 button，Enter 即可）
  const adopt = card.getByRole('button', { name: '采纳' }).first()
  await adopt.focus()
  await page.keyboard.press('Enter')
  await expect(card.locator('.sr-only[role="status"]')).toContainText('已采纳')

  // 真正提交：版本 +1，条目转为已生效
  await card.getByRole('button', { name: /按 1 条建议生成新版本/ }).click()
  await expect(page.getByText(/v2 · 生成于/)).toBeVisible()
  await expect(card.getByText(/已生效 · v2/)).toBeVisible()

  // 刷新后「已生效」与恢复入口都还在：状态存在计划里，不只存在内存里
  await page.reload()
  await expect(page.getByText(/v2 · 生成于/)).toBeVisible()
  await expect(card.getByText(/已生效 · v2/)).toBeVisible()

  // 恢复到 v1 的安排，同样生成新版本（v3），历史不被改写
  await card.getByRole('button', { name: /恢复到 v1 的安排/ }).click()
  await expect(page.getByText(/v3 · 生成于/)).toBeVisible()
  await expect(card.getByText(/已撤销 · v3/)).toBeVisible()
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

test('a single day can be edited without regenerating the week', async ({ page }) => {
  await ensurePlan(page)
  const dayButton = page.locator('.week-plan > button').filter({ hasText: '分' }).first()
  const label = (await dayButton.getAttribute('aria-label'))!.replace('的安排', '')
  await dayButton.click()

  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('heading', { name: label })).toBeVisible()
  // 种子数据已有四周记录，首次生成可能正好是降载周，组数从 1 起步；
  // 所以先加一组再断言，而不是假定初始值一定大于 1
  const sets = dialog.locator('.sets-stepper span').first()
  const before = Number((await sets.innerText()).replace(/\D/g, ''))
  await dialog.getByRole('button', { name: /^增加/ }).first().click()
  await expect(sets).toHaveText(`${before + 1} 组`)

  // 保存只生成新版本，不重排整周
  await dialog.getByRole('button', { name: /保存为 v2/ }).click()
  await expect(page.getByText(/v2 · 生成于/)).toBeVisible()

  // 重新打开同一天：改动已持久化
  await page.getByRole('button', { name: `${label}的安排` }).click()
  await expect(page.getByRole('dialog').locator('.sets-stepper span').first()).toHaveText(
    `${before + 1} 组`,
  )
  await page.getByRole('dialog').getByRole('button', { name: '取消' }).click()

  // 另一天改成休息：同样只动那一天
  const other = page.locator('.week-plan > button').filter({ hasText: '分' }).last()
  const otherLabel = (await other.getAttribute('aria-label'))!.replace('的安排', '')
  await other.click()
  await page.getByRole('dialog').getByRole('button', { name: '这天改成休息' }).click()
  await expect(page.getByText(/v3 · 生成于/)).toBeVisible()
  await expect(page.getByRole('button', { name: `${otherLabel}的安排` })).toContainText('休息')
  await expect(page.getByRole('button', { name: `${label}的安排` })).toContainText('分')
})

test('hiding weight removes every weight number from records and growth', async ({ page }) => {
  await page.goto('/records')
  await page.getByRole('button', { name: /记录体重|更新今天的体重/ }).click()
  await page.getByLabel('今天的体重（kg）').fill('61.4')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.locator('.toast')).toContainText('已记录今天的体重')

  await page.goto('/growth')
  await expect(page.getByRole('button', { name: '体重', exact: true })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '体重（kg）' })).toBeVisible()

  // 关掉开关：记录页的壳里不允许剩下任何数字
  await page.goto('/me')
  await page.getByRole('switch', { name: '显示体重记录' }).click()
  await page.goto('/records')
  const panel = page.locator('.weight-panel')
  await expect(panel).toContainText('体重记录已隐藏')
  expect(await panel.innerText()).not.toMatch(/\d/)

  // 成长页：tab 与表格列都要消失
  await page.goto('/growth')
  await expect(page.getByRole('button', { name: '体重', exact: true })).toHaveCount(0)
  await expect(page.getByRole('columnheader', { name: '体重（kg）' })).toHaveCount(0)

  // 重新打开：数据还在，只是之前不显示
  await page.goto('/me')
  await page.getByRole('switch', { name: '显示体重记录' }).click()
  await page.goto('/growth')
  await expect(page.getByRole('button', { name: '体重', exact: true })).toBeVisible()
  await expect(page.getByRole('columnheader', { name: '体重（kg）' })).toBeVisible()
})

test('delete confirmation can be cancelled with Escape', async ({ page }) => {
  await page.goto('/records')
  const row = page.locator('.history-row').first()
  await row.locator('summary').click()
  await row.getByRole('button', { name: '删除这条记录' }).click()
  await expect(row.getByRole('button', { name: '确认删除' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(row.getByRole('button', { name: '确认删除' })).toHaveCount(0)
  await expect(row.getByRole('button', { name: '删除这条记录' })).toBeVisible()
})

test('interactive controls meet the 44px touch minimum', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.hasTouch !== true, '只在触屏视口检查')
  await page.goto('/records')
  const row = page.locator('.history-row').first()
  await row.locator('summary').click()
  const box = await row.getByRole('button', { name: '删除这条记录' }).boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
})
