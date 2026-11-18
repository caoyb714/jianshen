# 下一步打算（v0.9）

> 写于 2026-11-18，基于 `master` @ `2443dd7`（工作区干净）。线上 https://herfit-ec6.pages.dev 。
>
> 这是**计划**，不是记录。下面每一条都还没做；做完才写进 `docs/HANDOFF.md`，并且只写做完的那部分。

## 怎么读

排序只有一条原则：**先止血，再补强，最后才谈体验。**

- 止血 = 会丢东西、会伤信任、会花真钱；
- 补强 = 行为已经对，边界还没守住；
- 体验 = 现在没坏，只是不够顺。

每条给四件事：为什么现在做（带代码证据）、怎么做（改哪个文件）、怎么验收（跑什么断言）、多久（按一个人熟悉这套代码估）。

## 结论先说

1. **先花 20 分钟把仓库推到一个私有远端。** 现在 `git remote -v` 是空的，整份代码只有这一台机器上的一份，`git tag` 也没有。这是唯一一个「一旦发生就无法挽回」的风险，其他都可以慢慢来。
2. **v0.9 真正的头等需求是「计划的每一次改动都能追溯」**，不是加功能。撤销按钮现在只在当前会话有效（`src/pages/Training.tsx:46-65` 全部是内存态），刷新就消失；而两人共用一份计划，对方一改就会盖掉你的上下文。
3. **`/api/explain` 是公网的、无鉴权的、已经配了真 Key 的端点。** 我实测 `POST {}` 返回 `{"ok":false,"reason":"bad-request"}`——未配置 Key 时这里会返回 `not-configured`，所以线上确实在花你的额度。限流是进程内 Map、`5 次/分钟/IP`（`functions/api/explain.ts:25-26`），多 isolate 各自计数，起不到预算作用。
4. **动作库的短板不是数据太少，是关系不闭合。** 44 个动作**全部**都有非空 `alternatives`、0 个断裂引用，但有 **27 组单向替代**：A 列了 B，B 没列 A。界面的「换动作」只列当前动作的替代（`src/pages/Training.tsx:605-624`），所以换过去之后换不回来。
5. 外部项目里最值得抄的一条：**「恢复」不是回滚，是生成新版本**（Figma、Linear、Liftosaur 一致）。HerFit 的计划已经是不可变版本链，语义天然吻合，只差把「哪一版基于哪一版」写进 payload。

## 一、P0：本周做（合计约 2 天）

### P0-1 把唯一副本推上远端（20 分钟）

**为什么**：`git remote -v` 空、`git tag` 空；项目目录 `backups/` 594MB、`release/` 3.7MB、`dist/` 3.4MB 都没进版本库。硬盘坏一次、误删一次，这个已经上线两个月、有真实用户数据的项目就没了。

**怎么做**

