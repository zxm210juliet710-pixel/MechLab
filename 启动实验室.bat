@echo off
chcp 65001 >nul
title 白日机械实验室 - 本地服务器（保持本窗口打开，关闭即停止服务）
cd /d "%~dp0"
set "PATH=C:\Users\Hawthorn\.local\node-v20.18.1-win-x64;%PATH%"

rem 已有服务在运行就直接打开浏览器
powershell -NoProfile -Command "try{Invoke-WebRequest 'http://127.0.0.1:5173' -TimeoutSec 2 -UseBasicParsing|Out-Null;exit 0}catch{exit 1}"
if not errorlevel 1 (
  start "" http://127.0.0.1:5173
  exit /b
)

echo 正在启动白日机械实验室，约 2~5 秒后浏览器会自动打开...
start "" /b cmd /c "ping 127.0.0.1 -n 6 >nul & start """" http://127.0.0.1:5173"
call npm run dev

echo.
echo 服务已停止。按任意键关闭本窗口。
pause >nul
