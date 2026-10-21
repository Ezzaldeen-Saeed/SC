"""
WebSocket Handler — Dashboard Broadcaster
──────────────────────────────────────────
• يقبل اتصالات Dashboard عبر /ws/voice
• يستقبل تحديثات من بوت Discord عبر POST /api/bot_update
• يبثّ كل شيء فوراً لجميع الشاشات المفتوحة
"""

import asyncio
import json
import logging

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect
from starlette.websockets import WebSocketState

logger = logging.getLogger(__name__)
router = APIRouter()

# ── قائمة الاتصالات المفتوحة ───────────────────────────────────────────────
_dashboards: list[WebSocket] = []
_lock = asyncio.Lock()


async def _add(ws: WebSocket):
    async with _lock:
        _dashboards.append(ws)


async def _remove(ws: WebSocket):
    async with _lock:
        if ws in _dashboards:
            _dashboards.remove(ws)


async def _broadcast(payload: dict):
    """يبثّ الـ payload لكل Dashboard مفتوح ويُزيل المغلقة تلقائياً."""
    dead: list[WebSocket] = []
    text = json.dumps(payload, ensure_ascii=False)

    async with _lock:
        targets = list(_dashboards)

    for ws in targets:
        try:
            if ws.client_state == WebSocketState.CONNECTED:
                await ws.send_text(text)
            else:
                dead.append(ws)
        except Exception as e:
            logger.warning("فشل إرسال للـ Dashboard: %s", e)
            dead.append(ws)

    for ws in dead:
        await _remove(ws)


async def broadcast(payload: dict):
    """
    واجهة عامة للبثّ — يستخدمها بوت Discord (داخل نفس العملية)
    وكذلك نقطة /api/bot_update. تبثّ الـ payload لكل Dashboard مفتوح.
    """
    await _broadcast(payload)


# ── WebSocket endpoint ─────────────────────────────────────────────────────
@router.websocket("/ws/voice")
async def ws_dashboard(websocket: WebSocket):
    await websocket.accept()
    await _add(websocket)
    logger.info("✅ Dashboard جديد اتصل — الإجمالي: %d", len(_dashboards))

    # أرسل رسالة ترحيب
    await websocket.send_text(json.dumps(
        {"type": "system_log", "message": "تم الاتصال بسيرفر المراقبة ✅", "level": "INFO"},
        ensure_ascii=False
    ))

    try:
        while True:
            msg = await websocket.receive()

            # أغلق بنظافة عند فصل العميل (تجنّب RuntimeError من استدعاء receive بعد الفصل)
            if msg.get("type") == "websocket.disconnect":
                break

            # استقبال أوامر من الـ Dashboard (مثلاً END_CALL)
            if "text" in msg:
                try:
                    data = json.loads(msg["text"])
                    cmd  = data.get("command", "")
                    if cmd == "END_CALL":
                        logger.info("Dashboard طلب إنهاء المكالمة.")
                        # يمكن هنا إرسال إشعار للبوت لو أردت
                    elif cmd == "CLEAR":
                        await websocket.send_text(json.dumps(
                            {"type": "clear"}, ensure_ascii=False
                        ))
                except json.JSONDecodeError:
                    pass   # نص عادي — تجاهل

    except WebSocketDisconnect:
        logger.info("Dashboard أغلق الاتصال.")
    except Exception as e:
        logger.error("خطأ في WebSocket: %s", e, exc_info=True)
    finally:
        await _remove(websocket)
        logger.info("Dashboard أُزيل — الإجمالي: %d", len(_dashboards))


# ── HTTP endpoint: بوت Discord يبعت التحديثات هنا ─────────────────────────
@router.post("/api/bot_update")
async def receive_from_bot(request: Request):
    """
    يستقبل JSON من بوت Discord ويبثّه لكل الـ Dashboards.

    أنواع الـ payload المتوقعة:
    • {"type": "realtime_transcript", "transcript": "..."}
    • {"type": "realtime_analysis",  "analysis": "..."}
    • {"type": "post_call_report",   "report": {...}}
    • {"type": "system_log", "message": "...", "level": "INFO|WARNING|ERROR"}
    """
    try:
        data = await request.json()
    except Exception:
        return {"status": "error", "detail": "invalid JSON"}

    msg_type = data.get("type", "unknown")
    logger.info("📨 استلمت من البوت: type=%s", msg_type)

    await broadcast(data)
    return {"status": "ok", "dashboards": len(_dashboards)}