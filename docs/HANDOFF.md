# 给下一位 AI 的交接说明

## v0.7 新进展（记录删除）

- 记录页每条训练记录展开后可「删除这条记录」，需再点一次「确认删除」；演示模式直接过滤本机数组，云端走独立 RPC。
- `supabase/migrations/20261118000100_delete_workout.sql` 新增 `herfit_delete_workout(p_workspace,p_profile,p_record)`。**这是唯一的 `security definer` 函数**：`workout_logs` 对 `authenticated` 没有 delete 权限也没有 delete 策略，只能靠函数体内的「成员资格 + `created_by = auth.uid()`」把关。
- 非作者删除返回 42501，message 为 `not the record author`；`src/cloud/repository.ts` 把它映射为 `CloudError('notOwner')`，避免被当成空间越权而清空整站数据。记录已不存在时按幂等成功处理。
- 云端界面只对作者显示删除入口（比对快照里的 `createdBy` 与当前登录用户），服务端仍是真正的边界。
- 验收：`npm test` 94/94；`npm run test:e2e` 38/38（演示模式，新增 2 项）；`HERFIT_TEST_CLOUD=1 npm run test:e2e` 4/4（新增「只有作者能删」）；`npm run build` 通过。
- **迁移尚未应用到线上 Supabase**：`.env.setup.local` 里的 `SUPABASE_ACCESS_TOKEN` 已失效（Management API 返回 `Invalid access token`）。在拿到新令牌前不要部署前端——`herfit_delete_workout` 不存在时删除会失败。补上令牌后执行 `node scripts/apply-sql.mjs supabase/migrations/20261118000100_delete_workout.sql`，再用 `npm run verify:cloud` 确认三个 RPC 齐全。

## v0.6 新进展（可选 AI 说明，方案 A）

- 训练页新增「今日说明」：**只解释已经由规则引擎算好的当天计划**，不参与生成、不写库、不改任何数字。
- `functions/api/explain.ts`（Cloudflare Pages Functions）：同源 `/api/explain` 代理 DeepSeek，Key 只从部署环境变量 `DEEPSEEK_API_KEY` 读取；未配置时返回 `not-configured`，界面静默隐藏说明能力。
- `src/domain/ai.ts`：白名单式 payload（无昵称、邮箱、id、时间戳），`restrictions` 截断 80 字；纯函数，有单测。
- 首次使用需在弹窗内同意，标记存 `localStorage` 的 `herfit.aiConsent.v1`；失败只显示一行提示，训练流程不受影响。
- 部署前需执行 `wrangler pages secret put DEEPSEEK_API_KEY --project-name herfit-ec6`；未执行时线上功能自动降级。**本机 `npm run dev` 不包含 Functions，说明块会显示"暂时无法生成"。**
- 注意：`docs/PRD.md` 与 `docs/SECURITY.md` 中「不接付费 AI」的表述已过时，需产品确认后再统一口径。

## v0.5 新进展（阶段 5 已完成 · 已上线）

- 线上地址 **https://herfit-ec6.pages.dev**（Cloudflare Pages，HTTPS，PWA 可安装）。
- `scripts/deploy.mjs` + `npm run deploy`：构建 → 校验云端模式 → 确认登录 → 建/复用 Pages 项目 → 上传 dist。
- CSP、`X-Frame-Options: DENY`、manifest、service worker 均已在线上核对生效；`connect-src` 只放行本项目 Supabase。
- 直连（不开代理）实测：pages.dev 200 / 2.4s，Supabase 接口可达 / 4.7s。慢但可用。

## v0.4 新进展（阶段 4 已完成）

阶段 4 补齐了统计与计划闭环：

- `docs/STAGE4.md`：本轮范围、规则与边界。
- `src/domain/engine.ts` 新增 `applyAdjustments`：把建议落到组次上（加量 / 降载 / 换动作），纯函数，6 项单测。
- `src/domain/stats.ts` 新增 `reviewPlan`、`metricSeries`、`exerciseProgress`。
- 训练页新增「负荷调整建议 → 按建议生成新计划 → 预览 → 确认」，复用原有的预览确认机制。
- 成长页新增「动作进步」（单指标曲线，徒手动作画次数）与「身体变化」折线图；趋势图增加饮水。
- 真实 Supabase 项目已接通并验收，见 `docs/GO-LIVE.md`。

## v0.3 新进展（阶段 3 已完成）

阶段 3 已实现动作库、确定性规则引擎、计划生成与逐组打卡。细节见 [STAGE3.md](STAGE3.md)。

