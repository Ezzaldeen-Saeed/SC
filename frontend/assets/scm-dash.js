/*
 * scm-dash.js — Shared dashboard runtime for the SCM role dashboards.
 * ──────────────────────────────────────────────────────────────────
 * Common pieces the Manager & Supervisor consoles reuse so they match the
 * Admin UI without duplicating logic: auth + scoped fetch, formatting,
 * badges, count-up KPIs, inline-SVG sparklines, the call-detail modal (+PDF),
 * the live-calls client (counter that updates in real time over SSE), and the
 * my-profile modal. Requires scm-ui.js (window.SCM) and, for charts callers,
 * scm-charts.js (window.SCMCharts). Exposes window.SCMDash.
 */
(function () {
  'use strict';

  /* ── auth + scoped fetch ── */
  function makeAuth(opts) {
    // Optional backend override (?api=… or localStorage.api_base) — handy for
    // deployments behind a different host and for local testing.
    var root = '';
    try { root = (new URLSearchParams(location.search).get('api') || localStorage.getItem('api_base') || '').replace(/\/+$/, ''); } catch (e) {}
    var apiBase = (root && opts.apiPath) ? root + opts.apiPath : opts.apiBase;
    var authBase = root ? root + '/api/auth' : opts.authBase;
    var role = opts.role, loginPage = opts.loginPage || '../login.html';
    function getUser() { try { return JSON.parse(localStorage.getItem('user')); } catch (e) { return null; } }
    function getToken() { try { return (JSON.parse(localStorage.getItem('session')) || {}).access_token || null; } catch (e) { return null; } }
    function redirectToLogin() { window.location.replace(loginPage); }
    function logout() { if (window.SCM) SCM.audit('LOGOUT'); localStorage.removeItem('session'); localStorage.removeItem('user'); redirectToLogin(); }
    function guard() { var u = getUser(); if (!u || !getToken() || (role && u.role !== role)) { redirectToLogin(); return false; } return true; }
    function authFetchAt(base, endpoint, options) {
      options = options || {};
      var token = getToken();
      if (!token) { redirectToLogin(); return Promise.reject(new Error('no session')); }
      var headers = Object.assign({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, options.headers || {});
      return fetch(base + endpoint, Object.assign({}, options, { headers: headers })).then(function (res) {
        if (res.status === 401) { logout(); throw new Error('انتهت الجلسة'); }
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.message || data.error || ('HTTP ' + res.status));
          return data;
        });
      });
    }
    return {
      getUser: getUser, getToken: getToken, redirectToLogin: redirectToLogin, logout: logout, guard: guard,
      authFetchAt: authFetchAt,
      authFetch: function (endpoint, options) { return authFetchAt(apiBase, endpoint, options); },
      authBaseFetch: function (endpoint, options) { return authFetchAt(authBase, endpoint, options); },
      liveBase: apiBase.replace(/\/(manager|supervisor|admin|agent)$/, '/live'),
    };
  }

  /* ── formatting ── */
  function escapeHtml(s) { if (s == null || s === '') return '—'; return String(s).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; }); }
  function initials(n) { return (n || 'U').trim().charAt(0).toUpperCase() || 'U'; }
  function fmtDateTime(s) { if (!s) return '—'; var d = new Date(s); return isNaN(d) ? '—' : d.toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function fmtDate(s) { if (!s) return '—'; var d = new Date(s); return isNaN(d) ? '—' : d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' }); }
  function durSec(c) {
    if (c.duration_sec != null) return c.duration_sec;
    if (c.call_start && c.call_end) { var s = Math.round((new Date(c.call_end) - new Date(c.call_start)) / 1000); return s >= 0 ? s : null; }
    if (typeof c.duration === 'string') { var h = c.duration.match(/(\d+):(\d{2}):(\d{2})/); if (h) return (+h[1]) * 3600 + (+h[2]) * 60 + (+h[3]); var x = c.duration.match(/(\d+)\s*sec/); if (x) return +x[1]; }
    return null;
  }
  function fmtDuration(sec) { if (sec == null) return '—'; if (sec < 60) return sec + ' ث'; var m = Math.floor(sec / 60), s = sec % 60; if (m < 60) return m + ':' + String(s).padStart(2, '0') + ' د'; var h = Math.floor(m / 60); return h + ':' + String(m % 60).padStart(2, '0') + ':' + String(s).padStart(2, '0'); }
  function timeAgo(ts) { var s = Math.floor((Date.now() - ts) / 1000); if (s < 60) return 'الآن'; var m = Math.floor(s / 60); if (m < 60) return 'منذ ' + m + ' دقيقة'; var h = Math.floor(m / 60); if (h < 24) return 'منذ ' + h + ' ساعة'; return 'منذ ' + Math.floor(h / 24) + ' يوم'; }
  function isToday(s) { if (!s) return false; var d = new Date(s), n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); }
  function scoreOf(c) { var ps = Array.isArray(c.performance_scores) ? c.performance_scores[0] : c.performance_scores; return ps && ps.total_score != null ? Number(ps.total_score) : null; }
  function sentimentClass(s) { if (!s) return 'neutral'; var v = String(s).toLowerCase(); if (/(pos|إيجاب|راض|سعيد|good|happy)/.test(v)) return 'positive'; if (/(neg|سلب|غاضب|غضب|bad|angry|سيّئ|سيئ|محبط)/.test(v)) return 'negative'; return 'neutral'; }
  function sentimentBadge(s) { if (!s) return '<span class="dash">—</span>'; var c = sentimentClass(s); var cls = c === 'positive' ? 'pos' : c === 'negative' ? 'neg' : 'neutral'; var ic = c === 'positive' ? 'fa-face-smile' : c === 'negative' ? 'fa-face-angry' : 'fa-face-meh'; return '<span class="badge ' + cls + '"><i class="fas ' + ic + '"></i> ' + escapeHtml(s) + '</span>'; }
  function scoreColor(v) { if (v == null) return { c: 'var(--muted)', bg: 'var(--surface-2)' }; if (v < 50) return { c: 'var(--danger)', bg: 'rgba(239,68,68,.12)' }; if (v < 75) return { c: 'var(--warning)', bg: 'rgba(245,158,11,.14)' }; return { c: 'var(--success)', bg: 'rgba(16,185,129,.12)' }; }
  function scorePill(v) { if (v == null) return '<span class="dash">—</span>'; var k = scoreColor(v); return '<span class="score-pill" style="color:' + k.c + ';background:' + k.bg + '">' + v + '</span>'; }
  function statusBadge(a) { return a ? '<span class="status-badge status-active">نشط</span>' : '<span class="status-badge status-inactive">معطل</span>'; }
  function roleLabelAr(r) { return ({ admin: 'أدمن', manager: 'مدير', supervisor: 'مشرف', agent: 'وكيل' })[r] || (r || '—'); }
  function toast(m, t) { if (window.SCM) SCM.toast(m, t || 'info'); }
  function emptyState(icon, title, sub) { return '<div class="empty-state"><div class="empty-ic"><i class="fas ' + icon + '"></i></div><h4>' + title + '</h4><p>' + (sub || '') + '</p></div>'; }
  function setKpi(id, val) { var el = document.getElementById(id); if (!el) return; if (window.SCM && SCM.countUp) SCM.countUp(el, String(val)); else el.textContent = val; }

  /* ── inline SVG sparkline ── */
  function makeSparkline(series, color) {
    series = (series && series.length) ? series : [0, 0];
    if (series.length === 1) series = [series[0], series[0]];
    var W = 240, H = 46, n = series.length, max = Math.max.apply(null, series), min = Math.min.apply(null, series), range = (max - min) || 1, step = W / (n - 1);
    var pts = series.map(function (v, i) { return [i * step, H - 6 - ((v - min) / range) * (H - 14)]; });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var gid = 'sp' + Math.random().toString(36).slice(2, 8), last = pts[pts.length - 1];
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none"><defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="' + color + '" stop-opacity="0.28"/><stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs><path d="' + line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z" fill="url(#' + gid + ')"/><path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3" fill="' + color + '"/></svg>';
  }
  function spark(id, series, color) { var el = document.getElementById(id); if (el) el.innerHTML = makeSparkline(series, color); }
  function perDay(items, days, get) {
    var today = new Date(); today.setHours(0, 0, 0, 0); var keys = [], map = {};
    for (var i = days - 1; i >= 0; i--) { var d = new Date(today); d.setDate(today.getDate() - i); var k = d.toISOString().slice(0, 10); keys.push(k); map[k] = 0; }
    (items || []).forEach(function (it) { var dt = get(it); if (!dt) return; var k = new Date(dt).toISOString().slice(0, 10); if (k in map) map[k]++; });
    return keys.map(function (k) { return map[k]; });
  }

  /* ── live-calls client (real-time counter) ── */
  function initLive(cfg) {
    // cfg: { authFetchAt, liveBase, onUpdate(liveCalls) }
    function fetchNow() {
      return cfg.authFetchAt(cfg.liveBase, '/calls').then(function (d) { cfg.onUpdate(d.liveCalls || []); }).catch(function () {});
    }
    document.addEventListener('scm:event', function (e) { var t = e.detail && e.detail.type; if (t && String(t).indexOf('live') === 0) fetchNow(); });
    fetchNow();
    // tick live durations every second (cards with data-start)
    setInterval(function () {
      document.querySelectorAll('.lc-dur[data-start]').forEach(function (el) {
        var st = new Date(el.getAttribute('data-start')); if (isNaN(st)) return;
        var s = Math.max(0, Math.floor((Date.now() - st) / 1000));
        el.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
      });
    }, 1000);
    return { refresh: fetchNow };
  }
  // Real-time data refresh: run cb (debounced) when an SSE event whose type
  // starts with one of `prefixes` arrives — so dashboards update live instead
  // of polling. Relies on scm-ui dispatching `scm:event` for every SSE message.
  function onDataChange(prefixes, cb, wait) {
    var timer = null; wait = wait || 1200;
    document.addEventListener('scm:event', function (e) {
      var t = e.detail && e.detail.type; if (!t) return;
      if (!prefixes.some(function (p) { return String(t).indexOf(p) === 0; })) return;
      clearTimeout(timer); timer = setTimeout(cb, wait);
    });
  }
  function liveCardFromRegistry(e) {
    var agent = e.full_name || '—', cust = e.customer_name || 'لم يُحدَّد بعد';
    return '<div class="live-call live-ring" style="border-inline-start:3px solid var(--danger)" title="مكالمة مباشرة الآن">'
      + '<div class="lc-head"><span class="lc-live"><span class="live-dot"></span> مباشر الآن</span><span class="lc-dur" data-start="' + e.started_at + '">00:00</span></div>'
      + '<div class="lc-people"><span class="avatar sq-sm">' + escapeHtml(initials(agent)) + '</span><div class="lc-person"><b>' + escapeHtml(agent) + '</b><small>الوكيل</small></div>'
      + '<i class="fas fa-arrow-right-arrow-left lc-arrow"></i><div class="lc-person" style="text-align:end;margin-inline-start:auto"><b>' + escapeHtml(cust) + '</b><small>العميل</small></div></div>'
      + '<div class="lc-meta"><span class="badge neg"><span class="live-dot"></span> LIVE</span><span class="badge info"><i class="fas fa-robot"></i> قيد التحليل</span></div>'
      + '<div class="lc-confidence"><div class="lcc-row"><span>التحليل اللحظي يعمل…</span><b>—</b></div><div class="lcc-bar"><i class="lcc-fill" style="width:45%"></i></div></div></div>';
  }

  /* ── call-detail modal (+PDF) ── */
  var _cdShort = '', _cdCall = null;
  function openCallDetail(callId, ctx) {
    // ctx: { authFetch } — fetches `/calls/:id`
    var modal = document.getElementById('callModal'), content = document.getElementById('callDetailContent');
    _cdShort = (callId || '').split('-')[0] || 'call';
    content.innerHTML = '<div class="cd-empty"><span class="spinner"></span> جارٍ التحميل…</div>';
    modal.classList.add('active');
    ctx.authFetch('/calls/' + callId).then(function (d) { renderCallDetail(d.call); })
      .catch(function (e) { content.innerHTML = '<div class="cd-empty" style="color:var(--danger)">تعذّر التحميل: ' + escapeHtml(e.message) + '</div>'; });
  }
  function closeCallDetail() { var m = document.getElementById('callModal'); if (m) m.classList.remove('active'); }
  function cdBox(l, v) { return '<div class="cd-box"><span>' + l + '</span><strong>' + v + '</strong></div>'; }
  function cdScore(l, v) { if (v == null) return ''; var k = scoreColor(v); var w = Math.max(0, Math.min(100, Number(v) || 0)); return '<div class="cd-score"><b style="color:' + k.c + '">' + v + '</b><span>' + l + '</span><span class="cd-score-bar"><i style="width:' + w + '%;background:' + k.c + '"></i></span></div>'; }
  function resolutionBlock(a) {
    var status = (a.resolution_status || '').trim(), solved = (a.problem_solved || '').trim();
    var outcome = (a.call_outcome || '').trim(), evidence = (a.resolution_evidence || '').trim();
    var followUp = (a.follow_up_commitment || '').trim();
    if (!status && !solved && !outcome) return '';
    var badge = function (val, cls) { return '<span class="badge ' + cls + '">' + escapeHtml(val) + '</span>'; };
    var statusCls = status === 'تم الحل' ? 'pos' : status === 'لم يتم الحل' ? 'neg' : (!status || status === 'غير واضح') ? 'info' : 'warn';
    var solvedCls = solved === 'نعم' ? 'pos' : solved === 'لا' ? 'neg' : 'warn';
    var outcomeCls = outcome === 'ناجحة' ? 'pos' : outcome === 'تصعيد مطلوب' ? 'neg' : 'warn';
    var chips = (status ? badge(status, statusCls) : '') + (solved ? badge('تم الحل؟ ' + solved, solvedCls) : '') + (outcome ? badge(outcome, outcomeCls) : '');
    var out = '<div class="cd-insight" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b>حالة الحل:</b> ' + chips + '</div>';
    if (evidence) out += '<div class="cd-insight"><b>🧾 الدليل من المكالمة:</b> ' + escapeHtml(evidence) + '</div>';
    if (followUp && followUp !== 'لا يوجد') out += '<div class="cd-insight"><b>📅 التزام المتابعة:</b> ' + escapeHtml(followUp) + '</div>';
    return out;
  }
  function analysisInsights(a) {
    if (!a || typeof a !== 'object') return '';
    // Single-value fields → clean labeled rows.
    var textLabels = { issue_category: '🏷️ تصنيف المشكلة', customer_issue: '❗ مشكلة العميل', root_cause: '🔎 السبب الجذري', resolution_provided: '🛠️ الحل المقدّم' };
    var textRows = Object.keys(textLabels).filter(function (k) { return a[k] != null && String(a[k]).trim(); })
      .map(function (k) { return '<div class="cd-insight"><b>' + textLabels[k] + ':</b> ' + escapeHtml(String(a[k])) + '</div>'; }).join('');
    // List fields → color-coded panels (strengths / weaknesses / …).
    var panel = function (kind, title, arr) {
      if (!Array.isArray(arr) || !arr.length) return '';
      return '<div class="cd-panel ' + kind + '"><div class="cd-panel-h">' + title + '</div><ul>' + arr.map(function (x) { return '<li>' + escapeHtml(String(x)) + '</li>'; }).join('') + '</ul></div>';
    };
    var panels = panel('good', '💪 نقاط القوة', a.strengths) + panel('bad', '⚠️ نقاط الضعف', a.weaknesses)
      + panel('warn', '🎯 فرص ضائعة', a.missed_opportunities) + panel('info', '➡️ الخطوات التالية', a.next_steps)
      + panel('info', '📌 توصيات للمشرف', a.recommended_actions) + panel('bad', '🔥 لحظات حرجة', a.critical_moments);
    var head = resolutionBlock(a);
    var grid = panels ? '<div class="cd-panels">' + panels + '</div>' : '';
    return (textRows || head || grid) ? '<div class="cd-section"><h4><i class="fas fa-robot"></i> تحليل الذكاء الاصطناعي</h4>' + head + textRows + grid + '</div>' : '';
  }
  function renderCallDetail(call) {
    _cdCall = call;
    var ps = Array.isArray(call.performance_scores) ? call.performance_scores[0] : call.performance_scores;
    var agent = call.users || {}, cust = call.customers || {}, tx = call.transcripts || [];
    var scores = ps ? [cdScore('الإجمالي', ps.total_score), cdScore('رضا العميل', ps.customer_satisfaction_score), cdScore('الالتزام', ps.script_compliance), cdScore('التعاطف', ps.empathy_score), cdScore('حل المشكلة', ps.resolution_score)].join('') : '';
    var txHtml = tx.length ? '<div class="cd-transcript">' + tx.map(function (t) { return '<div class="tx-line"><span class="tx-time">' + escapeHtml(t.timestamp || '') + '</span><span class="tx-speaker">' + escapeHtml(t.speaker || '—') + '</span><span class="tx-text">' + escapeHtml(t.text || '') + '</span></div>'; }).join('') + '</div>' : '<div class="cd-empty">لا يوجد تفريغ محفوظ</div>';
    document.getElementById('callDetailContent').innerHTML =
      '<div class="cd-section"><h4><i class="fas fa-circle-info"></i> بيانات المكالمة</h4><div class="cd-grid">' + cdBox('التاريخ', fmtDateTime(call.call_start)) + cdBox('المدة', fmtDuration(durSec(call))) + cdBox('النوع', escapeHtml(call.call_type || '—')) + cdBox('التصنيف', escapeHtml(call.issues_category || '—')) + cdBox('المشاعر', escapeHtml(call.sentiment || '—')) + '</div></div>'
      + '<div class="cd-section"><h4><i class="fas fa-users"></i> الأطراف</h4><div class="cd-grid">' + cdBox('الوكيل', escapeHtml(agent.full_name || '—')) + cdBox('العميل', escapeHtml(cust.name || '—')) + cdBox('هاتف العميل', '<span dir="ltr">' + escapeHtml(cust.phone_number || '—') + '</span>') + '</div></div>'
      + (scores ? '<div class="cd-section"><h4><i class="fas fa-chart-pie"></i> تقييم الأداء</h4><div class="cd-scores">' + scores + '</div></div>' : '')
      + (call.summary ? '<div class="cd-section"><h4><i class="fas fa-align-left"></i> الملخّص</h4><div class="cd-summary">' + escapeHtml(call.summary) + '</div></div>' : '')
      + analysisInsights(call.analysis)
      + suggestionsSection(call.suggestions)
      + '<div class="cd-section" style="margin-bottom:0"><h4><i class="fas fa-comments"></i> التفريغ (' + tx.length + ')</h4>' + txHtml + '</div>';
  }
  function suggestionsSection(items) {
    if (!Array.isArray(items) || !items.length) return '';
    var rows = items.map(function (s) {
      var cls = s.priority === 'high' ? 'neg' : s.priority === 'low' ? 'pos' : 'warn';
      var lbl = s.priority === 'high' ? '⚠️ عالية' : s.priority === 'low' ? '💡 نصيحة' : 'توجيه';
      var cats = (s.problem_type ? '<span class="badge info" style="margin-inline-start:6px">' + escapeHtml(s.problem_type) + '</span>' : '')
        + (s.suggestion_type ? '<span class="badge" style="margin-inline-start:6px;background:rgba(14,165,233,.1);color:#0369A1">' + escapeHtml(s.suggestion_type) + '</span>' : '');
      return '<div class="cd-insight"><b><span class="badge ' + cls + '">' + lbl + '</span></b>' + cats + ' ' + escapeHtml(s.suggest_text) + '</div>';
    }).join('');
    return '<div class="cd-section"><h4><i class="fas fa-lightbulb"></i> اقتراحات المدرّب اللحظي (' + items.length + ')</h4>' + rows + '</div>';
  }
  function downloadCallPdf() {
    var el = document.getElementById('callDetailContent'); if (!el) return;
    if (!window.SCM || !SCM.printReport) { toast('مكتبة PDF غير متاحة', 'error'); return; }
    SCM.audit('GENERATE_REPORT', { call: _cdShort });
    if (_cdCall && SCM.printCallReport) { SCM.printReport(null, { call: _cdCall, shortId: _cdShort }); return; }
    SCM.printReport(el.innerHTML, { title: 'تقرير المكالمة', subtitle: 'CALL REPORT', filename: 'call_' + _cdShort + '_report.pdf', meta: [{ label: 'رقم المكالمة', value: _cdShort }, { label: 'تاريخ التصدير', value: new Date().toLocaleString('ar-EG') }] });
  }

  /* ── my-profile modal ── */
  function bindProfile(ctx) {
    // ctx: { authFetchAt, authBase, onSaved(user) }
    var save = document.getElementById('saveProfileBtn'), pass = document.getElementById('changePassBtn');
    if (save) save.addEventListener('click', function () {
      var full_name = (document.getElementById('myFullName').value || '').trim(), phone = (document.getElementById('myPhone').value || '').trim();
      if (!full_name) { toast('الاسم الكامل مطلوب', 'error'); return; }
      ctx.authFetchAt(ctx.authBase, '/me', { method: 'PUT', body: JSON.stringify({ full_name: full_name, phone: phone }) }).then(function (d) {
        var u = JSON.parse(localStorage.getItem('user') || '{}'); u.full_name = d.user.full_name; u.phone = d.user.phone; localStorage.setItem('user', JSON.stringify(u));
        toast('تم حفظ بياناتك', 'success'); if (window.SCM) SCM.notify({ title: 'تم تحديث ملفك الشخصي', type: 'success' }); if (ctx.onSaved) ctx.onSaved(u);
      }).catch(function (e) { toast('فشل الحفظ: ' + e.message, 'error'); });
    });
    if (pass) pass.addEventListener('click', function () {
      var cur = document.getElementById('curPass').value, nw = document.getElementById('newPass').value;
      if (nw.length < 6) { toast('كلمة المرور 6 أحرف على الأقل', 'error'); return; }
      ctx.authFetchAt(ctx.authBase, '/change-password', { method: 'POST', body: JSON.stringify({ current_password: cur, new_password: nw }) }).then(function () {
        document.getElementById('curPass').value = ''; document.getElementById('newPass').value = '';
        toast('تم تحديث كلمة المرور', 'success'); if (window.SCM) SCM.notify({ title: 'تم تغيير كلمة المرور', type: 'success' });
      }).catch(function (e) { toast('فشل التحديث: ' + e.message, 'error'); });
    });
  }
  function openProfileModal() {
    var u = JSON.parse(localStorage.getItem('user') || '{}');
    document.getElementById('myFullName').value = u.full_name || ''; document.getElementById('myPhone').value = u.phone || ''; document.getElementById('myEmail').value = u.email || '';
    document.getElementById('curPass').value = ''; document.getElementById('newPass').value = '';
    document.getElementById('profileModal').classList.add('active');
  }
  function closeProfileModal() { document.getElementById('profileModal').classList.remove('active'); }

  /* ── shell helpers: sidebar, theme, nav, profile dropdown ── */
  function setupShell(ctx) {
    // ctx: { onTab(id), titles }
    var toggle = document.getElementById('sidebarToggle'), sidebar = document.getElementById('sidebar');
    if (toggle) toggle.addEventListener('click', function () { sidebar.classList.toggle('collapsed'); localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed')); });
    var stored = localStorage.getItem('sidebarCollapsed');
    if (stored === 'true' || (stored === null && window.innerWidth <= 1024)) sidebar.classList.add('collapsed');

    document.querySelectorAll('.nav-item').forEach(function (item) {
      item.addEventListener('click', function () {
        var id = item.getAttribute('data-nav');
        document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
        var target = document.getElementById(id); if (target) target.classList.add('active');
        document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n === item); });
        var t = document.getElementById('topbarTitle'); if (t && ctx.titles) t.textContent = ctx.titles[id] || '';
        window.scrollTo({ top: 0, behavior: 'smooth' });
        if (ctx.onTab) ctx.onTab(id);
      });
    });

    var chip = document.getElementById('profileChip'), menu = document.getElementById('profileMenu');
    if (chip && menu) {
      chip.addEventListener('click', function (e) { e.stopPropagation(); menu.classList.toggle('open'); });
      document.addEventListener('click', function (e) { if (menu.classList.contains('open') && !menu.contains(e.target) && !chip.contains(e.target)) menu.classList.remove('open'); });
    }
    syncThemeIcon();
    if (window.SCM && SCM.onThemeChange) SCM.onThemeChange(syncThemeIcon);
  }
  function showView(id) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    var t = document.getElementById(id); if (t) t.classList.add('active'); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function syncThemeIcon() { var i = document.querySelector('#themeBtn i'); if (i) i.className = (window.SCM && SCM.theme() === 'dark') ? 'fas fa-sun' : 'fas fa-moon'; }

  window.SCMDash = {
    makeAuth: makeAuth,
    escapeHtml: escapeHtml, initials: initials, fmtDateTime: fmtDateTime, fmtDate: fmtDate, durSec: durSec, fmtDuration: fmtDuration, timeAgo: timeAgo, isToday: isToday,
    scoreOf: scoreOf, sentimentClass: sentimentClass, sentimentBadge: sentimentBadge, scoreColor: scoreColor, scorePill: scorePill, statusBadge: statusBadge, roleLabelAr: roleLabelAr,
    toast: toast, emptyState: emptyState, setKpi: setKpi, makeSparkline: makeSparkline, spark: spark, perDay: perDay,
    initLive: initLive, liveCardFromRegistry: liveCardFromRegistry, onDataChange: onDataChange,
    openCallDetail: openCallDetail, closeCallDetail: closeCallDetail, downloadCallPdf: downloadCallPdf,
    bindProfile: bindProfile, openProfileModal: openProfileModal, closeProfileModal: closeProfileModal,
    setupShell: setupShell, showView: showView,
  };
})();
