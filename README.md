# Smart Call Monitor (SCM)

نظام متكامل لمراقبة وتحليل مكالمات خدمة العملاء **لحظيًا** (Discord voice → تفريغ → تحليل ذكاء اصطناعي → لوحات حسب الدور) مع مصادقة وأدوار وقاعدة بيانات Supabase.

---

## 🧩 المكوّنات (3 أجزاء تشتغل مع بعض)

| الجزء | المجلد | المنفذ | المسؤوليّة |
|------|--------|:-----:|-----------|
| **Node API** | `backend/` | `3000` | المصادقة (JWT/Supabase) + APIs الأدمن/المدير + قاعدة البيانات |
| **Voice Model** | `voice-model/` | `8080` | تحليل المكالمات اللحظي (Discord + Whisper محلي + LLM محلي) + WebSocket `/ws/voice` + **تقديم صفحات الواجهة** |
| **Frontend** | `frontend/` | — | صفحات HTML ثابتة (تسجيل الدخول + لوحات الأدوار) — تتقدّم من الموديل على `8080` |

> الواجهة بتتقدّم من منفذ الموديل (`8080`) عشان تبقى من **نفس أصل** الـ WebSocket (بدون مشاكل CORS)، أما الـ APIs (تسجيل الدخول وغيره) فبتروح للـ Node على `3000`.

---

## 📂 هيكل المشروع

```
smart-call-monitor/
├─ backend/                      # Node.js (Express) API — :3000
│  ├─ src/
│  │  ├─ modules/{auth,admin,manager}/   # routes + controllers + validation لكل دور
│  │  ├─ services/  repositories/        # منطق العمل + الوصول لقاعدة البيانات
│  │  ├─ middleware/  config/  utils/
│  │  ├─ database/migrations/            # سكيمة Supabase (SQL)
│  │  └─ server.js  app.js               # نقطة الدخول
│  ├─ .env(.example)  package.json
│
├─ voice-model/                  # Python (FastAPI) — :8080
│  ├─ app.py                     # الدخول: ويب + صفحات + WebSocket + بوت Discord (عملية واحدة)
│  ├─ discord_bot.py             # التقاط الصوت + التقطيع + التفريغ + التحليل + التقرير
│  ├─ whisper_service.py         # تحويل الصوت لنص عبر Whisper المحلي (faster-whisper، GPU)
│  ├─ llm_service.py             # التحليل اللحظي + التقرير النهائي (LM Studio/Ollama)
│  ├─ websocket_handler.py  config.py
│  ├─ coaching_kb.json  libopus-0.dll
│  ├─ requirements.txt  .env(.example)  Dockerfile  docker-compose.yml
│
├─ frontend/                     # صفحات HTML ثابتة (تتقدّم من voice-model)
│  ├─ login.html
│  ├─ agent-dashboard/agent-dashboard.html        # لوحة الموظف (المراقبة اللحظية)
│  ├─ admin-dashboard/admin-dashboard.html
│  ├─ manager-dashboard/manager-dashboard.html
│  └─ supervisor-dashboard/supervisor-dashboard.html
│
├─ start-all.bat  / start-all.ps1   # تشغيل الجزأين مع بعض (ويندوز)
├─ README.md  .gitignore
```

---

## 🚀 التشغيل (بضغطة واحدة)

- **دبل-كليك** على [`start-all.bat`](start-all.bat)
- أو من PowerShell: `powershell -ExecutionPolicy Bypass -File .\start-all.ps1`

هيفتح نافذتين (Node + الموديل) ويفتح المتصفح على صفحة الدخول.

ثم افتح: **http://localhost:8080/login.html**

### التشغيل اليدوي (نافذتين منفصلتين)
```powershell
# 1) Node API على 3000
cd backend ; npm run dev

# 2) موديل التحليل على 8080
cd voice-model ; python app.py
```

---

## 🔑 تدفّق الدخول والأدوار

`login.html` بيبعت لـ `http://localhost:3000/api/auth/login`، وبعد النجاح بيوجّه حسب الدور:

| الدور | الوجهة |
|------|--------|
| `agent` | `agent-dashboard/agent-dashboard.html` — **يبدأ تحليل المكالمات تلقائيًا** عند الدخول |
| `admin` | `admin-dashboard/admin-dashboard.html` |
| `manager` | `manager-dashboard/manager-dashboard.html` |
| `supervisor` | `supervisor-dashboard/supervisor-dashboard.html` |

لوحة الموظف بتتصل بالموديل عبر `ws://localhost:8080/ws/voice`. ممكن تجاوز المضيف بـ `?voice=HOST:PORT` أو `localStorage.voice_backend`.

---

## ⚙️ المتطلّبات (مرّة واحدة)

```powershell
cd backend ; npm install                      # مكتبات الـ Node API
cd ..\voice-model ; pip install -r requirements.txt   # مكتبات الموديل
```

كمان لازم يكون شغّال:
- **LM Studio** (أو Ollama) على `http://127.0.0.1:1234/v1` مع نموذج محمّل — للتحليل والتقرير.
- **توكن Discord** في `voice-model/.env` (`DISCORD_TOKEN`) — مع تفعيل *Message Content Intent*.
- بيانات **Supabase** في `backend/.env`.
- **ffmpeg** على PATH، و Python 3.11+.

اختياري — عشان "نسيت كلمة المرور" يبعت الكود بالإيميل فعليًا:
- بيانات **SMTP** في `backend/.env` (`SMTP_HOST` / `SMTP_USER` / `SMTP_PASS`) — خطوات Gmail App Password في [`backend/.env.example`](backend/.env.example).
- من غيرها النظام بيشتغل عادي، بس الكود بيتطبع في لوج الخادم بدل ما يتبعت.
- لازم تشغّل [`supabase/migrate.sql`](supabase/migrate.sql) مرة عشان جدول `password_reset_otps` يتعمل.

> تفاصيل إعداد الموديل ونصائح الأداء واستكشاف الأخطاء: [`voice-model/README.md`](voice-model/README.md).

---

## 🔒 ملاحظات أمان
- صفحات الواجهة بتتقدّم بمسارات صريحة من `app.py` (مش mount للمجلد كله) عشان ما نكشفش `voice-model/.env` أو ملفات الصوت على الويب.
- ملفات `.env` و`node_modules` و`__pycache__` و`_debug_audio/` و`*.wav` كلها متجاهَلة في `.gitignore`.