- `src/domain/exercises.ts`：44 个家居动作，只用徒手 / 哑铃 / 弹力带。`LIBRARY_REVIEWED = false`，未经专业审核。
- `src/domain/engine.ts`：纯函数规则引擎与渐进负荷建议，无随机、无 AI。31 项单测覆盖安全边界、器械过滤、时长预算与动作轮换。
- `src/domain/model.ts`：数据版本升到 2，`profiles[]` 双档案、`performance.sets[]` 逐组、`training_plans`。
- `src/pages/Training.tsx`：生成 → 预览 → 确认 → 本周安排；确认前不写库。
- `src/pages/Workout.tsx`：逐组勾选、组间休息计时、上次负荷预填、训练中换动作、不适停止。
- `src/pages/Exercises.tsx`：动作库筛选与详情。
- `src/pages/Growth.tsx`：本周完成次数、训练容量，作为监督视角。
- `supabase/migrations/20261116000200_stage3_profiles_plans.sql`：双档案位、`training_plans`、逐组校验、多档案快照。

本轮验收：`npm test` 49/49；`npm run test:e2e` 26/26（演示模式）；`HERFIT_TEST_CLOUD=1 npm run test:e2e` 2/2（共享模式，真实 PostgreSQL + 迁移）；`npm run build` 通过。

**仍未经真实验收：** 用户自己的 Supabase 项目、托管迁移、Cloudflare HTTPS、iPhone / Android 真机安装。这些必须在用户的真实项目上做，不能声称已完成。

## 从这里继续

建议顺序：

1. 按 [STAGE2.md](STAGE2.md) 的「接入你们的 Supabase 项目」接通真实项目，跑两个档案位的双向读写与越权测试。
2. 真机验证：iPhone Safari 添加到主屏幕、Android Chrome 安装、断网提示、组间休息计时在后台的表现。
3. 之后再考虑：动作示范图、推送提醒、计划内单日编辑（需先定「改单日是否产生新版本」的语义）。

## 当前实现

| 位置                          | 职责                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------- |
| src/app/Store.tsx             | 本机模式状态与派生视图 `active`（按档案过滤习惯/指标/训练/计划），`useProfile()` 断言非空 |
| src/cloud/CloudWorkspace.tsx  | 云端模式，提供同一套 Store 接口；档案位为空时显示建档表单                                 |
| src/cloud/repository.ts       | 快照 Zod 校验、RPC 调用、冲突/越权/无效的映射                                             |
| src/domain/engine.ts          | 计划生成与渐进建议，全部为纯函数                                                          |
| src/domain/exercises.ts       | 动作库与可用性判断                                                                        |
| src/domain/stats.ts           | 完整训练判定、训练容量、单动作历史、本周完成                                              |
| src/domain/repository.ts      | 本机存储 v2 与 v1 迁移                                                                    |
| src/components/OnboardProfile | 档案位为空时的建档入口                                                                    |
| public/_headers               | Cloudflare 安全响应头；CSP 按构建时的 Supabase origin 生成                                |

## 开发与验收

```powershell
Set-Location -LiteralPath 'E:\codex xiangmu\herfit'
$env:npm_config_cache = Join-Path (Get-Location) '.cache\npm'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.cache\playwright-browsers'
npm ci
npm test
npm run build
npm run test:e2e
$env:HERFIT_TEST_CLOUD = '1'; npm run test:e2e; Remove-Item Env:HERFIT_TEST_CLOUD
```

E2E 两个项目都用 Chromium，分别是桌面尺寸与 iPhone 13 尺寸模拟，**不代表真实 Safari**。

## 已知边界

- 动作库没有图片/视频；文字内容是自撰，未经专业审核。
- 计划只能整份重新生成，不能改单日动作。
- 训练记录删除后无法在应用内恢复；只能删自己创建的记录。
- 训练草稿存在本机 `herfit.workoutDraft.v1`，刷新可恢复，但不跨设备同步。
- 云端设置项（是否显示体重）按 Supabase 用户存储，与档案无关。
- 本机 JSON 未加密；演示模式不要录真实健康数据。
- 免费额度、暂停政策、域名归属需部署时重新核对。

## 可直接给下一位 AI 的指令

> 请继续开发 HerFit，先读 AGENTS.md、docs/HANDOFF.md、docs/STAGE3.md、docs/FITNESS_RULES.md，运行 `npm test` 与 `npm run build` 确认基线。阶段 3 已完成，不要重写动作库与规则引擎。下一步是在用户自己的 Supabase 项目上接通托管迁移与两个档案位，并做真机验收；不要假装云同步或真机安装已完成，不要接收费 AI API，也不要把自撰动作文案称为「已审核」。
