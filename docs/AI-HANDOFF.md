# HerFit 完整交接文档

> 读者：接手这个项目的下一个 AI 或开发者。
> 最后更新：2026-11-18，对应提交 `e1e7959`（用 `git log --oneline -1` 可确认最新）。
> 读完这份就能独立跑起来、看懂代码、知道哪些做完了、哪些没做、下一步做什么。

---

## 0. 两条阅读路径

- **只想知道怎么跑和现状**：读第 1、2、3 节，然后 `npm run check && npm test`。
- **要动代码或补测试**：读完 4–9 节，务必看第 10（缺口）和第 12（禁令）。

---

## 1. 产品是什么

两个人（通常是伴侣或家人）共用的健康 PWA。不是健身社区，不是减脂工具，没有排行榜、没有打卡惩罚、没有体重目标。

**它想解决的事**：把「今天该练什么、上次练得怎么样、要不要加量」说清楚，并让两个人都看到同一份记录。

**五条红线**（写测试时当断言看）：

1. 不以减重为目标：没有体重目标、没有热量、没有「应该瘦到多少」。
2. 体重不做比较、不排名、不计入任何评分。
3. 不做打卡惩罚、不制造断签焦虑。
4. 动作内容未经专业审核，界面不得出现「已审核」「专业处方」。
5. AI 不产生数字、不做诊断、不直接改计划。

---

## 2. 现在是什么状态

| 项           | 值                                                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 线上地址     | https://herfit-ec6.pages.dev                                                                                           |
| 代码远端     | `github` → https://github.com/caoyb714/jianshen（私有，master + 标签）；`origin` → `D:\backups\herfit.git`（本机镜像） |
| 技术栈       | React 19 + TypeScript + Vite；Cloudflare Pages + Functions；Supabase（Postgres + Auth）                                |
| 运行模式     | 云模式（线上）/ 演示模式（本机 localStorage），共用一套 Store 接口                                                     |
| 单测         | 111 项，7 个文件                                                                                                       |
| 演示 E2E     | 40 项（桌面 + 移动双视口，实际执行 80 次）                                                                             |
| 云端 E2E     | 4 项（PGlite 起真实 schema）                                                                                           |
| 最近一次全绿 | 2026-11-19 16:20                                                                                                       |

**已完成的能力**

| 能力               | 关键实现                                                          |
| ------------------ | ----------------------------------------------------------------- |
| 双档案共享一份空间 | `profiles` 为 1–2 个槽位，各自有档案、计划、记录                  |
| 规则生成周计划     | `generatePlan()`，7 天，含热身与降载                              |
| 计划不可变         | 每次改动生成新 `TrainingPlan`，版本 +1，旧版 `status='archived'`  |
| AI 逐条理由        | 幅度由规则算，AI 只写「为什么」，数字必须来自实测                 |
| 采纳进草稿         | 点采纳只改本地 `staged`，卡底才提交                               |
| 撤销从基线重算     | 不做反向加减，避免累积误差                                        |
| 单日编辑           | 改组数 / 换替代动作 / 整天改休息，只动那一天                      |
| 体重单源           | 只存 `metrics[].weight`；记录页写、我的页只读、开关默认可见       |
| 训练记录删除       | 仅作者可删，行内二次确认，云端 RPC 校验                           |
| 计划写入乐观锁     | `herfit_write_plan`，陈旧版本返回 40001                           |
| 替代动作无向并集   | `alternativesFor()`：同模式 + 同剂量类型 + 器械可用，作者顺序优先 |
| AI 代理鉴权        | `/api/explain` 要求 Bearer token，交 Supabase 判定，缺失即拒绝    |
| 计划定制           | 逐天勾选训练日、当天可用时长、单动作目标次数、今日精力分级        |

**这一轮把测试补齐了**：多端并发（陈旧计划被 40001 拒绝）、成长页与记录页的体重隐藏态、键盘采纳与 Esc 取消、触屏 44px 热区，都有 E2E 覆盖。

