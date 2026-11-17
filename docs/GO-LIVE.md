# 接通真实 Supabase 项目

目标：把本机演示模式切换成你自己项目上的共享模式。全程免费，不需要信用卡。

**只有前三步需要你在浏览器里做**，其余都可以在终端完成。不要把 `service_role` 密钥或数据库密码贴到聊天或提交到 Git。

---

## 1. 创建项目（约 3 分钟）

1. 打开 https://supabase.com ，用 GitHub 或邮箱注册。
2. New project，填写：
   - Name：`herfit`
   - **Region：`Southeast Asia (Singapore)`** 或 `Northeast Asia (Tokyo)` —— 离你最近，手机访问延迟明显更低。选定后不能改。
   - Database Password：随机生成并自己保存好（后面用 CLI 推送迁移时才需要）。
3. 等 2 分钟左右，项目状态变成 `Active`。

## 2. 关闭公开注册，创建两个账号（约 2 分钟）

1. 左侧 **Authentication → Sign In / Providers**，关掉 **Allow new users to sign up**，也关掉匿名登录。
2. **Authentication → Users → Add user → Create new user**，建两个：
   - 邮箱填你们各自的；
   - 勾选 **Auto Confirm User**（不勾会收不到确认邮件）；
   - 密码自己定，记下来。
3. 回到 Users 列表，把两个用户的 **UUID** 各复制一份（形如 `3f2a…-…`）。

## 3. 应用数据库迁移（约 2 分钟）

左侧 **SQL Editor → New query**，按顺序执行两个文件，**每个文件单独一次**，执行完再执行下一个：

1. `supabase/migrations/20261116000100_shared_workspace.sql`
2. `supabase/migrations/20261116000200_stage3_profiles_plans.sql`

然后打开 `supabase/bootstrap-example.sql`，把第 5、6 行的两个占位 UUID 换成第 2 步拿到的真实 UUID，整段粘贴执行。

它只做三件事：建一个空间、把你们俩设为成员、放两个空档案位。**不会写入任何健康数据。**

> 想用命令行而不是 SQL Editor：`npx supabase link --project-ref <项目ref>` 再 `npx supabase db push`。
> 本机没有 Docker，`supabase start`（本地整套服务）用不了，但 `link` + `db push` 直连远端数据库，不需要 Docker。

## 4. 填写本机配置

项目 **Settings → API Keys** 里复制 Project URL 和 **publishable** key（`sb_publishable_…`），然后在本项目根目录建 `.env.local`：

```dotenv
VITE_HERFIT_MODE=cloud
VITE_SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxx
```

`.env.local` 已在 `.gitignore` 里，不会被提交。

## 5. 自检

```powershell
npm run verify:cloud
```

脚本会检查：配置格式 → 认证服务 → 数据接口 → 8 张表与 2 个函数是否存在。全部打勾再往下走。

**这一步能抓到的典型问题**：密钥填成了 `service_role`、URL 少了 `https://`、迁移只跑了第一个文件。

## 6. 本机跑起来

```powershell
npm run dev
```

用第 2 步的账号登录，会看到「建立档案位 1」。填完档案 → 训练页生成计划 → 确认 → 开始今天的训练 → 逐组打卡 → 保存。

再用**无痕窗口**登录另一个账号，确认能看到同一份数据、能切到档案位 2。这一步验证的是真实的 RLS，不是本机模拟。

## 7. 部署到 Cloudflare Pages（可选，但真机要用）

1. 把项目推到 GitHub 私有仓库。
2. Cloudflare Dashboard → Workers & Pages → Create → Pages → 连接 Git 仓库。
3. 构建设置：Build command `npm run build`，Output directory `dist`。
4. **Settings → Environment variables** 填上面三项（`VITE_HERFIT_MODE` / `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY`），Production 与 Preview 都填。
5. 部署完成后用手机打开 `*.pages.dev`。

> `*.pages.dev` 在国内部分网络会被干扰。如果手机打不开，就在 Cloudflare 里绑一个便宜域名（¥30–60/年），这是整个项目唯一值得花钱的地方。

## 8. 免费额度的两个坑

| 坑                      | 后果                            | 对策                                                   |
| ----------------------- | ------------------------------- | ------------------------------------------------------ |
| 连续 7 天低活跃自动暂停 | 服务断开，需手动去控制台 Resume | 你们每天用就不会触发；长期停用后记得先 Resume          |
| 免费版没有自动备份      | 误删表或写错迁移没有回滚点      | 「我的 → 导出本机数据」定期导一份 JSON；重要变更前先导 |

想自动保活，可以在 GitHub 仓库加一个每周跑一次的 Action 请求一次 `herfit_snapshot`（未登录会返回 401，但仍算活动）。可选，不做也行。

---

## 卡住时看这里

| 现象                             | 原因                                          | 处理                                   |
| -------------------------------- | --------------------------------------------- | -------------------------------------- |
| 登录提示「无法登录」             | 账号没 Auto Confirm，或注册被关闭但账号不存在 | 控制台 Users 里确认状态是 Confirmed    |
| 登录后提示「无法访问此共享空间」 | `bootstrap-example.sql` 没执行，或 UUID 填错  | 重跑第 3 步的 bootstrap，核对 UUID     |
| 自检说缺表                       | 只执行了第一个迁移                            | 补执行 `20261116000200_…sql`           |
| 自检说密钥格式不对               | 复制成了 anon 以外的密钥                      | 只用 `sb_publishable_…`                |
| 保存时提示「记录已在另一处修改」 | 两个人在同一秒改了同一条                      | 刷新后重新提交，这是有意设计的冲突保护 |
