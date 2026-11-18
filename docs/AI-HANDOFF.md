# HerFit 测试交接说明

> 给接手继续测试的 AI。最后更新 2026-11-18，对应提交 `e4f4961`。
> 先读这一页，再按需翻 `ARCHITECTURE.md`、`TEST_PLAN.md`、`OPTIMIZATION.md`。

## 1. 这是什么

两人私用的健康 PWA，中文，线上 https://herfit-ec6.pages.dev。React 19 + TS + Vite，Cloudflare Pages + Functions，数据在 Supabase（云模式）或 localStorage（演示模式），二者共用同一套 Store 接口。

**产品红线**（测试时要当断言看，不是文案）：

1. 不以减重为目标：没有体重目标、没有热量、没有「应该瘦到多少」。
2. 不做体重排名或比较，体重不计入任何评分。
3. 不做打卡惩罚、不制造断签焦虑。
4. 动作未经专业审核，界面不能出现「已审核」「专业处方」。
5. AI 不产生数字、不诊断、不直接改计划。

## 2. 现在能跑通什么

| 能力                                                     | 状态                 |
| -------------------------------------------------------- | -------------------- |
| 双档案（A/B 位）共享一份空间，各自有档案、计划、记录     | 可用                 |
| 规则引擎生成周计划，计划不可变、每次生成新版本、旧版归档 | 可用                 |
| AI 逐条理由（幅度由规则算，AI 只写为什么）               | 可用（服务端已实现） |
| 采纳建议进草稿，卡底确认才生成新版本；撤销从基线重算     | 可用                 |
| 周计划单日编辑（改组数 / 换替代动作 / 整天改休息）       | 可用                 |
| 体重单源记录（记录页写、我的页只读、开关默认可见）       | 可用                 |
| 训练记录逐条删除（仅作者，行内二次确认）                 | 可用                 |
| 云端计划写入乐观锁（陈旧版本硬拒 40001）                 | 可用                 |

## 3. 怎么跑

```bash
npm run check          # tsc -b，类型
npm test               # vitest，92 项
npm run test:e2e       # Playwright，演示模式 40 项
HERFIT_TEST_CLOUD=1 npm run test:e2e   # 云端模式 4 项（用 PGlite 起真实 schema）
npm run dev            # 本机开发
npm run deploy         # 构建 + 发布到 Pages
npm run verify:cloud   # 线上结构与 4 个 RPC 自检
```

**必须先确认 Playwright 浏览器可用**。若报找不到浏览器，用仓库内的缓存路径：

```bash
PLAYWRIGHT_BROWSERS_PATH=.cache/playwright-browsers npm run test:e2e
```

## 4. 代码地图

| 位置                       | 职责                                                                      |
| -------------------------- | ------------------------------------------------------------------------- |
| `src/domain/engine.ts`     | 计划生成、`suggest()` 渐进负荷、`applyAdjustments()`、`estimateMinutes()` |
| `src/domain/stats.ts`      | `reviewPlan()`、`latestWeights()`、周统计                                 |
| `src/domain/model.ts`      | 所有 Zod schema，**改动这里最容易炸**                                     |
| `src/domain/ai.ts`         | `buildBasisPayload()`（隐私白名单）、`formatTarget()`                     |
| `functions/api/explain.ts` | DeepSeek 代理：白名单校验、数字校验、限流、超时                           |
| `src/pages/Training.tsx`   | 建议卡四态、单日编辑、计划生成与提交                                      |
| `src/pages/Records.tsx`    | 体重块、腰围臀围、睡眠、饮水、训练记录删除                                |
| `src/cloud/repository.ts`  | 云端读写；plan 走 `herfit_write_plan`                                     |
| `supabase/migrations/`     | 建表、RLS、RPC、乐观锁                                                    |

## 5. 已有测试覆盖

**单测 92 项**：`engine` 37（渐进负荷与安全边界）、`domain` 23（派生统计、体重）、`basis` 15（条目化接口：白名单、数字校验、截断、坏 JSON、405、缺 Key、4KB、限流、上游错误不泄漏、超时、重复签名、超 6 条）、`cloud-db` 10（PGlite 真实 schema：RLS、两档案、计划唯一、乐观锁 40001、删除仅作者）、`ai` 5（载荷白名单封闭集合、控制字符、6 条上限）、`cloud-config` 2（配置缺失时报错清晰）。

**演示 E2E 40 项**：五路由无溢出、计划生成、逐组打卡、完整训练判定、删除确认、体重块三态与同天覆盖保腰围、档案限制确认、跨天饮水、中断恢复、丢弃草稿、休息时长、周报、建议卡草稿→提交 v2→撤销 v3、单日编辑不重排整周。

