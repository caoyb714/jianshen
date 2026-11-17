# HerFit v0.3

照顾好身体，也照顾好自己。A little better, every day。

默认启动本机演示，档案、指标和历史均为虚构示例。v0.3 完成阶段 3：44 个家居动作的动作库、确定性规则引擎、可确认的周计划、逐组打卡与组间休息计时。云端仍是可选的 Supabase 共享模式，接入步骤见 [阶段 2 接入说明](docs/STAGE2.md)，阶段 3 的规则与边界见 [阶段 3 说明](docs/STAGE3.md)。

动作文案由本项目自行撰写，**未经专业审核**，不构成训练处方。

## 快速运行

要求 Node.js >=22.12（建议近期 LTS）、npm。项目已附 package-lock.json。

```powershell
cd <你的项目路径>\herfit
npm ci
npm run dev
```

打开终端显示的网址，默认 http://127.0.0.1:5173 。不要双击 index.html。

Windows 也可双击 `启动HerFit.cmd`；首次运行会安装依赖，之后直接启动本机预览。关闭该终端窗口会停止预览。

```powershell
npm test                 # 数据层单元测试
npm run build            # TypeScript 检查 + 生产构建 + PWA 静态资源
npm run preview          # 本机查看 dist，默认端口 4173
npx playwright install chromium --only-shell
npm run test:e2e          # 桌面和手机尺寸 Chromium 测试
```

启动 preview 前请停止同端口的 dev。e2e 使用 4173 并可启动自己的 Vite dev server。正式部署前另做生产模式 PWA 验证和真实 iOS/Android 测试。

## 可以体验

| 页面   | 可操作内容                                                                                                                                         |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 首页   | 示例今日训练、按真实本地日期汇总每周运动、饮水、睡眠入口、精力选择                                                                                 |
| 训练   | 按档案生成周计划（预览→确认）、负荷调整建议（预览→确认生效）、今日动作清单、本周安排；逐组填写次数与负荷、组间休息计时、换动作、不适停止、训练反馈 |
| 动作库 | 44 个动作按模式/器械/关键词筛选，含步骤、要点、常见误差、注意事项、替代动作                                                                        |
| 记录   | 饮水增减、睡眠、精力、三项生活习惯、可选围度/体重、可展开训练历史                                                                                  |
| 成长   | 近 7/28 天运动/睡眠/饮水/精力趋势、训练容量、本周完成次数（监督视角）、动作进步曲线、身体变化折线、身体历史                                        |
| 我的   | 两个档案位切换、档案编辑、身体限制确认、隐藏体重、JSON 导出、按档案清空、重载示例、安装说明                                                        |

记录保存在 localStorage 的 `herfit.demo.v2`（旧键 `v1` 会在首次读取时自动迁移）。保存失败有提示，不会说已同步；损坏数据不会静默覆盖，可导出原文再清空。显示体重的开关只改变可见性，**不会删除历史数据，导出仍包含它**。

## 目录与接手

```text
src/app/          页面外壳、本机状态与持久化反馈
src/components/   共享表单、弹窗、精力选择
src/domain/       数据模型、示例库、本地日期、持久层、聚合
src/pages/        五个主页面与训练详情/反馈
public/           本地素材、字体、PWA 图标、Cloudflare 响应头/路由
supabase/         阶段 2 迁移、双成员初始化模板、CLI 配置
tests/            Vitest 与 Playwright 行为测试
docs/             需求、架构、数据库、安全、训练规则、验收与交接
```

下一位 AI 请先读 [交接说明](docs/HANDOFF.md)、[开发约定](AGENTS.md) 和 [阶段 2 接入说明](docs/STAGE2.md)。先完成真实 Supabase 项目接入验收，再进入阶段 3 的审核动作库、训练模板与个性化规则。

## 部署边界

构建输出为 `dist`。Cloudflare Pages 的 build command 为 `npm run build`，output directory 为 `dist`。配置方案见 [Cloudflare React 部署指引](https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/)。

`dist/_headers` 由构建生成，云端模式会将准确的 Supabase origin 加入 CSP。Vite 本地服务器不模拟这些响应头，部署后应检查线上响应。

PWA 只缓存静态应用文件，不存在后台同步或离线云端写入队列。localhost 只能在当前电脑访问；手机需要正式 HTTPS 地址或后续专用测试环境。未宣称已通过手机实机安装验证。

## 素材

插画由内置 ImageGen 为此项目生成，字体是自托管 Noto Serif SC 标题子集，许可见 `public/fonts/OFL.txt`。图标使用 Lucide；应用安装图标为自制。没有运行时外部图片/字体请求。详情见 [ASSETS.md](docs/ASSETS.md)。
