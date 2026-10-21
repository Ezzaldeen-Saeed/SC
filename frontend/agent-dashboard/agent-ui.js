/* =====================================================================
   agent-ui.js — Presentation layer for the redesigned Agent Console
   ---------------------------------------------------------------------
   Purely ADDITIVE on top of agent.js: workspace tabs, tab badges,
   review-mode auto-switching (driven by MutationObservers on the state
   the engine already writes), and transcript tools (search / speaker
   filter / copy / download). It never calls, replaces, or depends on
   agent.js internals — only observes the DOM agent.js renders into.
   ===================================================================== */
"use strict";

(function () {
  var $ = function (id) { return document.getElementById(id); };

  /* ═══ Workspace tabs ═══ */
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".ws-tab"));
  function activateTab(id) {
    tabs.forEach(function (t) {
      var on = t.getAttribute("data-tab") === id;
      t.classList.toggle("active", on);
      if (on) t.classList.remove("pulse");
    });
    document.querySelectorAll(".ws-pane").forEach(function (p) {
      p.classList.toggle("active", p.id === id);
    });
    if (id === "tab-history") kickAnalytics();   // charts draw lazily, once visible
  }
  tabs.forEach(function (t) {
    t.addEventListener("click", function () { activateTab(t.getAttribute("data-tab")); });
  });
  // Any element can jump to a tab via data-tab-jump="tab-id" (delegated so it
  // also works for elements rendered later, e.g. the wrap-up "full report" link).
  document.addEventListener("click", function (e) {
    var j = e.target.closest ? e.target.closest("[data-tab-jump]") : null;
    if (j) activateTab(j.getAttribute("data-tab-jump"));
  });

  function isTabActive(id) {
    var p = $(id); return !!(p && p.classList.contains("active"));
  }
  function pulseTab(tabId) {
    var t = document.querySelector('.ws-tab[data-tab="' + tabId + '"]');
    if (!t || t.classList.contains("active")) return;
    t.classList.remove("pulse"); void t.offsetWidth; t.classList.add("pulse");
  }
  function setBadge(id, n) {
    var b = $(id); if (!b) return;
    b.textContent = n > 99 ? "99+" : String(n);
    b.style.display = n > 0 ? "" : "none";
  }

  /* ═══ Cockpit boxes — agent.js renders transcript + coaching into these,
     both now live side-by-side in the main cockpit (no separate tabs). ═══ */
  var analysisBox = $("analysis-box"), txBox = $("transcript-box");

  /* ═══ Review mode — the report section visibility is toggled by agent.js ═══ */
  var reportSection = $("report-section"), reportEmpty = $("reportEmpty");
  function syncReport() {
    var visible = reportSection && reportSection.style.display !== "none";
    var dot = $("reportTabDot"); if (dot) dot.style.display = visible ? "" : "none";
    if (reportEmpty) reportEmpty.style.display = visible ? "none" : "";
    if (visible) activateTab("tab-report");                    // call ended → review mode
    else if (isTabActive("tab-report")) activateTab("tab-live"); // report cleared → back to live
  }
  if (window.MutationObserver && reportSection) {
    new MutationObserver(syncReport).observe(reportSection, { attributes: true, attributeFilter: ["style"] });
    syncReport();
  }

  /* ═══ Call-state UX — agent.js writes data-state on the hero ═══ */
  var hero = $("callHero");
  var STATE_LABEL = {
    offline: "غير متصل", connecting: "جارٍ الاتصال…", ready: "جاهز لاستقبال المكالمات",
    live: "مكالمة مباشرة الآن", ended: "انتهت المكالمة — راجع واحفظ",
  };
  function onStateChange(state) {
    document.body.setAttribute("data-call-state", state);
    var lbl = $("abStateLabel"); if (lbl) lbl.textContent = STATE_LABEL[state] || state;
    if (state === "live") activateTab("tab-live");
    if (state === "ended") {
      // Call-ended mode: bring the agent to the save flow, then focus the
      // first required field once the pane is visible.
      activateTab("tab-customer");
      var cn = $("cust-name");
      if (cn && !cn.value.trim()) setTimeout(function () { try { cn.focus(); } catch (e) {} }, 260);
    }
  }
  if (hero) {
    var last = hero.getAttribute("data-state") || "offline";
    onStateChange(last);
    if (window.MutationObserver) {
      new MutationObserver(function () {
        var s = hero.getAttribute("data-state");
        if (s && s !== last) { last = s; onStateChange(s); }
      }).observe(hero, { attributes: true, attributeFilter: ["data-state"] });
    }
  }

  /* ═══ My-performance analytics (history tab) ═══
     Reads the same /api/agent/calls endpoint agent.js already uses (additive,
     read-only) and renders three charts via the shared SCMCharts layer. Charts
     draw only while the history tab is visible, so canvases never size at 0. */
  var AG_API = (function () {
    var qs = new URLSearchParams(location.search).get("api");
    if (qs) return qs.replace(/\/+$/, "");
    var stored = localStorage.getItem("api_base");
    if (stored) return stored.replace(/\/+$/, "");
    return location.protocol + "//" + location.hostname + ":3000";
  })();
  var agCalls = null, agDirty = true, agFetching = false, agLibRetries = 0;

  function agToken() {
    try { return (JSON.parse(localStorage.getItem("session")) || {}).access_token || null; } catch (e) { return null; }
  }
  function fetchAgentCalls() {
    var token = agToken();
    if (!token || agFetching) return;
    agFetching = true;
    fetch(AG_API + "/api/agent/calls", { headers: { "Authorization": "Bearer " + token } })
      .then(function (r) { return r.ok ? r.json() : { calls: [] }; })
      .then(function (d) {
        agCalls = d.calls || []; agDirty = true;
        if (isTabActive("tab-history")) renderAgentCharts();
      })
      .catch(function () {})
      .then(function () { agFetching = false; });
  }
  function kickAnalytics() {
    if (agCalls === null) fetchAgentCalls();
    else renderAgentCharts();
  }
  function agScore(c) {
    var ps = Array.isArray(c.performance_scores) ? c.performance_scores[0] : c.performance_scores;
    return ps && ps.total_score != null ? Number(ps.total_score) : null;
  }
  function renderAgentCharts() {
    if (!agDirty || !agCalls) return;
    if (!window.SCMCharts || !SCMCharts.available) {         // Chart.js loads deferred
      if (agLibRetries++ < 25) setTimeout(renderAgentCharts, 400);
      return;
    }
    if (!isTabActive("tab-history")) return;

    var calls = agCalls;
    var cvD = $("agChartDays");
    if (cvD) {
      var d = SCMCharts.callsPerDay(calls, 14);
      SCMCharts.line(cvD, { labels: d.labels, data: d.data });
    }
    var cvS = $("agChartScores");
    if (cvS) {
      var scored = calls.filter(function (c) { return agScore(c) != null; }).slice(0, 15).reverse();
      var data = scored.map(agScore);
      SCMCharts.bar(cvS, {
        labels: scored.map(function (_, i) { return String(i + 1); }),
        data: data,
        colors: data.map(function (v) { return v >= 75 ? "#10B981" : v >= 50 ? "#F59E0B" : "#EF4444"; }),
      });
    }
    var cvT = $("agChartTypes");
    if (cvT) {
      var t = SCMCharts.typeSplit(calls);
      SCMCharts.doughnut(cvT, { labels: t.labels, data: t.data });
    }
    agDirty = false;
  }
  // Refresh triggers: the list's refresh button, and any re-render of the list
  // (agent.js reloads it after every save) — debounced.
  var agRefreshBtn = $("refresh-calls-btn");
  if (agRefreshBtn) agRefreshBtn.addEventListener("click", fetchAgentCalls);
  var agRecentBox = $("recent-box"), agDebounce = null;
  if (agRecentBox && window.MutationObserver) {
    new MutationObserver(function () {
      clearTimeout(agDebounce);
      agDebounce = setTimeout(fetchAgentCalls, 900);
    }).observe(agRecentBox, { childList: true });
  }

  /* ═══ Save validation — agent.js flags missing fields with .invalid ═══
     If validation fails while another tab is open, bring the agent to the
     customer form so the flagged field is actually visible. */
  ["cust-name", "cust-phone"].forEach(function (id) {
    var el = $(id);
    if (!el || !window.MutationObserver) return;
    new MutationObserver(function () {
      if (el.classList.contains("invalid") && !isTabActive("tab-customer")) {
        activateTab("tab-customer");
        setTimeout(function () { try { el.focus(); } catch (e) {} }, 200);
      }
    }).observe(el, { attributes: true, attributeFilter: ["class"] });
  });

  /* ═══ Transcript tools — search, speaker filter, copy, download ═══ */
  var txSearch = $("txSearch");
  function currentSpeakerFilter() {
    var on = document.querySelector("#txFilters .chip.on");
    return on ? on.getAttribute("data-speaker") : "all";
  }
  function applyTxFilter() {
    if (!txBox) return;
    var q = (txSearch && txSearch.value.trim().toLowerCase()) || "";
    var mode = currentSpeakerFilter();
    txBox.querySelectorAll(".msg").forEach(function (m) {
      var okSpeaker = mode === "all"
        || (mode === "agent" && m.classList.contains("tx-agent"))
        || (mode === "customer" && m.classList.contains("tx-customer"));
      var okText = !q || m.textContent.toLowerCase().indexOf(q) >= 0;
      m.style.display = (okSpeaker && okText) ? "" : "none";
    });
  }
  if (txSearch) txSearch.addEventListener("input", applyTxFilter);
  document.querySelectorAll("#txFilters .chip").forEach(function (c) {
    c.addEventListener("click", function () {
      document.querySelectorAll("#txFilters .chip").forEach(function (x) { x.classList.remove("on"); });
      c.classList.add("on"); applyTxFilter();
    });
  });
  // Keep the active filter applied to lines that stream in later.
  if (window.MutationObserver && txBox) {
    new MutationObserver(function () {
      if ((txSearch && txSearch.value.trim()) || currentSpeakerFilter() !== "all") applyTxFilter();
    }).observe(txBox, { childList: true });
  }

  function transcriptText() {
    if (!txBox) return "";
    var out = [];
    txBox.querySelectorAll(".msg").forEach(function (m) {
      var role = m.querySelector(".tx-role"), body = m.querySelector(".tx-body");
      out.push((role ? "[" + role.textContent + "] " : "") + (body ? body.textContent : m.textContent).trim());
    });
    return out.join("\n");
  }
  var copyBtn = $("txCopyBtn");
  if (copyBtn) copyBtn.addEventListener("click", function () {
    var t = transcriptText();
    if (!t) { if (window.SCM) SCM.toast("لا يوجد تفريغ للنسخ", "warn"); return; }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t).then(function () {
        if (window.SCM) SCM.toast("تم نسخ التفريغ", "success");
      }, function () { if (window.SCM) SCM.toast("تعذّر النسخ", "error"); });
    }
  });
  var dlBtn = $("txDownloadBtn");
  if (dlBtn) dlBtn.addEventListener("click", function () {
    var t = transcriptText();
    if (!t) { if (window.SCM) SCM.toast("لا يوجد تفريغ للتحميل", "warn"); return; }
    var blob = new Blob(["﻿" + t], { type: "text/plain;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "transcript_" + new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-") + ".txt";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  });

  /* ═══ Knowledge base & quick replies — a slide-in drawer with ready steps and
     professional canned responses for the most common WE issues. Always one
     click away during a call (cockpit button, the nav button, Escape to close). ═══ */
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  var KB_ITEMS = [
    { cat: "الإنترنت", icon: "fa-wifi", title: "النت بيفصل أو بطيء",
      steps: ["اتأكد من لمبات الراوتر (اللمبة الحمرا = مشكلة خط).", "اطلب من العميل يعيد تشغيل الراوتر 30 ثانية.", "افحص حالة الخدمة على المنطقة قبل فتح بلاغ.", "لو المشكلة مستمرة، افتح بلاغ فني وادِّي رقم مرجعي."],
      reply: "أعتذر لحضرتك على إزعاج انقطاع النت. هنعيد تشغيل الراوتر مع بعض دلوقتي، ولو استمرت المشكلة هفتح لحضرتك بلاغ فني برقم مرجعي ونتابعه لحد ما يترحّل." },
    { cat: "الفاتورة", icon: "fa-file-invoice", title: "استفسار عن فاتورة عالية",
      steps: ["راجع آخر عملية سداد وتاريخ التجديد.", "اشرح بنود الباقة وأي زيادة على الاستهلاك.", "لو فيه رسم غير مفهوم، وثّقه وافتح مراجعة."],
      reply: "هراجع مع حضرتك تفاصيل الفاتورة بند بند دلوقتي، ولو فيه أي رسم غير واضح هفتح مراجعة وأتابعها لحد ما نوصل لحل واضح." },
    { cat: "تحقق الهوية", icon: "fa-id-card", title: "التحقق قبل أي تعديل",
      steps: ["اطلب رقم الخط أو الرقم القومي المسجّل.", "أكِّد بيانات صاحب الخط قبل أي تغيير.", "متعملش أي تعديل قبل التحقق."],
      reply: "عشان أحافظ على أمان حساب حضرتك، لازم أتأكد من الهوية الأول — ممكن رقم الخط أو الرقم القومي المسجّل؟" },
    { cat: "الباقات", icon: "fa-box", title: "تغيير أو تجديد باقة",
      steps: ["اعرض الباقة المناسبة لاستهلاك العميل.", "وضّح تاريخ التفعيل والتكلفة.", "أكِّد موافقة العميل قبل التفعيل."],
      reply: "حسب استهلاك حضرتك، أنسب باقة هي [الباقة] بتكلفة [المبلغ] وهتتفعّل من [التاريخ] — تحب أفعّلها لحضرتك دلوقتي؟" },
    { cat: "تصعيد واحتفاظ", icon: "fa-triangle-exclamation", title: "عميل غاضب أو طالب مسؤول",
      steps: ["اسمع العميل من غير مقاطعة واعتذر بوضوح.", "طمّنه إنك هتحل المشكلة بنفسك.", "لو أصرّ، صعّد لمشرف مع تلخيص الموقف والبلاغ."],
      reply: "أنا آسف جدًا لحضرتك على اللي حصل، ومتفهّم انزعاجك تمامًا. هتابع المشكلة دي بنفسي دلوقتي، ولو حضرتك حابب أوصّلك لمشرف مباشرة." },
    { cat: "إنهاء مهني", icon: "fa-circle-check", title: "إغلاق المكالمة باحتراف",
      steps: ["لخّص اللي اتعمل والخطوة الجاية.", "أكِّد رقم البلاغ/المتابعة إن وُجد.", "اسأل لو فيه أي خدمة تانية."],
      reply: "تمام يا فندم، كده خلّصنا [الملخّص] والخطوة الجاية هتكون [الإجراء]. فيه أي خدمة تانية أقدر أساعد حضرتك فيها؟" },
  ];
  function renderKb(filter) {
    var list = $("kbList"); if (!list) return;
    var q = (filter || "").trim().toLowerCase();
    var items = KB_ITEMS.filter(function (it) {
      return !q || (it.title + " " + it.cat + " " + it.reply + " " + it.steps.join(" ")).toLowerCase().indexOf(q) >= 0;
    });
    if (!items.length) { list.innerHTML = '<div class="kb-empty"><i class="fas fa-magnifying-glass"></i> لا نتائج مطابقة.</div>'; return; }
    list.innerHTML = items.map(function (it) {
      return '<div class="kb-item">' +
        '<div class="kb-item-head"><span class="kb-ic"><i class="fas ' + it.icon + '"></i></span>' +
          '<div><b>' + esc(it.title) + '</b><span class="kb-cat">' + esc(it.cat) + "</span></div></div>" +
        '<ul class="kb-steps">' + it.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ul>" +
        '<div class="kb-reply"><span class="kb-reply-label"><i class="fas fa-quote-right"></i> ردّ جاهز</span><p>' + esc(it.reply) + "</p>" +
          '<button class="btn btn-soft btn-sm kb-copy" type="button" data-reply="' + esc(it.reply) + '"><i class="fas fa-copy"></i> نسخ الردّ</button></div>' +
      "</div>";
    }).join("");
  }
  var kbDrawer = $("kbDrawer"), kbBackdrop = $("kbBackdrop"), kbSearch = $("kbSearch"), kbList = $("kbList");
  function openKb() {
    if (!kbDrawer) return;
    renderKb(kbSearch ? kbSearch.value : "");
    kbDrawer.classList.add("open"); kbDrawer.setAttribute("aria-hidden", "false");
    if (kbBackdrop) kbBackdrop.classList.add("show");
    if (kbSearch) setTimeout(function () { try { kbSearch.focus(); } catch (e) {} }, 120);
  }
  function closeKb() {
    if (kbDrawer) { kbDrawer.classList.remove("open"); kbDrawer.setAttribute("aria-hidden", "true"); }
    if (kbBackdrop) kbBackdrop.classList.remove("show");
  }
  Array.prototype.slice.call(document.querySelectorAll(".kb-trigger")).forEach(function (b) { b.addEventListener("click", openKb); });
  var kbCloseBtn = document.querySelector(".kb-close"); if (kbCloseBtn) kbCloseBtn.addEventListener("click", closeKb);
  if (kbBackdrop) kbBackdrop.addEventListener("click", closeKb);
  if (kbSearch) kbSearch.addEventListener("input", function () { renderKb(kbSearch.value); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeKb(); });
  if (kbList) kbList.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest(".kb-copy") : null;
    if (!btn) return;
    var txt = btn.getAttribute("data-reply") || "";
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(txt).then(function () { if (window.SCM) SCM.toast("تم نسخ الردّ الجاهز", "success"); },
        function () { if (window.SCM) SCM.toast("تعذّر النسخ", "error"); });
    }
  });
  renderKb("");
})();
