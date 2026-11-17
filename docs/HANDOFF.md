# 给下一位 AI 的交接说明

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
3. 之后再考虑：动作示范图、训练草稿持久化、推送提醒、计划内单日编辑、记录删除。

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
- 训练草稿不持久化，离开页面会丢失；界面已提示。
- 云端设置项（是否显示体重）按 Supabase 用户存储，与档案无关。
- 本机 JSON 未加密；演示模式不要录真实健康数据。
- 免费额度、暂停政策、域名归属需部署时重新核对。

## 可直接给下一位 AI 的指令

> 请继续开发 HerFit，先读 AGENTS.md、docs/HANDOFF.md、docs/STAGE3.md、docs/FITNESS_RULES.md，运行 `npm test` 与 `npm run build` 确认基线。阶段 3 已完成，不要重写动作库与规则引擎。下一步是在用户自己的 Supabase 项目上接通托管迁移与两个档案位，并做真机验收；不要假装云同步或真机安装已完成，不要接收费 AI API，也不要把自撰动作文案称为「已审核」。
