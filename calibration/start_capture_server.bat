@echo off
title ColorTransfer HTTPS 标定服务
cd /d "%~dp0"

echo ============================================================
echo   ColorTransfer 网页端标定服务
echo   启动后请不要关闭本窗口（关闭即停止服务）
echo ============================================================
echo.

python serve_https.py --port 8443

echo.
echo 服务已停止。
pause
