"""
Real-Time Call Analyzer — FastAPI Entry Point

يشغّل في عملية واحدة:
  • سيرفر الويب + الـ Dashboard + WebSocket (/ws/voice)
  • بوت Discord الذي يراقب المكالمات ويبثّ النتائج لحظياً
"""

import asyncio
import logging
import os
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response

import config
from websocket_handler import broadcast, router as ws_router

logging.basicConfig(
    level  = logging.INFO,
    format = "%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)

# ── Discord bot lifecycle ──────────────────────────────────────────────────
_bot = None          # CallMonitorBot instance
_bot_task = None     # asyncio.Task running the bot


@asynccontextmanager
async def lifespan(app: FastAPI):
    """يشغّل بوت Discord مع السيرفر (داخل نفس العملية) ويوقفه عند الإغلاق."""
    global _bot, _bot_task

    if not config.validate():
        logger.warning("⚠️  بعض الإعدادات غير مكتملة — بعض الميزات قد لا تعمل.")
    logger.info("🚀 Call Analyzer يعمل على http://%s:%s", config.HOST, config.PORT)

    # تحميل البوت خارج حلقة الأحداث حتى لا نُجمّد السيرفر
    loop = asyncio.get_running_loop()

    def _load_bot_module():
        logger.info("⏳ تجهيز بوت Discord (قد يستغرق لحظات)...")
        import discord_bot
        return discord_bot

    try:
        discord_bot = await loop.run_in_executor(None, _load_bot_module)
        if not discord_bot.TOKEN:
            logger.warning("لا يوجد DISCORD_TOKEN — السيرفر يعمل لكن البوت متوقف.")
        else:
            # نمرّر broadcast حتى يبثّ البوت مباشرةً لكل Dashboard (بدون HTTP)
            _bot = discord_bot.create_bot(broadcaster=broadcast)
            _bot_task = asyncio.create_task(discord_bot.run_bot(_bot))
            logger.info("🤖 بدء تشغيل بوت Discord داخل نفس العملية...")
    except Exception as e:
        logger.error("فشل تحميل بوت Discord: %s", e, exc_info=True)

    yield   # ← السيرفر يعمل هنا

    # ── إيقاف ──
    if _bot is not None:
        try:
            await _bot.close()
        except Exception:
            pass
    if _bot_task is not None:
        _bot_task.cancel()


app = FastAPI(title="Real-Time Call Analyzer", version="2.0.0", lifespan=lifespan)

# ── CORS ───────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["*"],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# ── WebSocket + API routes ─────────────────────────────────────────────────
app.include_router(ws_router)

# ── Frontend static files ──────────────────────────────────────────────────
# جذر واجهة SCM (login.html + لوحات الأدوار) — بجانب مجلد voice-model:
#   smart-call-monitor/voice-model/  ↔  smart-call-monitor/frontend/
SCM_FRONTEND_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "frontend")
)

_NO_CACHE = {"Cache-Control": "no-cache, no-store, must-revalidate"}

# نُقدّم صفحات HTML مُحدّدة فقط بمسارات صريحة (آمن) — لا نعمل mount للمجلد كله
# حتى لا نكشف ملفات حسّاسة (مثل voice-model/.env) على الويب.
_PAGES = {
    "/login.html":                              os.path.join(SCM_FRONTEND_DIR, "login.html"),
    "/agent-dashboard/agent-dashboard.html":    os.path.join(SCM_FRONTEND_DIR, "agent-dashboard", "agent-dashboard.html"),
    "/admin-dashboard/admin-dashboard.html":    os.path.join(SCM_FRONTEND_DIR, "admin-dashboard", "admin-dashboard.html"),
    "/manager-dashboard/manager-dashboard.html":os.path.join(SCM_FRONTEND_DIR, "manager-dashboard", "manager-dashboard.html"),
    "/supervisor-dashboard/supervisor-dashboard.html": os.path.join(SCM_FRONTEND_DIR, "supervisor-dashboard", "supervisor-dashboard.html"),
}


def _make_page_route(file_path: str):
    async def _serve():
        if os.path.isfile(file_path):
            return FileResponse(file_path, headers=_NO_CACHE)
        return Response("الصفحة غير موجودة", status_code=404)
    return _serve


for _url, _path in _PAGES.items():
    app.add_api_route(_url, _make_page_route(_path), methods=["GET"])


@app.get("/")
async def root_redirect():
    # الجذر يوجّه لصفحة تسجيل الدخول
    return RedirectResponse(url="/login.html")


@app.get("/favicon.ico")
async def favicon():
    return Response(status_code=204)


@app.get("/health")
async def health():
    import whisper_service
    return {
        "status"          : "ok",
        "stt_engine"      : "whisper",
        "whisper_model"   : config.WHISPER_MODEL,
        "whisper_device"  : config.WHISPER_DEVICE,
        "whisper_language": config.WHISPER_LANGUAGE,
        "whisper_ready"   : whisper_service.is_ready(),
        "text_cleaner"    : config.TEXT_CLEANER_ENABLED,
        "dialect_hints"   : config.DIALECT_INTERPRETER_ENABLED,
        "emotion_engine"  : config.EMOTION_ENGINE_ENABLED,
        "llm_model"       : config.LLM_MODEL,
        "llm_url"         : config.OLLAMA_BASE_URL,
    }


if __name__ == "__main__":
    uvicorn.run(
        "app:app",
        host      = config.HOST,
        port      = config.PORT,
        reload    = config.RELOAD,
        log_level = "info",
    )