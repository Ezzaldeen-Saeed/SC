# SMART CALL MONITOR — FINAL PRODUCTION PACKAGE
## Shot‑by‑shot capture + edit guide · grounded in the REAL implementation

> **This is the production/capture bible.** It maps the approved (v2) storyboard onto the **actual** Smart Call Monitor code — real pages, real element IDs, real Arabic labels, real charts. Every "capture" instruction points at something that exists in the repo. The creative bible (look, music, color) lives in `SCM-DEMO-VIDEO-PLAN.md`; this file is what the editor/camera operator executes.
>
> **Runtime:** ~10:00 (17 scenes). **Delivery:** 1080p H.264 (+4K master), 60 fps, −14 LUFS.
> **Narration:** provided in **Arabic + English** per scene (text only — you record it). UI is Egyptian Arabic; subtitles in the opposite language of your chosen VO.

---

## 0. WHAT I VERIFIED, BUILT, AND CANNOT DO (read first)

**Inspected against the real code:** `login.html`, `agent-dashboard/*` (HTML + `agent.js`), `admin-dashboard/*` (HTML + `charts.js`), the voice pipeline (`voice-model/*`), backend modules, and the Supabase schema. All scene references below use the **real** element IDs and Arabic labels.

**Built for you this session (now real, not a mockup):** the **Sentiment Timeline Replay**. It is implemented inside `frontend/agent-dashboard/agent.js` → `renderReport()`. When a post‑call report renders, a new full‑width card **«إعادة تشغيل مشاعر العميل» (تحليل بعد المكالمة)** appears at the **top of the report**, draws the customer's emotional arc across the call, and **auto‑plays** a moving head with a per‑turn caption. It derives the arc from the **real saved transcript** (the same Egyptian‑Arabic emotion markers the backend uses) and **anchors the final point to the report's real `customer_sentiment`**. It is fully guarded (can never break the rest of the report) and `node --check` passes. *(You saw a faithful preview in chat.)*

**What I cannot do (so you must capture these on your configured machine):** I cannot run your private stack — **Supabase credentials, LM Studio, the local Whisper model, and the Discord token are not available to me**, so I cannot log in, generate a real analyzed call, or screenshot live data without fabricating it (which your rules forbid). Therefore **all live/data screenshots in §3 must be recorded by you** on the running system. I provide exact, real‑UI capture instructions so there's no guesswork.

### Storyboard ⇄ reality reconciliation (changes from v2)
| v2 assumption | Reality → what this package does |
|---|---|
| Generic "agent dashboard" | Real page `agent-dashboard.html`: call‑hero with states (غير متصل→جارٍ الاتصال→متصل·جاهز→**مكالمة مباشرة**→انتهت المكالمة), `transcript-box`, `analysis-box`, floating `coach-alert`, post‑call `report-section`, `log-box`. |
| "Audio upload" demo step | **Removed — does not exist.** Demo is the **live Discord call** path. |
| Live sentiment meter during call | **Not a thing.** Replaced by the **post‑call Sentiment Timeline Replay** (now built) inside the report. |
| Single "admin dashboard" | Real admin has 7 views: نظرة عامة / التحليل اللحظي / سجل المكالمات / العملاء / إدارة المستخدمين / الهيكل التنظيمي / سجل التدقيق, plus a call‑detail modal with PDF. |
| Generic charts | Real charts (`charts.js`): line **حجم المكالمات** (14d), doughnut **توزيع المشاعر**, doughnut **أنواع المكالمات**, horizontal bar **أعلى الموظفين أداءً**, **خريطة كثافة المكالمات** (heatmap). |

### Capture environment — bring the system up (run order)
1. **Supabase**: run `supabase/migrate.sql`; seed realistic Egyptian‑Arabic data (≈6–10 agents under a supervisor/manager, ~50 calls of mixed sentiment) so KPIs/charts/rankings look alive.
2. **LM Studio**: load `arabic-orpo-llama-3-8b-instruct`, start the local server (`127.0.0.1:1234`).
3. 🔒 **All‑local config** (literally true on camera — cloud code was removed): defaults are already fully local. Verify at `http://localhost:8080/health` (`stt_engine: whisper` + local LLM URL `127.0.0.1:1234`).
4. **Backend (Node)**: `:3000`. **Voice service (FastAPI)**: `:8080` (serves the frontend + WebSocket + Discord bot). Use `start-all.bat`/`start-all.ps1`.
5. **Discord**: bot in a server with a voice channel (it auto‑joins on first human). Two people (or two devices) = agent + customer voices for diarization.
6. **Recording**: OBS, 2560×1440 or 4K, 60 fps; clean browser profile; dark theme; notifications OFF; browser zoom 110–125%; cursor click‑highlight ON.

### The Hero Call script (act this out so the demo + replay land)
Because the Sentiment Timeline Replay is derived from the **real transcript**, the scripted call must actually contain the emotional arc. Have the "customer" say lines with these beats (Egyptian Arabic):
1. **(محبط)** «النت فاصل عندي من امبارح ومحدش بيرد عليّا.»
2. **(غاضب)** «بقالي يومين بكلّمكم وكل مرة تقولوا هيتحل — أنا زهقت بصراحة!» ← *this triggers the live coaching card.*
3. *(agent follows the AI suggestion: apologizes + says checking the line now)*
4. **(محايد)** «طب ماشي، لو هتظبطوه دلوقتي تمام.»
5. **(سعيد)** «آه بقى شغّال دلوقتي، الحمد لله. تمام، شكراً ليكم — حضرتك ساعدتني فعلاً.»
This yields: a live **تحذير/توجيه** card mid‑call, a final report with recovered sentiment **سعيد**, and a replay arc محبط→غاضب→محايد→سعيد. **Keep the agent dashboard open after the call** — the report (and replay) stays on screen until «مسح الشاشة», so you can re‑film/screenshot it calmly.