**仍没做的**：iOS 手测与真实模型的连续抽查（10.6）、密钥移出仓库目录（11.5）。

---

## 3. 怎么跑

### 3.1 命令

```bash
npm ci                 # 安装依赖
npm run check          # tsc -b，改完必跑
npm test               # vitest，111 项，约 3 秒
npm run test:e2e       # Playwright 演示模式，26 个用例（双视口），约 40 秒
HERFIT_TEST_CLOUD=1 npm run test:e2e   # 云端模式 3 个用例（双视口），约 25 秒
npm run dev            # http://127.0.0.1:5173
npm run verify:cloud   # 线上 8 张表 + 4 个 RPC 自检
npm run deploy         # 构建并发布到 Cloudflare Pages
```

Playwright 浏览器若报缺失，用仓库内缓存：

```bash
PLAYWRIGHT_BROWSERS_PATH=.cache/playwright-browsers npm run test:e2e
```

### 3.1.1 推送到远端

```bash
git push github master --tags      # GitHub 私有远端：只推分支与标签
git push origin --mirror           # 本机镜像：全量
```

不要对 GitHub 用 `--mirror`：它会把 `refs/remotes/origin/*` 一起推上去，在远端留下多余引用；而且 `--mirror` 会把 `remote.github.mirror=true` **写进本地 config**，之后对该远端的普通 `git push` 也会变成全镜像。发现多出引用时，先 `git config --unset remote.github.mirror`，再 `git push github :refs/remotes/origin/master` 删掉。

### 3.2 密钥与账号（都不在仓库里）

| 东西                                      | 位置                                                                                                              |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Supabase service role key                 | `.env.setup.local`（本机，永久令牌）                                                                              |
| 线上账号 `herfit.a@` / `herfit.b@` 的密码 | 根目录 `账号密码.local`                                                                                           |
| DeepSeek Key                              | Cloudflare Pages 环境变量 `DEEPSEEK_API_KEY`                                                                      |
| 鉴权用项目地址与公开密钥                  | Cloudflare Pages secret `SUPABASE_URL` / `SUPABASE_ANON_KEY`（**不是** `VITE_` 前缀，Functions 读不到 VITE 变量） |

`npm run provision` 建账号与空间；`npm run deploy` 读 `.env.local` 里的 Cloudflare 凭据。

### 3.3 常见失败

| 现象                                                     | 原因                                                                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `page.evaluate` 报 `Cannot read properties of undefined` | 本地数据被 schema 拒绝并回落 seed（见 12.1）                                                                                                     |
| 演示 E2E 里 `/api/explain` 404                           | 正常，本地没有 Pages Functions，这正是测降级路径                                                                                                 |
| 云端 E2E 连不上                                          | 忘了 `HERFIT_TEST_CLOUD=1`，或 PGlite 缓存未生成                                                                                                 |
| 手机上看到的还是旧版                                     | PWA 缓存，下拉刷新                                                                                                                               |
| 命令行里 `git` 不是可识别的命令                          | 本机 git 是 WorkBuddy 自带的 PortableGit，未进 PATH。用完整路径调用：`C:\Users\20614\.workbuddy\binaries\PortableGit\versions\1.3.0\cmd\git.exe` |

---

## 4. 架构

### 4.1 三种数据形态

```
演示模式：页面 → Store → localStorage('herfit.demo.v2') + Zod 校验
云模式：  页面 → Store → CloudWorkspace → rpc('herfit_snapshot' / 'herfit_write' / 'herfit_write_plan' / 'herfit_delete_workout')
                                      └→ 实时订阅，B 端改动会推到 A 端
```

页面不直接碰存储，只调 `commit({ kind, value })`。`kind` 七种：`profile / habit / metric / workout / plan / settings / deleteWorkout`。

### 4.2 一次写入发生了什么

