@echo off
rem 摸鱼背词 Lite 启动脚本
cd /d "%~dp0"
start "" "%~dp0node_modules\electron\dist\electron.exe" .
