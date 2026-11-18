# 下一次会话的起点

> 给新会话用。读完这份就能接手，不必翻历史对话。

## 一句话状态

HerFit（两人用的私人健康 PWA）已上线并可用，**8 个体验项里 6 个已完成**，剩「记录删除」和「计划内单日编辑」两项待做。

## 位置与地址

| 项            | 值                                                                         |
| ------------- | -------------------------------------------------------------------------- |
| 项目目录      | `E:\codex xiangmu\herfit`                                                  |
| 线上地址      | **https://herfit-ec6.pages.dev**                                           |
| Pages 项目名  | `herfit`（**注意**：项目名与域名不同，wrangler 命令必须用 `herfit`）       |
| Supabase 项目 | `fjlbacfekkjvdfaxzkxy`，区域 `ap-southeast-1`                              |
| 账号密码      | 项目根目录 `账号密码.local`（已 gitignore，A/B 两个账号，密码均为 080914） |
| 部署凭据      | `.env.setup.local`（Supabase PAT、DB 密码、DeepSeek Key，已 gitignore）    |

## 当前提交

```
06ca36f feat(ux): 登录持久化、休息提示音与时长可调、跳过动作、上次成绩、周复盘
537a284 feat(ai): DeepSeek 训练说明层（方案 A）与去重复重构
746a25d feat(stage6): 训练草稿自动保存与恢复
55b7ef5 feat(stage5): 部署到 Cloudflare Pages
```

工作区干净，92 项单测 + 36 项 E2E 全绿。

## 架构要点（改动前必读）

- **计划由本地规则引擎生成**（`src/domain/engine.ts`），确定、可测、可复现。AI 只在 `functions/api/explain.ts` 里做解释，**不参与决策**，输出不写库。
- 云模式走 Supabase，写入统一经 `herfit_write(p_workspace, p_profile, p_kind, p_payload, p_expected)` RPC；读取走 `herfit_snapshot()`。
- 迁移在 `supabase/migrations/`。**Management API 会切坏 `$$` 函数体**，必须用 `node scripts/apply-sql.mjs <file>` 逐条执行。
- 部署：`npm run deploy`（构建 → 校验云端模式 → 确认登录 → 上传 dist 与 functions）。

## 已完成（不要重复做）

登录持久化（localStorage）、休息提示音、休息时长可调、上次成绩显示、跳过动作、草稿自动保存与恢复、PWA 更新文案、周复盘一句话、AI 说明层（含同意开关与撤回）、去重复重构。

`P2「首页直达今日训练」` **本来就有**（`Home.tsx:49`），不必再做。

## 待做（按建议顺序）

### 1. 记录删除

- 设计：新增独立 RPC `herfit_delete_workout(p_workspace uuid, p_profile uuid, p_record uuid)`，`security invoker`，校验成员资格后 `delete ... where created_by = auth.uid()`，返回 `herfit_snapshot()`。
- **不要**改 `herfit_write`——它体量大且带 `valid_payload` 校验，改它风险高。
- 需要：迁移文件 → `apply-sql.mjs` 执行 → 客户端 `commit` 增加 delete 分支 → 记录页加二次确认 → 测试（含"删别人的记录应被拒"）。
- 演示模式直接过滤数组。
- 破坏性操作，务必先在小号上验证。

### 2. 计划内单日编辑

- 未解决的设计问题：改了周三的一个动作，周一/周五的历史记录是否要换版本？
- 现有不变量：**计划不可变，每次生成都是新版本，旧版归档**。单日编辑要么破坏它，要么引入"局部版本"概念。
- 先定这个语义，再动手。

## 已知技术债

- `src/app/Store.tsx`、`src/pages/Me.tsx` 仍有 6 处裸 `localStorage`。隐私模式下不会白屏，但整站不可用（ErrorBoundary 兜底）。属存量问题。
- `/api/explain` 只有进程内尽力限流（不持久化）。建议在 Cloudflare 控制台给该路径配 Rate Limiting 规则。
- 代码只在本地 Git，**没有远端仓库**。硬盘坏了全没。
- `backups/v0.1`（569MB）与 `release/` 是历史交付物，未删除。

## 常用命令

```bash
npm run dev            # 纯前端，不含 Functions，AI 说明会走降级
npm run check          # tsc
npm test               # 92 项
PLAYWRIGHT_BROWSERS_PATH=.cache/playwright-browsers npm run test:e2e   # 36 项
npm run deploy         # 构建 + 部署
npm run provision      # 仅首次开通用
```

## 踩过的坑（别重踩）

1. Cloudflare 项目名是 `herfit`，不是 `herfit-ec6`。
2. `npm run dev` 没有 Functions，AI 说明必然失败——这是预期，不是 Bug。
3. E2E 的 `ensurePlan` 必须勾选「我已确认身体限制」，否则档案保存被静默拦下。
4. 用 `cat >>` 追加测试文件偶发重复写入，追加后务必 `grep -c "^test("` 核对。
5. wrangler OAuth 要在两分钟内完成；先登录控制台再发起授权。