### Global look & sound (summary — full detail in `SCM-DEMO-VIDEO-PLAN.md` §3)
Palette: bg `#0A0E14`, AI violet `#7C5CFF`, **local/secure mint `#2BD9A6`**, warn `#FFB020`, alert `#FF4D6D`. Type: Inter (EN) / Tajawal (AR) / JetBrains Mono (code). Motion: expo‑out easing, slow push‑ins, left→right data flow. Screen recordings always sit in a floating browser frame (radius 14, soft shadow, ≤6° tilt) with spotlight callouts. Music map & SFX per §3.4. Master −14 LUFS.

---

# SCENES

> Per scene: **(1) Scene # · (2) Duration · (3) Exact screen recording · (4) Exact screenshots · (5) UI to highlight · (6) Motion graphics · (7) Camera · (8) On‑screen text · (9) Subtitle text · (10) Editing · (11) Transition · (12) SFX · (13) Music · (14) Arabic narration · (15) English narration**
> Timecodes assume ~10:00 total.

---

## SCENE 1 — HOOK
1. **Scene #:** 1
2. **Duration:** 0:00–0:22 (22s)
3. **Exact screen recording:** None (cinematic). *Optional:* a 2s out‑of‑focus glimpse of the agent `transcript-box` filling, to be revealed later.
4. **Exact screenshots:** None.
5. **UI to highlight:** None.
6. **Motion graphics:** A single audio **waveform** draws across black, then shatters into particles and fades. Faint counter "1,000,000+" ghosts up and dims.
7. **Camera:** Push‑in from black to a point of light (the waveform); slow drift over dark call‑center B‑roll.
8. **On‑screen text:** (0:06) "Millions of calls every day." (0:15) "Almost none are ever heard again."
9. **Subtitle text:** — (match on‑screen text in VO language's opposite).
10. **Editing:** Maximum restraint; grain + vignette; let one sound carry it. No logos yet.
11. **Transition:** Fade through black → S2.
12. **SFX:** Lone piano note + sub drone; soft boom on the shatter.
13. **Music:** Tense cinematic swell, ~70 BPM (starts barely there).
14. **Arabic narration:** «كل يوم… ملايين المكالمات بتحصل حوالين العالم. ومعظمها… محدش هيسمعه تاني أبدًا. عميل غاضب… وعد ما اتنفّذش… فرصة إننا نتحسّن — بتضيع في اللحظة اللي بتقفل فيها المكالمة.»
15. **English narration:** "Every day, millions of customer calls happen around the world. And almost none of them will ever be heard again. A frustrated customer. A promise not kept. A chance to do better — gone the moment the line goes dead."

---

## SCENE 2 — THE PROBLEM
1. **Scene #:** 2
2. **Duration:** 0:22–1:05 (43s)
3. **Exact screen recording:** None (or generic stock of a supervisor scrubbing audio — not the product).
4. **Exact screenshots:** None.
5. **UI to highlight:** None.
6. **Motion graphics:** Grid of 100 call icons; **99 grey out, 1 lights red** ("1 in 100"). Three red stamps land in sequence: **بطيء / غير موضوعي / لا يتوسّع** (Slow / Subjective / Doesn't scale). Two reviewer icons show 7/10 vs 4/10 for the *same* call.
7. **Camera:** Slow push on the grid; handheld micro‑move on B‑roll faces.
8. **On‑screen text:** "Manual QA: ~1% of calls reviewed" · "SLOW · SUBJECTIVE · TOO LATE".
9. **Subtitle text:** Arabic/English mirror of narration.
10. **Editing:** Land each stamp on a beat; the red single‑call is the memorable image.
11. **Transition:** Glow wipe → S3.
12. **SFX:** Ticking clock; thud on each stamp.
13. **Music:** Uneasy pulse + low strings, ~90 BPM.
14. **Arabic narration:** «بالنسبة لأي شركة، مركز الاتصال هو الواجهة الحقيقية للعلامة التجارية. مكالمة وحدة وحشة ممكن تخسّرك عميل للأبد. لكن الحقيقة المؤلمة: الشركات تقريبًا مش عارفة بيتقال إيه فعلًا في مكالماتها. المراجعة بتتعمل يدويًا — مشرف بيسمع مكالمة من كل مية، بعد ما تكون خلصت بأيام. عملية بطيئة، وتقييمها بيختلف من شخص للتاني، ومبتكبرش مع حجم الشركة.»
15. **English narration:** "For any company, the call center is the brand. One bad call can lose a customer for life. But the uncomfortable truth is: companies have almost no idea what's actually being said on their calls. Today, quality is checked by hand — a supervisor reviews maybe one call in a hundred, days after it ended. It's slow, it's subjective, and it doesn't scale."

---

## SCENE 3 — THE SOLUTION (INTRODUCING SCM)
1. **Scene #:** 3
2. **Duration:** 1:05–1:50 (45s)
3. **Exact screen recording:** A 3s blurred‑then‑sharpening glimpse of the **agent dashboard** (R‑LIVE, see S6) and the **admin overview** (R‑ADMIN), framed in the floating browser.
4. **Exact screenshots:** `SCM-logo` (export from brand assets) for the reveal.
5. **UI to highlight:** None yet (teaser only).
6. **Motion graphics:** Logo build in brand gradient + light‑leak + boom. Three feature pills assemble: **يسمع · يوجّه لحظيًا · يكتب التقرير فورًا** (Listens · Coaches Live · Reports Instantly). The S2 "1‑in‑100" grid reappears tiny and **all 100 light mint**. Quick **Before→After** sting: a slow red "manual" bar vs a fast mint "SCM" bar ("Hours → Seconds").
7. **Camera:** Pull‑back from the all‑mint grid to the full logo; slow push‑in.
8. **On‑screen text:** "SMART CALL MONITOR" · "Real‑time AI Quality Assurance & Live Agent Coaching" · "Hours → Seconds".
9. **Subtitle text:** mirror.
10. **Editing:** This is the Apple‑style reveal — a beat of near‑silence + swell before the logo. Keep the Before/After to ~5s.
11. **Transition:** In: match from grid. Out: push‑through depth → S4.
12. **SFX:** Impact boom on the logo; snappy tick on the "After" bar.
13. **Music:** Hopeful lift begins, ~108 BPM.
14. **Arabic narration:** «نقدّم لكم: Smart Call Monitor. نظام بيسمع المكالمة وهي بتحصل، يفهم الكلام، ويوجّه الموظف لحظة بلحظة. وأول ما المكالمة تخلص، بيكتب تقرير جودة كامل… أوتوماتيك. كل مكالمة — مش واحدة من مية، لأ… كلهم. اللي كان بياخد ساعات شغل يدوي… بقى ثواني.»
15. **English narration:** "Introducing Smart Call Monitor. It listens to a call as it happens, understands the conversation, and coaches the agent in real time. The second the call ends, it writes a complete quality report — automatically. Every call — not one in a hundred — all of them. What used to take hours of manual work now takes seconds."

---

## SCENE 4 — WHY LOCAL AI? 🔒 (centerpiece)
1. **Scene #:** 4
2. **Duration:** 1:50–2:45 (55s)
3. **Exact screen recording:** **R‑PROOF‑LM** — LM Studio window: model `arabic-orpo-llama-3-8b-instruct` loaded + local server running. **R‑PROOF‑HEALTH** — browser at `http://localhost:8080/health` showing local whisper model + `llm_url: http://127.0.0.1:1234/v1`. *Optional dramatic:* **R‑OFFLINE** — unplug the network cable, run an analysis, it still works.
4. **Exact screenshots:** `health-json.png`, `lmstudio-loaded.png`.
5. **UI to highlight:** In `/health`, spotlight `"stt_engine":"whisper"` (+ `"whisper_model":"large-v3"`, `"whisper_device":"cuda"`) and `"llm_url":"...127.0.0.1..."`. In LM Studio, the loaded model name + "Server running".
6. **Motion graphics:** Two panels with a **building outline**. **Cloud AI (red):** Customer audio → Internet → Cloud API → Third‑party server → Response; the audio packet **leaves the building** across a dashed border; red chips: Privacy risks · API costs · Internet dependency · Latency; a red "cloud‑off" slash. **Local AI (mint):** Customer audio → Our server → Speech‑to‑Text → Local LLM → Dashboard, all **inside the glowing building, never crossing out**; mint chips: Complete privacy · Zero API cost · Offline · Faster · Enterprise security · Data never leaves the company. Stat‑pop **"0 bytes to the cloud."**
7. **Camera:** Switch to privacy gradient; orbit a local mini‑PC B‑roll; push to the proof insets.
8. **On‑screen text:** "CLOUD AI" vs "LOCAL AI" + the chips · "Private by design. Local by default."
9. **Subtitle text:** mirror.
10. **Editing:** Show the **real** LM Studio + `/health` — proof beats animation. Wording is the verifiable version (local‑first). Make "data never crosses the building" unmissable.
11. **Transition:** Data‑line draw → S5.
12. **SFX:** Clean chime on "0 bytes to the cloud"; soft denied‑buzz on the cloud slash.
13. **Music:** Intimate, confident, ~110 BPM.
14. **Arabic narration:** «بس ده اللي بيخلّي Smart Call Monitor مختلف فعلًا. أغلب أدوات الذكاء الاصطناعي بتبعت صوت عميلك على الإنترنت، لسيرفرات شركة تانية، عشان يتحلّل. يعني مكالمات عملائك الخاصة… بتطلع برّه شركتك. إحنا بنعمل العكس: الذكاء الاصطناعي بيشتغل على جهازنا، جوّه الشركة. الصوت بيدخل، والنتيجة بتطلع — ومحاجة بتلمس الإنترنت. يعني خصوصية كاملة، ومفيش فواتير API، وبيشتغل حتى من غير إنترنت، وبيانات العميل عمرها ما بتخرج من الشركة. لبنك، أو مستشفى، أو جهة حكومية — دي مش ميزة إضافية… دي كل الحكاية.»
15. **English narration:** "But here's what makes Smart Call Monitor truly different. Most AI tools send your customers' audio over the internet, to someone else's servers, to be processed. We do the opposite. Our AI runs on our own machine, inside the building. The audio goes in, the answer comes out — and nothing ever touches the internet. Complete privacy. No API bills. It works offline. And customer data never leaves the company. For a bank, a hospital, a government office — that isn't a nice‑to‑have. It's the whole game."

---

## SCENE 5 — ARCHITECTURE (simple, animated)
1. **Scene #:** 5
2. **Duration:** 2:45–3:20 (35s)
3. **Exact screen recording:** Optional 2s insets under nodes: `transcript-box` filling (STT) and `report-box` (dashboard).
4. **Exact screenshots:** None required.
5. **UI to highlight:** None (motion graphics).
6. **Motion graphics:** The signature pipeline draws left→right with flowing particles: **🎙️ صوت المكالمة → 📝 تحويل الكلام لنص (محلي) → 🧠 ذكاء اصطناعي محلي → { } نتائج منظّمة → 🗄️ الخادم + Supabase → 📊 لوحات التحكم.** A mint 🔒 badge sits over STT+LLM ("on‑premise"). A realtime bolt loops back from dashboards.
7. **Camera:** Travel along the pipeline as each node lights.
8. **On‑screen text:** node labels + "End‑to‑end, in real time — on‑premise."
9. **Subtitle text:** mirror.
10. **Editing:** Keep it conceptual and clean; this motif recurs in S8–S10. Consistent left→right direction.
11. **Transition:** The first node ("صوت") match‑cuts into the agent dashboard of S6.
12. **SFX:** Soft "data travel" whooshes per node; tick on each node lock.
13. **Music:** Clean glossy tech build, ~112 BPM.
14. **Arabic narration:** «طيب، بيشتغل إزاي؟ نتابع مكالمة واحدة من أولها لآخرها. الصوت بيدخل. الكلام بيتحوّل لنص. النص بيروح لنموذج ذكاء اصطناعي محلي بيفهمه ويرجّع نتائج منظّمة. الخادم بيخزّنها، واللوحات بتعرضها — كل ده في الوقت الحقيقي. خط معالجة واحد، من البداية للنهاية، وتحت سيطرتك بالكامل.»
15. **English narration:** "So how does it work? Let's follow one call from start to finish. Audio comes in. Speech becomes text. The text goes to a local AI model that understands it and returns structured results. The backend stores them, and the dashboards bring them to life — all in real time. One pipeline, end to end, fully under your control."

---

## SCENE 6 — AGENT DEMO: LIVE CALL (the meat)
1. **Scene #:** 6
2. **Duration:** 3:20–4:30 (70s)
3. **Exact screen recording:** **R‑LIVE** on `agent-dashboard.html` during the Hero Call: (a) idle state, then click **«بدء الاتصال»** (`#toggle-btn`) → status pill `#status-badge` goes to **«متصل · جاهز»**; (b) the Discord call starts → call‑hero `#callHero` flips to **«مكالمة مباشرة الآن»**, `#live-dot` active, `#ch-timer` counting; (c) **`#transcript-box`** fills line‑by‑line with **[الموظف]/[العميل]** turns; (d) when the customer's angry line lands, **`#analysis-box`** gets a coaching card AND the floating **`#coach-alert`** pops with **«الإجراء الآن»**.
4. **Exact screenshots:** `agent-idle.png`, `agent-live-transcript.png`, `agent-coach-alert.png` (the card moment).
5. **UI to highlight:** `#toggle-btn` (start), the status pill states, `#callHero` title, the transcript role chips (الموظف/العميل), and **the coach‑alert** (`.coach-alert` → `.ca-action`) — this is the hero highlight. If `#engineBadge` shows, spotlight it = the live engine.
6. **Motion graphics:** "LIVE" badge + red REC dot. Spotlight zoom to `#transcript-box`, then a hard spotlight on the coach‑alert when it appears, with an English translation chip of the suggested action. Mint 🔒 "on‑premise" corner badge.
7. **Camera:** Locked on UI with gentle push‑ins; quick spotlight zooms to active regions.
8. **On‑screen text:** "LIVE DEMO" · "Live transcription" · "AI coaching — live, on‑premise" · (translated suggestion chip).
9. **Subtitle text:** English translation of the Arabic transcript lines + the coaching action.
10. **Editing:** **Time the narration "…and instantly, the AI steps in" to the coach‑alert appearing** (nudge the clip if needed). Record several takes of the card firing; pick the cleanest. Keep the customer calm before the angry beat for contrast.
11. **Transition:** Hard cut on beat from S5; flows into S7.
12. **SFX:** UI tick per transcript line; a soft riser as the customer escalates → a clean "chime/hit" when the coach‑alert pops.
13. **Music:** Confident demo groove, ~120 BPM, suspense building under the escalation.
14. **Arabic narration:** «يلا نشوفه شغّال — على مكالمة حقيقية. دي شاشة الموظف. أول ما المكالمة تبدأ، كل كلمة بتظهر قدّامه لحظيًا. وفي نفس الوقت، الذكاء الاصطناعي بيسمع — دور بدور — وبيقرّر هل الموظف محتاج مساعدة دلوقتي. بصّوا… العميل بدأ يزعل. ومباشرةً، النظام بينبّه الموظف ويقترح عليه يقول إيه بالظبط: يعتذر للعميل، ويأكّدله إنه بيراجع الخط دلوقتي. ده مدرّب… في كل مكالمة… في اللحظة المناسبة بالظبط.»
15. **English narration:** "Let's see it on a real call. This is the agent's screen. The moment the conversation starts, every word appears live. In the background, the AI is listening — turn by turn — deciding whether the agent needs help. Watch: the customer is getting angry. Instantly, the system alerts the agent and suggests exactly what to say — acknowledge the frustration and confirm you're checking the line right now. That's a coach, on every call, at the exact moment it's needed."

---

## SCENE 7 — CALL ENDS
1. **Scene #:** 7
2. **Duration:** 4:30–4:50 (20s)
3. **Exact screen recording:** **R‑END** — the call ends (everyone leaves the Discord channel, or the customer hangs up): `#callHero` flips to **«انتهت المكالمة — جاهزة للحفظ»**; `#log-box` shows system logs e.g. **«📞 انتهت المكالمة — جاري إعداد التقرير النهائي…»**.
4. **Exact screenshots:** `agent-call-ended.png`, `logs-processing.png`.
5. **UI to highlight:** `#callHero` state change; the newest lines in `#log-box`.
6. **Motion graphics:** A subtle "processing" pulse over the screen; the pipeline motif from S5 advances to the "analysis" stage. Timer `#ch-timer` freezes (server‑authoritative duration).
7. **Camera:** Slow push toward the log panel.
8. **On‑screen text:** "Call ended — analysis begins."
9. **Subtitle text:** mirror.
10. **Editing:** Short connective beat; build a little anticipation for the report. Don't linger.
11. **Transition:** Glow wipe → S8.
12. **SFX:** A soft "powering up" swell; gentle processing hum.
13. **Music:** Groove eases into a curious "neural" texture, ~112 BPM.
14. **Arabic narration:** «المكالمة خلصت. ومن هنا، الشغل الحقيقي بيبدأ — النظام بيجهّز التقرير النهائي.»
15. **English narration:** "The call ends. And from here, the real work begins — the system prepares the final report."

---

## SCENE 8 — SPEECH‑TO‑TEXT (post‑call, accurate)
1. **Scene #:** 8
2. **Duration:** 4:50–5:20 (30s)
3. **Exact screen recording:** **R‑STT** — `#log-box` lines that actually appear: **«📝 إعادة تفريغ بدقة أعلى … قد يستغرق دقيقة»**, **«🗣️ تم فصل المتحدثين (الموظف/العميل)»**, then **`#transcript-box`** is **replaced** by the cleaner `final_transcript` (diarized الموظف/العميل lines), and **«💾 اتحفظ صوت المكالمة … جودة الصوت جيدة»**.
4. **Exact screenshots:** `logs-retranscribe.png`, `transcript-final-diarized.png`.
5. **UI to highlight:** The log lines (re‑transcribing, speakers separated, audio quality); the upgraded transcript with clean الموظف/العميل chips.
6. **Motion graphics:** Audio chain (simple): waveform → "clean" → "split speakers" → text. A toggle "fast live ↔ accurate final." Mint 🔒 "runs locally."
7. **Camera:** Macro on the waveform motif; push into the transcript replacement.
8. **On‑screen text:** "Speech → Text — locally" · "Hybrid: fast live + accurate final" · "Who said what."
9. **Subtitle text:** mirror + English of a sample transcript line.
10. **Editing:** Show the live→final transcript swap as a satisfying "sharpening." Keep jargon out of VO; detail lives in committee notes.
11. **Transition:** The finished text flows into the AI node of S9.
12. **SFX:** Soft typing under text; a "snap into focus" on the final transcript.
13. **Music:** Curious neural texture continues.
14. **Arabic narration:** «أول خطوة: تحويل الصوت لنص — وده بيحصل على جهازنا. النظام بيستخدم نموذج سريع أثناء المكالمة، وبعد ما تخلص، بيعيد تفريغ المكالمة كلها بنموذج أدق، وبيفصل مين الموظف ومين العميل — عشان النص اللي هيتحلّل يكون نضيف وواضح.»
15. **English narration:** "First, speech becomes text — right here on our machine. A fast model handles the live call; once it ends, the system re‑transcribes the whole conversation with a more accurate model and separates the agent from the customer — so the text we analyze is clean and clear."

---

## SCENE 9 — LOCAL AI ANALYSIS (post‑call)
1. **Scene #:** 9
2. **Duration:** 5:20–5:55 (35s)
3. **Exact screen recording:** **R‑ANALYZE** — `#log-box` showing **«وصل التقرير من الخادم — جاري العرض…»**, and (optional, powerful) **R‑PROOF‑LM** again showing LM Studio actively generating (token activity) = local inference.
4. **Exact screenshots:** `lmstudio-inference.png`, `logs-report-arrived.png`.
5. **UI to highlight:** The "report arrived" log; LM Studio activity.
6. **Motion graphics:** A glowing "brain" (LLM) node ingests the transcript and emits a structured **{ }** card; small labels orbit it: sentiment · scores · summary · recommendations. "✓ generated locally" stamp. Keep it conceptual — no schemas on screen.
7. **Camera:** Push into the brain node; settle as the { } locks.
8. **On‑screen text:** "Local AI reads the call" · "Sentiment · Scores · Summary · Next steps" · "Generated locally."
9. **Subtitle text:** mirror.
10. **Editing:** This is the only deep‑AI beat; stay at "reads → understands → structured results." (Prompt design, structured output, etc. live in §Committee Notes for Q&A.)
11. **Transition:** The { } card scales/match‑cuts into the report appearing (S10/S11).
12. **SFX:** Soft "thinking" pulse; a warm resolve as the { } locks.
13. **Music:** Brain theme peaks then resolves.
14. **Arabic narration:** «بعد كده، النموذج اللغوي المحلي بيقرا المكالمة ويفهمها: مشاعر العميل، المشكلة، ومستوى الجودة. وبيرجّع النتيجة منظّمة وجاهزة للعرض — كل ده من غير ما يخرج أي بيانات برّه الجهاز.»
15. **English narration:** "Then the local language model reads the call and understands it — the customer's sentiment, the problem, the quality. It returns the result, clean and structured, ready to display — all without any data leaving the machine."

---

## SCENE 10 — ⭐ SENTIMENT TIMELINE REPLAY (new, real, in the report)
1. **Scene #:** 10
2. **Duration:** 5:55–6:45 (50s)
3. **Exact screen recording:** **R‑REPLAY** — top of the post‑call report: the card **«إعادة تشغيل مشاعر العميل · تحليل بعد المكالمة»** (`#sentiment-replay-card`). It **auto‑plays** on render: the white head dot (`#srHead`) travels the arc while `#srCaption` shows each customer turn + its sentiment chip. Then click **«تشغيل الإعادة»** (`#srPlay`) to replay on camera.
4. **Exact screenshots:** `replay-full-arc.png` (final state showing البداية/الأدنى/النهاية chips), `replay-midplay.png` (head mid‑arc with an angry caption).
5. **UI to highlight:** The arc line + colored band stripes (غاضب/محبط/محايد/سعيد), the moving `#srHead`, the `#srCaption` (turn text + sentiment), the **«تحليل بعد المكالمة»** badge (proves it's post‑processing), and the start/low/end chips.
6. **Motion graphics:** Let the component's own animation be the star; add a thin lower‑third "Post‑call analysis — reconstructed from the transcript." Optionally mirror the arc as a large background graphic synced to the head. Color the journey end mint (سعيد) for the emotional payoff.
7. **Camera:** Slow push‑in following the head along the curve; ease as it reaches سعيد.
8. **On‑screen text:** "Sentiment Timeline Replay" · "Frustrated → Angry → Neutral → Satisfied" · "Analyzed after the call."
9. **Subtitle text:** English of each customer turn as the head passes it.
10. **Editing:** This is the WOW. Sync music to the head: tension as it dips to غاضب, release as it climbs to سعيد. The on‑screen badge **«تحليل بعد المكالمة»** must be legible — it keeps you honest (this is post‑call, not live). Use the `#srPlay` re‑trigger for a clean second pass if needed.
11. **Transition:** The head's final mint point match‑cuts down into the full report (S11).
12. **SFX:** A held riser as the head sits in غاضب → a warm, rising "resolve" as it climbs to سعيد; soft tick at each turn marker.
13. **Music:** Held breath → triumphant release, ~120 BPM.
14. **Arabic narration:** «وهنا الجزء الأحلى. النظام بيعيد تشغيل رحلة مشاعر العميل عبر المكالمة كلها — تحليل بيتعمل بعد المكالمة. شوفوا الرحلة: العميل بدأ محبط… وصل لقمة الغضب… وبعدين، مع تدخّل الموظف، المشاعر بدأت تهدا… لحد ما العميل اللي كان غاضب… بقى راضي. مش مجرد درجة في الآخر — دي القصة كلها، اتفهمت واتحلّلت بعد المكالمة.»
15. **English narration:** "And here's the best part. The system replays the customer's emotional journey across the entire call — analyzed after it ends. Watch the arc: the customer starts frustrated… peaks in anger… and then, as the agent steps in, the mood eases… until the customer who began furious… ends up satisfied. Not just a single score — the whole story, understood and analyzed after the call."

---

## SCENE 11 — THE AI REPORT
1. **Scene #:** 11
2. **Duration:** 6:45–7:25 (40s)
3. **Exact screen recording:** **R‑REPORT** — scroll the `#report-box` below the replay: the status cards **«هل تم حل المشكلة»** / **«شعور العميل»**, the six score bars (**أداء الموظف / رضا العميل / الاحترافية / التواصل / حل المشكلات / التعاطف** with `.score-fill`), and the list cards (**نقاط القوة / نقاط الضعف / فرص ضائعة / توصيات للمشرف / لحظات حرجة / الخطوات التالية**). Then click **«تحميل (تفريغ + تقرير) PDF»** (`#pdf-btn`) → PDF opens.
4. **Exact screenshots:** `report-scores.png`, `report-lists.png`, `report-pdf.png`.
5. **UI to highlight:** Sentiment status pill, the score bars (esp. أداء الموظف / التعاطف), the recommendations list, the PDF button.
6. **Motion graphics:** Spotlight each block in turn; if your editor wants animated gauges, overlay count‑ups synced to the real bar fills. "✓ 0 manual effort" stamp.
7. **Camera:** Slow push‑in as the report scrolls; small spotlight zooms.
8. **On‑screen text:** "From hang‑up to full report — automatically" · "Summary · Sentiment · 6 scores · Recommendations" · "One‑click PDF."
9. **Subtitle text:** English labels of each section.
10. **Editing:** Ensure the shown report is **consistent with the Hero Call** (recovered sentiment, sensible scores). End on the satisfying PDF.
11. **Transition:** The report shrinks into a card and flies up into the admin grid (S12).
12. **SFX:** Soft ticks as cards spotlight; chime on PDF open.
13. **Music:** Satisfying resolve.
14. **Arabic narration:** «وده التقرير — اتكتب لوحده، في ثواني. ملخّص لما حصل، شعور العميل الحقيقي، وأداء الموظف — التعاطف والتواصل وحل المشكلة، كل واحد بدرجة. نقاط القوة، نقاط الضعف، اللحظات الحرجة، وتوصيات للمشرف بالخطوات الجاية. تقييم كامل، من غير أي مجهود يدوي — وبضغطة واحدة تصدّره PDF.»
15. **English narration:** "And here's the report — written by itself, in seconds. A summary of what happened, the customer's true sentiment, and the agent's performance — empathy, communication, problem‑solving — each scored. Strengths, weaknesses, critical moments, and recommendations for the supervisor. A complete evaluation, with zero manual effort — and a one‑click PDF."

---

## SCENE 12 — ADMIN DASHBOARD (overview)
1. **Scene #:** 12
2. **Duration:** 7:25–7:55 (30s)
3. **Exact screen recording:** **R‑ADMIN** on `admin-dashboard.html` → view **«نظرة عامة»**: the hero with **«ملخّص الذكاء الاصطناعي»** (`#aiSummaryText`), the hero stats (`#heroHealth`, `#heroCallsToday`, `#heroActiveAgents`, `#heroNegative`), and the 4 KPI cards (`#kpiUsers`, `#kpiCalls`, `#kpiActive`, `#kpiCustomers`). Show the **live counter** `#liveCount` («مكالمة حيّة») ticking (a new call landing via realtime).
4. **Exact screenshots:** `admin-overview.png`, `admin-kpis.png`.
5. **UI to highlight:** Sidebar nav (`نظرة عامة` active), the AI summary card, the 4 KPIs, the live counter.
6. **Motion graphics:** KPI count‑up overlays synced to real values; pulse the live counter when a call lands; spotlight the sidebar to show the system's breadth.
7. **Camera:** Pan across KPIs; push to the AI summary.
8. **On‑screen text:** "The whole operation — live" · "KPIs · AI summary · Live calls."
9. **Subtitle text:** English of the KPI labels.
10. **Editing:** Fast, confident; ~4s per element. Establish that this is the management cockpit.
11. **Transition:** Push to the analytics section (S13) within the same view (scroll).
12. **SFX:** Soft ticks on KPI count‑ups; pulse on the live counter.
13. **Music:** Confident montage groove, ~118 BPM.
14. **Arabic narration:** «وكل ده بيتجمّع للإدارة — لحظيًا. المنظومة كلها في نظرة واحدة: ملخّص ذكي لليوم، أرقام أساسية، وعدّاد بالمكالمات الحيّة دلوقتي. قرارات مبنية على بيانات… مش على تخمين.»
15. **English narration:** "And it all rolls up to management — live. The whole operation at a glance: a smart daily summary, key numbers, and a live counter of calls happening right now. Decisions backed by data — not guesswork."

---

## SCENE 13 — ANALYTICS (real charts)
1. **Scene #:** 13
2. **Duration:** 7:55–8:30 (35s)
3. **Exact screen recording:** **R‑ANALYTICS** — the **«التحليلات المتقدمة»** grid: line **«حجم المكالمات»** (`#chartCallsDay`), doughnut **«توزيع المشاعر»** (`#chartSentiment`), doughnut **«أنواع المكالمات»** (`#chartTypes`), horizontal bar **«أعلى الموظفين أداءً»** (`#chartScores`), and the **«خريطة كثافة المكالمات»** heatmap (`#heatmap`). Then jump to **«سجل المكالمات»**: type in `#callSearch`, click a sentiment chip (`#callSentChips`), and open a row → **call‑detail modal** («تفاصيل المكالمة والتحليل») with its **«تقرير PDF»**.
4. **Exact screenshots:** `admin-charts.png`, `admin-heatmap.png`, `admin-calls-table.png`, `admin-call-detail.png`.
5. **UI to highlight:** Each chart title in turn; the agent‑ranking bars; the heatmap hot cells; the calls search + sentiment filter; the call‑detail modal.
6. **Motion graphics:** Let charts draw on; spotlight each with a 3–6 word label; a "live filter" callout as the search narrows the table.
7. **Camera:** Guided tour: pan charts → cut to calls table → push into the detail modal.
8. **On‑screen text:** "Call volume · Sentiment · Types · Agent ranking · Heatmap" · "Search · Filter · Drill‑down · PDF."
9. **Subtitle text:** English of the chart titles.
10. **Editing:** Punchy "look how much it does"; cuts on the beat; ~4s per feature.
11. **Transition:** Push‑through depth → S14.
12. **SFX:** Draw‑on swooshes for charts; tick on filter.
13. **Music:** Montage groove continues.
14. **Arabic narration:** «وتحليلات أعمق: حجم المكالمات بمرور الوقت، توزيع المشاعر، أنواع المكالمات، وترتيب الموظفين حسب الجودة — وكمان خريطة بتوضّح إمتى بييجي الضغط. تقدر تبحث، تفلتر، وتفتح أي مكالمة بتفاصيلها الكاملة وتقريرها — وتصدّرها PDF.»
15. **English narration:** "And deeper analytics: call volume over time, sentiment distribution, call types, and agents ranked by quality — plus a heatmap of when the pressure hits. You can search, filter, open any call in full detail with its report, and export it to PDF."

---

## SCENE 14 — WHO IT'S FOR (INDUSTRIES)
1. **Scene #:** 14
2. **Duration:** 8:30–8:55 (25s)
3. **Exact screen recording:** None (motion graphics).
4. **Exact screenshots:** None.
5. **UI to highlight:** None.
6. **Motion graphics:** A grid of industry tiles lighting in sequence with icons + one‑line "why": **Telecom · Banks 🔒 · Hospitals 🔒 · Insurance 🔒 · Government 🔒 · Support Centers · E‑commerce.** Regulated tiles carry the mint 🔒 (ties back to Local AI).
7. **Camera:** Pull back to the grid; slow drift; highlight the 🔒 tiles.
8. **On‑screen text:** the tile labels + micro‑reasons ("Banks — compliance & privacy", "Hospitals — patient data stays in‑house", "Government — data sovereignty").
9. **Subtitle text:** mirror.
10. **Editing:** ~3s per tile; emphasize that privacy‑sensitive industries are the **best fit** — reinforces the differentiator.
11. **Transition:** Tiles converge into the ROI scene.
12. **SFX:** Soft "light‑up" per tile.
13. **Music:** Bright, optimistic, expanding, ~116 BPM.
14. **Arabic narration:** «وده مش لشركة واحدة بس. أي مكان بيشتغل على المكالمات يقدر يستفيد: شركات الاتصالات بملايين المكالمات، البنوك وشركات التأمين اللي كل كلمة فيها حسّاسة، المستشفيات اللي خصوصية المريض فيها مقدّسة، الجهات الحكومية اللي البيانات لازم تفضل جوّه البلد، ومراكز خدمة العملاء والتجارة الإلكترونية. وعشان الذكاء الاصطناعي بيفضل جوّه الشركة — كل ما بياناتك تكون أكتر حساسية، كل ما النظام يبقى أهم.»
15. **English narration:** "And this isn't for one company. Any business that runs on calls can benefit: telecom operators with millions of calls; banks and insurers, where every word is compliance‑sensitive; hospitals, where patient privacy is sacred; government centers, where data must stay in‑country; support centers and e‑commerce. And because the AI stays in‑house — the more sensitive your data, the more this matters."

---

## SCENE 15 — ROI
1. **Scene #:** 15
2. **Duration:** 8:55–9:30 (35s)
3. **Exact screen recording:** None (motion graphics). *Optional:* a 2s inset of the real report PDF for "reports in seconds."
4. **Exact screenshots:** None.
5. **UI to highlight:** None.
6. **Motion graphics:** Two columns with **animated counters.** Manual (red): `1000 مكالمة → ~500 ساعة → تقارير متأخرة → أخطاء بشرية`. SCM (mint): `1000 مكالمة → معالجة تلقائية → تقارير في ثواني → تقييم ثابت → تكلفة أقل`. Stat‑pops: **"~500 hours → seconds"**, **"1% sampled → 100% reviewed"** (callback to S2), **"Same score, every time."** A dropping cost bar.
7. **Camera:** Two‑column compare; push to the "Hours → Seconds" payoff.
8. **On‑screen text:** "Manual: 1000 calls ≈ 500 hours" / "SCM: reports in seconds" · "1% sampled → 100% understood".
9. **Subtitle text:** mirror.
10. **Editing:** Mark numbers as **illustrative estimates** (assume ~30 min/manual review) unless you have measured data. The "1% → 100%" callback is the emotional close of the business case.
11. **Transition:** Push‑through depth → S16.
12. **SFX:** "Numbers go up" ticks; a satisfying drop‑thud on the cost bar.
13. **Music:** Optimistic build, ~116 BPM.
14. **Arabic narration:** «نحطّها في أرقام. ألف مكالمة تتراجع يدويًا يعني حوالي خمسمية ساعة شغل — بطيئة، ومكلّفة، ومتفاوتة. نفس الألف مكالمة مع Smart Call Monitor بتتعالج أوتوماتيك — تقارير في ثواني، وكل مكالمة بتتقيّم بنفس المعيار، وبتكلفة أقل بكتير. ده الفرق بين إنك تاخد عيّنة من الجودة… وإنك تعرفها كلها.»
15. **English narration:** "Let's put numbers on it. A thousand calls reviewed by hand is roughly five hundred hours of work — slow, costly, inconsistent. The same thousand with Smart Call Monitor are processed automatically — reports in seconds, every call scored the same way, at a fraction of the cost. That's the difference between sampling your quality… and knowing it."

---

## SCENE 16 — FUTURE VISION
1. **Scene #:** 16
2. **Duration:** 9:30–9:55 (25s)
3. **Exact screen recording:** None.
4. **Exact screenshots:** None.
5. **UI to highlight:** None.
6. **Motion graphics:** A roadmap line draws with milestone nodes: `نموذج عربي مصري للتفريغ · دقة أعلى (GPU) · مساعد لحظي للمشرف · ربط بأنظمة الهاتف · تحليلات واتجاهات`. Regulated‑friendly items keep the mint tint ("still local").
7. **Camera:** Forward dolly down the roadmap toward the logo.
8. **On‑screen text:** "Roadmap" + milestone labels.
9. **Subtitle text:** mirror.
10. **Editing:** Ambition, not "what's missing." Tie to identity: "even our future is local."
11. **Transition:** The path leads the camera up toward the logo (S17).
12. **SFX:** Rising "milestone" pings.
13. **Music:** Begins the triumphant finale build, ~100 BPM.
14. **Arabic narration:** «وإحنا لسه في الأول. الجاي: نموذج تفريغ متخصّص في العامية المصرية، دقة أعلى بتسريع كروت الرسوميات، مساعد لحظي للمشرفين، وربط مباشر بأنظمة التليفون الحقيقية. الأساس مبني عشان يكبر.»
15. **English narration:** "And we're just getting started. Next: a speech model tuned for Egyptian Arabic, higher accuracy with GPU acceleration, a live assistant for supervisors, and a direct connection to real phone systems. The foundation is built to grow."

---

## SCENE 17 — CINEMATIC ENDING
1. **Scene #:** 17
2. **Duration:** 9:55–10:25 (30s)
3. **Exact screen recording:** None.
4. **Exact screenshots:** `SCM-logo` (hi‑res, transparent).
5. **UI to highlight:** None.
6. **Motion graphics:** **Black screen.** Logo fades in (brand gradient). The tagline types/fades in slowly. A beat of silence. The pipeline motif (S5) draws once, faint, behind the logo. Then the AASTMT credit fades in. The 🔒 shield‑house glows once and settles.
7. **Camera:** Slow push to the logo; gentle pull to reveal the credit.
8. **On‑screen text:**
   **SMART CALL MONITOR**
   *"Every conversation becomes actionable intelligence."*  (alt: "Every Call. Analyzed. Protected." / "AI that respects privacy.")
   *(then fading in)*
   **Arab Academy for Science, Technology & Maritime Transport**
   **Graduation Project · 2026**
   *(optional: team names · supervisor · GitHub/QR)*
9. **Subtitle text:** Arabic tagline «كل محادثة بتتحوّل لذكاء قابل للتنفيذ.»
10. **Editing:** **Do NOT say "Thank you."** End on the tagline + AASTMT credit. Hold the logo 3s in silence before true black. Last frame: logo + tagline.
11. **Transition:** In: from roadmap. Out: hold black.
12. **SFX:** Final warm "resolve" chord; let it ring; then silence.
13. **Music:** Full triumphant resolve → ritardando → final chord under the logo.
14. **Arabic narration:** «Smart Call Monitor بيثبت حاجة بسيطة: مش لازم تختار بين ذكاء اصطناعي قوي… وحماية الناس اللي بتثق فيك. تقدر يكون عندك الاتنين — لما الذكاء يشتغل بشروطك إنت. Smart Call Monitor. كل محادثة… بتتحوّل لذكاء قابل للتنفيذ.»
15. **English narration:** "Smart Call Monitor proves one thing: you don't have to choose between powerful AI… and protecting the people who trust you. You can have both — when the intelligence runs on your terms. Smart Call Monitor. Every conversation becomes actionable intelligence."

---

# PRODUCTION CHECKLIST
**Bring‑up & capture**
- [ ] Supabase migrated + seeded; LM Studio model loaded; 🔒 cloud flags OFF; `/health` shows local. 
- [ ] Backend `:3000` + voice `:8080` up; Discord bot in a voice channel.
- [ ] Rehearse the **Hero Call script** so the coach‑alert fires and the report ends on **سعيد**.
- [ ] Capture: **R‑PROOF‑LM, R‑PROOF‑HEALTH, R‑OFFLINE** (S4); **R‑LIVE, R‑END** (S6–S7); **R‑STT, R‑ANALYZE** (S8–S9); **R‑REPLAY, R‑REPORT** (S10–S11); **R‑ADMIN, R‑ANALYTICS** (S12–S13).
- [ ] After one good call, **leave the report on screen** to re‑film the replay (`#srPlay`) and report cleanly.
- [ ] Screens at 1440p/4K, 60 fps, notifications off, no real personal data/secrets on screen.

**Edit & finish**
- [ ] Frame every recording in the floating browser mock; spotlight active regions; add English subtitle chips for Arabic UI.
- [ ] Sync S10 music to the replay head (tension at غاضب → release at سعيد). Time S6 narration to the coach‑alert.
- [ ] Keep the **«تحليل بعد المكالمة»** badge legible in S10 (honesty: post‑call, not live).
- [ ] Color‑grade to palette; transitions per the bible; master −14 LUFS; export 1080p (+4K).
- [ ] **No "Thank you"** — end on tagline + AASTMT 2026.
- [ ] Truth pass: local‑first wording (not "never cloud"), ROI marked illustrative, report consistent with its call, no upload step shown.

---

# COMMITTEE Q&A NOTES (how the Sentiment Timeline Replay actually works)
*Be precise if asked.* The replay is a **post‑call** visualization rendered inside the report (`agent.js` → `buildSentimentReplayHtml`). It reconstructs the customer's emotional arc by scanning the **customer turns of the final transcript** for the same Egyptian‑Arabic emotion markers the backend uses (e.g., «زهقت/محدش بيرد/ألغي» negative; «تمام/شكراً/الحمد لله» positive), producing a per‑turn score, then **anchoring the final point to the AI report's overall `customer_sentiment`** so the chart's endpoint matches the model's verdict. It is computed after processing (never live), is fully guarded, and will transparently use a model‑provided `report.sentiment_timeline` if that field is ever added to the analysis. *(For the deeper pipeline — local Whisper hybrid, LM Studio structured output, diarization, fallbacks — see `SCM-DEMO-VIDEO-PLAN.md` §10–11.)*