```
commit(change)
  → CloudWorkspace.save(current, change)
      → plan:   rpc herfit_write_plan(workspace, profile, payload, expectedVersion)
      → 其他:   rpc herfit_write(workspace, profile, kind, payload, expectedRevision)
      → 成功返回整份新快照，直接替换本地状态
      → 失败抛错 → Store 返回 false → 页面保留输入并提示，绝不乐观更新
```

### 4.3 路由

| 路径                      | 页面      | 说明                                         |
| ------------------------- | --------- | -------------------------------------------- |
| `/`                       | Home      | 今日概览、饮水、连续完成                     |
| `/training`               | Training  | 建议卡、周计划、单日编辑、计划生成           |
| `/training/session/:date` | Workout   | 逐组打卡，中断可恢复                         |
| `/exercises`              | Exercises | 44 个动作，含替代动作与注意事项              |
| `/records`                | Records   | 体重块、腰围臀围、睡眠、饮水、训练记录与删除 |
| `/growth`                 | Growth    | 周统计、身体变化曲线、数据表                 |
| `/me`                     | Me        | 档案、体重开关、AI 同意、导出、清空          |

---

## 5. 数据模型

### 5.1 前端根结构（`src/domain/model.ts`）

```ts
dataSchema = {
  version: 2,                 // 字面量，不匹配即拒绝
  profiles: 1..2 个 { id, slot, profile | null },
  habits: Habit[],            // 按 date 唯一，睡眠/饮水
  metrics: Metric[],          // 按 date 唯一，weight/waist/hip 各可空
  workouts: Workout[],        // 训练记录，含逐组 reps/load/done
  plans: TrainingPlan[],      // 至多一条 status='active'
  settings: { showWeight: boolean }
}
```

档案字段：昵称、年龄 18–100、身高 100–230、经验三档、日常活动三档、目标三档、每周 1–7 天、单次 10–90 分钟、器械（徒手/哑铃/弹力带至少一项）、哑铃重量、弹力带档位、身体限制 ≤500 字、限制确认布尔、可选的自选训练日 `trainingDays`（0=周一）。

**没有体重字段，这是刻意的。**

`metricSchema`：`weight` 20–400 可空、`waist/hip` 30–250 可空，三项至少一项非空。

`workoutSchema` 每个动作必须八字段齐全：`exerciseId / name / role / plannedSets / targetReps / targetSeconds / replacedFrom / sets`。少一个会让整份本地数据被拒并回落 seed（见 12.1）。

### 5.2 数据库

8 张表：`workspaces / workspace_members / health_profiles / habit_logs / body_metrics / workout_logs / app_settings / training_plans`。

- 全部开 RLS，读写限定 `workspace_members` 成员。
- `training_plans` 唯一索引 `training_plans_one_active`：每个档案同时只能一条 `active`。
- `body_metrics` 主键 `(workspace_id, profile_id, observed_on)`：同一天只有一行。
- `app_settings` 按 `(workspace_id, user_id)` 存，带 `revision` 做乐观锁。

### 5.3 RPC 契约

| 函数                         | 参数                                         | 行为                                        |
| ---------------------------- | -------------------------------------------- | ------------------------------------------- |
| `herfit_snapshot()`          | —                                            | 返回调用者所在空间全部数据                  |
| `herfit_write(...)`          | workspace, profile, kind, payload, expected  | 六种记录统一写入，`expected` 不匹配抛 40001 |
| `herfit_write_plan(...)`     | workspace, profile, payload, expectedVersion | 计划专用，按 `payload->>'version'` 比对     |
| `herfit_delete_workout(...)` | workspace, profile, record                   | 仅作者可删，非作者抛 42501                  |

错误码：`42501` 权限、`23514` 字段非法、`40001` 版本冲突。前端把 40001 映射成「计划已更新，需要刷新」。

---

## 6. 领域规则

### 6.1 计划生成

`generatePlan({ age, experience, weeklyDays, sessionMinutes, equipment, restrictions, restrictionsConfirmed })`：

