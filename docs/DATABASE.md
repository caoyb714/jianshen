# 数据库设计草案（阶段 2 实施）

阶段 2 迁移见 `supabase/migrations/20261116000100_shared_workspace.sql`。本机 PostgreSQL 已执行迁移并测试 RLS。托管环境还需接入和验收。现行结构以迁移和 [STAGE2.md](STAGE2.md) 为准，下文保留原长期关系设计。

## 表与关系

| 表                | 核心字段 / 约束                                                                                                                                                                                 |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| workspaces        | id UUID PK, name, timezone, created_at, updated_at；仅预置一个空间                                                                                                                              |
| workspace_members | workspace_id FK, user_id FK auth.users, role='admin', joined_at；复合主键(workspace_id,user_id)，最多两名成员由管理端事务保障                                                                   |
| health_profiles   | id UUID PK, workspace_id FK, name, age, height_cm, experience, activity, goals, weekly_days, session_minutes, equipment JSONB, restrictions, restrictions_confirmed_at；UNIQUE(workspace_id,id) |
| body_metrics      | id, workspace_id, profile_id, observed_on DATE, weight_kg nullable, waist_cm nullable, hip_cm nullable；UNIQUE(profile_id,observed_on)                                                          |
| exercise_library  | id, name, target_areas, equipment, instructions JSONB, cautions, substitutions, review_status, reviewed_by, reviewed_at, source_url；只读已审核版本                                             |
| training_plans    | id, workspace_id, profile_id, template_version, version, status, plan JSONB, confirmed_at；已确认版本不可被后台静默替换                                                                         |
| training_sessions | id, workspace_id, profile_id, plan_id, planned_on, plan_snapshot JSONB, status；保留当次计划快照                                                                                                |
| workout_logs      | id, workspace_id, profile_id, session_id nullable, performed_on, duration_seconds, difficulty, discomfort, feeling, exercises JSONB, status；重试依赖稳定 UUID，session_id 可用唯一约束防重复   |
| habit_logs        | id, workspace_id, profile_id, observed_on, water_ml, sleep_hours nullable, energy nullable, meals, protein, plants；UNIQUE(profile_id,observed_on)                                              |
| app_settings      | workspace_id, user_id, show_weight, reminder_preferences；UNIQUE(workspace_id,user_id)                                                                                                          |

个人数据表含 created_at、updated_at、created_by、updated_by。操作人必须由数据库触发器基于 auth.uid() 设置，客户端不可伪造；created_by 不允许事后修改。workspace_id/profile_id/plan_id 等关联需建立组合外键，阻止同一用户有多个空间时把其他空间的 profile 拼进当前行。

数值范围同时由数据库 CHECK 与客户端校验；睡眠/身体指标缺失用 NULL 而非 0；同日合并规则明确；日期与创建时间分别使用 DATE / TIMESTAMPTZ。为 workspace_members(user_id,workspace_id)、各表(workspace_id,profile_id,observed_on) 建索引。

## 权限矩阵

| 身份         | 空间/成员                | 档案与健康记录                  | 动作库                               |
| ------------ | ------------------------ | ------------------------------- | ------------------------------------ |
| 未登录       | 无权限                   | 无权限                          | 当前不开放；可决定仅授权读取已审核项 |
| 空间成员 A/B | 读取自己的空间与成员名单 | 读/写属于本空间且关联合法的数据 | 读已审核版本                         |
| 非成员 C     | 不可读写                 | 不可读写，即使知道 UUID         | 无权限                               |
| 后台管理流程 | 预置空间和成员，有限授权 | 必要运维                        | 发布审核内容                         |

成员不应能从浏览器直接修改 workspace_members：否则可自我加入任意空间/增加第三人。“双方管理员”指业务数据共同管理，并非数据库超级权限。

## RLS 实施要求

所有暴露到 Data API 的个人表启用 RLS，撤销 anon 权限，仅给 authenticated 必要 grants。SELECT/DELETE 检查 USING；INSERT 检查 WITH CHECK；UPDATE 同时检查旧行归属及新行归属。共享空间成员判断与 profile 复合外键共同生效。

如使用 SECURITY DEFINER 成员查询 helper，必须位于受控 schema、固定 search_path、最小 EXECUTE 授权、不暴露任意 SQL，避免成员表递归查询。服务密钥不进入前端。

测试至少覆盖 A/B 双向读写、C/匿名拒绝、伪造 workspace_id/profile_id、转移记录归属、伪造审计用户、成员自我加入、删除跨空间对象和级联影响。每张表逐操作验证，不能仅隐藏 UI。

依据：[Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security)。此处为设计约束，具体 SQL 须在阶段 2 创建迁移并实测。
