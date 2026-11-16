# 阶段 2 · 账号和共享空间

沿用产品方案的两个独立账号与一份共同健康档案。已有五页在演示模式保持可用。配置 Supabase 后进入私有模式，先登录，随后数据库确认空间成员资格。空共享档案由成员首次填写，演示数据不进入真实空间。

- SQL 迁移创建空间、成员、档案、身体指标、习惯、运动记录、个人偏好；训练计划与审核动作库在阶段 3 实施。
- SQL 使用 RLS 与最小列权限。数据库记录操作人并更新版本。每条可编辑记录使用版本比较，冲突重新加载。训练记录使用稳定 UUID，避免同次提交重复入库。
- 浏览器只保留认证会话。共享健康数据在页面内存中，退出或失去访问权限即清除；静态 PWA 缓存不保存 API 响应。
- 数据库测试用 PGlite 运行真实 PostgreSQL SQL，模拟 Supabase 身份声明。浏览器测试另验证演示与云端交互，托管项目与真账号仍需接通验收。

执行顺序：创建迁移和数据库测试 → 云端 Repository 与登录入口 → 接入五页保存与同步 → 构建、测试、部署步骤和交接。

## 接入你们的 Supabase 项目

1. 为 HerFit 创建独立 Supabase 项目。在 Authentication 的配置中关闭 **Allow new users to sign up** 和匿名登录，保留 Email 登录。[Supabase Auth 配置](https://supabase.com/docs/guides/auth/general-configuration)
2. 使用 Supabase CLI 的数据库迁移流程应用本项目的 migration。若使用 SQL Editor，在新项目中执行 `supabase/migrations/20261116000100_shared_workspace.sql` 一次，并记录迁移版本；后续使用 CLI 时应核对远端迁移历史。[Supabase 数据库迁移](https://supabase.com/docs/guides/deployment/database-migrations)
3. 在 Authentication → Users 创建两个已确认的 Email 账号。将这两个用户的 UUID 填到 `supabase/bootstrap-example.sql` 的示例位置，再由管理员在 SQL Editor 执行。脚本只创建一个空间、两个成员席位和一个空档案。
4. 复制 `.env.example` 为 `.env.local`，填写下面三项。获取 publishable key 请使用 Supabase 项目的 Connect / API Keys 页面。[Supabase API keys](https://supabase.com/docs/guides/api/api-keys)

   ```dotenv
   VITE_HERFIT_MODE=cloud
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
   ```

5. 运行 `npm run dev`。先用账号 A 登录和建立档案，记录一杯水。再用独立浏览器标签页或无痕窗口登录账号 B，确认读取同一档案和饮水，保存睡眠后由 A 在「我的」选择「刷新共享记录」。用测试账号验证非成员无法进入，退出后刷新应回到登录页。首次验收只用虚构记录。
6. 后续部署到 Cloudflare Pages 时，把同三项放入构建环境变量，使用 `npm run build` 和 `dist`。构建会生成 `dist/_headers`，CSP 只为配置的 HTTPS 项目 origin 开放连接。请用线上响应头检查 CSP 生效。[Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/)

## 当前行为与边界

- 两位成员共同编辑一个档案、按日习惯和围度、追加训练记录。体重开关按账号隔离。JSON 导出包含空间及记录的操作人标识。
- 同日修改在正常应用写入时按修订号校验。冲突时不会直接覆盖现有云端记录。训练使用固定 UUID，重复发送相同记录不会插入两次。
- 共享数据从 RLS 授权的快照读取，每 20 秒在前台尝试刷新，页面重新获得焦点时也会刷新。当前使用设备本地日期，建议两台设备使用同一时区。
- 云端登录会话保存在当前标签页的 sessionStorage，刷新可保留。健康记录仅保存在内存中。退出隐藏共享页面，认证服务确认后清除会话。网络错误期间保存保留表单。
- 共享记录的批量删除只由数据库管理员执行。以后如需在 App 中开放，先定义双方确认、审计和恢复方式。现版本的清空与重载仅用于本机演示。
- `supabase/config.toml` 可用于本机 CLI 环境。该工具需要单独具备其运行环境后方可运行。此交付不依赖在 Windows 安装 Docker。

## 可复现验收

```powershell
Set-Location -LiteralPath 'E:\codex xiangmu\herfit'
$env:npm_config_cache = Join-Path (Get-Location) '.cache\npm'
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.cache\playwright-browsers'
npm ci
npm test
npm run build
npx playwright install chromium --only-shell
npm run test:e2e
$env:HERFIT_TEST_CLOUD = '1'
npm run test:e2e
Remove-Item Env:HERFIT_TEST_CLOUD
```

PGlite 在内存中建立 PostgreSQL 角色及虚构 Auth 用户，并执行同一份 SQL 迁移。共享浏览器测试使用真实 Supabase JS 客户端，拦截 Auth/RPC HTTP，将权限和读写交给 PGlite。此验收覆盖浏览器到 PostgreSQL 的逻辑，仍需上面第 5 步的托管环境验收。