1. 限制未确认 → 返回 `{ ok: false, message }`，不生成。
2. 排期：档案里勾了 `trainingDays` 就用勾选的那几天；没勾才按每周天数自动分配。
3. 每天按动作模式覆盖（蹲 / 髋铰链 / 推 / 拉 / 核心）挑动作，控制总时长。
4. 输出 7 天，含热身、槽位、预计时长、备注。

> 注意：`isDeloadWeek()` 已经写好并导出（每 4 周降载），但**生成器目前没有调用它**，也就是说计划里不会自动出现降载周。这属于预留能力，不是已完成功能。

### 6.2 渐进负荷 `suggest()`

判定顺序**不可调换**，测试依赖它：

| 顺序 | 条件                             | 结果                                                |
| ---- | -------------------------------- | --------------------------------------------------- |
| 1    | 历史里有 `discomfort`            | `stop`（暂停，给替代动作）                          |
| 2    | 可用记录 < 2 次                  | `collect`（先攒数据）                               |
| 3    | 上次难度 ≥ 9                     | `reduce`（负荷 ×0.95）                              |
| 4    | 连续两次全部达标 且 两次难度 ≤ 7 | `increase`（哑铃 +1kg / 弹力带 +1 档 / 徒手 +2 次） |
| 5    | 上次有组未达标                   | `hold`（保持，先做完整）                            |
| 6    | 其他                             | `hold`（进展正常）                                  |

幅度常量 `LOAD_STEP_KG = 1`。**AI 不能改这个数字**，只能解释。

### 6.2.1 当天的两种微调

- `fitDayToBudget(day, minutes)`：按今天的可用时长裁剪动作。先去放松，再从末尾去主要动作，**至少保留一个主要动作**；时长重算。
- `adjustDayForReadiness(day, readiness)`：`high`/`ok` 不动；`low` 每个动作少一组；`unwell` 改成恢复日（只留放松动作）。两者都只改当天，并生成新版本。

### 6.3 体重口径

- 唯一来源 `metrics[].weight`。
- 当前值 = 按日期倒序最近一条 ≥20 的非空值；`0` 与 `null` 不算。
- 变化 = 与上一条非空的差，只做中性描述（「比上次少 0.2 kg」），不用箭头、不用红绿。
- 同天再保存 = 覆盖同一行，且必须把已有腰围/臀围带回去（整行覆盖的坑）。

### 6.4 AI 边界

- 输入白名单：年龄、经验、器械、限制（压平控制字符、截 80 字）、当天动作、每条建议的幅度与最近一次实测（次数/负荷/难度）、近 7 天三个汇总数。**不含昵称、邮箱、id、时间戳、体重。**
- 输出契约：`{ ok: true, items: [{ sig, text }] }`，`text` ≤40 字。
- 服务端逐条校验：sig 必须在请求白名单内；文本里的数字必须属于该条实测值或幅度文案；否则整条丢弃。
- 模型没按 JSON 输出 → 返回空数组，界面只少「理由」一行，幅度与采纳不受影响。

---

## 7. 关键交互的状态机

### 7.1 建议卡四态

| 态                | 触发         | 状态行                          | 操作                       |
| ----------------- | ------------ | ------------------------------- | -------------------------- |
| S0 未采纳         | 初始         | 无                              | 采纳 / 忽略                |
| S1 已采纳（草稿） | 点采纳       | 已采纳 · 下次生成计划时应用     | 移出本次调整（不产生版本） |
| S2 已生效         | 卡底提交成功 | 已生效 · v{n}，撤销不会改回旧版 | 撤销并生成新版本           |
| S3 已撤销         | 撤销成功     | 已撤销 · v{n}                   | 采纳（等同 S0，进草稿）    |

**卡底按钮是唯一提交入口**：「按 N 条建议生成新版本」，草稿 0 条时不渲染。S3 的采纳不得绕过它。

