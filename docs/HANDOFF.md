# 给下一位 AI 的交接说明

## v0.2 新进展

阶段 2 的代码、SQL 迁移与本机验收在 E 盘项目中。继续时从 [STAGE2.md](STAGE2.md) 的「接入你们的 Supabase 项目」开始，配置独立项目和两位成员，用测试数据验收双向读写及非成员拒绝。真实账号、数据库迁移应用和部署须在用户的 Supabase 项目上进行。验收通过后，阶段 3 重点是专业审核动作库和可确认的训练计划版本。

- `src/cloud/CloudGate.tsx` 驱动 Email 登录与退出，`CloudWorkspace.tsx` 处理授权后的加载、冲突及保存结果。
- `src/cloud/repository.ts` 验证快照并调用 RPC，`src/domain/change.ts` 明确五类写入操作。
- `supabase/migrations/20261116000100_shared_workspace.sql` 管理 schema、RLS、列权限和版本检查。
- `supabase/bootstrap-example.sql` 供管理员绑定两个已建立的用户。该文件只包含占位 UUID。
- `tests/cloud-db.test.ts` 运行同份 SQL 迁移验证行为，`tests/cloud.spec.ts` 通过浏览器验证模拟认证与真实 SQL。

下面保留阶段 1 的交接记录，当前实现以本节和 STAGE2.md 为准。

## 从这里继续

HerFit v0.1 已实现用户方案的阶段 0、阶段 1：项目文档、五个移动页面、虚构示例档案与本机交互。额外实现 PWA 静态资源配置、本机数据导出和测试，便于后续迭代。

**不要重做项目或把它当作已上线服务。下一阶段是 Supabase 账号与共享空间。** 当前没有 GitHub 远程仓库、真实数据库、生产迁移、认证、云同步、收费 AI 或真实健康数据。

先读 AGENTS.md → PRD.md → ARCHITECTURE.md → DATABASE.md → SECURITY.md → FITNESS_RULES.md → TEST_PLAN.md。

## 当前实现

| 位置                           | 职责                                                                          |
| ------------------------------ | ----------------------------------------------------------------------------- |
| src/app/Store.tsx              | 当前数据、保存结果、日期更新、跨标签页读取、按提交日期增减饮水                |
| src/domain/model.ts            | Zod 数据结构与范围校验                                                        |
| src/domain/repository.ts       | localStorage 版本、读写、错误处理；后续云端存储替换边界                       |
| src/domain/seed.ts             | 全部虚构示例数据；不应同步到生产空间                                          |
| src/domain/catalog.ts          | 6 个动作与 4 个模板的演示资料，未经专业审核                                   |
| src/domain/stats.ts            | 完整训练计数、实际活动分钟、睡眠平均、按日趋势                                |
| src/pages/Workout.tsx          | 训练计时、实际动作记录、不适停止、反馈                                        |
| src/components/ProfileForm.tsx | 档案表单，身体限制必须本次主动确认，改变限制后重新确认                        |
| public/_headers                | Cloudflare 安全响应头；当前 CSP 不允许 Supabase 请求，接入时需增加准确 origin |
| vite.config.ts                 | 静态 PWA 缓存、用户确认更新；不缓存 API、不做后台写队列                       |

## 开发与验收

```powershell
npm ci
npm run dev
npm test
npm run build
npx playwright install chromium --only-shell
npm run test:e2e
```

E2E 两个项目都使用 Chromium，分别为桌面尺寸和 iPhone 13 尺寸模拟；这不代表真实 Safari 或手机系统验收。测试输出默认 test-results，可用 HERFIT_TEST_OUTPUT 指定目录。PLAYWRIGHT_BROWSERS_PATH 可指定测试浏览器缓存位置。

也可以设置 HERFIT_TEST_BASE_URL 连接已启动的生产 preview，此时测试不会再启动/关闭 Vite。最终生产包 20 项测试使用了此方式，详情见 VALIDATION.md。

本次独立复核已发现并修复：午夜饮水挪用昨日总量、不适停止后的错误数值无法修正、身体限制确认默认勾选。三个回归用例都先复现失败，再验证通过。

## 阶段 2 建议顺序

1. 保留现有 UI，在独立 Supabase 测试环境实现数据库迁移；表/关系/约束见 DATABASE.md。
2. 关闭公开注册，管理员预置两个独立账号。真实邮箱和凭证由用户在安全界面配置，不索取聊天中的服务密钥。
3. 预置共享空间与两条成员记录。双方可管理业务数据，客户端不能任意添加成员或自我加入空间。
4. 为每个个人数据表实现 RLS。先验证成员 A/B 的读写，再验证非成员 C、匿名、伪造关联和审计字段的拒绝行为。
5. 引入异步 Repository 与登录状态。演示模式、真实云端模式显式区分，禁止静默把 demo 数据迁入生产。
6. 保存等待服务器确认；处理会话过期、离线/网络失败和两人同时修改的冲突。退出时清除个人内存和缓存。
7. 经用户授权配置私有 GitHub 仓库与 Cloudflare Pages；构建 dist，正式 HTTPS 下检查 CSP/PWA、两部真机。

只有这些完成且实测后，才进入阶段 3 的经审核动作库、模板和规则引擎。

## 已知边界与下一步候选

- 正式模板中的热身、放松、核心、柔韧等分类尚待阶段 3 补齐；当前只用少量动作验证流程。
- 训练草稿未持久化，离开训练页面会丢失未保存记录，界面已提示。后续做草稿时保持不适停止状态，不自动恢复计时。
- 每个动作目前按统一的每组次数记录，不支持每一组分别填写；步行仅用总结中的实际计时体现，组/次字段仍为演示。
- 没有训练计划编辑、渐进调整规则、推送提醒、离线写入云端队列、导入恢复。
- 数据清空只清除运动/习惯/身体记录，保留档案与偏好；重载示例替换整份数据。隐藏体重不会删除它，也不会从 JSON 导出中剔除。
- 本机 JSON 未加密；禁止用此版当正式健康数据存储。生产版必须重新设计备份/恢复与删除权限。
- 云服务免费额度、暂停政策、域名与账号归属需部署时核对，不沿用原聊天中的数值作为保证。

## 可直接给下一位 AI 的指令

> 请继续开发这个 HerFit 项目，先读取 AGENTS.md、docs/HANDOFF.md、docs/PRD.md 和 docs/SECURITY.md，运行现有测试确认基线。保留当前五页视觉与交互，从阶段 2 的 Supabase 双账号、共享空间、数据库迁移和 RLS 开始。明确区分演示数据和真实数据，先完成本地实现及越权测试，再处理需要我提供的账号配置；不要假装云同步已完成，也不要接收费 AI API。完成后更新交接和测试文档。
