# HerFit 开发约定

先读 README.md、docs/PRD.md、docs/HANDOFF.md、docs/STAGE3.md、docs/FITNESS_RULES.md。

- 产品是两人私人健康管理 PWA，不以减重为目标。不要加入体重排名、热量赤字、连续打卡惩罚。
- v0.3 包含本机演示与可配置的 Supabase 共享模式，以及动作库、规则引擎、计划与逐组打卡。
- 保持 React + TypeScript + Vite，页面按功能拆分，演示数据与持久层分离。
- 动作库与规则引擎是纯数据与纯函数，**不要在里面加网络请求、随机数或 AI 调用**；改动规则必须同步 `tests/engine.test.ts`。
- 动作文案恒为「未经专业审核」。不得在界面、文档或提交信息里写成「已审核」「专业处方」。`LIBRARY_REVIEWED` 保持 false，除非有真实审核记录。
- 计划必须在用户确认后才写入；不得自动改写已生效计划，也不得自动加减负荷。`suggest()` 只产出建议。
- 未经授权不要创建线上账号、公开部署健康数据、使用付费 API。
- 后续 Supabase 数据必须由共享空间成员 RLS 隔离；前端只允许 publishable key；禁止 service_role。
- 所有数据库改动进入 supabase/migrations（新文件，不改已发布的迁移）；成员添加/删除不得授予普通客户端直接改表权限。
- 一个空间最多两个档案位，`unique(workspace_id, slot)` 与 RPC 双重保证。
- 离线队列和推送不在当前范围。正式云端写入等待确认，失败保留表单且明确提示。
- 破坏性操作二次确认；导出数据明确包含私人信息；禁止把真实健康数据加入源码或测试。
- 执行 `npm run check`、`npm test`、`npm run build`；交互变更执行 `npm run test:e2e`。记录未测试的真机/后端边界。
- 每次交接更新 docs/HANDOFF.md；不要把计划中的功能写成已完成。