### 7.2 体重块三态

| 态             | 表现                                                                             |
| -------------- | -------------------------------------------------------------------------------- |
| 开关开、有记录 | 主值 + 变化行（日期只出现一次）+ 「更新今天的体重」+ 免责                        |
| 开关开、无记录 | `—` + 「还没有记录过体重。」+ 「记录体重」                                       |
| 开关关         | 标题「体重」+「体重记录已隐藏」+「在设置里打开」；**壳内不得出现任何数字或日期** |

### 7.3 删除训练记录

行内「删除这条记录」→「确认删除 / 取消」→ 调 `herfit_delete_workout`。不用 Modal，避免焦点陷阱。

### 7.4 单日编辑

周计划七个格子是 `button`（`aria-label="编辑周X的安排"`）。可改组数（1–10）、换替代动作（目标按新动作重算、负荷归零）、整天改休息。保存只替换该天，版本 +1。

---

## 8. 代码地图

| 文件                       | 职责                                  | 改动注意点                                            |
| -------------------------- | ------------------------------------- | ----------------------------------------------------- |
| `src/domain/model.ts`      | 所有 schema                           | 加字段等于改数据契约，旧数据会解析失败                |
| `src/domain/engine.ts`     | 生成、渐进负荷、应用调整、时长估算    | 纯函数，改动必须补 `engine.test.ts`                   |
| `src/domain/stats.ts`      | 周统计、`reviewPlan`、`latestWeights` | `reviewPlan` 只返回 increase/reduce/stop              |
| `src/domain/ai.ts`         | 载荷构造、`formatTarget`              | 隐私边界，新增字段要同步 `ai.test.ts` 的封闭集合断言  |
| `src/domain/change.ts`     | 变更类型与本地应用                    | 本地与云端两条路径都要照顾                            |
| `src/app/Store.tsx`        | 状态、`commit`、`notify`、`busy`      | 失败必须返回 false                                    |
| `src/app/explain.ts`       | `requestBasis`，18 秒超时             | 任何异常收敛成 `{ ok: false }`                        |
| `src/cloud/repository.ts`  | 云端读写与错误码映射                  | plan 走 `herfit_write_plan`，别退回 `herfit_write`    |
| `src/pages/Training.tsx`   | 建议卡、单日编辑                      | 状态最多，改完必须跑 E2E                              |
| `src/pages/Records.tsx`    | 体重块与其他记录                      | 体重与腰围共用一行 metric                             |
| `functions/api/explain.ts` | DeepSeek 代理                         | 白名单、数字校验、4KB、限流、12 秒超时都在这里        |
| `supabase/migrations/`     | 表、RLS、RPC                          | 新增迁移要同步 `scripts/verify-cloud.mjs` 的 RPC 清单 |

---

## 9. 测试体系

| 文件                         | 数量 | 覆盖                                                                                                                   |
| ---------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------- |
| `tests/engine.test.ts`       | 42   | 生成、渐进负荷六分支、安全边界、降载周、训练周序号                                                                     |
| `tests/domain.test.ts`       | 30   | 派生统计、体重取值、周报、计划可追溯字段、替代动作无向并集                                                             |
| `tests/basis.test.ts`        | 18   | 条目化接口：白名单、数字校验、截断、坏 JSON、405、缺 Key、4KB、限流、上游错误不泄漏、超时、重复签名、超 6 条、鉴权 401 |
| `tests/cloud-db.test.ts`     | 10   | PGlite 真实 schema：RLS、两档案、计划唯一、乐观锁、删除鉴权                                                            |
| `tests/ai.test.ts`           | 5    | 载荷封闭集合、控制字符、6 条上限、近 7 天统计                                                                          |
| `tests/cloud-config.test.ts` | 2    | 配置缺失时的报错                                                                                                       |
| `tests/app.spec.ts`          | 40   | 全流程 UI，桌面 + 移动                                                                                                 |
| `tests/cloud.spec.ts`        | 4    | 双人共享、失败保留输入、仅作者可删                                                                                     |

