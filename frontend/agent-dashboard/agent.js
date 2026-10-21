/* =====================================================================
   agent.js — Live Agent Console engine
   ---------------------------------------------------------------------
   WebSocket live transcription/analysis (voice model :8080), customer-first
   save flow + report (Node API :3000), recent calls, KPIs, PDF, profile.
   NEW: a call-state machine (offline → connecting → ready → live → ended)
   that surfaces a real "Live Call" status the moment transcription flows.
   ===================================================================== */
"use strict";

(function () {
  var Agent = window.Agent = {};

  /* ═══ Auth guard (role: agent) ═══ */
  var LOGIN_PAGE = "../login.html";
  function getCurrentUser() { try { return JSON.parse(localStorage.getItem("user")); } catch (e) { return null; } }
  function getAuthToken() { try { return (JSON.parse(localStorage.getItem("session")) || {}).access_token || null; } catch (e) { return null; } }
  function redirectToLogin() { window.location.replace(LOGIN_PAGE); }
  function logout() { if (window.SCM) SCM.audit("LOGOUT"); localStorage.removeItem("session"); localStorage.removeItem("user"); redirectToLogin(); }

  var currentUser = getCurrentUser();
  (function checkAuth() {
    if (!currentUser || !getAuthToken() || currentUser.role !== "agent") redirectToLogin();
  })();

  /* ═══ Connection config (voice model :8080) ═══ */
  var VOICE_BACKEND = (function () {
    var qs = new URLSearchParams(location.search).get("voice");
    if (qs) return qs;
    var stored = localStorage.getItem("voice_backend");
    if (stored) return stored;
    if (location.port === "8080") return location.host;
    return "localhost:8080";
  })();
  var WS_SCHEME = location.protocol === "https:" ? "wss" : "ws";
  var WS_URL = WS_SCHEME + "://" + VOICE_BACKEND + "/ws/voice";
  var RECONNECT_MS = 3000, MAX_LOG_LINES = 200;

  /* ═══ State ═══ */
  var ws = null, reconnectTimer = null, callTimer = null, liveHeartbeat = null;
  var callSeconds = 0, lineCount = 0, isConnecting = false, userClosed = false;
  var callState = "offline";

  var $ = function (id) { return document.getElementById(id); };
  var toggleBtn = $("toggle-btn"), clearBtn = $("clear-btn"), logoutBtn = $("logout-btn");
  var statusBadge = $("status-badge"), transcriptBox = $("transcript-box"), analysisBox = $("analysis-box");
  var logBox = $("log-box"), liveDot = $("live-dot"), durationVal = $("duration-val"), linesVal = $("lines-val");
  var reportSection = $("report-section"), reportBox = $("report-box"), pdfBtn = $("pdf-btn");
  var callHero = $("callHero");

  /* ═══ Call-state machine — the "Live Call" status ═══ */
  var STATES = {
    offline:    { pill: "غير متصل",      orb: "fa-plug-circle-xmark", eyebrow: "غير متصل",        title: "الكونسول غير متصل",            sub: "اضغط «بدء الاتصال» لتشغيل التحليل اللحظي للمكالمات.", kstate: "غير متصل",     knote: "اضغط «بدء الاتصال» للبدء" },
    connecting: { pill: "جارٍ الاتصال",   orb: "fa-plug-circle-bolt",  eyebrow: "جارٍ الاتصال",     title: "جارٍ الاتصال بمحرك التحليل…", sub: "يتم تهيئة محرك التفريغ والتحليل اللحظي.",            kstate: "جارٍ الاتصال", knote: "تهيئة المحرك…" },
    ready:      { pill: "متصل · جاهز",    orb: "fa-circle-check",      eyebrow: "متصل وجاهز",       title: "جاهز لاستقبال المكالمات",      sub: "المحرك يعمل — ستبدأ المراقبة تلقائيًا فور بدء المكالمة.", kstate: "متصل · جاهز", knote: "بانتظار بدء مكالمة" },
    live:       { pill: "مكالمة مباشرة",  orb: "fa-microphone-lines",  eyebrow: "مكالمة مباشرة",     title: "مكالمة مباشرة الآن",           sub: "يتم تفريغ المكالمة وتحليلها لحظيًا لمساعدتك.",         kstate: "مكالمة مباشرة", knote: "التحليل اللحظي يعمل الآن" },
    ended:      { pill: "انتهت المكالمة", orb: "fa-clipboard-check",   eyebrow: "انتهت المكالمة",    title: "انتهت المكالمة — جاهزة للحفظ",  sub: "أدخل بيانات العميل ثم اضغط «حفظ المكالمة».",          kstate: "بانتظار الحفظ", knote: "أدخِل بيانات العميل واحفظ" },
  };
  function setCallState(state) {
    if (!STATES[state]) return;
    callState = state;
    var s = STATES[state];
    if (statusBadge) { statusBadge.setAttribute("data-state", state); var st = $("status-text"); if (st) st.textContent = s.pill; }
    if (callHero) callHero.setAttribute("data-state", state);
    setText("chOrb", ""); var orb = $("chOrb"); if (orb) orb.innerHTML = '<i class="fas ' + s.orb + '"></i>';
    setText("chEyebrowText", s.eyebrow);
    setText("chTitle", s.title); setText("chSub", s.sub);
    setText("kpiState", s.kstate); setText("kpiStateNote", s.knote);
    if (liveDot) liveDot.classList.toggle("active", state === "live");
    var connected = (state !== "offline");
    if (toggleBtn) {
      toggleBtn.innerHTML = connected
        ? '<i class="fas fa-stop"></i> قطع الاتصال'
        : '<i class="fas fa-play"></i> بدء الاتصال';
      toggleBtn.classList.toggle("btn-live", state === "live");
      toggleBtn.classList.toggle("btn-primary", state !== "live");
    }
    // equalizer fallback text hides when live (CSS shows bars)
    var eqf = $("ch-eqfallback"); if (eqf) eqf.style.display = (state === "live") ? "none" : "";
  }

  /* ═══ Connection lifecycle ═══ */
  toggleBtn.addEventListener("click", function () {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      userClosed = true; stopReconnect(); try { ws.close(1000, "user_close"); } catch (e) {}
    } else { userClosed = false; stopReconnect(); connect(); }
  });
  clearBtn.addEventListener("click", function () {
    transcriptBox.innerHTML = ""; analysisBox.innerHTML = ""; reportSection.style.display = "none";
    lineCount = 0; lastSugSig = ""; updateStats();
  });
  logoutBtn.addEventListener("click", function () { if (ws) { userClosed = true; try { ws.close(1000, "logout"); } catch (e) {} } logout(); });
  if (pdfBtn) pdfBtn.addEventListener("click", downloadReportPDF);

  function connect() {
    if (isConnecting || (ws && ws.readyState === WebSocket.OPEN)) return;
    isConnecting = true;
    setCallState("connecting");
    log("جاري الاتصال بمحرك التحليل: " + WS_URL, "INFO");
    try { ws = new WebSocket(WS_URL); }
    catch (e) { log("فشل إنشاء WebSocket: " + e.message, "ERROR"); isConnecting = false; scheduleReconnect(); return; }

    ws.onopen = function () {
      isConnecting = false; setCallState("ready");
      resetTimerDisplay();
      log("تم الاتصال بنجاح ✅ — المحرك جاهز.", "INFO");
    };
    ws.onmessage = function (ev) { try { handleMessage(JSON.parse(ev.data)); } catch (e) { log("خطأ في تحليل الرسالة: " + e.message, "ERROR"); console.error("Raw:", ev.data); } };
    ws.onerror = function () { log("خطأ في الاتصال بالخادم.", "WARNING"); };
    ws.onclose = function (e) {
      isConnecting = false; setCallState("offline");
      stopCallTimer(); endLiveSignal();
      if (e.code !== 1000 && !userClosed) { log("انقطع الاتصال (" + e.code + ") — إعادة المحاولة خلال " + (RECONNECT_MS / 1000) + "s…", "WARNING"); scheduleReconnect(); }
      else log("تم قطع الاتصال.", "INFO");
    };
  }
  function scheduleReconnect() { stopReconnect(); if (userClosed) return; reconnectTimer = setTimeout(connect, RECONNECT_MS); }
  function stopReconnect() { if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; } }

  function handleMessage(data) {
    switch (data.type) {
      case "realtime_transcript": markCallStart(); addTranscript(data.transcript || ""); break;
      case "final_transcript": renderFinalTranscript(data.lines || []); break;
      case "realtime_analysis": addAnalysis(data.analysis || ""); break;
      case "post_call_report": applyCallTimes(data); renderReport(data.report || {}); prepareCallForReview(data.report || {}); break;
      case "system_log": log(data.message || "", data.level || "INFO"); break;
      case "clear": transcriptBox.innerHTML = ""; analysisBox.innerHTML = ""; onNewCall(); break;
      default: console.warn("نوع رسالة غير معروف:", data.type);
    }
  }
  function clearHints(box) { box.querySelectorAll(".empty-hint").forEach(function (n) { n.remove(); }); }

  function addTranscript(text) {
    if (!text.trim()) return;
    clearHints(transcriptBox); lineCount++; updateStats();
    var m = text.match(/^\s*\[([^\]]+)\]\s*:\s*([\s\S]*)$/);
    var speaker = m ? m[1].trim() : "";
    var body = (m ? m[2] : text).trim();
    currentTranscript.push({ speaker: speaker, text: body, ts: new Date().toISOString() });
    // لوّن الدور: الموظف / العميل (بعد فصل المتحدثين)، وإلا شريحة محايدة باسم المتحدث
    var role = speaker === "الموظف" ? "agent" : speaker === "العميل" ? "customer" : (speaker ? "other" : "");
    var div = document.createElement("div");
    div.className = "msg" + (role && role !== "other" ? " tx-" + role : "");
    var chip = speaker ? '<span class="tx-role tx-role-' + role + '">' + escHtml(speaker) + "</span>" : "";
    div.innerHTML = '<span class="msg-time">' + now() + "</span>" + chip +
      '<span class="tx-body">' + escHtml(body) + "</span>";
    transcriptBox.appendChild(div); scrollBottom(transcriptBox);
  }

  // النسخة النهائية المفصولة (الموظف/العميل) بعد المكالمة — تستبدل النص الحيّ بلا
  // أي تأثير على توقيت المكالمة (callStartTs/الحالة) حتى تتسجّل مدة المكالمة صح.
  function buildTranscriptRow(speaker, body) {
    var role = speaker === "الموظف" ? "agent" : speaker === "العميل" ? "customer" : (speaker ? "other" : "");
    var div = document.createElement("div");
    div.className = "msg" + (role && role !== "other" ? " tx-" + role : "");
    var chip = speaker ? '<span class="tx-role tx-role-' + role + '">' + escHtml(speaker) + "</span>" : "";
    div.innerHTML = chip + '<span class="tx-body">' + escHtml(body) + "</span>";
    return div;
  }
  function renderFinalTranscript(lines) {
    if (!Array.isArray(lines) || !lines.length) return;
    transcriptBox.innerHTML = ""; currentTranscript = []; lineCount = 0;
    lines.forEach(function (l) {
      var speaker = (l.speaker || "").trim(), body = (l.text || "").trim();
      if (!body) return;
      currentTranscript.push({ speaker: speaker, text: body, ts: new Date().toISOString() });
      lineCount++;
      transcriptBox.appendChild(buildTranscriptRow(speaker, body));
    });
    updateStats(); scrollBottom(transcriptBox);
  }

  // Priority → severity label + colour class. Prefers the model's explicit
  // `priority`; falls back to deriving it from the intervention type.
  function severityMeta(priority, type) {
    var p = (priority || "").toLowerCase();
    if (p !== "high" && p !== "medium" && p !== "low") {
      p = type === "تحذير" ? "high" : type === "نصيحة" ? "low" : "medium";
    }
    if (p === "high") return { key: "high", label: "أولوية عالية", cls: "high" };
    if (p === "low") return { key: "low", label: "تحسين", cls: "low" };
    return { key: "medium", label: "أولوية متوسطة", cls: "mid" };
  }

  // Signature of the last coaching action shown — used to drop consecutive
  // duplicates so the agent gets clean "next best action" guidance, never spam.
  var lastSugSig = "";
  function addAnalysis(jsonStr) {
    if (!jsonStr.trim()) return;
    var parsed; try { parsed = JSON.parse(jsonStr); } catch (e) { parsed = { action: jsonStr }; }
    if (!parsed || String(parsed.type).toUpperCase() === "OK") return;
    var issue = (parsed.reason || "").trim(), suggestion = (parsed.action || "").trim();
    if (!issue && !suggestion) return;
    // Drop an identical consecutive tip (belt-and-suspenders with the server-side
    // dedupe) — repeating the same instruction reads as noise, not coaching.
    var sig = (suggestion || issue).replace(/\s+/g, " ").trim().slice(0, 60);
    if (sig && sig === lastSugSig) return;
    lastSugSig = sig;
    var type = (parsed.type || "توجيه").trim();
    var problemType = (parsed.problem_type || "").trim();
    var suggestionType = (parsed.suggestion_type || "").trim();
    var sev = severityMeta(parsed.priority, type);
    // Capture the coaching tip WITH its categories so the FULL call is persisted.
    var sText = suggestion || issue;
    if (sText) currentSuggestions.push({
      suggest_text: sText, priority: sev.key,
      problem_type: problemType || undefined, suggestion_type: suggestionType || undefined,
    });
    if (parsed.engine) showEngine(parsed.engine);   // display the live-analysis API/model
    clearHints(analysisBox);
    var isWarn = type === "تحذير";
    var icon = isWarn ? "fa-triangle-exclamation" : type === "توجيه" ? "fa-compass" : "fa-lightbulb";
    // Category chips (problem type + suggestion type) make coaching scannable & organized.
    var cats =
      (problemType ? '<span class="ai-cat ai-cat-problem"><i class="fas fa-circle-dot"></i>' + escHtml(problemType) + "</span>" : "") +
      (suggestionType ? '<span class="ai-cat ai-cat-sug"><i class="fas fa-wand-magic-sparkles"></i>' + escHtml(suggestionType) + "</span>" : "");
    // The newest tip is the "active guidance" — highlight it and demote the rest,
    // so the agent's eye lands on the single next action (enterprise agent-assist).
    var prevCur = analysisBox.querySelectorAll(".ai-current");
    for (var pc = 0; pc < prevCur.length; pc++) prevCur[pc].classList.remove("ai-current");
    var div = document.createElement("div");
    div.className = "msg msg-ai ai-current sev-" + sev.key + (isWarn ? " msg-warn" : "");
    div.innerHTML =
      '<div class="ai-coach-head"><span class="ai-severity ' + sev.cls + '"><i class="fas ' + icon + '"></i>' + escHtml(sev.label) + '</span><span class="ai-type">' + escHtml(type) + '</span><span class="ai-now-tag">الأحدث</span></div>' +
      (cats ? '<div class="ai-cats">' + cats + "</div>" : "") +
      (issue ? '<div class="ai-issue"><span class="ai-badge issue">الملاحظة</span><span>' + escHtml(issue) + "</span></div>" : "") +
      (suggestion ? '<div class="ai-suggestion"><span class="ai-badge sug">الإجراء الآن</span><span>' + escHtml(suggestion) + "</span></div>" : "");
    analysisBox.appendChild(div); scrollBottom(analysisBox);
    // تنبيه طافٍ يلفت نظر الموظف فوراً (السجل الكامل يفضل في اللوحة)
    showCoachAlert(type, issue, suggestion, problemType);
  }

  /* ═══ تنبيه المدرّب اللحظي الطافي — يلفت نظر الموظف للاقتراح فوراً ═══ */
  var coachAlert = $("coach-alert"), coachTimer = null;
  function hideCoachAlert() { if (coachAlert) coachAlert.classList.remove("show"); }
  function showCoachAlert(type, issue, suggestion, problemType) {
    if (!coachAlert) return;
    var kind = type === "تحذير" ? "warn" : type === "توجيه" ? "guide" : "tip";
    var icon = kind === "warn" ? "fa-triangle-exclamation" : kind === "guide" ? "fa-compass" : "fa-lightbulb";
    coachAlert.className = "coach-alert coach-" + kind + " show";
    var catChip = problemType ? '<span class="ca-cat">' + escHtml(problemType) + "</span>" : "";
    coachAlert.innerHTML =
      '<div class="ca-icon"><i class="fas ' + icon + '"></i></div>' +
      '<div class="ca-body">' +
        '<div class="ca-head"><span class="ca-label">' + escHtml(type || "اقتراح") + "</span>" + catChip +
          (issue ? '<span class="ca-issue">' + escHtml(issue) + "</span>" : "") + "</div>" +
        '<div class="ca-action">' + escHtml(suggestion || issue) + "</div>" +
      "</div>" +
      '<button class="ca-close" type="button" aria-label="إغلاق">&times;</button>';
    var btn = coachAlert.querySelector(".ca-close"); if (btn) btn.onclick = hideCoachAlert;
    // أعِد تشغيل نبضة الدخول لكل تنبيه جديد
    coachAlert.classList.remove("pulse"); void coachAlert.offsetWidth; coachAlert.classList.add("pulse");
    if (coachTimer) clearTimeout(coachTimer);
    coachTimer = setTimeout(hideCoachAlert, kind === "warn" ? 13000 : 8500);  // التحذير يبقى أطول
  }

  /* ═══ Sentiment Timeline Replay (post-call analysis — rendered INSIDE the report) ═══
     Reconstructs the CUSTOMER's emotional journey across the whole call so it can be
     "replayed" visually after processing. It prefers report.sentiment_timeline if the
     model ever provides it; otherwise it derives the arc from the saved transcript using
     the same Egyptian-Arabic emotion markers the backend uses, then anchors the final
     point to the report's overall customer_sentiment (the AI verdict). This runs ONCE,
     after the call, when the report renders — never live. Fully guarded: any failure
     just hides the replay and the rest of the report renders normally. */
  var SENT_NEG = ["زهقت", "تعبت", "مش طايق", "كفاية", "ألغي", "الغي", "التعاقد", "مفيش حل", "محدش بيرد", "بقالي", "مستني", "مش معقول", "زعلان", "غضب", "غاضب", "سيئ", "وحش", "مش راضي", "تأخير", "مشكلة", "شكوى", "للأسف", "مقطوع", "مش شغال", "مش شغالة", "فاصل", "بطيء", "فشل", "حرام", "مستاء", "ضايقني", "قرف", "مهزلة", "مقصرين"];
  var SENT_POS = ["شكرا", "شكراً", "متشكر", "تمام", "حلو", "ممتاز", "حليت", "اتحلت", "جزاك", "ربنا يكرمك", "تسلم", "راضي", "كفو", "رائع", "perfect", "ماشي", "تمت", "اشكرك", "أشكرك", "سعيد", "ممنون", "حضرتك ساعدتني", "الحمد لله"];
  var SENT_BANDS = [
    { key: "غاضب",  max: 25,  mid: 14, color: "#EF4444", label: "غاضب" },
    { key: "محبط",  max: 50,  mid: 38, color: "#F59E0B", label: "محبط" },
    { key: "محايد", max: 70,  mid: 60, color: "#0EA5E9", label: "محايد" },
    { key: "سعيد",  max: 100, mid: 86, color: "#10B981", label: "سعيد" },
  ];
  var SENT_LINE = "#0EA5E9";   // chart line/head colour (matches the app's analysis accent)
  function sentBandFor(v) { for (var i = 0; i < SENT_BANDS.length; i++) { if (v < SENT_BANDS[i].max) return SENT_BANDS[i]; } return SENT_BANDS[SENT_BANDS.length - 1]; }
  function sentBandScore(key) { for (var i = 0; i < SENT_BANDS.length; i++) { if (SENT_BANDS[i].key === key) return SENT_BANDS[i].mid; } return 60; }
  function sentCountMarkers(text, list) { var n = 0, t = text || ""; for (var i = 0; i < list.length; i++) { if (t.indexOf(list[i]) >= 0) n++; } return n; }

  function computeSentimentSeries(report, transcript) {
    // 1) Prefer a model-provided per-turn timeline (future-proof; optional, not required today).
    var provided = report && report.sentiment_timeline;
    if (Array.isArray(provided) && provided.length) {
      return provided.map(function (p, i) {
        var v = Number(p.score); if (!isFinite(v)) v = sentBandScore(p.sentiment);
        v = Math.max(2, Math.min(98, v));
        return { i: i, s: v, t: String(p.label || p.text || ""), e: p.sentiment || sentBandFor(v).key };
      });
    }
    // 2) Derive from the CUSTOMER turns in the real transcript.
    var turns = (transcript || []).filter(function (t) { return (t.text || "").trim(); });
    var cust = turns.filter(function (t) { return t.speaker === "العميل"; });
    var seq = cust.length ? cust : turns;          // fallback: all turns if diarization labelled none
    if (!seq.length) return [];
    var run = 58, pts = [];
    for (var i = 0; i < seq.length; i++) {
      var neg = sentCountMarkers(seq[i].text, SENT_NEG), pos = sentCountMarkers(seq[i].text, SENT_POS);
      run = Math.max(6, Math.min(96, run + pos * 14 - neg * 17));
      pts.push({ i: i, s: run, t: seq[i].text, e: sentBandFor(run).key });
    }
    // 3) Anchor the final point to the report's overall sentiment, blending the shift
    //    across the series so the curve still reflects what actually happened.
    var overall = report && report.customer_sentiment, band = null;
    for (var b = 0; b < SENT_BANDS.length; b++) { if (SENT_BANDS[b].key === overall) band = SENT_BANDS[b]; }
    if (band && pts.length) {
      var diff = band.mid - pts[pts.length - 1].s, n = pts.length;
      for (var j = 0; j < n; j++) { pts[j].s = Math.max(4, Math.min(97, pts[j].s + diff * ((j + 1) / n))); pts[j].e = sentBandFor(pts[j].s).key; }
    }
    return pts;
  }

  var SR_W = 800, SR_H = 210, SR_PL = 10, SR_PR = 10, SR_PT = 14, SR_PB = 26;
  function srX(i, n) { var innerW = SR_W - SR_PL - SR_PR, step = n > 1 ? innerW / (n - 1) : innerW; return SR_PL + i * step; }
  function srY(v) { var innerH = SR_H - SR_PT - SR_PB; return SR_PT + (1 - v / 100) * innerH; }

  function buildSentimentReplayHtml(report, transcript) {
    var pts = computeSentimentSeries(report, transcript);
    if (!pts || pts.length < 2) return "";        // need at least a small arc to be meaningful
    var n = pts.length, innerH = SR_H - SR_PT - SR_PB;
    var coords = pts.map(function (p, i) { return [srX(i, n), srY(p.s)]; });
    var line = coords.map(function (c, i) { return (i ? "L" : "M") + c[0].toFixed(1) + " " + c[1].toFixed(1); }).join(" ");
    var area = line + " L" + srX(n - 1, n).toFixed(1) + " " + (SR_PT + innerH) + " L" + srX(0, n).toFixed(1) + " " + (SR_PT + innerH) + " Z";
    var first = pts[0], last = pts[n - 1];
    var lo = pts.reduce(function (a, b) { return b.s < a.s ? b : a; });
    var stripes = SENT_BANDS.map(function (bnd) {
      var prevMax = SENT_BANDS.indexOf(bnd) === 0 ? 0 : SENT_BANDS[SENT_BANDS.indexOf(bnd) - 1].max;
      var y1 = srY(bnd.max), y2 = srY(prevMax);
      return '<rect x="' + SR_PL + '" y="' + y1.toFixed(1) + '" width="' + (SR_W - SR_PL - SR_PR) + '" height="' + (y2 - y1).toFixed(1) + '" fill="' + bnd.color + '" opacity="0.07"></rect>';
    }).join("");
    var dots = coords.map(function (c, i) { return '<circle cx="' + c[0].toFixed(1) + '" cy="' + c[1].toFixed(1) + '" r="3.2" fill="' + sentBandFor(pts[i].s).color + '"></circle>'; }).join("");
    var gid = "sgrad" + Math.random().toString(36).slice(2, 7);
    var seriesJson = escHtml(JSON.stringify(pts.map(function (p) { return { s: Math.round(p.s), t: p.t, e: p.e }; })));
    var svg =
      '<svg id="srSvg" viewBox="0 0 ' + SR_W + ' ' + SR_H + '" preserveAspectRatio="none" style="width:100%;height:210px;display:block">' +
        '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + SR_LINE_FILL() + '" stop-opacity="0.30"/><stop offset="100%" stop-color="' + SR_LINE_FILL() + '" stop-opacity="0.02"/></linearGradient></defs>' +
        stripes +
        '<path d="' + area + '" fill="url(#' + gid + ')"></path>' +
        '<path d="' + line + '" fill="none" stroke="' + SENT_LINE + '" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path>' +
        dots +
        '<circle id="srHead" cx="' + coords[0][0].toFixed(1) + '" cy="' + coords[0][1].toFixed(1) + '" r="6" fill="#ffffff" stroke="' + SENT_LINE + '" stroke-width="3"></circle>' +
      '</svg>';
    var chip = function (lbl, bnd) { return '<span style="font-size:.8rem;color:var(--muted)">' + lbl + ': <b style="color:' + bnd.color + '">' + bnd.label + '</b></span>'; };
    var legend = SENT_BANDS.slice().reverse().map(function (b) { return '<span style="display:inline-flex;align-items:center;gap:5px;font-size:.72rem;color:var(--muted)"><i style="width:9px;height:9px;border-radius:50%;background:' + b.color + ';display:inline-block"></i>' + b.label + '</span>'; }).join('<span style="width:8px;display:inline-block"></span>');
    return '' +
      '<div class="report-card full-col" id="sentiment-replay-card" data-series="' + seriesJson + '">' +
        '<div class="rc-label" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">' +
          '<i class="fas fa-wave-square" style="color:' + SENT_LINE + '"></i> إعادة تشغيل مشاعر العميل' +
          '<span class="type-badge" style="font-weight:600">تحليل بعد المكالمة</span>' +
          '<button id="srPlay" class="btn btn-soft btn-sm" type="button" style="margin-inline-start:auto"><i class="fas fa-play"></i> تشغيل الإعادة</button>' +
        '</div>' +
        '<div style="display:flex;gap:16px;flex-wrap:wrap;margin:6px 0 10px">' + chip("البداية", sentBandFor(first.s)) + chip("الأدنى", sentBandFor(lo.s)) + chip("النهاية", sentBandFor(last.s)) + '</div>' +
        svg +
        '<div style="display:flex;justify-content:center;gap:10px;margin-top:6px;flex-wrap:wrap">' + legend + '</div>' +
        '<div id="srCaption" class="cd-empty" style="margin-top:8px;min-height:2.4em;font-size:.85rem;text-align:start"></div>' +
      '</div>';
  }
  function SR_LINE_FILL() { return SENT_LINE; }

  function initSentimentReplay() {
    var card = $("sentiment-replay-card"); if (!card) return;
    var head = $("srHead"), btn = $("srPlay"), cap = $("srCaption");
    var series; try { series = JSON.parse(card.getAttribute("data-series")); } catch (e) { return; }
    if (!head || !series || !series.length) return;
    var n = series.length, timer = null;
    function capClass(e) { return e === "غاضب" ? "danger" : e === "محبط" ? "warn" : e === "سعيد" ? "ok" : "neutral"; }
    function showStep(i) {
      var p = series[i], bnd = sentBandFor(p.s);
      head.setAttribute("cx", srX(i, n).toFixed(1)); head.setAttribute("cy", srY(p.s).toFixed(1)); head.setAttribute("stroke", bnd.color);
      if (cap) cap.innerHTML = '<span class="report-status ' + capClass(p.e) + '">' + escHtml(p.e) + '</span> <span style="color:var(--muted)">' + escHtml(String(p.t || "").slice(0, 150)) + '</span>';
    }
    function play() { if (timer) clearInterval(timer); var i = 0; showStep(0); timer = setInterval(function () { i++; if (i >= n) { clearInterval(timer); timer = null; return; } showStep(i); }, 900); }
    if (btn) btn.onclick = play;
    showStep(n - 1);                 // rest on the final (anchored) state
    setTimeout(play, 450);           // auto-play the journey once when the report appears
  }

  /* ═══ Resolution status — the professional "what actually happened" headline ═══
     Maps the model's resolution_status/outcome to a colour + icon and builds a
     prominent banner so the report clearly reflects whether the problem was
     solved, promised within 24h, escalated, or still open. */
  function resolutionClass(s) {
    if (s === "تم الحل") return "ok";
    if (s === "لم يتم الحل") return "danger";
    if (s === "وعد خلال 24 ساعة" || s === "قيد المتابعة" || s === "تم التصعيد") return "warn";
    return "neutral";
  }
  function resolutionIcon(s) {
    if (s === "تم الحل") return "fa-circle-check";
    if (s === "وعد خلال 24 ساعة") return "fa-clock";
    if (s === "قيد المتابعة") return "fa-hourglass-half";
    if (s === "تم التصعيد") return "fa-arrow-up-right-dots";
    if (s === "لم يتم الحل") return "fa-circle-xmark";
    return "fa-circle-question";
  }
  function resolutionBanner(report) {
    var status = (report.resolution_status || "").trim();
    var solved = (report.problem_solved || "").trim();
    var outcome = (report.call_outcome || "").trim();
    var evidence = (report.resolution_evidence || "").trim();
    var followUp = (report.follow_up_commitment || "").trim();
    if (!status && !solved && !outcome) return "";     // model gave none → skip banner
    var cls = resolutionClass(status || (solved === "نعم" ? "تم الحل" : solved === "لا" ? "لم يتم الحل" : ""));
    var icon = resolutionIcon(status);
    var solvedCls = solved === "نعم" ? "ok" : solved === "لا" ? "danger" : solved === "جزئياً" ? "warn" : "neutral";
    var outcomeCls = outcome === "ناجحة" ? "ok" : outcome === "تصعيد مطلوب" ? "danger" : outcome === "غير مكتملة" ? "neutral" : "warn";
    var chips =
      (solved ? '<span class="report-status ' + solvedCls + '">هل تم الحل؟ ' + escHtml(solved) + "</span>" : "") +
      (outcome ? '<span class="report-status ' + outcomeCls + '">' + escHtml(outcome) + "</span>" : "");
    return "" +
      '<div class="report-card full-col resolution-banner rb-' + cls + '">' +
        '<div class="rb-head"><span class="rb-ic"><i class="fas ' + icon + '"></i></span>' +
          '<div class="rb-main"><div class="rb-label">حالة حل المشكلة</div><div class="rb-status">' + escHtml(status || "غير محدّد") + "</div></div></div>" +
        (evidence ? '<div class="rb-evidence"><i class="fas fa-quote-right"></i><span>' + escHtml(evidence) + "</span></div>" : "") +
        (followUp && followUp !== "لا يوجد" ? '<div class="rb-follow"><i class="fas fa-calendar-check"></i><span><b>التزام المتابعة:</b> ' + escHtml(followUp) + "</span></div>" : "") +
        (chips ? '<div class="rb-chips">' + chips + "</div>" : "") +
      "</div>";
  }

  /* ═══ Report ═══ */
  function renderReport(report) {
    log("وصل التقرير من الخادم — جاري العرض…", "INFO");
    if (!report || report.error) { log("لم يُنشأ التقرير: " + ((report && report.error) || "خطأ مجهول"), "ERROR"); return; }
    try {
      var summary = report.call_summary || report.summary || "—";
      var sentiment = report.customer_sentiment || "";
      var solved = report.problem_solved || "—";
      var sentimentClass = sentiment === "غاضب" ? "danger" : sentiment === "محبط" ? "warn" : sentiment === "سعيد" ? "ok" : "neutral";
      var solvedClass = solved === "نعم" ? "ok" : solved === "لا" ? "danger" : solved === "جزئياً" ? "warn" : "neutral";
      var textCard = function (label, val, full) { return '<div class="report-card' + (full ? " full-col" : "") + '"><div class="rc-label">' + label + '</div><div class="rc-value">' + escHtml(val || "—") + "</div></div>"; };
      var scoreBar = function (label, val) {
        var v = Math.max(0, Math.min(10, Number(val) || 0));
        var col = v >= 7.5 ? "var(--success)" : v >= 5 ? "var(--warning)" : "var(--danger)";
        return '<div class="report-card"><div class="rc-label">' + label + '</div><div class="rc-value">' + v + ' / 10</div><div class="score-bar"><div class="score-fill" style="width:' + (v * 10) + "%;background:" + col + '"></div></div></div>';
      };
      var listCard = function (label, arr) {
        if (!Array.isArray(arr) || !arr.length) return "";
        return '<div class="report-card full-col"><div class="rc-label">' + label + '</div><ul style="margin:6px 20px 0;padding:0;line-height:1.9">' + arr.map(function (x) { return "<li>" + escHtml(String(x)) + "</li>"; }).join("") + "</ul></div>";
      };
      var statusCard = function (label, val, cls) {
        return '<div class="report-card"><div class="rc-label">' + label + '</div><div class="rc-value"><span class="report-status ' + cls + '">' + escHtml(val || "—") + "</span></div></div>";
      };
      var agentPerf = report.agent_performance_score != null ? report.agent_performance_score : (report.agent_score != null ? report.agent_score : 0);
      // Sentiment Timeline Replay (guarded — never breaks the rest of the report).
      var replayHtml = ""; try { replayHtml = buildSentimentReplayHtml(report, currentTranscript); } catch (e) { replayHtml = ""; console.error("sentiment replay build:", e); }
      // Resolution headline first — the report must clearly reflect what happened
      // (solved / promised within 24h / escalated / still open).
      var resolutionHtml = ""; try { resolutionHtml = resolutionBanner(report); } catch (e) { resolutionHtml = ""; console.error("resolution banner:", e); }
      reportBox.innerHTML =
        resolutionHtml +
        replayHtml +
        textCard("ملخص المكالمة", summary, true) +
        (report.issue_category ? statusCard("تصنيف المشكلة", report.issue_category, "neutral") : "") +
        textCard("مشكلة العميل", report.customer_issue) +
        textCard("السبب الجذري", report.root_cause) +
        textCard("الحل المقدّم", report.resolution_provided, true) +
        statusCard("هل تم حل المشكلة", solved, solvedClass) +
        statusCard("شعور العميل", sentiment, sentimentClass) +
        scoreBar("أداء الموظف", agentPerf) +
        scoreBar("رضا العميل", report.customer_satisfaction_score) +
        scoreBar("الاحترافية", report.professionalism_score) +
        scoreBar("التواصل", report.communication_score) +
        scoreBar("حل المشكلات", report.problem_solving_score) +
        scoreBar("التعاطف", report.empathy_score) +
        listCard("نقاط القوة", report.strengths) +
        listCard("نقاط الضعف", report.weaknesses) +
        listCard("فرص ضائعة", report.missed_opportunities) +
        listCard("توصيات للمشرف", report.recommended_actions) +
        listCard("لحظات حرجة", report.critical_moments) +
        listCard("الخطوات التالية", report.next_steps);
      reportSection.style.display = "block";
      if (replayHtml) { try { initSentimentReplay(); } catch (e) { console.error("sentiment replay init:", e); } }
      reportSection.scrollIntoView({ behavior: "smooth" });
      log("تم استلام التقرير النهائي.", "INFO");
    } catch (e) { log("خطأ في عرض التقرير: " + e.message, "ERROR"); console.error("renderReport error:", e, report); }
  }

  function downloadReportPDF() {
    if (!window.SCM || !SCM.printReport) { log("مكتبة PDF غير متاحة.", "ERROR"); return; }
    if (!lastReport || !Object.keys(lastReport).length) { log("لا يوجد تقرير لإصداره بعد.", "WARNING"); if (window.SCM) SCM.toast("لا يوجد تقرير بعد", "error"); return; }
    SCM.audit("GENERATE_REPORT");
    var agentName = ($("agentName") || {}).textContent || "";
    var scores = reportToScores(lastReport);
    // Shape the live report like a persisted call so the shared professional
    // report builder renders it identically to the manager/admin PDF.
    var callLike = {
      call_start: authCallStart || (callStartTs ? new Date(callStartTs).toISOString() : new Date(Date.now() - callSeconds * 1000).toISOString()),
      duration_seconds: callSeconds,
      call_type: (callTypeSelect && callTypeSelect.value) || null,
      issues_category: (issuesCategory && issuesCategory.value.trim()) || lastReport.issue_category || null,
      sentiment: lastReport.customer_sentiment || "",
      summary: lastReport.call_summary || lastReport.summary || "",
      users: { full_name: agentName },
      customers: { name: (custName && custName.value.trim()) || "—", phone_number: (custPhone && custPhone.value.trim()) || "—" },
      performance_scores: scores ? [scores] : [],
      analysis: lastReport,
      suggestions: currentSuggestions || [],
      transcripts: (currentTranscript || []).map(function (l) { return { speaker: l.speaker || "—", text: l.text || "", timestamp: l.timestamp || l.time || "" }; }),
    };
    var ts = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
    SCM.printReport(null, { call: callLike, shortId: lastSavedCallId ? String(lastSavedCallId).split("-")[0] : ts, exportedBy: agentName });
  }

  /* ═══ Logs / timer / stats ═══ */
  function log(msg, level) {
    level = level || "INFO";
    while (logBox.children.length >= MAX_LOG_LINES) logBox.removeChild(logBox.firstChild);
    var cls = level === "ERROR" ? "log-err" : level === "WARNING" ? "log-warn" : "log-info";
    var div = document.createElement("div"); div.className = cls;
    div.textContent = "[" + now() + "] [" + level + "] " + msg;
    logBox.appendChild(div); scrollBottom(logBox);
  }
  function startCallTimer() { callSeconds = 0; updateDuration(); stopCallTimer(); callTimer = setInterval(function () { callSeconds++; updateDuration(); }, 1000); }
  function stopCallTimer() { if (callTimer) { clearInterval(callTimer); callTimer = null; } }
  function resetTimerDisplay() { stopCallTimer(); callSeconds = 0; updateDuration(); }
  function updateDuration() {
    var t = String(Math.floor(callSeconds / 60)).padStart(2, "0") + ":" + String(callSeconds % 60).padStart(2, "0");
    if (durationVal) durationVal.textContent = t;
    setText("ch-timer", t);
  }
  function updateStats() { if (linesVal) linesVal.textContent = lineCount + " سطر"; setText("ch-lines", lineCount); }
  function scrollBottom(el) { el.scrollTop = el.scrollHeight; }
  function now() { return new Date().toLocaleTimeString("ar-EG"); }
  function escHtml(str) { return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function setText(id, v) { var el = $(id); if (el) el.textContent = v; }
  // Show which local live-analysis model produced the coaching (e.g. "محلي · qwen2.5-7b-instruct").
  function showEngine(engine) { var el = $("engineBadge"); if (!el || !engine) return; el.style.display = ""; el.innerHTML = '<i class="fas fa-bolt"></i> ' + escHtml(String(engine)); }

  /* ═══ Save flow (Node API :3000) ═══ */
  var API_BASE = (function () {
    var qs = new URLSearchParams(location.search).get("api");
    if (qs) return qs.replace(/\/+$/, "");
    var stored = localStorage.getItem("api_base");
    if (stored) return stored.replace(/\/+$/, "");
    return location.protocol + "//" + location.hostname + ":3000";
  })();
  var AGENT_API = API_BASE + "/api/agent";
  var AUTH_API = API_BASE + "/api/auth";
  var LIVE_API = API_BASE + "/api/live";

  /* ═══ Live-call signaling (drives the admin/manager/supervisor live counter) ═══
     Fire-and-forget: a transient failure must never log the agent out or break
     the call, so this uses a bare fetch (not agentFetch) and swallows errors. */
  function liveSignal(action, keepalive) {
    var token = getAuthToken(); if (!token) return;
    var body = JSON.stringify({ customer_name: (custName && custName.value.trim()) || undefined });
    try {
      fetch(LIVE_API + "/" + action, {
        method: "POST", keepalive: !!keepalive,
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token }, body: body,
      }).catch(function () {});
    } catch (e) {}
  }
  function startLiveSignal() {
    liveSignal("start");
    if (liveHeartbeat) clearInterval(liveHeartbeat);
    liveHeartbeat = setInterval(function () { liveSignal("ping"); }, 30000);
  }
  function endLiveSignal(keepalive) {
    if (liveHeartbeat) { clearInterval(liveHeartbeat); liveHeartbeat = null; }
    liveSignal("end", keepalive);
  }
  window.addEventListener("beforeunload", function () { if (liveHeartbeat) endLiveSignal(true); });

  var custName = $("cust-name"), custPhone = $("cust-phone");
  var callTypeSelect = $("call-type-select"), issuesCategory = $("issues-category");
  var saveCallBtn = $("save-call-btn"), saveStatus = $("save-status");
  var recentBox = $("recent-box"), refreshCallsBtn = $("refresh-calls-btn");

  var callStartTs = null, savedThisCall = false, lastReport = {}, lastSavedCallId = null;
  var currentTranscript = [], currentSuggestions = [], callEndTs = null, awaitingSave = false;
  // توقيت المكالمة المعتمد من الخادم (زمن الحائط الفعلي) — له الأولوية عند الحفظ حتى
  // ما تتأثرش المدة بوقت توليد التقرير على الموديل المحلي.
  var authCallStart = null, authCallEnd = null;

  function agentFetch(path, options) {
    options = options || {};
    var token = getAuthToken();
    if (!token) { redirectToLogin(); return Promise.reject(new Error("لا توجد جلسة")); }
    return fetch((path.indexOf("http") === 0 ? path : AGENT_API + path), Object.assign({}, options, {
      headers: Object.assign({ "Content-Type": "application/json", "Authorization": "Bearer " + token }, options.headers || {}),
    })).then(function (res) {
      if (res.status === 401) { logout(); throw new Error("انتهت الجلسة"); }
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(data.message || data.error || ("HTTP " + res.status));
        return data;
      });
    });
  }
  function setSaveStatus(text, state) { saveStatus.textContent = text; saveStatus.className = "save-status " + (state || ""); }
  function markInvalid(el, on) { el.classList.toggle("invalid", !!on); }

  function reportToScores(r) {
    if (!r || typeof r !== "object") return undefined;
    var x10 = function (v) { var n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n * 10))) : undefined; };
    var s = {};
    var sc = x10(r.professionalism_score); if (sc !== undefined) s.script_compliance = sc;
    var em = x10(r.empathy_score); if (em !== undefined) s.empathy_score = em;
    var re = x10(r.problem_solving_score); if (re !== undefined) s.resolution_score = re;
    var to = x10(r.agent_performance_score != null ? r.agent_performance_score : r.agent_score); if (to !== undefined) s.total_score = to;
    var cs = x10(r.customer_satisfaction_score); if (cs !== undefined) s.customer_satisfaction_score = cs;
    return Object.keys(s).length ? s : undefined;
  }

  function markCallStart() {
    var wasLive = (callState === "live");
    if (savedThisCall || awaitingSave) {
      savedThisCall = false; awaitingSave = false; callEndTs = null; currentTranscript = []; currentSuggestions = [];
      authCallStart = null; authCallEnd = null; lastSugSig = "";
      lineCount = 0; updateStats(); resetCallForm();
      callStartTs = Date.now(); startCallTimer();
    } else if (!callStartTs) {
      callStartTs = Date.now(); startCallTimer();
    }
    if (!wasLive) { setCallState("live"); startLiveSignal(); }   // agent is now on a real call
    else if (!callTimer) startCallTimer();
  }
  function onNewCall() {
    callStartTs = Date.now(); callEndTs = null; savedThisCall = false; awaitingSave = false; lastSavedCallId = null;
    authCallStart = null; authCallEnd = null;
    currentTranscript = []; currentSuggestions = []; lineCount = 0; lastSugSig = ""; updateStats(); resetCallForm();
    resetTimerDisplay(); endLiveSignal();
    setCallState(ws && ws.readyState === WebSocket.OPEN ? "ready" : "offline");
    setSaveStatus("مكالمة جديدة — جارٍ المتابعة…", "pending");
  }

  // يطبّق توقيت المكالمة المعتمد من الخادم: يثبّت المدة الظاهرة ويوقف العدّاد فلا
  // يحسب وقت توليد التقرير ضمن مدة المكالمة.
  function applyCallTimes(data) {
    if (!data) return;
    authCallStart = data.call_start || null;
    authCallEnd = data.call_end || null;
    var secs = Number(data.duration_seconds);
    if (!isFinite(secs) && authCallStart && authCallEnd) {
      secs = Math.round((new Date(authCallEnd) - new Date(authCallStart)) / 1000);
    }
    if (isFinite(secs) && secs >= 0) {
      stopCallTimer(); callSeconds = secs; updateDuration();
    }
  }

  function prepareCallForReview(report) {
    lastReport = report || {};
    savedThisCall = false; awaitingSave = true; callEndTs = Date.now();
    stopCallTimer(); endLiveSignal();   // call finished → drop from the live counter
    setCallState("ended");
    if (!issuesCategory.value.trim() && lastReport.customer_issue) issuesCategory.value = String(lastReport.customer_issue).slice(0, 120);
    if (saveCallBtn) saveCallBtn.classList.add("attention");
    if (Agent.renderWrapup) Agent.renderWrapup(lastReport);   // wrap-up summary for a consistent close
    setSaveStatus("📋 انتهت المكالمة — أدخل بيانات العميل ثم اضغط «حفظ المكالمة»", "pending");
    log("✅ انتهت المكالمة. أدخل بيانات العميل ثم احفظ المكالمة.", "INFO");
    if (!custName.value.trim()) custName.focus();
  }
  function resetCallForm() {
    custName.value = ""; custPhone.value = ""; issuesCategory.value = "";
    markInvalid(custName, false); markInvalid(custPhone, false);
    if (Agent.resetCustomerContext) Agent.resetCustomerContext();
    var wu = $("wrapupCard");
    if (wu) { wu.setAttribute("data-state", "empty"); wu.innerHTML = '<div class="wu-empty"><i class="fas fa-clipboard-check"></i> بعد انتهاء المكالمة يظهر هنا ملخّص الإغلاق (النتيجة والتقييم) لمراجعته قبل الحفظ.</div>'; }
  }

  function validateCustomer() {
    var name = custName.value.trim(), phone = custPhone.value.trim();
    markInvalid(custName, !name); markInvalid(custPhone, !phone);
    if (!name) { custName.focus(); setSaveStatus("⚠️ أدخل اسم العميل أولًا", "err"); return null; }
    if (!phone) { custPhone.focus(); setSaveStatus("⚠️ أدخل رقم هاتف العميل أولًا", "err"); return null; }
    return { name: name, phone_number: phone };
  }

  function saveCurrentCall(report) {
    if (savedThisCall) return Promise.resolve();
    var customer = validateCustomer();
    if (!customer) return Promise.resolve();
    lastReport = report || {};
    // توقيت الخادم المعتمد له الأولوية؛ وإلا نتراجع للتقدير المحلي.
    var start = authCallStart ? new Date(authCallStart)
              : callStartTs ? new Date(callStartTs) : new Date(Date.now() - callSeconds * 1000);
    var end = authCallEnd ? new Date(authCallEnd)
            : callEndTs ? new Date(callEndTs) : new Date();
    if (!issuesCategory.value.trim() && lastReport.customer_issue) issuesCategory.value = String(lastReport.customer_issue).slice(0, 120);

    var body = {
      customer: customer,
      call_start: start.toISOString(), call_end: end.toISOString(),
      call_type: callTypeSelect.value || null,
      issues_category: issuesCategory.value.trim() || null,
      sentiment: lastReport.customer_sentiment || null,
      summary: lastReport.call_summary || lastReport.summary || null,
      analysis: (lastReport && Object.keys(lastReport).length) ? lastReport : null,
    };
    if (currentTranscript.length) body.transcripts = currentTranscript;
    if (currentSuggestions.length) body.suggestions = currentSuggestions;   // persist the FULL call
    var scores = reportToScores(lastReport);
    if (scores) body.scores = scores;

    setSaveStatus("جارٍ حفظ العميل والمكالمة…", "pending");
    return agentFetch("/calls", { method: "POST", body: JSON.stringify(body) }).then(function (d) {
      savedThisCall = true; awaitingSave = false;
      lastSavedCallId = (d.call && d.call.call_id) || null;
      if (saveCallBtn) saveCallBtn.classList.remove("attention");
      setSaveStatus("تم حفظ المكالمة وبيانات العميل ✅", "ok");
      log("💾 تم حفظ المكالمة والعميل في قاعدة البيانات.", "INFO");
      if (window.SCM) SCM.toast("تم حفظ المكالمة", "success");
      callStartTs = null; callEndTs = null; authCallStart = null; authCallEnd = null;
      setCallState(ws && ws.readyState === WebSocket.OPEN ? "ready" : "offline");
      return loadRecentCalls();
    }).catch(function (e) {
      setSaveStatus("فشل الحفظ: " + e.message, "err");
      log("فشل حفظ المكالمة: " + e.message, "ERROR");
    });
  }

  function manualSave() {
    if (savedThisCall && lastSavedCallId) {
      return patchCall(lastSavedCallId, { call_type: callTypeSelect.value || null, issues_category: issuesCategory.value.trim() || null });
    }
    savedThisCall = false;
    return saveCurrentCall(lastReport);
  }
  function patchCall(callId, fields) {
    setSaveStatus("جارٍ التحديث…", "pending");
    return agentFetch("/calls/" + callId, { method: "PATCH", body: JSON.stringify(fields) }).then(function () {
      setSaveStatus("تم تحديث المكالمة ✅", "ok"); return loadRecentCalls();
    }).catch(function (e) { setSaveStatus("فشل التحديث: " + e.message, "err"); });
  }

  /* ═══ Recent calls + KPIs ═══ */
  function fmtDur(d) {
    if (d == null) return "—";
    if (typeof d === "number") { var m = Math.floor(d / 60), s = d % 60; return m + ":" + String(s).padStart(2, "0"); }
    return String(d);
  }
  function callScore(c) { var ps = c.performance_scores; var r = Array.isArray(ps) ? ps[0] : ps; return r && r.total_score != null ? Number(r.total_score) : null; }
  function isToday(s) { if (!s) return false; var d = new Date(s), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); }
  function scoreColor(v) { if (v == null) return { c: "var(--muted)", bg: "var(--surface-3)" }; if (v < 50) return { c: "var(--danger)", bg: "rgba(239,68,68,.12)" }; if (v < 75) return { c: "var(--warning)", bg: "rgba(245,158,11,.14)" }; return { c: "var(--primary-700)", bg: "rgba(16,185,129,.14)" }; }

  function loadRecentCalls() {
    return agentFetch("/calls").then(function (d) { renderRecentCalls(d.calls || []); })
      .catch(function (e) { recentBox.innerHTML = '<div class="empty-hint">تعذّر تحميل المكالمات: ' + escHtml(e.message) + "</div>"; });
  }
  function updateKpis(calls) {
    setText("kpiTotal", calls.length);
    setText("kpiToday", calls.filter(function (c) { return isToday(c.call_start); }).length);
    var scores = calls.map(callScore).filter(function (v) { return v != null; });
    var avg = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : null;
    setText("kpiAvg", avg != null ? avg : "—");
    var chip = $("myAvgPerf");
    if (chip) { if (avg != null) { chip.style.display = ""; chip.textContent = "⭐ متوسط أدائي: " + avg + "/100"; } else chip.style.display = "none"; }
    // sparklines
    spark("sparkPerf", scores.slice().reverse(), "#0EA5E9");
    spark("sparkToday", callsPerDay(calls, 8), "#10B981");
  }
  function callsPerDay(calls, days) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var keys = [], map = {};
    for (var i = days - 1; i >= 0; i--) { var d = new Date(today); d.setDate(today.getDate() - i); var k = d.toISOString().slice(0, 10); keys.push(k); map[k] = 0; }
    calls.forEach(function (c) { if (!c.call_start) return; var k = new Date(c.call_start).toISOString().slice(0, 10); if (k in map) map[k]++; });
    return keys.map(function (k) { return map[k]; });
  }
  function renderRecentCalls(calls) {
    updateKpis(calls);
    if (!calls.length) { recentBox.innerHTML = '<div class="empty-hint"><i class="fas fa-database"></i> لا توجد مكالمات محفوظة بعد.</div>'; return; }
    recentBox.innerHTML = calls.slice(0, 20).map(function (c) {
      var start = c.call_start ? new Date(c.call_start).toLocaleString("ar-EG") : "—";
      var name = (c.customers && c.customers.name) || "—";
      var phone = (c.customers && c.customers.phone_number) || "";
      var avatar = (name || "—").trim().charAt(0);
      var sc = callScore(c), k = scoreColor(sc);
      return '<div class="rec-row">' +
        '<div class="rec-top"><span class="rec-cust"><span class="cell-ava">' + escHtml(avatar) + "</span>" + escHtml(name) + "</span>" +
        '<span class="rec-time">' + start + "</span></div>" +
        '<div class="rec-meta">' +
        (phone ? '<span class="rec-phone">📞 ' + escHtml(phone) + "</span>" : "") +
        '<span class="type-badge">' + escHtml(c.call_type || "—") + "</span>" +
        (c.issues_category ? "<span>🏷️ " + escHtml(c.issues_category) + "</span>" : "") +
        (sc != null ? '<span class="score-chip" style="color:' + k.c + ";background:" + k.bg + '">⭐ ' + sc + "</span>" : "") +
        '<span style="margin-inline-start:auto">⏱️ ' + fmtDur(c.duration) + "</span>" +
        "</div></div>";
    }).join("");
  }

  /* inline SVG sparkline */
  function spark(id, series, color) {
    var el = $(id); if (!el) return;
    series = (series && series.length) ? series : [0, 0];
    if (series.length === 1) series = [series[0], series[0]];
    var W = 220, H = 38, n = series.length;
    var max = Math.max.apply(null, series), min = Math.min.apply(null, series), range = (max - min) || 1, step = W / (n - 1);
    var pts = series.map(function (v, i) { return [i * step, H - 5 - ((v - min) / range) * (H - 12)]; });
    var line = pts.map(function (p, i) { return (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1); }).join(" ");
    var area = line + " L" + W + " " + H + " L0 " + H + " Z";
    var gid = "sp" + Math.random().toString(36).slice(2, 8), last = pts[pts.length - 1];
    el.innerHTML = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none"><defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.26"/><stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#' + gid + ')"/><path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="2.6" fill="' + color + '"/></svg>';
  }

  saveCallBtn.addEventListener("click", manualSave);
  refreshCallsBtn.addEventListener("click", loadRecentCalls);
  [custName, custPhone].forEach(function (el) { el.addEventListener("input", function () { markInvalid(el, false); }); });

  /* ═══ Customer context — recognise the caller by phone and show their history ═══
     A hallmark of a real CS console: the moment a known number is entered, the
     agent sees who's calling, their sentiment history, recurring issue and an
     at-risk flag. Rendered into every .cc-slot (live cockpit + save tab). */
  var custCtxTimer = null, lastCtxPhone = "";
  function ccSlots() { return Array.prototype.slice.call(document.querySelectorAll(".cc-slot")); }
  function setCustContext(html, state) {
    ccSlots().forEach(function (el) { el.setAttribute("data-state", state || "filled"); el.innerHTML = html; });
  }
  function ctxSentClass(s) {
    var v = (s || "").trim();
    if (["غاضب", "محبط", "سلبي"].indexOf(v) >= 0) return "danger";
    if (["سعيد", "راضي", "إيجابي"].indexOf(v) >= 0) return "ok";
    return "neutral";
  }
  function renderCtxEmpty() {
    setCustContext('<div class="cc-empty"><i class="fas fa-clock-rotate-left"></i> اكتب رقم العميل ليظهر سِجلّه وسياقه هنا.</div>', "empty");
    lastCtxPhone = "";
  }
  function renderCtxNew() {
    setCustContext('<div class="cc-new"><span class="cc-badge new"><i class="fas fa-user-plus"></i> عميل جديد</span><span>لا يوجد سِجل سابق لهذا الرقم — أول تواصل مع العميل.</span></div>', "new");
  }
  function renderCtx(d) {
    var s = d.stats || {}, c = d.customer || {};
    var name = c.name || "—";
    var chips = '<span class="cc-chip"><i class="fas fa-phone-volume"></i> ' + (s.total_calls || 0) + " مكالمة سابقة</span>";
    if (s.last_sentiment) chips += '<span class="cc-chip ' + ctxSentClass(s.last_sentiment) + '"><i class="fas fa-face-meh"></i> آخر مشاعر: ' + escHtml(s.last_sentiment) + "</span>";
    if (s.avg_score != null) chips += '<span class="cc-chip"><i class="fas fa-star"></i> متوسط الخدمة: ' + s.avg_score + "</span>";
    if (s.top_issue) chips += '<span class="cc-chip"><i class="fas fa-tag"></i> الأكثر تكرارًا: ' + escHtml(s.top_issue) + "</span>";
    var risk = s.at_risk ? '<span class="cc-badge risk"><i class="fas fa-triangle-exclamation"></i> عميل معرّض للمغادرة — تعامَل بعناية</span>'
      : '<span class="cc-badge known"><i class="fas fa-user-check"></i> عميل معروف</span>';
    var history = (d.recentCalls || []).map(function (r) {
      var sc = ctxSentClass(r.sentiment);
      var when = r.call_start ? new Date(r.call_start).toLocaleDateString("ar-EG") : "";
      return '<div class="cc-hist-row"><span class="cc-dot ' + sc + '"></span><span class="cc-hist-when">' + when +
        '</span><span class="cc-hist-cat">' + escHtml(r.issues_category || r.call_type || "—") + "</span>" +
        (r.sentiment ? '<span class="cc-hist-sent ' + sc + '">' + escHtml(r.sentiment) + "</span>" : "") + "</div>";
    }).join("");
    setCustContext(
      '<div class="cc-card">' +
        '<div class="cc-top"><span class="cc-ava">' + escHtml((name || "—").charAt(0)) + "</span>" +
          '<div class="cc-id"><b>' + escHtml(name) + '</b><small dir="ltr">' + escHtml(c.phone_number || "") + "</small></div>" + risk + "</div>" +
        '<div class="cc-chips">' + chips + "</div>" +
        (s.last_summary ? '<div class="cc-last"><b>آخر مكالمة:</b> ' + escHtml(String(s.last_summary).slice(0, 160)) + "</div>" : "") +
        (history ? '<div class="cc-hist"><div class="cc-hist-head">السِجل الأخير</div>' + history + "</div>" : "") +
      "</div>", "filled");
  }
  function lookupCustomer(phone) {
    var p = (phone || "").trim();
    if (p.length < 4) { renderCtxEmpty(); return; }
    if (p === lastCtxPhone) return;
    agentFetch("/customers/lookup?phone=" + encodeURIComponent(p)).then(function (d) {
      lastCtxPhone = p;
      if (!d || !d.found) { renderCtxNew(); return; }
      renderCtx(d);
    }).catch(function () { /* context is an enhancement — fail silently */ });
  }
  Agent.resetCustomerContext = renderCtxEmpty;
  custPhone.addEventListener("input", function () {
    clearTimeout(custCtxTimer);
    custCtxTimer = setTimeout(function () { lookupCustomer(custPhone.value); }, 500);
  });

  /* ═══ Wrap-up summary — the AI outcome shown on the save tab so every call
     closes consistently (resolution + sentiment + score at a glance) ═══ */
  Agent.renderWrapup = function (report) {
    var el = $("wrapupCard"); if (!el) return;
    if (!report || report.error || !Object.keys(report).length) { el.setAttribute("data-state", "empty"); return; }
    var status = (report.resolution_status || "").trim();
    var solved = (report.problem_solved || "").trim();
    var sentiment = (report.customer_sentiment || "").trim();
    var score = report.agent_performance_score != null ? report.agent_performance_score : (report.agent_score != null ? report.agent_score : null);
    var rCls = status === "تم الحل" ? "ok" : status === "لم يتم الحل" ? "danger" : "warn";
    var sCls = sentiment === "غاضب" ? "danger" : sentiment === "محبط" ? "warn" : sentiment === "سعيد" ? "ok" : "neutral";
    el.setAttribute("data-state", "filled");
    el.innerHTML =
      '<div class="wu-head"><i class="fas fa-clipboard-check"></i> ملخّص الإغلاق (من التحليل)</div>' +
      '<div class="wu-row">' +
        (status ? '<span class="report-status ' + rCls + '">' + escHtml(status) + "</span>" : "") +
        (solved ? '<span class="report-status ' + (solved === "نعم" ? "ok" : solved === "لا" ? "danger" : "warn") + '">تم الحل؟ ' + escHtml(solved) + "</span>" : "") +
        (sentiment ? '<span class="report-status ' + sCls + '">شعور العميل: ' + escHtml(sentiment) + "</span>" : "") +
        (score != null ? '<span class="report-status neutral"><i class="fas fa-star"></i> أداء: ' + score + "/10</span>" : "") +
      "</div>" +
      (report.follow_up_commitment && report.follow_up_commitment !== "لا يوجد"
        ? '<div class="wu-follow"><i class="fas fa-calendar-check"></i> <b>متابعة:</b> ' + escHtml(report.follow_up_commitment) + "</div>" : "") +
      '<button class="wu-link" type="button" data-tab-jump="tab-report"><i class="fas fa-up-right-from-square"></i> عرض التقرير الكامل</button>';
  };

  /* ═══ My profile modal ═══ */
  Agent.openProfileModal = function () {
    var u = getCurrentUser() || {};
    setVal("myFullName", u.full_name || ""); setVal("myPhone", u.phone || ""); setVal("myEmail", u.email || "");
    setVal("curPass", ""); setVal("newPass", "");
    $("profileModal").classList.add("active"); closeProfileMenu();
  };
  Agent.closeProfileModal = function () { $("profileModal").classList.remove("active"); };
  function setVal(id, v) { var el = $(id); if (el) el.value = v; }

  function saveMyProfile() {
    var full_name = ($("myFullName").value || "").trim(), phone = ($("myPhone").value || "").trim();
    if (!full_name) { if (window.SCM) SCM.toast("الاسم الكامل مطلوب", "error"); return; }
    agentFetch(AUTH_API + "/me", { method: "PUT", body: JSON.stringify({ full_name: full_name, phone: phone }) }).then(function (d) {
      var u = getCurrentUser() || {}; u.full_name = d.user.full_name; u.phone = d.user.phone;
      localStorage.setItem("user", JSON.stringify(u)); hydrateIdentity();
      if (window.SCM) { SCM.toast("تم حفظ بياناتك", "success"); SCM.notify({ title: "تم تحديث ملفك الشخصي", type: "success" }); }
    }).catch(function (e) { if (window.SCM) SCM.toast("فشل الحفظ: " + e.message, "error"); });
  }
  function changeMyPassword() {
    var current_password = $("curPass").value, new_password = $("newPass").value;
    if (new_password.length < 6) { if (window.SCM) SCM.toast("كلمة المرور 6 أحرف على الأقل", "error"); return; }
    agentFetch(AUTH_API + "/change-password", { method: "POST", body: JSON.stringify({ current_password: current_password, new_password: new_password }) }).then(function () {
      setVal("curPass", ""); setVal("newPass", "");
      if (window.SCM) { SCM.toast("تم تحديث كلمة المرور", "success"); SCM.notify({ title: "تم تغيير كلمة المرور", type: "success" }); }
    }).catch(function (e) { if (window.SCM) SCM.toast("فشل التحديث: " + e.message, "error"); });
  }

  /* ═══ Identity + profile dropdown + theme ═══ */
  function initials(n) { return (n || "A").trim().charAt(0).toUpperCase() || "A"; }
  function hydrateIdentity() {
    var u = getCurrentUser() || {};
    var name = u.full_name || u.username || (u.email || "").split("@")[0] || "الموظف";
    var ini = initials(name);
    setText("agentName", name); setText("agentMail", u.email || "");
    setText("agentAvatar", ini); setText("pmAvatar", ini);
    var chip = $("chipName"); if (chip) chip.innerHTML = escHtml(name) + '<small id="chipRole">وكيل</small>';
  }
  function toggleProfileMenu(e) { e && e.stopPropagation(); $("profileMenu").classList.toggle("open"); }
  function closeProfileMenu() { var m = $("profileMenu"); if (m) m.classList.remove("open"); }
  document.addEventListener("click", function (e) {
    var menu = $("profileMenu"), chip = $("profileChip");
    if (menu && menu.classList.contains("open") && !menu.contains(e.target) && chip && !chip.contains(e.target)) closeProfileMenu();
  });
  function syncThemeIcon() { var i = document.querySelector("#themeBtn i"); if (i) i.className = (window.SCM && SCM.theme() === "dark") ? "fas fa-sun" : "fas fa-moon"; }

  /* ═══ Init ═══ */
  (function init() {
    if (!currentUser) return;
    hydrateIdentity();
    setCallState("offline");
    $("profileChip").addEventListener("click", toggleProfileMenu);
    $("saveProfileBtn").addEventListener("click", saveMyProfile);
    $("changePassBtn").addEventListener("click", changeMyPassword);
    $("profileModal").addEventListener("click", function (e) { if (e.target.id === "profileModal") Agent.closeProfileModal(); });
    syncThemeIcon();
    if (window.SCM && SCM.onThemeChange) SCM.onThemeChange(syncThemeIcon);

    recentBox.innerHTML = Array.from({ length: 4 }).map(function () {
      return '<div class="rec-row"><div class="rec-top"><span class="scm-skel" style="width:45%"></span><span class="scm-skel" style="width:25%"></span></div><div class="rec-meta"><span class="scm-skel" style="width:70%"></span></div></div>';
    }).join("");
    loadRecentCalls();

    if (window.SCM && SCM.registerCommands) SCM.registerCommands([
      { label: "بدء / قطع الاتصال", hint: "مكالمة", icon: "🔌", run: function () { toggleBtn.click(); } },
      { label: "حفظ المكالمة", hint: "إجراء", icon: "💾", run: function () { saveCallBtn.click(); } },
      { label: "تحميل تقرير PDF", hint: "تصدير", icon: "📄", run: function () { if (pdfBtn) pdfBtn.click(); } },
      { label: "مسح الشاشة", hint: "إجراء", icon: "🧹", run: function () { clearBtn.click(); } },
      { label: "تحديث مكالماتي", hint: "إجراء", icon: "🔄", run: loadRecentCalls },
      { label: "ملفي الشخصي", hint: "حساب", icon: "👤", run: Agent.openProfileModal },
    ]);

    log("مرحبًا " + (currentUser.full_name || "") + " 👋 — جارٍ تشغيل نظام تحليل المكالمات تلقائيًا…", "INFO");
    connect();
  })();
})();
