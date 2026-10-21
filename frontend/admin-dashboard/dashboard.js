/* =====================================================================
   dashboard.js — Core engine for the Admin Control Center
   ---------------------------------------------------------------------
   Defines window.App: shared state, auth + API helpers, formatting,
   navigation, KPI + hero rendering, AI summary, my-profile modal, and
   the load orchestration that charts/realtime/users/calls/audit plug into.
   Loaded FIRST; other modules attach their renderers to window.App.
   ===================================================================== */
(function () {
  'use strict';

  var API_BASE = 'http://localhost:3000/api/admin';
  var AUTH_BASE = 'http://localhost:3000/api/auth';
  var REFRESH_MS = 300000;   // 5-min safety net; real-time updates come via SSE (below)

  /* ──────────── App namespace + shared state ──────────── */
  var App = window.App = {
    API_BASE: API_BASE,
    AUTH_BASE: AUTH_BASE,
    state: { users: [], calls: [], customers: [], audit: [] },
    _refreshTimer: null,
    _prevView: 'view-overview',
  };

  /* ──────────── Auth ──────────── */
  function getAuthToken() {
    var raw = localStorage.getItem('session');
    if (!raw) return null;
    try { return (JSON.parse(raw) || {}).access_token || null; } catch (e) { return null; }
  }
  function getCurrentUser() {
    var raw = localStorage.getItem('user');
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  function redirectToLogin() { window.location.replace('../login.html'); }
  function logout() {
    if (window.SCM) SCM.audit('LOGOUT');
    localStorage.removeItem('session'); localStorage.removeItem('user');
    redirectToLogin();
  }
  App.getCurrentUser = getCurrentUser;
  App.logout = logout;

  (function checkAuth() {
    var user = getCurrentUser(), token = getAuthToken();
    if (!user || !token || user.role !== 'admin') { redirectToLogin(); return; }
  })();

  /* ──────────── API ──────────── */
  function authFetchAt(base, endpoint, options) {
    options = options || {};
    var token = getAuthToken();
    if (!token) return Promise.reject(new Error('No token'));
    var headers = Object.assign({ 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token }, options.headers || {});
    return fetch(base + endpoint, Object.assign({}, options, { headers: headers })).then(function (res) {
      if (res.status === 401) { logout(); throw new Error('Unauthorized'); }
      if (!res.ok) return res.json().catch(function () { return {}; }).then(function (err) { throw new Error(err.message || err.error || ('HTTP ' + res.status)); });
      return res.json();
    });
  }
  App.authFetch = function (endpoint, options) { return authFetchAt(API_BASE, endpoint, options); };
  App.authFetchAt = authFetchAt;

  /* ──────────── Formatting helpers (shared) ──────────── */
  function escapeHtml(str) {
    if (str == null || str === '') return '—';
    return String(str).replace(/[&<>"]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]; });
  }
  function fmtDateTime(s) {
    if (!s) return '—';
    var d = new Date(s); if (isNaN(d)) return '—';
    return d.toLocaleString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function fmtDate(s) {
    if (!s) return '—';
    var d = new Date(s); if (isNaN(d)) return '—';
    return d.toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  function callDurationSec(call) {
    if (call.duration_sec != null) return call.duration_sec;
    if (call.call_start && call.call_end) {
      var secs = Math.round((new Date(call.call_end) - new Date(call.call_start)) / 1000);
      return secs >= 0 ? secs : null;
    }
    if (typeof call.duration === 'string') {
      var hms = call.duration.match(/(\d+):(\d{2}):(\d{2})/);
      if (hms) return (+hms[1]) * 3600 + (+hms[2]) * 60 + (+hms[3]);
      var sec = call.duration.match(/(\d+)\s*sec/);
      if (sec) return +sec[1];
    }
    return null;
  }
  function fmtDuration(sec) {
    if (sec == null) return '—';
    if (sec < 60) return sec + ' ث';
    var m = Math.floor(sec / 60), s = sec % 60;
    if (m < 60) return m + ':' + String(s).padStart(2, '0') + ' د';
    var h = Math.floor(m / 60), mm = m % 60;
    return h + ':' + String(mm).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }
  function timeAgo(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 5) return 'الآن';
    if (s < 60) return 'منذ ' + s + ' ثانية';
    var m = Math.floor(s / 60); if (m < 60) return 'منذ ' + m + ' دقيقة';
    var h = Math.floor(m / 60); if (h < 24) return 'منذ ' + h + ' ساعة';
    var d = Math.floor(h / 24); return 'منذ ' + d + ' يوم';
  }
  function scoreOf(call) {
    var ps = Array.isArray(call.performance_scores) ? call.performance_scores[0] : call.performance_scores;
    return ps && ps.total_score != null ? Number(ps.total_score) : null;
  }
  function sentimentClass(s) {
    if (!s) return 'neutral';
    var v = String(s).toLowerCase();
    if (/(pos|إيجاب|راض|سعيد|good|happy)/.test(v)) return 'positive';
    if (/(neg|سلب|غاضب|غضب|bad|angry|سيّئ|سيئ|محبط)/.test(v)) return 'negative';
    return 'neutral';
  }
  function sentimentBadge(s) {
    if (!s) return '<span class="dash">—</span>';
    var c = sentimentClass(s);
    var cls = c === 'positive' ? 'pos' : c === 'negative' ? 'neg' : 'neutral';
    var ic = c === 'positive' ? 'fa-face-smile' : c === 'negative' ? 'fa-face-angry' : 'fa-face-meh';
    return '<span class="badge ' + cls + '"><i class="fas ' + ic + '"></i> ' + escapeHtml(s) + '</span>';
  }
  function scoreColor(score) {
    if (score == null) return { c: 'var(--muted)', bg: 'var(--surface-2)' };
    if (score < 50) return { c: 'var(--danger)', bg: 'rgba(239,68,68,.12)' };
    if (score < 75) return { c: 'var(--warning)', bg: 'rgba(245,158,11,.14)' };
    return { c: 'var(--success)', bg: 'rgba(16,185,129,.12)' };
  }
  function scorePill(score) {
    if (score == null) return '<span class="dash">—</span>';
    var k = scoreColor(score);
    return '<span class="score-pill" style="color:' + k.c + ';background:' + k.bg + '">' + score + '</span>';
  }
  function roleLabelAr(role) {
    return ({ admin: 'أدمن', manager: 'مدير', supervisor: 'مشرف', agent: 'وكيل' })[role] || (role || '—');
  }
  function initials(name) { return (name || 'U').trim().charAt(0).toUpperCase() || 'U'; }

  App.escapeHtml = escapeHtml; App.fmtDateTime = fmtDateTime; App.fmtDate = fmtDate;
  App.fmtDuration = fmtDuration; App.callDurationSec = callDurationSec; App.timeAgo = timeAgo;
  App.scoreOf = scoreOf; App.sentimentClass = sentimentClass; App.sentimentBadge = sentimentBadge;
  App.scorePill = scorePill; App.scoreColor = scoreColor; App.roleLabelAr = roleLabelAr; App.initials = initials;

  function toast(msg, type) { if (window.SCM) SCM.toast(msg, type || 'info'); }
  App.toast = toast;
  function isToday(s) { if (!s) return false; var d = new Date(s); var n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate(); }
  App.isToday = isToday;

  /* ──────────── Navigation ──────────── */
  var VIEW_TITLES = {
    'view-overview': 'نظرة عامة', 'view-live': 'التحليل اللحظي للمكالمات', 'view-calls': 'سجل المكالمات',
    'view-customers': 'العملاء', 'view-users': 'إدارة المستخدمين', 'view-tree': 'الهيكل التنظيمي',
    'view-audit': 'سجل التدقيق', 'view-profile': 'ملف المستخدم', 'view-customer360': 'ملف العميل 360°',
    'view-kpis': 'مؤشرات الأداء', 'view-analytics': 'الرسوم التحليلية',
    'view-team': 'أداء الفريق', 'view-alerts': 'التنبيهات الذكية',
  };
  function switchView(id, fromNav) {
    var target = document.getElementById(id);
    if (!target) return;
    var cur = document.querySelector('.view.active');
    if (cur && cur.id !== id && cur.id !== 'view-profile' && cur.id !== 'view-customer360') App._prevView = cur.id;
    document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
    target.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-nav') === id); });
    var titleEl = document.getElementById('topbarTitle');
    if (titleEl) titleEl.textContent = VIEW_TITLES[id] || '';
    window.scrollTo({ top: 0, behavior: 'smooth' });

    if (id === 'view-analytics' && App.renderCharts) App.renderCharts();
    if (id === 'view-kpis') renderKpis();
    if (id === 'view-team' && App.renderTeams) App.renderTeams();
    if (id === 'view-alerts' && App.renderSmartAlerts) App.renderSmartAlerts();
    if (id === 'view-live' && App.renderLiveCalls) App.renderLiveCalls(true);
    if (id === 'view-calls' && App.renderCallsTable) App.renderCallsTable();
    if (id === 'view-customers' && App.renderCustomersTable) App.renderCustomersTable();
    if (id === 'view-users' && App.renderUsersTable) App.applyUserFilter();
    if (id === 'view-tree' && App.buildOrgTree) App.buildOrgTree();
    if (id === 'view-audit' && App.loadAuditLogs) App.loadAuditLogs();
  }
  App.switchView = switchView;

  function setupNav() {
    document.querySelectorAll('.nav-item').forEach(function (item) {
      item.addEventListener('click', function () { switchView(item.getAttribute('data-nav'), true); });
    });
  }

  /* ──────────── KPIs + sparklines + trends ──────────── */
  function setKpi(id, val) {
    var el = document.getElementById(id);
    if (!el) return;
    if (window.SCM && SCM.countUp) SCM.countUp(el, String(val)); else el.textContent = val;
  }
  function setTrend(id, pct, label) {
    var el = document.getElementById(id);
    if (!el) return;
    var dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
    var ic = pct > 0 ? 'fa-arrow-up' : pct < 0 ? 'fa-arrow-down' : 'fa-minus';
    el.className = 'kpi-trend ' + dir;
    el.innerHTML = '<i class="fas ' + ic + '"></i> ' + (label != null ? label : (Math.abs(pct) + '%'));
  }
  function spark(id, series, color) {
    var el = document.getElementById(id);
    if (!el || !App.makeSparkline) return;
    el.innerHTML = App.makeSparkline(series, color);
  }

  // Distinct count of items per day over last `days`, by accessor → Date
  function perDay(items, days, getDate) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var buckets = [];
    for (var i = days - 1; i >= 0; i--) { var d = new Date(today); d.setDate(today.getDate() - i); buckets.push({ key: d.toISOString().slice(0, 10), n: 0 }); }
    var map = {}; buckets.forEach(function (b) { map[b.key] = b; });
    (items || []).forEach(function (it) {
      var dt = getDate(it); if (!dt) return;
      var key = new Date(dt).toISOString().slice(0, 10);
      if (map[key]) map[key].n++;
    });
    return buckets.map(function (b) { return b.n; });
  }
  function cumulative(series) { var acc = 0; return series.map(function (n) { acc += n; return acc; }); }

  function renderKpis() {
    var s = App.state, stats = s._stats || {};
    var calls = s.calls, users = s.users, customers = s.customers;

    setKpi('kpiUsers', stats.users != null ? stats.users : users.length);
    setKpi('kpiCalls', stats.calls != null ? stats.calls : calls.length);
    setKpi('kpiActive', stats.active_users != null ? stats.active_users : users.filter(function (u) { return u.is_active; }).length);
    setKpi('kpiCustomers', stats.customers != null ? stats.customers : customers.length);

    // Calls trend: last 7d vs prior 7d
    var d14 = perDay(calls, 14, function (c) { return c.call_start; });
    var last7 = d14.slice(7).reduce(add, 0), prev7 = d14.slice(0, 7).reduce(add, 0);
    var callsPct = prev7 ? Math.round(((last7 - prev7) / prev7) * 100) : (last7 ? 100 : 0);
    setTrend('kpiCallsTrend', callsPct);
    spark('sparkCalls', perDay(calls, 12, function (c) { return c.call_start; }), '#7C3AED');

    // Users trend: new in last 30 days (from created_at)
    var newUsers = users.filter(function (u) { return u.created_at && (Date.now() - new Date(u.created_at)) < 30 * 864e5; }).length;
    setTrend('kpiUsersTrend', newUsers > 0 ? 1 : 0, '+' + newUsers + ' جديد');
    var uSeries = cumulative(perDay(users, 12, function (u) { return u.created_at; }));
    if (uSeries[uSeries.length - 1] === 0) uSeries = ramp(users.length, 12);
    spark('sparkUsers', uSeries, '#2563EB');

    // Active trend: ratio active/total
    var activeN = users.filter(function (u) { return u.is_active; }).length;
    var ratio = users.length ? Math.round((activeN / users.length) * 100) : 0;
    setTrend('kpiActiveTrend', 0, ratio + '% نشط');
    spark('sparkActive', perDay(calls, 12, function (c) { return c.call_start; }).map(function (n) { return n; }), '#10B981');

    // Customers trend: new in last 30 days
    var newCust = customers.filter(function (c) { return c.created_at && (Date.now() - new Date(c.created_at)) < 30 * 864e5; }).length;
    setTrend('kpiCustomersTrend', newCust > 0 ? 1 : 0, '+' + newCust + ' جديد');
    var cSeries = cumulative(perDay(customers, 12, function (c) { return c.created_at; }));
    if (cSeries[cSeries.length - 1] === 0) cSeries = ramp(customers.length, 12);
    spark('sparkCustomers', cSeries, '#F59E0B');

    renderOpsKpis(calls);
    renderKpiBand();
  }

  /* ──────────── Operational KPI cards (today · AHT · sentiment · peak hour) ──────────── */
  function renderOpsKpis(calls) {
    // Calls today vs yesterday
    var d2 = perDay(calls, 2, function (c) { return c.call_start; });
    var today = d2[1], yesterday = d2[0];
    setKpi('kpiToday', today);
    setTrend('kpiTodayTrend', yesterday ? Math.round(((today - yesterday) / yesterday) * 100) : (today ? 100 : 0));
    spark('sparkToday', perDay(calls, 12, function (c) { return c.call_start; }), '#2563EB');

    // Average handle time — lower is better, so colour by direction of change
    var durs = calls.map(callDurationSec).filter(function (v) { return v != null; });
    var avgDur = durs.length ? durs.reduce(add, 0) / durs.length : null;
    setText('kpiAvgDur', avgDur != null ? clockMMSS(avgDur) : '—');
    var a7 = kpiAggregate(callsInWindow(calls, 7, 0), KPI_METRICS.aht);
    var b7 = kpiAggregate(callsInWindow(calls, 14, 7), KPI_METRICS.aht);
    var durEl = document.getElementById('kpiAvgDurTrend');
    if (durEl) {
      if (a7.avg != null && b7.avg != null) {
        var dd = a7.avg - b7.avg;
        var dir = Math.abs(dd) < 1 ? 'flat' : (dd < 0 ? 'up' : 'down'); // shorter calls = green
        var ic = Math.abs(dd) < 1 ? 'fa-minus' : (dd < 0 ? 'fa-arrow-down' : 'fa-arrow-up');
        durEl.className = 'kpi-trend ' + dir;
        durEl.innerHTML = '<i class="fas ' + ic + '"></i> ' + clockMMSS(Math.abs(dd));
      } else { durEl.className = 'kpi-trend flat'; durEl.innerHTML = '<i class="fas fa-minus"></i> —'; }
    }
    spark('sparkAvgDur', avgDurPerDaySeries(calls, 12), '#1E40AF');

    // Positive-sentiment share, last 7d vs prior 7d (in percentage points)
    var posOf = function (list) {
      var n = 0; list.forEach(function (c) { if (sentimentClass(c.sentiment) === 'positive') n++; });
      return list.length ? (n / list.length) * 100 : null;
    };
    var posAll = posOf(calls);
    setText('kpiPosRate', posAll != null ? Math.round(posAll) + '%' : '—');
    var pa = posOf(callsInWindow(calls, 7, 0)), pb = posOf(callsInWindow(calls, 14, 7));
    if (pa != null && pb != null) setTrend('kpiPosRateTrend', Math.round(pa - pb));
    else setTrend('kpiPosRateTrend', 0, '—');
    spark('sparkPosRate', perDay(calls.filter(function (c) { return sentimentClass(c.sentiment) === 'positive'; }), 12, function (c) { return c.call_start; }), '#10B981');

    // Peak hour of day
    var hours = new Array(24).fill(0);
    calls.forEach(function (c) {
      if (!c.call_start) return;
      var d = new Date(c.call_start); if (!isNaN(d)) hours[d.getHours()]++;
    });
    var peakN = Math.max.apply(null, hours), peakH = hours.indexOf(peakN);
    setText('kpiPeak', peakN > 0 ? String(peakH).padStart(2, '0') + ':00' : '—');
    setTrend('kpiPeakTrend', 0, peakN > 0 ? peakN + ' مكالمة' : '—');
    spark('sparkPeak', hours, '#F59E0B');
  }

  // Average call duration per day (seconds) for the sparkline
  function avgDurPerDaySeries(calls, days) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var out = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(today); d.setDate(today.getDate() - i);
      var key = d.toISOString().slice(0, 10), sum = 0, n = 0;
      (calls || []).forEach(function (c) {
        if (!c.call_start || new Date(c.call_start).toISOString().slice(0, 10) !== key) return;
        var sec = callDurationSec(c); if (sec != null) { sum += sec; n++; }
      });
      out.push(n ? Math.round(sum / n) : 0);
    }
    return out;
  }
  function add(a, b) { return a + b; }
  function ramp(total, n) { var out = []; for (var i = 0; i < n; i++) out.push(Math.round(total * (i + 1) / n)); return out; }

  /* ──────────── Customer-service KPIs (targets + trend) ──────────── */
  // Parse a call's AI analysis (jsonb → object; tolerates a stringified column).
  function callAnalysis(c) {
    var a = c && c.analysis;
    if (!a) return null;
    if (typeof a === 'string') { try { a = JSON.parse(a); } catch (e) { return null; } }
    return (a && typeof a === 'object') ? a : null;
  }
  App.callAnalysis = callAnalysis;
  function perfScore(c) { var ps = c && c.performance_scores; return Array.isArray(ps) ? ps[0] : ps; }
  function num(v) { v = Number(v); return Number.isFinite(v) ? v : null; }

  // Per-call metric extractors → a 0-100 value (or seconds for AHT), or null when
  // the call lacks that datum (so each KPI averages only over calls that have it).
  var KPI_METRICS = {
    csat: function (c) { var a = callAnalysis(c); var v = a ? num(a.customer_satisfaction_score) : null; return v == null ? null : v * 10; },
    fcr: function (c) { var a = callAnalysis(c); if (!a || a.problem_solved == null) return null; return a.problem_solved === 'نعم' ? 100 : 0; },
    resolution: function (c) { var a = callAnalysis(c); if (!a || a.problem_solved == null) return null; return a.problem_solved === 'نعم' ? 100 : (a.problem_solved === 'جزئياً' ? 50 : 0); },
    qa: function (c) { var p = perfScore(c); return p ? num(p.total_score) : null; },
    aht: function (c) { return callDurationSec(c); },
    empathy: function (c) { var p = perfScore(c); var v = p ? num(p.empathy_score) : null; if (v != null) return v; var a = callAnalysis(c); var e = a ? num(a.empathy_score) : null; return e == null ? null : e * 10; },
    script: function (c) { var p = perfScore(c); return p ? num(p.script_compliance) : null; },
    negative: function (c) { if (!c.sentiment) return null; return sentimentClass(c.sentiment) === 'negative' ? 100 : 0; },
  };

  // key→metric, Arabic label, English tag, icon, target, and direction (lower=true
  // means smaller is better, e.g. handle time and negative-call rate).
  var KPI_DEFS = [
    { metric: 'csat',       name: 'رضا العملاء',        sub: 'CSAT',       icon: 'fa-face-smile',           target: 80,  lower: false, fmt: 'pct' },
    { metric: 'fcr',        name: 'الحل من أول اتصال',   sub: 'FCR',        icon: 'fa-circle-check',         target: 75,  lower: false, fmt: 'pct' },
    { metric: 'resolution', name: 'نسبة حل المشكلات',    sub: 'Resolution', icon: 'fa-clipboard-check',      target: 90,  lower: false, fmt: 'pct' },
    { metric: 'qa',         name: 'جودة الأداء',         sub: 'QA Score',   icon: 'fa-star',                 target: 85,  lower: false, fmt: 'pct' },
    { metric: 'aht',        name: 'متوسط مدة المعالجة',  sub: 'AHT',        icon: 'fa-stopwatch',            target: 300, lower: true,  fmt: 'dur' },
    { metric: 'empathy',    name: 'متوسط التعاطف',       sub: 'Empathy',    icon: 'fa-heart',                target: 80,  lower: false, fmt: 'pct' },
    { metric: 'script',     name: 'الالتزام بالنص',      sub: 'Compliance', icon: 'fa-list-check',           target: 85,  lower: false, fmt: 'pct' },
    { metric: 'negative',   name: 'المكالمات السلبية',   sub: 'At-risk',    icon: 'fa-triangle-exclamation', target: 15,  lower: true,  fmt: 'pct' },
  ];

  function kpiAggregate(calls, fn) {
    var sum = 0, n = 0;
    (calls || []).forEach(function (c) { var v = fn(c); if (v != null && isFinite(v)) { sum += v; n++; } });
    return { avg: n ? sum / n : null, n: n };
  }
  function callsInWindow(calls, fromDaysAgo, toDaysAgo) {
    var now = Date.now(), from = now - fromDaysAgo * 864e5, to = now - toDaysAgo * 864e5;
    return (calls || []).filter(function (c) {
      var t = c.call_start ? new Date(c.call_start).getTime() : NaN;
      return t >= from && t < to;
    });
  }
  // Attainment ratio (1 = target met) → health colour + bar width.
  function kpiHealth(avg, def) {
    if (avg == null) return { r: 0, color: 'var(--muted)' };
    var r = def.lower ? (def.target / Math.max(avg, 1e-6)) : (avg / def.target);
    var color = r >= 1 ? 'var(--success)' : r >= 0.8 ? 'var(--warning)' : 'var(--danger)';
    return { r: r, color: color };
  }
  function clockMMSS(sec) { sec = Math.round(sec); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + String(s).padStart(2, '0'); }
  function kpiValueText(avg, def) {
    if (avg == null) return '—';
    return def.fmt === 'dur' ? clockMMSS(avg) : Math.round(avg) + '%';
  }
  function kpiTargetText(def) {
    return def.fmt === 'dur' ? ('الهدف ≤ ' + clockMMSS(def.target)) : ('الهدف ' + (def.lower ? '≤ ' : '') + def.target + '%');
  }

  /* The four the overview leads with. The KPI page still shows all eight — the
     overview stays a summary rather than a second copy of that page. */
  var EXEC_KPIS = ['csat', 'fcr', 'qa', 'negative'];

  function kpiCardHtml(def, calls, cur, prev) {
    var fn = KPI_METRICS[def.metric];
    var all = kpiAggregate(calls, fn);
    var h = kpiHealth(all.avg, def);
    var fillPct = Math.max(0, Math.min(1, h.r)) * 100;

    // 30-day trend vs the prior 30 days (shown only when both have ≥2 samples).
    var a = kpiAggregate(cur, fn), b = kpiAggregate(prev, fn), deltaHtml = '';
    if (a.avg != null && b.avg != null && a.n >= 2 && b.n >= 2) {
      var diff = a.avg - b.avg;
      var better = def.lower ? diff < 0 : diff > 0;
      var dir = Math.abs(diff) < 0.5 ? 'flat' : (better ? 'up' : 'down');
      var ic = dir === 'flat' ? 'fa-minus' : (diff > 0 ? 'fa-arrow-up' : 'fa-arrow-down');
      var mag = def.fmt === 'dur' ? clockMMSS(Math.abs(diff)) : (Math.round(Math.abs(diff)) + '%');
      deltaHtml = '<span class="kpi2-delta ' + dir + '" title="آخر ٣٠ يومًا مقابل الفترة السابقة"><i class="fas ' + ic + '"></i> ' + mag + '</span>';
    }

    var count = all.n ? (' · ' + all.n + ' مكالمة') : '';
    return '' +
      '<div class="kpi2" style="--k:' + h.color + '">' +
        '<div class="kpi2-head"><span class="kpi2-ic"><i class="fas ' + def.icon + '"></i></span>' +
          '<span class="kpi2-name">' + def.name + '<small>' + def.sub + count + '</small></span></div>' +
        '<div class="kpi2-value" style="color:' + h.color + '">' + kpiValueText(all.avg, def) + '</div>' +
        '<div class="kpi2-bar"><div class="kpi2-fill" style="width:' + fillPct + '%;background:' + h.color + '"></div></div>' +
        '<div class="kpi2-foot"><span class="kpi2-target">' + kpiTargetText(def) + '</span>' + deltaHtml + '</div>' +
      '</div>';
  }

  function renderKpiBand() {
    var calls = App.state.calls || [];
    var cur = callsInWindow(calls, 30, 0), prev = callsInWindow(calls, 60, 30);
    function html(defs) {
      return defs.map(function (def) { return kpiCardHtml(def, calls, cur, prev); }).join('');
    }

    var band = document.getElementById('kpiBand');
    if (band) band.innerHTML = html(KPI_DEFS);

    var exec = document.getElementById('kpiBandExec');
    if (exec) {
      exec.innerHTML = html(KPI_DEFS.filter(function (d) { return EXEC_KPIS.indexOf(d.metric) >= 0; }));
    }
  }
  App.renderKpiBand = renderKpiBand;

  /* ──────────── Hero + AI summary ──────────── */
  function renderHero() {
    var s = App.state, calls = s.calls, users = s.users;
    var callsToday = calls.filter(function (c) { return isToday(c.call_start); });
    var negToday = callsToday.filter(function (c) { return sentimentClass(c.sentiment) === 'negative'; }).length;
    var activeAgents = users.filter(function (u) { return u.is_active && u.role === 'agent'; }).length;

    // System health heuristic
    var total = calls.length || 1;
    var negRatio = calls.filter(function (c) { return sentimentClass(c.sentiment) === 'negative'; }).length / total;
    var inactiveRatio = users.length ? users.filter(function (u) { return !u.is_active; }).length / users.length : 0;
    var health = Math.max(40, Math.min(100, Math.round(100 - negRatio * 45 - inactiveRatio * 20)));

    setText('heroHealth', health + '%');
    if (window.SCM && SCM.countUp) SCM.countUp(document.getElementById('heroCallsToday'), String(callsToday.length));
    setText('heroActiveAgents', activeAgents);
    setText('heroNegative', negToday);

    var u = getCurrentUser() || {};
    setText('heroName', u.full_name || (u.email ? u.email.split('@')[0] : 'المشرف'));

    renderAiSummary(calls);
  }
  function renderAiSummary(calls) {
    var el = document.getElementById('aiSummaryText');
    if (!el) return;
    if (!calls.length) { el.textContent = 'لا توجد بيانات كافية بعد لإنشاء ملخّص ذكي. ابدأ بمراقبة المكالمات.'; return; }

    var today = calls.filter(function (c) { return isToday(c.call_start); });
    var negToday = today.filter(function (c) { return sentimentClass(c.sentiment) === 'negative'; }).length;
    var negRatioToday = today.length ? negToday / today.length : 0;
    // prior baseline (last 7 days excluding today)
    var prior = calls.filter(function (c) { return c.call_start && !isToday(c.call_start) && (Date.now() - new Date(c.call_start)) < 8 * 864e5; });
    var negPrior = prior.filter(function (c) { return sentimentClass(c.sentiment) === 'negative'; }).length;
    var negRatioPrior = prior.length ? negPrior / prior.length : 0;

    var parts = [];
    if (negRatioPrior > 0 && today.length) {
      var delta = Math.round(((negRatioToday - negRatioPrior) / negRatioPrior) * 100);
      if (delta >= 5) parts.push('🔺 اكتشف الذكاء الاصطناعي ارتفاعًا بنسبة <strong>' + delta + '%</strong> في المشاعر السلبية اليوم مقارنة بالمتوسط.');
      else if (delta <= -5) parts.push('🟢 تحسّن في مزاج العملاء بنسبة <strong>' + Math.abs(delta) + '%</strong> اليوم مقارنة بالأيام السابقة.');
      else parts.push('استقرار في مشاعر العملاء اليوم ضمن المعدّل الطبيعي.');
    } else if (today.length) {
      parts.push('تمت معالجة <strong>' + today.length + '</strong> مكالمة اليوم، منها ' + negToday + ' سلبية.');
    } else {
      parts.push('لا توجد مكالمات اليوم حتى الآن.');
    }

    // recommendation: lowest scoring agent
    if (window.SCMCharts) {
      var g = SCMCharts.avgScoreByGroup(calls, function (c) { return c.user_id; }, function (c) { return (c.users && c.users.full_name) || '—'; });
      if (g.labels.length) {
        var lowName = g.labels[g.labels.length - 1], lowScore = g.data[g.data.length - 1];
        if (lowScore != null && lowScore < 70) parts.push('💡 توصية: جدوِل جلسة تدريب للموظف <strong>' + escapeHtml(lowName) + '</strong> (متوسط الأداء ' + lowScore + ').');
      }
    }
    el.innerHTML = parts.join(' ');
  }
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }

  /* ──────────── Load orchestration ──────────── */
  function applyOverview(data) {
    App.state.users = data.users || [];
    App.state.calls = data.calls || [];
    App.state.customers = data.customers || [];
    App.state._stats = data.stats || {};

    renderKpis();
    renderHero();
    if (App.renderCharts) App.renderChartsIfVisible();
    if (App.renderLiveCalls) App.renderLiveCalls();
    if (App.buildActivityFeed) App.buildActivityFeed();
    if (App.renderSmartAlerts) App.renderSmartAlerts();
    if (App.renderTeams) App.renderTeams();
    if (App.applyUserFilter) App.applyUserFilter();
    if (App.buildOrgTree) App.buildOrgTree();
    if (App.renderCallsTable) App.renderCallsTable();
    if (App.renderCustomersTable) App.renderCustomersTable();
    if (App.updateLiveCounter) App.updateLiveCounter();
    if (App.fetchLiveCalls) App.fetchLiveCalls();
    setText('sideUpdated', new Date().toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' }));
  }
  App.applyOverview = applyOverview;

  function loadOverview() {
    return App.authFetch('/overview').then(applyOverview).catch(function (err) {
      if (String(err.message).indexOf('Unauthorized') >= 0) return;
      toast('تعذّر تحميل البيانات: ' + err.message, 'error');
    });
  }
  App.loadOverview = loadOverview;

  function silentRefresh() {
    if (document.getElementById('userModal').classList.contains('active')) return;
    if (document.activeElement && document.activeElement.tagName === 'SELECT') return;
    var active = document.querySelector('.view.active');
    if (active && (active.id === 'view-profile' || active.id === 'view-customer360')) return;
    App.authFetch('/overview').then(applyOverview).catch(function () {});
  }
  App.silentRefresh = silentRefresh;
  function startAutoRefresh() {
    if (App._refreshTimer) clearInterval(App._refreshTimer);
    App._refreshTimer = setInterval(silentRefresh, REFRESH_MS);
  }

  /* ──────────── My-profile modal ──────────── */
  App.openProfileModal = function () {
    var u = getCurrentUser() || {};
    setVal('myFullName', u.full_name || ''); setVal('myPhone', u.phone || ''); setVal('myEmail', u.email || '');
    setVal('curPass', ''); setVal('newPass', '');
    document.getElementById('profileModal').classList.add('active');
    closeProfileMenu();
  };
  App.closeProfileModal = function () { document.getElementById('profileModal').classList.remove('active'); };
  function setVal(id, v) { var el = document.getElementById(id); if (el) el.value = v; }

  function saveMyProfile() {
    var full_name = (document.getElementById('myFullName').value || '').trim();
    var phone = (document.getElementById('myPhone').value || '').trim();
    if (!full_name) { toast('الاسم الكامل مطلوب', 'error'); return; }
    authFetchAt(AUTH_BASE, '/me', { method: 'PUT', body: JSON.stringify({ full_name: full_name, phone: phone }) })
      .then(function (d) {
        var u = getCurrentUser() || {};
        u.full_name = d.user.full_name; u.phone = d.user.phone;
        localStorage.setItem('user', JSON.stringify(u));
        hydrateIdentity();
        toast('تم حفظ بياناتك بنجاح', 'success');
        if (window.SCM) SCM.notify({ title: 'تم تحديث ملفك الشخصي', type: 'success' });
      }).catch(function (e) { toast('فشل الحفظ: ' + e.message, 'error'); });
  }
  function changeMyPassword() {
    var current_password = document.getElementById('curPass').value;
    var new_password = document.getElementById('newPass').value;
    if (new_password.length < 6) { toast('كلمة المرور الجديدة يجب أن تكون 6 أحرف على الأقل', 'error'); return; }
    authFetchAt(AUTH_BASE, '/change-password', { method: 'POST', body: JSON.stringify({ current_password: current_password, new_password: new_password }) })
      .then(function () {
        setVal('curPass', ''); setVal('newPass', '');
        toast('تم تحديث كلمة المرور بنجاح', 'success');
        if (window.SCM) SCM.notify({ title: 'تم تغيير كلمة المرور', type: 'success' });
      }).catch(function (e) { toast('فشل تحديث كلمة المرور: ' + e.message, 'error'); });
  }

  /* ──────────── Identity hydration (sidebar + topbar) ──────────── */
  function hydrateIdentity() {
    var u = getCurrentUser() || {};
    var name = u.full_name || (u.email ? u.email.split('@')[0] : 'المشرف');
    var ini = initials(name);
    setText('sideAdminName', name); setText('sideAdminEmail', u.email || 'admin@scm.com'); setText('sideAvatar', ini);
    setText('chipName', name); setText('chipAvatar', ini); setText('chipRole', roleLabelAr(u.role));
    setText('pmName', name); setText('pmEmail', u.email || ''); setText('pmAvatar', ini);
    setText('heroName', name);
    // chipName has nested <small> overwritten by textContent; rebuild
    var chip = document.getElementById('chipName');
    if (chip) chip.innerHTML = escapeHtml(name) + '<small id="chipRole">' + escapeHtml(roleLabelAr(u.role)) + '</small>';
  }

  /* ──────────── Profile dropdown ──────────── */
  function toggleProfileMenu(e) { e && e.stopPropagation(); document.getElementById('profileMenu').classList.toggle('open'); }
  function closeProfileMenu() { var m = document.getElementById('profileMenu'); if (m) m.classList.remove('open'); }
  document.addEventListener('click', function (e) {
    var menu = document.getElementById('profileMenu'), chip = document.getElementById('profileChip');
    if (menu && menu.classList.contains('open') && !menu.contains(e.target) && chip && !chip.contains(e.target)) closeProfileMenu();
  });

  /* ──────────── Theme button icon sync ──────────── */
  function syncThemeIcon() {
    var btn = document.querySelector('#themeBtn i');
    if (btn) btn.className = (window.SCM && SCM.theme() === 'dark') ? 'fas fa-sun' : 'fas fa-moon';
  }

  /* ──────────── Sidebar collapse ──────────── */
  function setupSidebar() {
    var toggle = document.getElementById('sidebarToggle'), sidebar = document.getElementById('sidebar');
    if (toggle) toggle.addEventListener('click', function () {
      sidebar.classList.toggle('collapsed');
      localStorage.setItem('sidebarCollapsed', sidebar.classList.contains('collapsed'));
    });
    var stored = localStorage.getItem('sidebarCollapsed');
    if (stored === 'true' || (stored === null && window.innerWidth <= 1024)) sidebar.classList.add('collapsed');

    // Collapsible nav groups (state persisted per group)
    document.querySelectorAll('.nav-group').forEach(function (g) {
      var key = 'navGroup:' + (g.getAttribute('data-group') || '');
      if (localStorage.getItem(key) === 'closed') g.classList.add('closed');
      var title = g.querySelector('.nav-section-title');
      if (title) title.addEventListener('click', function () {
        g.classList.toggle('closed');
        localStorage.setItem(key, g.classList.contains('closed') ? 'closed' : 'open');
      });
    });
  }

  /* ──────────── Command palette registration ──────────── */
  function registerCommands() {
    if (!window.SCM || !SCM.registerCommands) return;
    SCM.registerCommands([
      { label: 'نظرة عامة', hint: 'تنقل', icon: '📊', run: function () { switchView('view-overview'); } },
      { label: 'التحليل اللحظي', hint: 'تنقل', icon: '📡', run: function () { switchView('view-live'); } },
      { label: 'مؤشرات الأداء', hint: 'تنقل', icon: '🎯', run: function () { switchView('view-kpis'); } },
      { label: 'الرسوم التحليلية', hint: 'تنقل', icon: '📈', run: function () { switchView('view-analytics'); } },
      { label: 'أداء الفريق', hint: 'تنقل', icon: '🏆', run: function () { switchView('view-team'); } },
      { label: 'التنبيهات الذكية', hint: 'تنقل', icon: '⚠️', run: function () { switchView('view-alerts'); } },
      { label: 'سجل المكالمات', hint: 'تنقل', icon: '📞', run: function () { switchView('view-calls'); } },
      { label: 'العملاء', hint: 'تنقل', icon: '🏢', run: function () { switchView('view-customers'); } },
      { label: 'إدارة المستخدمين', hint: 'تنقل', icon: '👥', run: function () { switchView('view-users'); } },
      { label: 'الهيكل التنظيمي', hint: 'تنقل', icon: '🌳', run: function () { switchView('view-tree'); } },
      { label: 'سجل التدقيق', hint: 'تنقل', icon: '🛡️', run: function () { switchView('view-audit'); } },
      { label: 'إضافة مستخدم جديد', hint: 'إجراء', icon: '➕', run: function () { App.openUserModal && App.openUserModal(); } },
      { label: 'فتح ملفي الشخصي', hint: 'حساب', icon: '👤', run: function () { App.openProfileModal(); } },
      { label: 'تصدير المستخدمين CSV', hint: 'تصدير', icon: '📄', run: function () { App.exportUsers && App.exportUsers(); } },
      { label: 'مركز الإشعارات', hint: 'إجراء', icon: '🔔', run: function () { App.openNotifications && App.openNotifications(); } },
    ]);
  }

  /* ──────────── Boot ──────────── */
  function boot() {
    hydrateIdentity();
    setText('topbarDate', new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    setupNav();
    setupSidebar();
    registerCommands();
    syncThemeIcon();
    if (window.SCM && SCM.onThemeChange) SCM.onThemeChange(syncThemeIcon);

    // wiring
    document.getElementById('logoutBtnSide').addEventListener('click', logout);
    document.getElementById('logoutMenuBtn').addEventListener('click', logout);
    document.getElementById('profileChip').addEventListener('click', toggleProfileMenu);
    document.getElementById('saveProfileBtn').addEventListener('click', saveMyProfile);
    document.getElementById('changePassBtn').addEventListener('click', changeMyPassword);
    document.getElementById('profileModal').addEventListener('click', function (e) { if (e.target.id === 'profileModal') App.closeProfileModal(); });

    loadOverview().then(function () {
      if (App.renderChartsIfVisible) App.renderChartsIfVisible(); // charts live in view-analytics; drawn on first visit
    });
    startAutoRefresh();

    // Real-time: refresh on relevant SSE events (call/user changes) instead of
    // frequent polling. live.* updates are handled in realtime.js.
    var _rtTimer = null;
    document.addEventListener('scm:event', function (e) {
      var t = e.detail && e.detail.type; if (!t) return;
      if (/^(call\.|user\.)/.test(t)) { clearTimeout(_rtTimer); _rtTimer = setTimeout(silentRefresh, 1200); }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) { if (App._refreshTimer) { clearInterval(App._refreshTimer); App._refreshTimer = null; } }
      else { silentRefresh(); startAutoRefresh(); }
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
