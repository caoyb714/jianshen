@echo off
chcp 65001 >nul
cd /d "%~dp0"
set "npm_config_cache=%~dp0.cache\npm"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.12 或更新的 LTS 版本。
  pause
  exit /b 1
)
if not exist node_modules (
  echo 正在安装项目依赖，首次运行需要网络。
  call npm ci
  if errorlevel 1 (
    echo 依赖安装失败，请检查网络和上面的错误信息。
    pause
    exit /b 1
  )
)
echo 请在浏览器打开终端接下来显示的网址。关闭本窗口将停止预览。
call npm run dev
pause
