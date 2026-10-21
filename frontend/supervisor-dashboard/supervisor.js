/* =====================================================================
   supervisor.js — Supervisor console (team-scoped). Reuses the Admin UI +
   the shared SCMDash runtime, wired to /api/supervisor. Amber accent.
   ===================================================================== */
(function () {
  'use strict';
  var D = window.SCMDash;
  if (!D) return;

  var API_BASE = 'http://localhost:3000/api/supervisor';
  var AUTH_BASE = 'http://localhost:3000/api/auth';
  var auth = D.makeAuth({ apiBase: API_BASE, authBase: AUTH_BASE, role: 'supervisor', apiPath: '/api/supervisor' });
  if (!auth.guard()) return;

  var state = { agents: [], calls: [], customers: [], stats: {}, live: [] };
  var prevView = 'view-overview', callSent = 'all', refreshTimer = null;
  var Supervisor = window.Supervisor = {};

  /* ── data ── */
  function loadAll() {
    return Promise.all([
      auth.authFetch('/stats').catch(function () { return { stats: {} }; }),
      auth.authFetch('/agents').catch(function () { return { agents: [] }; }),
      auth.authFetch('/calls').catch(function () { return { calls: [] }; }),
      auth.authFetch('/customers').catch(function () { return { customers: [] }; }),
    ]).then(function (r) {
      state.stats = (r[0] && r[0].stats) || r[0] || {};
      state.agents = r[1].agents || [];
      state.calls = r[2].calls || [];
      state.customers = r[3].customers || [];
      renderAll();
    });
  }
  function silentRefresh() {
    var active = document.querySelector('.view.active');
    if (active && active.id === 'view-profile') return;
    loadAll().catch(function () {});
  }
  function renderAll() {
    renderKpis(); renderHero(); renderChartsIfVisible(); renderTeams(); renderActivity();
    renderAgents(); renderAgentFilter(); renderCalls(); renderCustomers(); renderLive();
  }

  /* ── agent performance (client-side) ── */
  function agentPerf() {
    var acc = {};
    state.calls.forEach(function (c) { var s = D.scoreOf(c); if (c.user_id == null) return; var e = acc[c.user_id] || (acc[c.user_id] = { user_id: c.user_id, name: (c.users && c.users.full_name) || null, sum: 0, n: 0, calls: 0 }); e.calls++; if (s != null) { e.sum += s; e.n++; } });
    var nameOf = {}, activeOf = {}; state.agents.forEach(function (a) { nameOf[a.user_id] = a.full_name || a.email; activeOf[a.user_id] = a.is_active; });
    // include agents with zero calls too
    state.agents.forEach(function (a) { if (!acc[a.user_id]) acc[a.user_id] = { user_id: a.user_id, name: a.full_name || a.email, sum: 0, n: 0, calls: 0 }; });
    return Object.keys(acc).map(function (k) { var e = acc[k]; return { user_id: e.user_id, name: e.name || nameOf[e.user_id] || '—', calls: e.calls, avg: e.n ? Math.round(e.sum / e.n) : null, is_active: !!activeOf[e.user_id] }; })
      .sort(function (a, b) { return (b.avg == null ? -1 : b.avg) - (a.avg == null ? -1 : a.avg); });
  }

  /* ── KPIs + hero ── */
  function renderKpis() {
    var s = state.stats || {};
    D.setKpi('kpiAgents', s.agentsCount != null ? s.agentsCount : state.agents.length);
    D.setKpi('kpiActive', s.activeAgents != null ? s.activeAgents : state.agents.filter(function (a) { return a.is_active; }).length);
    D.setKpi('kpiCalls', s.callsCount != null ? s.callsCount : state.calls.length);
    D.setKpi('kpiCustomers', state.customers.length);
    var d14 = D.perDay(state.calls, 14, function (c) { return c.call_start; });
    var last7 = d14.slice(7).reduce(add, 0), prev7 = d14.slice(0, 7).reduce(add, 0);
    setTrend('kpiCallsTrend', prev7 ? Math.round(((last7 - prev7) / prev7) * 100) : (last7 ? 100 : 0));
    D.spark('sparkCalls', D.perDay(state.calls, 12, function (c) { return c.call_start; }), '#2563EB');
    D.spark('sparkAgents', ramp(state.agents.length, 12), '#F59E0B');
    D.spark('sparkActive', D.perDay(state.calls, 12, function (c) { return c.call_start; }), '#10B981');
    D.spark('sparkCust', ramp(state.customers.length, 12), '#7C3AED');
    setTrend('kpiAgentsTrend', 0, 'وكيل بفريقك');
    setTrend('kpiActiveTrend', 0, 'نشط الآن');
    setTrend('kpiCustomersTrend', 0, 'عميل');
  }
  function add(a, b) { return a + b; }
  function ramp(total, n) { var o = []; for (var i = 0; i < n; i++) o.push(Math.round(total * (i + 1) / n)); return o; }
  function setTrend(id, pct, label) {
    var el = document.getElementById(id); if (!el) return;
    var dir = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat', ic = pct > 0 ? 'fa-arrow-up' : pct < 0 ? 'fa-arrow-down' : 'fa-minus';
    el.className = 'kpi-trend ' + dir; el.innerHTML = '<i class="fas ' + ic + '"></i> ' + (label != null ? label : (Math.abs(pct) + '%'));
  }
  function renderHero() {
    var calls = state.calls;
    var today = calls.filter(function (c) { return D.isToday(c.call_start); });
    var neg = today.filter(function (c) { return D.sentimentClass(c.sentiment) === 'negative'; }).length;
    var activeAgents = state.agents.filter(function (a) { return a.is_active; }).length;
    var total = calls.length || 1, negRatio = calls.filter(function (c) { return D.sentimentClass(c.sentiment) === 'negative'; }).length / total;
    var health = Math.max(40, Math.min(100, Math.round(100 - negRatio * 45)));
    setText('heroHealth', health + '%'); setKpiCount('heroCallsToday', today.length); setText('heroActiveAgents', activeAgents); setText('heroNegative', neg);
    renderAi();
  }
  function renderAi() {
    var el = document.getElementById('aiSummaryText'); if (!el) return;
    if (!state.calls.length) { el.textContent = 'لا توجد بيانات كافية بعد لتحليل فريقك.'; return; }
    var perf = agentPerf().filter(function (p) { return p.avg != null; }); var parts = [];
    if (perf[0]) parts.push('أفضل وكيل: <strong>' + D.escapeHtml(perf[0].name) + '</strong> بمتوسط ' + perf[0].avg + '.');
    var low = perf.filter(function (p) { return p.avg < 65 && p.calls >= 2; });
    if (low.length) parts.push('💡 يُنصح بتدريب ' + low.length + ' وكيل بأداء دون المستهدف.');
    else parts.push('أداء الفريق ضمن المعدّل الطبيعي.');
    el.innerHTML = parts.join(' ');
  }

  /* ── charts ── */
  function renderChartsIfVisible() { var ov = document.getElementById('view-overview'); if (ov && ov.classList.contains('active')) renderCharts(); }
  function renderCharts() {
    if (!window.SCMCharts || !SCMCharts.available) return;
    var c = state.calls;
    var d = SCMCharts.callsPerDay(c, 14); SCMCharts.line(document.getElementById('chartCallsDay'), { labels: d.labels, data: d.data, colors: ['#F59E0B'] });
    var sent = SCMCharts.sentimentSplit(c); SCMCharts.doughnut(document.getElementById('chartSentiment'), { labels: sent.labels, data: sent.data, colors: ['#10b981', '#94a3b8', '#ef4444'] });
    var t = SCMCharts.typeSplit(c); SCMCharts.doughnut(document.getElementById('chartTypes'), { labels: t.labels, data: t.data, colors: ['#f59e0b', '#2563eb', '#10b981', '#7c3aed', '#ef4444', '#0ea5e9'] });
    var g = SCMCharts.avgScoreByGroup(c, function (call) { return call.user_id; }, function (call) { return (call.users && call.users.full_name) || '—'; }, 10);
    SCMCharts.bar(document.getElementById('chartScores'), { labels: g.labels, data: g.data, colors: g.colors, horizontal: true });
  }

  /* ── live + activity + teams ── */
  function renderLive() {
    var live = state.live || [];
    setText('liveCount', live.length);
    var label = document.getElementById('liveSubLabel'); if (label) label.textContent = live.length ? (live.length + ' مكالمة مباشرة الآن') : 'أحدث المكالمات';
    var mini = document.getElementById('liveCallsGridMini'); if (!mini) return;
    var cards = live.slice(0, 4).map(D.liveCardFromRegistry);
    if (cards.length < 4) cards = cards.concat(recentCalls(4 - cards.length).map(recentCard));
    mini.innerHTML = cards.join('') || D.emptyState('fa-phone-slash', 'لا توجد مكالمات بعد', 'ستظهر المكالمات الحيّة هنا.');
  }
  function recentCalls(n) { return state.calls.slice().sort(function (a, b) { return new Date(b.call_start || 0) - new Date(a.call_start || 0); }).slice(0, n); }
  function recentCard(c) {
    var agent = (c.users && c.users.full_name) || '—', cust = (c.customers && c.customers.name) || '—', sc = D.scoreOf(c);
    return '<div class="live-call" onclick="Supervisor.openCall(\'' + c.call_id + '\')" title="عرض التفاصيل">'
      + '<div class="lc-head"><span class="lc-live" style="color:var(--muted)"><i class="fas fa-clock-rotate-left"></i> الأحدث</span><span class="lc-dur">' + D.fmtDuration(D.durSec(c)) + '</span></div>'
      + '<div class="lc-people"><span class="avatar sq-sm">' + D.escapeHtml(D.initials(agent)) + '</span><div class="lc-person"><b>' + D.escapeHtml(agent) + '</b><small>الوكيل</small></div>'
      + '<i class="fas fa-arrow-right-arrow-left lc-arrow"></i><div class="lc-person" style="text-align:end;margin-inline-start:auto"><b>' + D.escapeHtml(cust) + '</b><small>العميل</small></div></div>'
      + '<div class="lc-meta">' + D.sentimentBadge(c.sentiment) + (sc != null ? D.scorePill(sc) : '') + '</div></div>';
  }
  function renderActivity() {
    var feed = document.getElementById('activityFeed'); if (!feed) return;
    var ev = recentCalls(12).map(function (c) { return { ts: new Date(c.call_start || 0).getTime(), icon: 'fa-phone-volume', tone: 'fi-amber', title: 'تحليل مكالمة', desc: ((c.users && c.users.full_name) || 'وكيل') + ' · ' + ((c.customers && c.customers.name) || 'عميل') }; });
    if (!ev.length) { feed.innerHTML = D.emptyState('fa-wave-square', 'لا يوجد نشاط بعد', ''); return; }
    feed.innerHTML = ev.map(function (e) { return '<div class="feed-item"><div class="feed-rail"><span class="feed-ic ' + e.tone + '"><i class="fas ' + e.icon + '"></i></span><span class="feed-line"></span></div><div class="feed-body"><div class="feed-title">' + D.escapeHtml(e.title) + '</div><div class="feed-desc">' + D.escapeHtml(e.desc) + '</div><div class="feed-time">' + D.timeAgo(e.ts) + '</div></div></div>'; }).join('');
  }
  function rankRow(p, idx, top) {
    var avg = p.avg != null ? p.avg : 0, col = D.scoreColor(p.avg), medal = top && idx < 3 ? ['🥇', '🥈', '🥉'][idx] : '';
    return '<div class="rank-row ' + (top && idx < 3 ? 'top-' + (idx + 1) : '') + '" onclick="Supervisor.openAgentProfile(\'' + p.user_id + '\')">'
      + '<span class="rank-num">' + (idx + 1) + '</span><span class="avatar sq-sm">' + D.escapeHtml(D.initials(p.name)) + '</span>'
      + '<div class="rank-info"><b>' + D.escapeHtml(p.name) + ' ' + medal + '</b><small>' + p.calls + ' مكالمة</small><div class="rank-bar"><i style="width:' + avg + '%;background:' + col.c + '"></i></div></div>'
      + '<span class="score-pill" style="color:' + col.c + ';background:' + col.bg + '">' + (p.avg != null ? p.avg : '—') + '</span></div>';
  }
  function renderTeams() {
    var perf = agentPerf();
    var top = document.getElementById('topAgents'), bot = document.getElementById('bottomAgents');
    if (top) top.innerHTML = perf.length ? perf.slice(0, 5).map(function (x, i) { return rankRow(x, i, true); }).join('') : D.emptyState('fa-trophy', 'لا توجد تقييمات بعد', '');
    if (bot) bot.innerHTML = perf.length ? perf.slice(-5).reverse().map(function (x, i) { return rankRow(x, i, false); }).join('') : D.emptyState('fa-circle-info', 'لا توجد بيانات', '');
  }

  /* ── agents table ── */
  function renderAgents() {
    var tbody = document.getElementById('agentsTable'); if (!tbody) return;
    var term = ((document.getElementById('agentSearch') || {}).value || '').trim().toLowerCase();
    var perf = {}; agentPerf().forEach(function (p) { perf[p.user_id] = p; });
    var list = state.agents.filter(function (a) { return !term || (a.full_name || '').toLowerCase().indexOf(term) >= 0 || (a.email || '').toLowerCase().indexOf(term) >= 0; });
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="6">' + D.emptyState('fa-user-slash', 'لا يوجد وكلاء', 'لا يوجد وكلاء تابعون لك بعد.') + '</td></tr>'; return; }
    tbody.innerHTML = list.map(function (a) {
      var p = perf[a.user_id] || { calls: 0, avg: null };
      return '<tr class="row-click" onclick="Supervisor.openAgentProfile(\'' + a.user_id + '\')"><td><div class="cell-name"><span class="avatar sq-sm">' + D.escapeHtml(D.initials(a.full_name)) + '</span><b>' + D.escapeHtml(a.full_name || '—') + '</b></div></td>'
        + '<td><span class="cell-sub">' + D.escapeHtml(a.email || '—') + '</span></td><td>' + p.calls + '</td><td>' + D.scorePill(p.avg) + '</td><td>' + D.statusBadge(a.is_active) + '</td>'
        + '<td><button class="icon-action ia-view"><i class="fas fa-eye"></i></button></td></tr>';
    }).join('');
  }

  /* ── calls + customers ── */
  function renderAgentFilter() {
    var sel = document.getElementById('agentFilter'); if (!sel) return; var cur = sel.value;
    sel.innerHTML = '<option value="">— كل الوكلاء —</option>' + state.agents.map(function (a) { return '<option value="' + a.user_id + '">' + D.escapeHtml(a.full_name || a.email) + '</option>'; }).join('');
    sel.value = cur;
  }
  function renderCalls() {
    var tbody = document.getElementById('callsTable'); if (!tbody) return;
    var term = ((document.getElementById('callSearch') || {}).value || '').trim().toLowerCase();
    var agent = (document.getElementById('agentFilter') || {}).value || '';
    var list = state.calls.filter(function (c) {
      if (agent && c.user_id !== agent) return false;
      if (callSent !== 'all' && D.sentimentClass(c.sentiment) !== callSent) return false;
      if (term) { var hay = ((c.users && c.users.full_name) || '') + ' ' + ((c.customers && c.customers.name) || '') + ' ' + (c.summary || ''); if (hay.toLowerCase().indexOf(term) < 0) return false; }
      return true;
    });
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="8">' + D.emptyState('fa-phone-slash', 'لا توجد مكالمات مطابقة', '') + '</td></tr>'; return; }
    tbody.innerHTML = list.map(function (c) {
      var agentN = (c.users && c.users.full_name) || '—', dur = D.durSec(c);
      return '<tr class="row-click" onclick="Supervisor.openCall(\'' + c.call_id + '\')"><td><div class="cell-name"><span class="avatar sq-sm">' + D.escapeHtml(D.initials(agentN)) + '</span><b>' + D.escapeHtml(agentN) + '</b></div></td>'
        + '<td>' + D.escapeHtml((c.customers && c.customers.name) || '—') + '</td><td dir="ltr" style="text-align:start">' + D.escapeHtml((c.customers && c.customers.phone_number) || '—') + '</td>'
        + '<td data-sort="' + (c.call_start || '') + '">' + D.fmtDateTime(c.call_start) + '</td>'
        + '<td data-sort="' + (dur == null ? '' : dur) + '">' + D.fmtDuration(dur) + '</td><td>' + D.escapeHtml(c.issues_category || c.call_type || '—') + '</td>'
        + '<td>' + D.sentimentBadge(c.sentiment) + '</td><td>' + D.scorePill(D.scoreOf(c)) + '</td></tr>';
    }).join('');
  }
  function custStats() {
    var by = {};
    state.calls.forEach(function (c) { if (!c.customer_id) return; var e = by[c.customer_id] || (by[c.customer_id] = { count: 0, lastAgent: null, _t: 0 }); e.count++; var t = c.call_start ? new Date(c.call_start).getTime() : 0; if (t >= e._t) { e._t = t; e.lastAgent = (c.users && c.users.full_name) || c.handling_agent || null; } });
    return by;
  }
  function renderCustomers() {
    var tbody = document.getElementById('customersTable'); if (!tbody) return;
    var term = ((document.getElementById('custSearch') || {}).value || '').trim().toLowerCase();
    var by = custStats();
    var list = state.customers.filter(function (c) { return !term || (c.name || '').toLowerCase().indexOf(term) >= 0 || (c.phone_number || '').toLowerCase().indexOf(term) >= 0; });
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="6">' + D.emptyState('fa-address-book', 'لا يوجد عملاء', '') + '</td></tr>'; return; }
    tbody.innerHTML = list.map(function (c) {
      var e = by[c.customer_id] || { count: 0, lastAgent: null }; var agent = c.handling_agent || e.lastAgent;
      return '<tr class="row-click" onclick="Supervisor.openCustomerProfile(\'' + c.customer_id + '\')"><td><div class="cell-name"><span class="avatar sq-sm"><i class="fas fa-user"></i></span><b>' + D.escapeHtml(c.name) + '</b></div></td>'
        + '<td dir="ltr" style="text-align:start">' + D.escapeHtml(c.phone_number) + '</td><td>' + D.escapeHtml(c.email || '—') + '</td>'
        + '<td>' + (agent ? D.escapeHtml(agent) : '<span class="dash">—</span>') + '</td><td><span class="badge info">' + e.count + '</span></td>'
        + '<td><button class="icon-action ia-view"><i class="fas fa-arrow-left"></i></button></td></tr>';
    }).join('');
  }

  Supervisor.openCall = function (id) { D.openCallDetail(id, { authFetch: auth.authFetch }); };

  /* ── drill-downs ── */
  function gotoProfile(html) {
    var cur = document.querySelector('.view.active'); if (cur && cur.id !== 'view-profile') prevView = cur.id;
    document.getElementById('view-profile').innerHTML = html; D.showView('view-profile');
    document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
  }
  Supervisor.closeProfile = function () { D.showView(prevView); document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.toggle('active', n.getAttribute('data-nav') === prevView); }); };
  function profHero(name, sub, badge) { return '<button class="btn btn-ghost btn-sm btn-back" onclick="Supervisor.closeProfile()"><i class="fas fa-arrow-right"></i> رجوع</button><div class="profile-hero"><span class="avatar sq-lg">' + D.escapeHtml(D.initials(name)) + '</span><div class="ph-info"><h2>' + D.escapeHtml(name) + '</h2><p>' + sub + '</p>' + (badge || '') + '</div></div>'; }
  function kpiCard(icon, cls, label, value) { return '<div class="kpi-card ' + cls + '"><div class="kpi-top"><div><div class="kpi-label">' + label + '</div><div class="kpi-value" style="font-size:1.8rem">' + value + '</div></div><div class="kpi-ic"><i class="fas ' + icon + '"></i></div></div></div>'; }
  function avgScore(calls) { var s = calls.map(D.scoreOf).filter(function (v) { return v != null; }); return s.length ? Math.round(s.reduce(add, 0) / s.length) : null; }
  function callsTable(calls) {
    if (!calls.length) return D.emptyState('fa-phone-slash', 'لا توجد مكالمات', '');
    return '<div class="table-wrap"><table class="data-table"><thead><tr><th>العميل</th><th>وقت البدء</th><th>المدة</th><th>التصنيف</th><th>المشاعر</th><th>التقييم</th></tr></thead><tbody>'
      + calls.map(function (c) { var dur = D.durSec(c); return '<tr class="row-click" onclick="Supervisor.openCall(\'' + c.call_id + '\')"><td><b>' + D.escapeHtml((c.customers && c.customers.name) || '—') + '</b></td><td data-sort="' + (c.call_start || '') + '">' + D.fmtDateTime(c.call_start) + '</td><td data-sort="' + (dur == null ? '' : dur) + '">' + D.fmtDuration(dur) + '</td><td>' + D.escapeHtml(c.issues_category || c.call_type || '—') + '</td><td>' + D.sentimentBadge(c.sentiment) + '</td><td>' + D.scorePill(D.scoreOf(c)) + '</td></tr>'; }).join('') + '</tbody></table></div>';
  }
  Supervisor.openAgentProfile = function (agentId) {
    var a = state.agents.filter(function (x) { return x.user_id === agentId; })[0] || { full_name: 'وكيل' };
    var calls = state.calls.filter(function (c) { return c.user_id === agentId; });
    var html = profHero(a.full_name, '<i class="fas fa-envelope"></i> ' + D.escapeHtml(a.email || '—'), '<div style="margin-top:8px"><span class="role-badge r-agent">وكيل</span></div>')
      + '<div class="grid grid-kpi">' + kpiCard('fa-phone-volume', 'kc-amber', 'المكالمات', calls.length) + kpiCard('fa-star', 'kc-green', 'متوسط الأداء', (avgScore(calls) != null ? avgScore(calls) + '/100' : '—')) + kpiCard('fa-circle-check', 'kc-blue', 'الحالة', a.is_active ? 'نشط' : 'معطل') + '</div>'
      + '<div class="glass-panel" style="margin-top:var(--s-4)"><div class="section-head" style="margin-bottom:var(--s-3)"><h3 style="font-size:1rem"><span class="sh-ic"><i class="fas fa-list"></i></span> سجل مكالمات الوكيل</h3></div>' + callsTable(calls) + '</div>';
    gotoProfile(html);
  };
  Supervisor.openCustomerProfile = function (custId) {
    var cust = state.customers.filter(function (c) { return c.customer_id === custId; })[0]; if (!cust) { D.toast('العميل غير موجود', 'error'); return; }
    var calls = state.calls.filter(function (c) { return c.customer_id === custId; }).sort(function (a, b) { return new Date(b.call_start || 0) - new Date(a.call_start || 0); });
    var neg = calls.filter(function (c) { return D.sentimentClass(c.sentiment) === 'negative'; }).length;
    var html = profHero(cust.name, '<i class="fas fa-phone"></i> <span dir="ltr">' + D.escapeHtml(cust.phone_number) + '</span> · <i class="fas fa-envelope"></i> ' + D.escapeHtml(cust.email || '—'), '')
      + '<div class="grid grid-kpi">' + kpiCard('fa-phone-volume', 'kc-blue', 'المكالمات', calls.length) + kpiCard('fa-face-angry', 'kc-amber', 'سلبية', neg) + kpiCard('fa-star', 'kc-violet', 'متوسط الجودة', (avgScore(calls) != null ? avgScore(calls) + '/100' : '—')) + '</div>'
      + '<div class="glass-panel" style="margin-top:var(--s-4)"><div class="section-head" style="margin-bottom:var(--s-3)"><h3 style="font-size:1rem"><span class="sh-ic"><i class="fas fa-timeline"></i></span> سجل مكالمات العميل</h3></div>' + callsTable(calls) + '</div>';
    gotoProfile(html);
  };

  /* ── exports ── */
  function typeAr(t) { return (window.SCMCharts && SCMCharts.CALL_TYPE_AR[t]) || t || ''; }
  Supervisor.exportCalls = function () { var rows = [['الوكيل', 'العميل', 'رقم العميل', 'وقت البدء', 'النوع', 'التصنيف', 'المشاعر', 'التقييم']]; state.calls.forEach(function (c) { rows.push([(c.users && c.users.full_name) || '', (c.customers && c.customers.name) || '', (c.customers && c.customers.phone_number) || '', c.call_start ? new Date(c.call_start).toLocaleString('ar-EG') : '', typeAr(c.call_type), c.issues_category || '', c.sentiment || '', D.scoreOf(c) != null ? D.scoreOf(c) : '']); }); if (window.SCM) SCM.exportCSV('team-calls.csv', rows); };
  Supervisor.exportAgents = function () { var rows = [['الوكيل', 'البريد', 'المكالمات', 'متوسط الأداء', 'الحالة']]; agentPerf().forEach(function (p) { rows.push([p.name || '', '', p.calls, p.avg != null ? p.avg : '', p.is_active ? 'نشط' : 'معطل']); }); if (window.SCM) SCM.exportCSV('my-agents.csv', rows); };
  Supervisor.exportCustomers = function () { var rows = [['الاسم', 'رقم الهاتف', 'البريد']]; state.customers.forEach(function (c) { rows.push([c.name || '', c.phone_number || '', c.email || '']); }); if (window.SCM) SCM.exportCSV('my-customers.csv', rows); };

  /* ── helpers + init ── */
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  function setKpiCount(id, v) { var el = document.getElementById(id); if (el) { if (window.SCM && SCM.countUp) SCM.countUp(el, String(v)); else el.textContent = v; } }
  function hydrate() {
    var u = auth.getUser() || {}; var name = u.full_name || (u.email ? u.email.split('@')[0] : 'المشرف'); var ini = D.initials(name);
    setText('sideName', name); setText('sideEmail', u.email || ''); setText('sideAvatar', ini); setText('heroName', name);
    setText('chipAvatar', ini); setText('pmAvatar', ini); setText('pmName', name); setText('pmEmail', u.email || '');
    var chip = document.getElementById('chipName'); if (chip) chip.innerHTML = D.escapeHtml(name) + '<small>مشرف</small>';
  }
  document.addEventListener('DOMContentLoaded', function () {
    hydrate();
    setText('topbarDate', new Date().toLocaleDateString('ar-EG', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }));
    D.setupShell({ titles: { 'view-overview': 'نظرة عامة', 'view-agents': 'فريقي وأداؤه', 'view-calls': 'المكالمات والتقارير', 'view-customers': 'عملائي' }, onTab: function (id) { if (id === 'view-overview') renderCharts(); } });
    D.bindProfile({ authFetchAt: auth.authFetchAt, authBase: AUTH_BASE, onSaved: hydrate });
    D.initLive({ authFetchAt: auth.authFetchAt, liveBase: auth.liveBase, onUpdate: function (live) { state.live = live; renderLive(); } });

    document.getElementById('logoutBtnSide').addEventListener('click', auth.logout);
    document.getElementById('logoutMenuBtn').addEventListener('click', auth.logout);
    document.getElementById('callModal').addEventListener('click', function (e) { if (e.target === this) SCMDash.closeCallDetail(); });
    document.getElementById('profileModal').addEventListener('click', function (e) { if (e.target === this) SCMDash.closeProfileModal(); });
    document.getElementById('agentSearch').addEventListener('input', renderAgents);
    document.getElementById('callSearch').addEventListener('input', renderCalls);
    document.getElementById('agentFilter').addEventListener('change', renderCalls);
    document.getElementById('custSearch').addEventListener('input', renderCustomers);
    document.querySelectorAll('#callSentChips .chip').forEach(function (chip) { chip.addEventListener('click', function () { document.querySelectorAll('#callSentChips .chip').forEach(function (c) { c.classList.remove('on'); }); chip.classList.add('on'); callSent = chip.getAttribute('data-sent'); renderCalls(); }); });

    if (window.SCM && SCM.registerCommands) SCM.registerCommands([
      { label: 'نظرة عامة', hint: 'تنقل', icon: '📊', run: function () { D.showView('view-overview'); renderCharts(); } },
      { label: 'فريقي وأداؤه', hint: 'تنقل', icon: '🎧', run: function () { D.showView('view-agents'); } },
      { label: 'المكالمات والتقارير', hint: 'تنقل', icon: '📞', run: function () { D.showView('view-calls'); } },
      { label: 'ملفي الشخصي', hint: 'حساب', icon: '👤', run: SCMDash.openProfileModal },
    ]);

    loadAll().then(function () { renderChartsIfVisible(); setTimeout(renderChartsIfVisible, 700); });
    // Real-time: refresh instantly on relevant SSE events instead of frequent polling.
    D.onDataChange(['call.', 'user.', 'live.'], silentRefresh);
    refreshTimer = setInterval(silentRefresh, 300000);   // 5-min safety net only
    document.addEventListener('visibilitychange', function () { if (document.hidden) { if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; } } else { silentRefresh(); refreshTimer = setInterval(silentRefresh, 300000); } });
  });
})();