### 9.1 造数据模板

```ts
await ensurePlan(page) // 每周 7 天 + 生成并确认计划
const day = page.locator('.week-plan > button').filter({ hasText: '分' }).first()
await day.click() // 打开单日编辑
```

需要历史训练记录时，用 `page.evaluate` 直接改 `localStorage['herfit.demo.v2']`，动作对象必须八字段齐全（照抄 `tests/app.spec.ts` 里「adopting a suggestion」那段）。

---

## 10. 已知缺口

### 10.1 AI 触发策略与鉴权（已完成）

**已实现**（`src/app/aiBasis.ts` + `Training.tsx`）：进页面 800ms 自动拉一次，条件为「已同意 + 在线 + 有可执行建议 + 该版本本天未拉过」；手动每天 4 次成功额度，每次成功进 30 秒冷却，额度用完直接显示「今天的理由已用完」而不是假装倒计时；失败不计数。状态按 `planStamp + 本地日期` 落 localStorage，换版本或跨天自动重置。

**服务端鉴权**也已补上：`/api/explain` 要求 `Authorization: Bearer <supabase access token>`，用 Supabase 的 `/auth/v1/user` 判定，401 时直接拒绝；`SUPABASE_URL` 缺失时 fail closed（返回 `not-configured`，不放行匿名）。客户端从会话取 token，经 `src/cloud/session.ts` 传给请求。

**线上实测（2026-11-19）**：无 token → 401、伪造 token → 401、真实登录 token → 200 且正常返回理由。

### 10.2 撤销跨刷新（已解决）

计划 payload 现在带 `baselineVersion`、`appliedAdjustments`、`editedBy`（都可选，旧数据照常解析）。「已生效」与恢复入口从计划本身读取，刷新后仍在；恢复按钮文案为「恢复到 vN 的安排」，仍生成新版本，不改写历史。E2E 覆盖了「提交 v2 → 刷新 → 仍显示已生效 → 恢复到 v1 → 生成 v3」。

### 10.3 多端并发（已覆盖）

`tests/cloud.spec.ts` 新增用例：两个 `browser.context()` 同账号登录，A 改一天保存出 v2，B 停留在 v1 提交 → 收到 40001，提示「计划已在另一处更新…」，刷新后看到 v2，A 的版本未被改写。SQL 层与 UI 层现在都有断言。

### 10.4 成长页隐藏态（已覆盖）

一条 E2E 覆盖全链路：记录体重 → 成长页有「体重」tab 与「体重（kg）」列 → 关开关 → 记录页壳内无任何数字、成长页 tab 与列消失 → 重开 → 数据仍在。

### 10.5 无障碍（已补）

已做：体重保存走全局 `role="status"` 播报；采纳与理由失败有页面内 `sr-only` 播报；删除确认可按 Esc 退出；触屏设备下 `.text-button` / `.chip-button` / 步进器 / 周计划格子统一 44px 最小高度，并有 E2E 断言。

仍缺：焦点顺序的系统性检查、`prefers-reduced-motion` 的验证。

### 10.6 P2 · iOS 与真实模型抽查未完成

真实 Key 已在 2026-11-19 用真实登录 token 打过一次线上冒烟：返回 `200`，理由里的数字与实测一致。仍缺连续 10 次的抽查（是否越界给数字、是否出现医疗建议）。iOS 的 PWA 安装、safe-area、`scrollIntoView` 仍未测。

### 10.7 降载周（已接入）

`generatePlan()` 已接受可选 `weekNumber`，第 4 周组数减一、负荷九成，并在 notes 写明原因。周数由 `trainingWeekNumber()` 按最早训练记录计算，**不能用「第几次重新生成」冒充**，否则同一天重生成四次就会被误判。种子数据自带四周记录，所以演示环境第一次生成就是降载周——这是正确行为，但会让人以为「计划怎么这么轻」。

