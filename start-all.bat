@echo off
chcp 65001 >nul
REM ============================================================
REM  Smart Call Monitor - تشغيل كل المكوّنات مع بعض
REM    - Node API      : http://localhost:3000   (تسجيل الدخول + الـ APIs)
REM    - Voice Model   : http://localhost:8080   (تحليل المكالمات + WebSocket + الصفحات)
REM  الصفحة الرئيسية للموظف: http://localhost:8080/login.html
REM ============================================================

echo.
echo ============================================================
echo   تشغيل نظام Smart Call Monitor...
echo   - Node API     : http://localhost:3000
echo   - Voice Model  : http://localhost:8080
echo ============================================================
echo.

REM 1) الـ Node backend (المصادقة + الـ APIs) على المنفذ 3000
start "SCM Node API (3000)" /D "%~dp0backend" cmd /k "npm start"

REM 2) باك إند الموديل (Discord + Whisper محلي + WebSocket + خدمة الصفحات) على 8080
start "SCM Voice Model (8080)" /D "%~dp0voice-model" cmd /k "python app.py"

REM 3) افتح صفحة تسجيل الدخول بعد لحظات لتشغيل الخوادم
timeout /t 5 >nul
start "" "http://127.0.0.1:5501/frontend/login.html"

echo.
echo تم فتح نافذتين للخوادم. اقفلهما لإيقاف النظام.
echo.