1. 建私有仓库，`git remote add origin …`，`git push -u origin master --tags`。
2. 先打一个 `v0.8.0` 标签再推，让远端从「能跑的状态」开始。
3. 核对没有密钥被带上：`.gitignore` 已排除 `.env.*` 与 `*.local`，实测 `git ls-files` 里只有 `.env.example`、`.env.setup.example`，`git status` 0 未跟踪文件。**但 `.env.setup.local` 里有真实 `DEEPSEEK_API_KEY`，它就躺在仓库目录里**——建议移到 `%USERPROFILE%\.herfit\`，或改成从系统环境变量读，免得哪天打包整个目录发出去。

**验收**：换一台机器 `git clone` → `npm ci` → `npm test` 92 项全绿。

**风险**：几乎没有。唯一注意是别 `git add -f` 任何 `.local` 文件。

### P0-2 计划版本可追溯（半天到一天）

**为什么现在做**：这是交接文档 10.2 的 P0，也是「两人共用」最容易伤信任的地方。现状：

- `applied` / `undone` / `baseline` / `appliedItems` 全是 `useState`（`src/pages/Training.tsx:46-65`）。刷新后 `applied` 变 null，卡片上的「已生效 · v3」徽标和「撤销」按钮一起消失（`src/pages/Training.tsx:405-436`），用户会以为自己的调整没生效。
- 计划 payload 里没有任何「基于哪一版算的」「采纳过哪几条」的字段（`src/domain/model.ts:127-137`）。
- 只加 `baselineVersion` **不够**：撤销时规则可能已经不再给出同一条建议，现有代码正是靠 `appliedItems` 这份提交时快照才撤得动（`src/pages/Training.tsx:242` 的注释写明了这点）。刷新后这份快照没了，所以要连快照一起存。

**怎么做**（按顺序，每一步都能单独提交）

1. **schema 加三个可选字段**（`src/domain/model.ts` 的 `trainingPlanSchema`）：
   - `baselineVersion?: number` —— 本版从哪一版重算；
   - `appliedAdjustments?: { sig: string; exerciseId: string; name: string; kind: …; nextLoad: number | null; nextReps: number | null }[]`（最多 6 条，和 AI 条目上限一致）；
   - `editedBy?: string` —— 空间内是哪个账号改的，用来判断「v-1 是不是我改的」。

   **这一步不需要数据库迁移。** 我核对过：`herfit_private.valid_payload('plan', …)` 只校验必需键、允许多余键（`supabase/migrations/20261116000200_stage3_profiles_plans.sql:158-205`），`herfit_write_plan` 只剥离 `id/date/createdAt/profileId`（`…20261118000200_plan_version_mutex.sql:36`），新字段会原样进 payload；`herfit_snapshot()` 也返回**全部**版本、不只 active（`…stage3…:289-293`），所以 archived 的 days 在客户端拿得到。

2. **提交时写入**：`submitAdjustments()`（`src/pages/Training.tsx:237`）在 `commit({ kind: 'plan', value: next })` 前把 `baselineVersion`、`appliedAdjustments`、`editedBy` 填上。
3. **读取时派生**：删掉 `baseline` / `appliedItems` 两个 `useState`，改成从 `plan.baselineVersion` 找到那个 archived 版本、从 `plan.appliedAdjustments` 取快照。撤销路径变成「恢复到 v{baselineVersion}」。
4. **文案改口**：把「撤销」改成「恢复到 v2」，按钮上带版本号，刷新后仍然在。恢复也是 version+1，旧版继续 archived——**不原地回滚**，失败也能再看一眼旧版。
5. **冲突文案拆开**（不是新功能，是改口）。`40001` 已经映射成 `conflict`（`src/cloud/repository.ts:82`），也已经有处理：提示 + 自动 `refresh()`（`src/cloud/CloudWorkspace.tsx:124-128`）。缺的是区分度——现在计划冲突和记录冲突共用一句「记录已在另一处修改」。计划冲突应当说清「对方把计划改成了 v4，你刚才基于 v3」，并把「恢复到 v3」做成提示里的下一步动作。

**验收**

- 单测：新增 `tests/plan-history.test.ts`，覆盖「从 v2 恢复、丢掉被撤的那条、sig 在新计划里已不存在」三种情况。
- 演示 E2E（`tests/app.spec.ts`）：提交调整 → `page.reload()` → 按钮仍在 → 点恢复 → 版本 +1、旧版 archived。
- 云端 E2E：`tests/cloud.spec.ts:20-40` 已经用 PGlite 真 schema + Playwright 路由拦截模拟了 Supabase，**双 context 并发写计划可以离线测**，不用真机也不用真云端。补一条「A 提交后 B 提交 → B 拿到计划冲突的专用文案，提示里带 v3/v4 两个版本号」。

**风险**：`snapshot` 返回的 archived 版本会越来越多（每次调整 +1）。两人、低频，一年几百条，可忽略；真觉得大，再加「只保留最近 20 版」的清理。

### P0-3 AI 入口治理（约一天）

**为什么现在做**：三个问题叠在一起。

1. **端点没有鉴权**。`handle()` 只看 `DEEPSEEK_API_KEY` 在不在（`functions/api/explain.ts:90-93`），不看调用者是谁，也不看 `Origin`。地址是公开的，任何人都能用你的额度。
2. **限流不可靠**。`RATE_WINDOW_MS = 60_000`、`RATE_LIMIT = 5`、`recentHits` 是模块级 Map（`…/explain.ts:25-26, 39-42`）。Cloudflare 每个 isolate 一份，横向扩展后实际额度是 5×实例数。
3. **客户端没有节流也没有自动**。`loadBasis()` 每点一次发一次（`src/pages/Training.tsx:189-217`）；请求在途时切换档案或日期，回来的结果会写到新的界面状态上（没有 stamp 复检）；`requestBasis` 18 秒超时但没有在卸载时 abort（`src/app/explain.ts:16-17`）。

**怎么做**

1. **新文件 `src/app/aiBasis.ts`，纯函数 + 一层薄存储**，不改组件：
   - 存储键：`herfit.aiBasis.v1`，就地按 `{ profileId, planVersion, date, autoAt, manualCount, okCount, blockedUntil }` 存；
   - `date` 用 `localDate()`（`src/domain/dates.ts:1-3`，本地历法日），**不要** `toISOString().slice(0,10)`——东八区早八点前会串天；
   - 策略：进页面 800ms 自动拉**一次**；手动最多 4 次；第 5 次进 30 秒冷却；**只有请求成功且校验通过才 +1**，超时/坏 JSON 只记「试过」不扣次数；
   - 冷却用时间戳算剩余，不用 `setInterval`——后台标签页会被节流。
2. **`loadBasis()` 三处小改**：进入时先 `peekBasisState()` 决定要不要自动拉；await 回来后比对 `plan.version + today`，不一致就丢弃结果；`useEffect` 返回时 abort。
3. **服务端加鉴权**：要求 `Authorization: Bearer <supabase access_token>`，按项目当前的签名方式验签（HS256 用 JWT secret，或 RS256 走 JWKS；WebCrypto 就够，不引新依赖），失败 401。可选再收紧：只允许空间内那两个 uid。
4. **预算**：保留现有的 per-IP 5/分钟，另加一层按天的计数（KV 或一张小表都行）。两人自用，日预算是兜底，不是主逻辑。

**验收**

- 单测（`tests/ai.test.ts` 补一组，纯函数好测）：同一 `profileId+version+date` 自动只触发一次；手动第 5 次返回冷却；跨天/换版本自动重置；失败不扣次数。
- 服务端（`tests/basis.test.ts` 补）：缺 token 401；token 无效 401；合法 token 且超频仍是 `rate-limited`。
- 手工：连点 5 次出现倒计时；刷新页面只自动请求一次（Network 面板）。

**明确不做的两件事**（来自对标）

- 不做「自动重试」。解释只是锦上添花，失败就该安静地只显示本地幅度（Liftosaur 的做法：失败即终态，甚至把失败也缓存）。
- 不让模型产数字。SparkyFitness 敢让模型估热量，是因为它有逐条人工确认的 `ApprovalCard`；HerFit 的定位是「数字由规则给、模型只解释」，这个口子不能开。

## 二、P1：下周（合计约一天）

### P1-1 替代关系闭合，引擎挑兼容替代（半天）

**证据**（脚本核验，不是文档转述）：44 个动作、44 个都有 `alternatives`、0 个断裂引用、**27 组单向**、**12 处剂量类型不一致**（`sit-to-stand` 次数 ↔ `wall-sit` 保持、`deadbug` ↔ `plank`、`brisk-walk` 时长 ↔ `cat-cow` 次数）。

**影响**：换动作下拉只列当前动作的替代，换过去之后如果对方没列回来，就换不回来，只能重新生成计划。

**怎么做**

1. `src/domain/exercises.ts` 加 `alternativesFor(id)`：读时取**无向并集**（A 列 B 或 B 列 A 都算），数据文件保持原样，补几条明显缺的边即可。
2. `src/domain/engine.ts:358` 现在 `alternative: exercise?.alternatives[0] ?? null`，只取第一个。改成优先挑「同 pattern + 器械在用户可用范围内 + 剂量类型相同」的第一个，找不到退化为任意替代，再找不到返回 null。
3. 换动作的语义**不要动**：`swapSlot()` 已经按新动作重算 `target` 并把 `startLoad` 归零（`src/pages/Training.tsx:118-139`），这正是 wger / workout-cool 的做法——单位变了就不继承数值。

**验收**：`tests/domain.test.ts` 断言「替代关系互反」「所有 id 可解析」「引擎选出的替代与 target 剂量类型一致」；训练页能 A→B→A 来回换。红线段：改规则必须同步 `tests/engine.test.ts`，`LIBRARY_REVIEWED` 保持 `false`。

### P1-2 把 `isDeloadWeek()` 接进 `generatePlan()`（2 小时）

`isDeloadWeek()` 已实现且有单测（`src/domain/engine.ts:421`、`tests/engine.test.ts:271-273`），但 `generatePlan()` 从未调用它——第 4 周、第 8 周本该减量的逻辑是死的。要么接上（每 4 周把组数或负荷降一档，并在 `notes` 里写清原因），要么删掉这个函数和测试，别留着让人以为在做。

**验收**：`tests/engine.test.ts` 加「第 4 周的计划组数/负荷低于第 3 周」「第 5 周恢复」；界面上第 4 周的计划说明能看出是减量周。

## 三、P2：有空再说

- **无障碍播报**：`src` 里 `aria-live` 出现 **0 次**，全靠 19 处 `role="status"/"alert"`；`prefers-reduced-motion` 只有 1 处。至少把通知、保存结果、倒计时这三类统一成有 `aria-live` 的区域，再加一条「保存后播报」的 E2E 断言。
- **成长页开关关闭态**：`data.settings.showWeight` 为 false 时表格列应当消失（`src/pages/Growth.tsx:364-375`），目前没有断言；顺手补一条。
- **`backups/` 594MB 瘦身**：只留最近两份，其余压到外部盘。
- **项目名核对**：`docs/NEXT-SESSION.md:80` 写「Cloudflare 项目名是 `herfit`」，但线上域名是 `herfit-ec6.pages.dev`。下次部署前先 `wrangler pages project list` 对一眼，别把 secret 打到不存在的项目上。

## 四、产品方向：一个需要你拍板的选项

**「每周一起看计划」**（不排期，先讨论）

habitbox 的观察值得抄：伴侣一起做一件事，最伤人的不是坚持不住，而是**进度差被并排放大**——「pace mismatch is brutal」；共享 streak 越长，断一次的代价越大。所以他们的建议是「各自记录 + 每周一次 10 分钟仪式」，而不是实时共享。

对应到 HerFit 的红线（不比体重、不排名、不打卡惩罚），可以做的版本是：

- 只共享**计划**，不共享**完成度**——看得见「下周我们各自练哪三天」，看不见「你今天又没练」；
- 一周一次，固定在周日；两个人各自在页面上留一句「下周想试的动作」；
- 不做 streak、不做并排完成率、不做红绿点。

这是个产品决策，不是工程任务，我不擅自做。

## 五、外部对标：抄什么，不抄什么

| 来源                         | 做法                                                                   | 对 HerFit 的判断                                                                  |
| ---------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Figma / Linear / Liftosaur   | 「恢复」= 读旧版本 → 生成新版本，不是原地回滚                          | **照抄**。计划本来就不可变，语义天然吻合，P0-2 直接用                             |
| wger `variation_group`       | 扁平、对称、无序的变体组，没有进阶链                                   | **照抄语义，不照抄实现**：HerFit 用「无向并集」就够，不必再加 group id 与维护流程 |
| wger 代码 / 前端             | AGPL-3.0-or-later，含网络服务条款                                      | **明确不要**。闭源 PWA 引 AGPL 会触发整份代码开源                                 |
| wger 动作数据                | 逐条声明 CC（默认 CC BY-SA 4.0），每条带 author/source                 | 可改造借鉴（逐条署名、只进数据层）。但现有 44 条是自写的，没必要换源              |
| workout-cool `schema.prisma` | 动作之间零关系，属性走 EAV 三表                                        | **明确不要**。两人规模，EAV 是纯负担                                              |
| workout-cool 视频 / 图片     | 授权成本过高，项目本身就因此停止维护                                   | **明确不要**                                                                      |
| SparkyFitness 家族共享       | 「Built for Families」，AI 营养助手 + 家庭共享                         | 定位可借鉴，但不共享完成度（见第四节）                                            |
| SparkyFitness 限流           | DB 固定窗口、键 `<name>\|<ip>`、429 带 `X-Retry-After`、多实例共享预算 | 改造后借鉴：浏览器侧用时间戳 + Web Locks，服务端把「进程内 Map」换成共享计数      |
| SparkyFitness 失败分类       | timeout / truncated / parse_error / no_content / refused 各有文案      | 改造后借鉴：HerFit 现在全收敛成 `network`，可以区分「超时」与「解析失败」         |
| Liftosaur `/api/muscles`     | prompt 写死可选枚举、temperature 0、失败即降级、失败也缓存             | **照抄**：闭环枚举 + 降级 + 不重试，HerFit 的服务端校验已是这个思路               |
| Liftosaur 订阅闸门           | MCP 工具要求 `Active subscription required`                            | 可借鉴：把「谁在花我的额度」变成显式判断（P0-3 的鉴权就是这件事）                 |
| Liftoscript 可编程计划       | 用户写 if 规则改重量，程序即代码                                       | **明确不要**。超出两人使用场景，也违反「AI 与用户都不直接改计划」的红线           |
| 字段级 LWW / CRDT / 事件溯源 | 多端合并的通用解法                                                     | **明确不要**。两人低频，`herfit_write_plan` 的版本互斥已经够用，调试成本不划算    |
| habitbox 每周仪式            | 各自记录 + 每周 10 分钟一起复盘，避免并排比较                          | 改造后借鉴，见第四节                                                              |

## 六、验收命令

```bash
npm run check     # tsc，必须无输出
npm test          # 92 项（改完 P0-2 / P1 应增加）
npm run build     # 构建通过
PLAYWRIGHT_BROWSERS_PATH=.cache/playwright-browsers npm run test:e2e        # 38 项演示
HERFIT_TEST_CLOUD=1 PLAYWRIGHT_BROWSERS_PATH=.cache/playwright-browsers npm run test:e2e   # 4 项云端
npx prettier --check docs/*.md    # 文档格式
```

## 七、如果只有一天

做 **P0-1 + P0-3 的客户端部分**：先把副本推上远端（20 分钟），再加节流与鉴权（半天）。这两件一件防灾难、一件防漏钱，都不改变用户看到的产品。
把 P0-2 留到有完整一天的时候做——它要动 schema、提交路径和 E2E，半途停下会留下「一半可追溯」的状态，比不做更糟。
