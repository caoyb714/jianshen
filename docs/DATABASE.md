# 数据库设计（阶段 2 建表，阶段 3 扩展）

以 `supabase/migrations/` 下的迁移为准。当前有两个迁移，按文件名顺序执行：

1. `20261116000100_shared_workspace.sql`：空间、成员、档案、习惯、指标、训练记录、个人设置，RLS 与 RPC。
2. `20261116000200_stage3_profiles_plans.sql`：双档案位、训练计划、逐组训练记录校验、多档案快照。

## 表与关系

| 表                | 核心字段 / 约束                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ |
| workspaces        | id UUID PK, name, created_at；仅预置一个空间                                                                             |
| workspace_members | (workspace_id, user_id) 复合主键，seat 1/2，user_id 唯一（一人一空间）                                                   |
| health_profiles   | id UUID PK, workspace_id FK, **slot smallint 1/2**, payload JSONB, revision；`unique(workspace_id, slot)` 最多两个档案位 |
| habit_logs        | (workspace_id, profile_id, observed_on) PK，payload JSONB                                                                |
| body_metrics      | (workspace_id, profile_id, observed_on) PK，payload JSONB                                                                |
| workout_logs      | (workspace_id, profile_id, id) PK，performed_on DATE，payload JSONB（逐组）                                              |
| training_plans    | (workspace_id, profile_id, id) PK，status active/archived，payload JSONB；部分唯一索引保证每档案只有一份 active          |
| app_settings      | (workspace_id, user_id) PK，payload JSONB（按用户，不按档案）                                                            |

所有业务表含 `created_at / updated_at / created_by / updated_by / revision`。操作人由 `herfit_private.stamp_write()` 触发器基于 `auth.uid()` 写入，客户端不能伪造；只授予 `update(payload)` 等列级权限。

## 为什么用 JSONB

两位用户、单机手机端、字段还在演进。JSONB 让每次调整组次结构不必写迁移，同时用 `valid_payload()` 在 CHECK 约束里做结构化校验，前端被绕过也写不进脏数据。

代价：跨记录聚合（按肌群统计容量）只能在客户端算。数据量在几千条以内可以接受；如果确实需要，再把 `workout_logs.payload.exercises[].sets[]` 拆成 `workout_sets` 表。

## 权限矩阵

| 身份         | 空间/成员                | 档案与健康记录              | 计划            |
| ------------ | ------------------------ | --------------------------- | --------------- |
| 未登录       | 无权限                   | 无权限                      | 无权限          |
| 空间成员 A/B | 读取自己的空间与成员名单 | 读/写本空间且关联合法的数据 | 读/写本空间计划 |
| 非成员 C     | 不可读写                 | 不可读写，即使知道 UUID     | 无权限          |
| 后台管理     | 预置空间与档案位         | 必要运维                    | 发布与清理      |

成员不能从浏览器改 `workspace_members`，也不能把记录转到别的档案或空间：`herfit_write` 先校验成员资格，再由复合外键阻止跨空间拼接。

## 写入约定

`herfit_write(p_workspace, p_profile, p_kind, p_payload, p_expected)`

- `p_kind`：`profile` / `habit` / `metric` / `workout` / `plan` / `settings`。
- `p_expected` 为 `null` 表示新建，非空表示按 `revision` 比较后更新；不匹配返回 `40001`。
- 训练记录用稳定 UUID，重试同一次提交不会重复入库。
- 写入 `plan` 且 `status='active'` 时，先把同档案的其他 active 计划归档。
- 档案位不存在时，仅 `p_kind='profile'` 允许插入；槽位由数据库计算，最多两个。

## 测试要求

`tests/cloud-db.test.ts` 用 PGlite 执行真实迁移并模拟 `auth.uid()`，覆盖：两个档案位上限、跨空间拒绝、成员表自我加入拒绝、审计字段伪造拒绝、同日并发写冲突、逐组载荷非法值拒绝、计划唯一生效、座席撤销后失去访问。不能只靠隐藏 UI。
