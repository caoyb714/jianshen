# 架构与迁移边界

阶段 2 实现以 [STAGE2.md](STAGE2.md) 为准。下文记录 v0.1 演示设计和交接时拟定的迁移方向。

## 当前

React + TypeScript + Vite；Tailwind v4 提供入口，界面视觉由 `src/styles.css` 中命名样式与设计变量控制。Router 分页，除首页外按页面 lazy 加载，Recharts 只进入成长页面 chunk。RHF+Zod 负责档案表单；Zod 同时校验磁盘数据与训练提交。

数据流：页面 → Store.update / setHabit → repository.saveData（先验证并持久化）→ 更新内存 → 显示本机保存结果。写入失败不更新界面数据。没有服务端或 API 请求。localStorage Schema 带 version=1；首次无值时生成示例，首次成功修改时持久化。未知版本/损坏时显示警告、保留原值并阻止普通写入。

日期：每条日志用用户设备本地 YYYY-MM-DD；创建时间用 ISO。周一至周日，日期偏移按本地日历而非固定毫秒，避免夏令时偏移。Store 每 30 秒更新 today。跨设备正式版应明确空间时区（建议 Asia/Shanghai），不要用 UTC 字符串截断充当本地日期。

记录、统计、首页读取同一对象。完整训练：无不适、动作数组非空且所有动作实际组数/次数>0；部分训练保留实际耗时，不计入完整训练数。不适停止单独展示。计时只在训练页面运行，当前未保存草稿离页会丢失，界面已提示。

## 下一阶段

新增异步 Repository 接口（建议 `loadWorkspace`, `saveProfile`, `upsertHabit`, `createWorkout`, `upsertMetric`, `exportWorkspace`），将本机模式与云端模式做成明确分开的 adapter。不要把整份 AppData 每次盲写云端。每条 mutation 等待数据库确认，失败保留用户输入；用 version/updated_at 检测并发覆盖。

登录后根据当前用户查询唯一共享空间及目标 profile。增加 auth loading/unauthenticated/authorized/error 状态。未授权时不加载个人数据；退出清空内存和个人缓存。不要自动把演示数据同步进真实空间。

v0.1 的 VITE_SUPABASE_* 注释变量不会生效。接入时新增 supabase-js 依赖并审查 CSP、RLS、确认来源与会话清理。

## PWA

vite-plugin-pwa 使用 prompt 更新，不强制刷新正在编辑页面；仅 precache 构建静态文件，无 runtimeCaching、BackgroundSync 或推送。离线提示明确仍是本机演示。注册与 HTTPS 真机安装验收见 TEST_PLAN.md。

参考：[Vite PWA React 集成](https://vite-pwa-org.netlify.app/frameworks/react)、[Cloudflare React 部署](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)。