**云端 E2E 4 项**：两名成员共享记录、失败表单不丢输入、仅作者可删、越权被拒。

## 6. 没有覆盖的地方（接手后优先补这些）

按风险从高到低，**前两条是功能缺口，不是测试缺口**：

1. **AI 触发策略没有实现。** 计划里写的是「每版本每天自动 1 次、手动 ≤4 次、第 5 次进入 30 秒倒计时」，实际只做了手动「生成理由」按钮，点一次请求一次，没有自动触发、没有次数上限、没有倒计时。服务端仍有每 IP 每分钟 5 次限流兜底。要补的话先补客户端计数，再加测试。
2. **撤销只在当前会话有效。** 撤销依赖内存里的 `baseline`（调整前的 days），刷新页面后「已生效」状态丢失，条目回到未采纳。需要产品决定：接受，还是把基线随版本落到库里。
3. **多端并发冲突没有 E2E。** 只有 SQL 层的 40001 断言。真正的双标签页同改一天、后提交被拒并提示刷新，没有自动化。
4. **成长页在开关关闭时的表现没有断言。** 记录页的壳有断言（无数字、有标题），成长页的 tab / 表格列 / 曲线回落只有单测层面的分支存在。
5. **无障碍只做了零散断言。** `aria-live` 播报（体重已记录、已采纳、理由不可用）没有自动验证；44px 热区、焦点顺序、`prefers-reduced-motion` 都没有。
6. **真实 DeepSeek 没有端到端。** 线上无 Key 时走降级，有 Key 时的真实返回质量（是否守住 40 字、是否复述数字）只能人工抽查。
7. **iOS / Safari 未测。** PWA 安装、safe-area、`scrollIntoView` 在 iOS 上的行为都只在 Chromium 验证过。

## 7. 写测试时会踩的坑

1. **训练记录的 schema 很严。** `performanceSchema` 要求 `exerciseId / name / role / plannedSets / targetReps / targetSeconds / replacedFrom / sets` 八个字段齐全。少一个，整份本地数据会被 `dataSchema` 拒绝并回落到 seed，表现是「测试莫名其妙回到了初始状态」。造数据请照抄 `tests/app.spec.ts` 里「adopting a suggestion」那段。
2. **本地存储键是 `herfit.demo.v2`，计划字段叫 `plans` 不是 `training_plans`。**
3. **`profiles` 是槽位包装**：`{ id, slot, profile }`，`profile` 可能为 null。
4. **周计划格子已从 `div` 改成 `button`**，带 `aria-label="编辑周X的安排"`。断言不要再找 `div`。
5. **演示模式下 `/api/explain` 必然 404**（没有 Pages Functions），这是测降级路径的预期，不是环境坏了。
6. **同意弹窗的确认按钮文案是「同意并生成」**，标题是「把数据发送给 DeepSeek 生成理由」。
7. **体重开关默认 `true`**，第一次点击是关闭。体重块的输入标签是「今天的体重（kg）」，动作按钮是「记录体重」/「更新今天的体重」。

## 8. 加一个测试的最小模板

```ts
test('...', async ({ page }) => {
  await ensurePlan(page) // 每周 7 天 + 生成并确认计划
  const dayButton = page.locator('.week-plan > button').filter({ hasText: '分' }).first()
  await dayButton.click() // 打开单日编辑
  const dialog = page.getByRole('dialog')
  // ...操作
})
```

`ensurePlan` / `startSession` 在 `tests/app.spec.ts` 顶部。需要造历史记录时，用 `page.evaluate` 直接改 localStorage，再 `page.goto('/training')` 重新加载。

## 9. 绝对不要做

- **不要给档案加体重字段**（`profile.weight`）。体重只有一个来源：`metrics[].weight`。加第二个来源必然出现两个数字。
- **不要给 `dataSchema / profileSchema / settings` 加必填键**。旧数据会解析失败，`loadData` 只能回落到 seed，等于静默清空。
- **不要用原生 `disabled` 表示「进行中」**。它会把键盘焦点弹回页面根部，用 `aria-disabled` + 处理函数锁。
- **不要把版本号写成字面量**。所有 `v{n}` 必须用 `plan.version` 插值，否则从 v15 起每次失败提示都在说谎。
- **不要让 AI 产生数字**。幅度只来自 `adjustLabel()`，AI 的文本要过数字子集校验。

## 10. 账号与密钥

- 线上两个账号：`herfit.a@` 与 `herfit.b@`，密码在仓库根目录的 `账号密码.local`（**不要把内容写进任何提交或文档**）。
- Supabase service role key 在 `.env.setup.local`（永久令牌，仅本机）。
- DeepSeek Key 配在 Cloudflare Pages 的环境变量 `DEEPSEEK_API_KEY`，不落仓库。
