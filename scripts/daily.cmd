@echo off
rem 작업 스케줄러가 매일 새벽 실행하는 진입점. 로그는 data\daily.log 에 쌓인다.
cd /d C:\dev\house_pjt
set PYTHONIOENCODING=utf-8
echo. >> data\daily.log
echo ===== %date% %time% ===== >> data\daily.log
.venv\Scripts\python.exe pipeline\daily.py >> data\daily.log 2>&1
echo ===== exit %errorlevel% ===== >> data\daily.log
