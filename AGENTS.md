# HerFit 开发约定

先读 README.md、docs/PRD.md、docs/HANDOFF.md、docs/SECURITY.md。

- 产品是两人私人健康管理 PWA，不以减重为目标。不要加入体重排名、热量赤字、连续打卡惩罚。
- v0.2 包含本机演示与可配置的 Supabase 共享模式。演示与云端数据分开，云端保存须等待成功响应。
- 保持 React + TypeScript + Vite，页面按功能拆分，演示数据与持久层分离。
- 未经授权不要创建线上账号、公开部署健康数据、使用付费 API。
- 不将示例动作称为专业审核。身体限制未确认时，正式规则引擎必须停止自动推荐。
- 后续 Supabase 数据必须由共享空间成员 RLS 隔离；前端只允许 publishable/anon key；禁止 service_role。
- 所有数据库改动进入 supabase/migrations；成员添加/删除不得授予普通客户端直接改表权限。
- 离线队列和推送不在当前范围。正式云端写入等待确认，失败保留表单且明确提示。
- 破坏性操作二次确认；导出数据明确包含私人信息；禁止把真实健康数据加入源码或测试。
- 执行 npm test、npm run build；交互变更执行 npm run test:e2e。记录未测试的真机/后端边界。
- 每次交接更新 docs/HANDOFF.md；不要把计划中的功能写成已完成。