---

## 11. 剩余工作

> `docs/ROADMAP.md` 是 2026-11-18 写下的完整计划（带代码证据与验收口径），可当背景读。
> 截至 2026-11-19，其中 P0-1 远端、P0-2 计划可追溯、P0-3 触发策略与鉴权、P1-1 替代关系、P1-2 降载周，以及多端并发、成长页隐藏态、无障碍补测都已完成。实际状态以第 10 节为准。

只剩两件，都不阻塞使用。

### 1. iOS 与真实模型抽查（P2，人工）

iOS Safari：安装到主屏、safe-area、`#showWeight` 的滚动定位。
真实 Key：连续 10 次生成理由，检查是否越界给数字、是否出现医疗建议、是否守住 40 字。

**验收**：留一份手测记录；异常项记进 issue。

### 2. 密钥移出仓库目录（P2，安全卫生）

`.env.setup.local` 里有真实的 `DEEPSEEK_API_KEY`、Supabase service token 与 DB 密码。已被 `.gitignore` 排除、未进版本库，但文件就在项目目录里，整目录打包或共享时会一起带走。

**做法**：移到 `%USERPROFILE%\.herfit\`，让 `provision` / `deploy` 从该路径或系统环境变量读取。

**验收**：仓库目录内 `grep -r "sk-"` 无命中；`npm run verify:cloud` 仍通过。

## 12. 禁令与陷阱

1. **不要加 `profile.weight`**。体重只有 `metrics[].weight` 一个来源。
2. **不要给 `dataSchema / profileSchema / settings` 加必填键**。旧数据会解析失败并回落 seed，等于静默清空。要加就加可选字段 + 默认值。
3. **不要用原生 `disabled` 表示「进行中」**。它会把焦点弹回 body，用 `aria-disabled` + 处理函数里的 in-flight 锁。
4. **不要把版本号写死**。所有 `v{n}` 用 `plan.version` 插值。
5. **不要让 AI 产生数字**。幅度只来自 `adjustLabel()`，理由里的数字要过子集校验。
6. **不要乐观更新云端写入**。失败必须保留输入并提示。
7. **不要改 `suggest()` 的判定顺序**，除非同步改 `engine.test.ts` 相关用例。
8. **不要在记录页整行覆盖 metric 而不带旧值**，会清掉腰围或体重。
9. **不要把 plan 写入改回 `herfit_write`**，会失去乐观锁。
10. **不要在文档或提交里写密码**，凭据只在本机 `.local` 文件。

---

## 13. 决策记录（为什么这么做）

| 决定               | 原因                                                  |
| ------------------ | ----------------------------------------------------- |
| 体重只存 metrics   | 两个来源必然给出两个数字，「基线还是最新」无法自洽    |
| AI 只写理由        | 模型给数字会漂移，规则给数字可解释、可测试            |
| 采纳进草稿         | 「计划不可变」是全局约束，就地改会破坏版本历史        |
| 撤销走基线重算     | 反向加减会累积误差（+1kg 再 -1kg 不等于原值）         |
| 计划写入单独建函数 | `herfit_write` 体量大、承载六种校验，改它等于全量回归 |
| 建议卡与说明合并   | 同屏两份建议会互相打架，数字口径还不同                |
| 单日编辑生成新版本 | 与计划不可变一致，也天然可回溯                        |

---

## 14. 术语

- **档案位（slot）**：一个空间最多两个档案，A/B 位，各自独立。
- **active / archived**：计划状态，同时只有一条 active。
- **stamp**：`plan.id + version` 拼成的标识，用来判断页面上的计划是否已被换掉。
- **草稿（staged）**：已采纳但未提交的建议，只在内存里。
- **基线（baseline）**：调整发生前那份计划的 days，撤销时用它重算。
- **sig**：建议条目的稳定签名 `exerciseId:kind:细节`，客户端与服务端靠它对齐。
