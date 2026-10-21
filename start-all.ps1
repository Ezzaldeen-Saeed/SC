# ============================================================
#  Smart Call Monitor - تشغيل كل المكوّنات مع بعض (PowerShell)
#    - Node API     : http://localhost:3000  (تسجيل الدخول + الـ APIs)
#    - Voice Model  : http://localhost:8080  (تحليل المكالمات + WebSocket + الصفحات)
#  الصفحة الرئيسية: http://localhost:8080/login.html
#
#  التشغيل:  powershell -ExecutionPolicy Bypass -File .\start-all.ps1
# ============================================================

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$nodeDir  = Join-Path $root "backend"
$voiceDir = Join-Path $root "voice-model"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  تشغيل نظام Smart Call Monitor..." -ForegroundColor Cyan
Write-Host "  - Node API     : http://localhost:3000"
Write-Host "  - Voice Model  : http://localhost:8080"
Write-Host "============================================================" -ForegroundColor Cyan

# 1) الـ Node backend (المصادقة + الـ APIs) على المنفذ 3000
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location -LiteralPath '$nodeDir'; Write-Host 'SCM Node API (3000)' -ForegroundColor Green; npm start"
)

# 2) باك إند الموديل (Discord + Whisper محلي + WebSocket + خدمة الصفحات) على 8080
Start-Process powershell -ArgumentList @(
    "-NoExit", "-Command",
    "Set-Location -LiteralPath '$voiceDir'; Write-Host 'SCM Voice Model (8080)' -ForegroundColor Green; python app.py"
)

# 3) افتح صفحة تسجيل الدخول بعد لحظات
Start-Sleep -Seconds 5
Start-Process "http://127.0.0.1:5501/frontend/login.html"

Write-Host ""
Write-Host "تم فتح نافذتين للخوادم. اقفلهما لإيقاف النظام." -ForegroundColor Yellow
