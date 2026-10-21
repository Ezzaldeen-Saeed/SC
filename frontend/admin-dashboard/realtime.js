/* =====================================================================
   realtime.js — Live monitoring layer for the Admin Control Center
   Live call cards · Activity feed · Smart alerts · Team performance ·
   Categorized notifications drawer · live SSE capture (wraps SCM.notify).
   ===================================================================== */
(function () {
  'use strict';
  var App = window.App;
  if (!App) return;

  App._liveEvents = [];
  App._notifs = [];
  var notifFilter = 'all';

  /* ════════════ Live call cards ════════════ */
  function isLive(c) { return c.call_start && (c.call_end == null) ; }
  function riskOf(c) {
    var sent = App.sentimentClass(c.sentiment), score = App.scoreOf(c);
    if (sent === 'negative' || (score != null && score < 50)) return 'high';
    if (sent === 'neutral' || (score != null && score < 75)) return 'med';
    return 'low';
  }
  function liveCardHtml(c) {
    var agent = (c.users && c.users.full_name) || c.handling_agent || '—';
    var cust = (c.customers && c.customers.name) || '—';
    var risk = riskOf(c), live = isLive(c), score = App.scoreOf(c);
    var riskBadge = risk === 'high' ? '<span class="badge neg"><i class="fas fa-triangle-exclamation"></i> خطر مرتفع</span>'
      : risk === 'med' ? '<span class="badge warn"><i class="fas fa-circle-exclamation"></i> متوسط</span>'
        : '<span class="badge pos"><i class="fas fa-shield-heart"></i> آمن</span>';
    var head = live
      ? '<span class="lc-live"><span class="live-dot"></span> مباشر الآن</span><span class="lc-dur" data-start="' + c.call_start + '">00:00</span>'
      : '<span class="lc-live" style="color:var(--muted)"><i class="fas fa-clock-rotate-left"></i> الأحدث</span><span class="lc-dur">' + App.fmtDuration(App.callDurationSec(c)) + '</span>';
    var conf = score != null
      ? '<div class="lc-confidence"><div class="lcc-row"><span>درجة الجودة / الثقة</span><b>' + score + '%</b></div><div class="lcc-bar"><i class="lcc-fill" style="width:' + score + '%;background:' + App.scoreColor(score).c + '"></i></div></div>'
      : '<div class="lc-confidence"><div class="lcc-row"><span>قيد التحليل بالذكاء الاصطناعي</span><b>—</b></div><div class="lcc-bar"><i class="lcc-fill" style="width:35%"></i></div></div>';
    return '<div class="live-call risk-' + risk + (live ? ' live-ring' : '') + '" onclick="App.openCallDetail && App.openCallDetail(\'' + c.call_id + '\')" title="عرض التفاصيل">'
      + '<div class="lc-head">' + head + '</div>'
      + '<div class="lc-people">'
      + '<span class="avatar sq-sm">' + App.escapeHtml(App.initials(agent)) + '</span>'
      + '<div class="lc-person"><b>' + App.escapeHtml(agent) + '</b><small>الوكيل</small></div>'
      + '<i class="fas fa-arrow-right-arrow-left lc-arrow"></i>'
      + '<div class="lc-person" style="text-align:end;margin-inline-start:auto"><b>' + App.escapeHtml(cust) + '</b><small>العميل</small></div>'
      + '</div>'
      + '<div class="lc-meta">' + App.sentimentBadge(c.sentiment) + riskBadge + '</div>'
      + conf + '</div>';
  }

  function recentCalls(n) {
    return App.state.calls.slice().sort(function (a, b) {
      return new Date(b.call_start || 0) - new Date(a.call_start || 0);
    }).slice(0, n);
  }
  // ── Real live registry (in-progress calls from /api/live/calls) ──
  App.state.liveCalls = App.state.liveCalls || [];
  var LIVE_BASE = App.API_BASE.replace(/\/admin$/, '/live');
  App.fetchLiveCalls = function () {
    return App.authFetchAt(LIVE_BASE, '/calls').then(function (d) {
      App.state.liveCalls = d.liveCalls || [];
      renderLiveCalls();
    }).catch(function () {});
  };

  // A live registry entry (agent currently on a call; no analysis yet).
  function liveCardFromRegistry(e) {
    var agent = e.full_name || '—';
    var cust = e.customer_name || 'لم يُحدَّد بعد';
    return '<div class="live-call live-ring" style="border-inline-start:3px solid var(--danger)" title="مكالمة مباشرة الآن">'
      + '<div class="lc-head"><span class="lc-live"><span class="live-dot"></span> مباشر الآن</span>'
      + '<span class="lc-dur" data-start="' + e.started_at + '">00:00</span></div>'
      + '<div class="lc-people">'
      + '<span class="avatar sq-sm">' + App.escapeHtml(App.initials(agent)) + '</span>'
      + '<div class="lc-person"><b>' + App.escapeHtml(agent) + '</b><small>الوكيل</small></div>'
      + '<i class="fas fa-arrow-right-arrow-left lc-arrow"></i>'
      + '<div class="lc-person" style="text-align:end;margin-inline-start:auto"><b>' + App.escapeHtml(cust) + '</b><small>العميل</small></div>'
      + '</div>'
      + '<div class="lc-meta"><span class="badge neg"><span class="live-dot"></span> LIVE</span><span class="badge info"><i class="fas fa-robot"></i> قيد التحليل</span></div>'
      + '<div class="lc-confidence"><div class="lcc-row"><span>التحليل اللحظي يعمل…</span><b>—</b></div><div class="lcc-bar"><i class="lcc-fill" style="width:45%"></i></div></div>'
      + '</div>';
  }

  function renderLiveCalls(fullView) {
    var liveReg = App.state.liveCalls || [];
    var label = document.getElementById('liveSubLabel');
    if (label) label.textContent = liveReg.length ? (liveReg.length + ' مكالمة مباشرة الآن') : 'أحدث المكالمات';
    var mini = document.getElementById('liveCallsGridMini');
    var full = document.getElementById('liveCallsGrid');

    if (mini) {
      var m = liveReg.slice(0, 4).map(liveCardFromRegistry);
      if (m.length < 4) m = m.concat(recentCalls(4 - m.length).map(liveCardHtml));
      mini.innerHTML = m.join('') || emptyState('fa-phone-slash', 'لا توجد مكالمات بعد', 'ابدأ بمراقبة المكالمات لرؤية البطاقات الحيّة.');
    }
    if (full) {
      var f = liveReg.map(liveCardFromRegistry);
      var need = Math.max(0, 12 - f.length);
      if (need) f = f.concat(recentCalls(need).map(liveCardHtml));
      full.innerHTML = f.join('') || emptyState('fa-phone-slash', 'لا توجد مكالمات لعرضها', 'ستظهر هنا المكالمات النشطة والأحدث فور توفّرها.');
    }
    updateLiveCounter();
  }
  App.renderLiveCalls = renderLiveCalls;

  function updateLiveCounter() {
    var n = (App.state.liveCalls || []).length;
    setText('liveCount', n);
    var badge = document.querySelector('#navLiveBadge b'); if (badge) badge.textContent = n;
    var navBadge = document.getElementById('navLiveBadge'); if (navBadge) navBadge.style.display = n ? '' : 'none';
  }
  App.updateLiveCounter = updateLiveCounter;

  // tick live durations every second
  setInterval(function () {
    document.querySelectorAll('.lc-dur[data-start]').forEach(function (el) {
      var start = new Date(el.getAttribute('data-start'));
      if (isNaN(start)) return;
      var s = Math.max(0, Math.floor((Date.now() - start) / 1000));
      var m = Math.floor(s / 60), ss = s % 60;
      el.textContent = String(m).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
    });
  }, 1000);

  /* ════════════ Activity feed ════════════ */
  function staticEvents() {
    var ev = [];
    recentCalls(8).forEach(function (c) {
      ev.push({
        ts: new Date(c.call_start || 0).getTime(), icon: 'fa-phone-volume', tone: 'fi-violet',
        title: 'تحليل مكالمة', desc: ((c.users && c.users.full_name) || 'وكيل') + ' · ' + ((c.customers && c.customers.name) || 'عميل'),
      });
    });
    App.state.users.filter(function (u) { return u.created_at; })
      .sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); }).slice(0, 5)
      .forEach(function (u) {
        ev.push({ ts: new Date(u.created_at).getTime(), icon: 'fa-user-plus', tone: 'fi-blue', title: 'مستخدم جديد', desc: (u.full_name || u.email) + ' · ' + App.roleLabelAr(u.role) });
      });
    return ev;
  }
  function buildActivityFeed() {
    var feed = document.getElementById('activityFeed');
    if (!feed) return;
    var all = staticEvents().concat(App._liveEvents);
    all.sort(function (a, b) { return b.ts - a.ts; });
    all = all.slice(0, 14);
    if (!all.length) { feed.innerHTML = emptyState('fa-wave-square', 'لا يوجد نشاط بعد', 'سيظهر هنا كل حدث فور وقوعه.'); return; }
    feed.innerHTML = all.map(function (e) {
      return '<div class="feed-item anim-fade-in"><div class="feed-rail"><span class="feed-ic ' + (e.tone || 'fi-blue') + '"><i class="fas ' + e.icon + '"></i></span><span class="feed-line"></span></div>'
        + '<div class="feed-body"><div class="feed-title">' + App.escapeHtml(e.title) + '</div><div class="feed-desc">' + App.escapeHtml(e.desc) + '</div><div class="feed-time">' + App.timeAgo(e.ts) + '</div></div></div>';
    }).join('');
  }
  App.buildActivityFeed = buildActivityFeed;

  /* ════════════ Smart alerts ════════════ */
  function agentPerformance() {
    var acc = {};
    App.state.calls.forEach(function (c) {
      var s = App.scoreOf(c); if (s == null || c.user_id == null) return;
      var e = acc[c.user_id] || (acc[c.user_id] = { user_id: c.user_id, name: (c.users && c.users.full_name) || '—', sum: 0, n: 0 });
      e.sum += s; e.n++;
    });
    return Object.keys(acc).map(function (k) { var e = acc[k]; return { user_id: e.user_id, name: e.name, avg: Math.round(e.sum / e.n), calls: e.n }; })
      .sort(function (a, b) { return b.avg - a.avg; });
  }
  App.agentPerformance = agentPerformance;

  /* Severity ranking — drives both the overview triage strip (which shows only
     what needs acting on) and the sidebar badge count. */
  var SEV_RANK = { 'sev-danger': 0, 'sev-warn': 1, 'sev-info': 2, 'sev-success': 3 };
  function needsAttention(a) { return a.sev === 'sev-danger' || a.sev === 'sev-warn'; }

  /* Derives the alert model from current state. Kept separate from rendering so
     the overview strip and the full alerts view share one source of truth
     rather than each re-deriving the thresholds. */
  function buildAlerts() {
    var calls = App.state.calls, users = App.state.users, alerts = [];

    var today = calls.filter(function (c) { return App.isToday(c.call_start); });
    var negToday = today.filter(function (c) { return App.sentimentClass(c.sentiment) === 'negative'; }).length;
    var prior = calls.filter(function (c) { return c.call_start && !App.isToday(c.call_start) && (Date.now() - new Date(c.call_start)) < 8 * 864e5; });
    var negPrior = prior.filter(function (c) { return App.sentimentClass(c.sentiment) === 'negative'; }).length;
    var rToday = today.length ? negToday / today.length : 0, rPrior = prior.length ? negPrior / prior.length : 0;
    if (rPrior > 0 && rToday > rPrior) {
      var up = Math.round(((rToday - rPrior) / rPrior) * 100);
      if (up >= 5) alerts.push(alert('sev-danger', 'fa-arrow-trend-up', 'ارتفاع في المشاعر السلبية', 'زادت نسبة المكالمات السلبية اليوم بمقدار ' + up + '% عن المتوسط الأسبوعي.', 'مراجعة المكالمات السلبية', 'view-calls'));
    }

    var perf = agentPerformance();
    var low = perf.filter(function (p) { return p.avg < 65 && p.calls >= 2; });
    if (low.length) {
      var w = low[low.length - 1];
      alerts.push(alert('sev-warn', 'fa-graduation-cap', 'توصية تدريب', 'أداء الموظف ' + w.name + ' أقل من المستهدف (' + w.avg + '). يُنصح بجدولة جلسة تدريب.', 'عرض ملف الموظف', null, w.user_id));
    }

    var inactive = users.filter(function (u) { return !u.is_active; }).length;
    if (inactive) alerts.push(alert('sev-info', 'fa-user-clock', 'حسابات معطّلة', 'يوجد ' + inactive + ' حساب غير نشط في النظام. راجع صلاحيات الوصول.', 'إدارة المستخدمين', 'view-users'));

    var top = perf[0];
    if (top && top.avg >= 85) alerts.push(alert('sev-success', 'fa-award', 'أداء متميّز', 'الموظف ' + top.name + ' يحقق أعلى متوسط جودة (' + top.avg + '). أداء يستحق التقدير.', 'عرض الترتيب', 'view-overview'));

    if (!alerts.length) alerts.push(alert('sev-success', 'fa-circle-check', 'كل المؤشرات سليمة', 'لا توجد تنبيهات حرجة حاليًا. المنظومة تعمل ضمن المعدّلات الطبيعية.', '', null));

    return alerts.sort(function (a, b) { return SEV_RANK[a.sev] - SEV_RANK[b.sev]; });
  }
  App.buildAlerts = buildAlerts;

  function renderSmartAlerts() {
    var alerts = buildAlerts();
    var attention = alerts.filter(needsAttention);

    var box = document.getElementById('smartAlerts');
    if (box) box.innerHTML = alerts.map(alertHtml).join('');

    renderTriage(alerts, attention);

    var navBadge = document.getElementById('navAlertBadge');
    if (navBadge) {
      navBadge.style.display = attention.length ? '' : 'none';
      var b = navBadge.querySelector('b'); if (b) b.textContent = attention.length;
    }
  }
  App.renderSmartAlerts = renderSmartAlerts;

  /* Overview triage strip — the "what do I do right now?" band. Shows only the
     alerts that need acting on; when there are none it collapses to a single
     all-clear row instead of repeating the full alerts view. */
  function renderTriage(alerts, attention) {
    var strip = document.getElementById('overviewAlerts');
    if (!strip) return;
    var show = attention.length ? attention.slice(0, 3) : alerts.slice(0, 1);
    strip.innerHTML = show.map(alertHtml).join('');

    var more = document.getElementById('overviewAlertsMore');
    if (more) {
      var extra = attention.length - show.length;
      more.textContent = extra > 0 ? '+' + extra + ' تنبيه آخر' : 'عرض كل التنبيهات';
    }
  }

  function alert(sev, icon, title, desc, cta, view, userId) {
    return { sev: sev, icon: icon, title: title, desc: desc, cta: cta, view: view, userId: userId };
  }

  function alertHtml(a) {
    var action = '';
    if (a.cta) {
      var onclick = a.userId ? "App.openUserProfile && App.openUserProfile('" + a.userId + "')" : a.view ? "App.switchView('" + a.view + "')" : '';
      action = '<div class="alert-cta" ' + (onclick ? 'onclick="' + onclick + '" style="cursor:pointer"' : '') + '>' + App.escapeHtml(a.cta) + ' <i class="fas fa-arrow-left"></i></div>';
    }
    return '<div class="alert-card ' + a.sev + '"><div class="alert-ic"><i class="fas ' + a.icon + '"></i></div><div class="alert-body"><b>' + App.escapeHtml(a.title) + '</b><p>' + App.escapeHtml(a.desc) + '</p>' + action + '</div></div>';
  }

  /* ════════════ Team performance ════════════ */
  function rankRow(p, idx, top) {
    var k = App.scoreColor(p.avg);
    var medal = top && idx < 3 ? ['🥇', '🥈', '🥉'][idx] : '';
    return '<div class="rank-row ' + (top && idx < 3 ? 'top-' + (idx + 1) : '') + '" onclick="App.openUserProfile && App.openUserProfile(\'' + p.user_id + '\')">'
      + '<span class="rank-num">' + (idx + 1) + '</span>'
      + '<span class="avatar sq-sm">' + App.escapeHtml(App.initials(p.name)) + '</span>'
      + '<div class="rank-info"><b>' + App.escapeHtml(p.name) + ' ' + medal + '</b><small>' + p.calls + ' مكالمة</small>'
      + '<div class="rank-bar"><i style="width:' + p.avg + '%;background:' + k.c + '"></i></div></div>'
      + '<span class="score-pill" style="color:' + k.c + ';background:' + k.bg + '">' + p.avg + '</span></div>';
  }
  function renderTeams() {
    var perf = agentPerformance();
    var topBox = document.getElementById('topAgents'), botBox = document.getElementById('bottomAgents');
    if (topBox) topBox.innerHTML = perf.length ? perf.slice(0, 5).map(function (p, i) { return rankRow(p, i, true); }).join('')
      : emptyState('fa-trophy', 'لا توجد تقييمات بعد', 'ستظهر هنا قائمة الأفضل أداءً.');
    if (botBox) {
      var bottom = perf.slice(-5).reverse();
      botBox.innerHTML = perf.length ? bottom.map(function (p, i) { return rankRow(p, i, false); }).join('')
        : emptyState('fa-circle-info', 'لا توجد بيانات', 'لا يوجد موظفون بحاجة لمتابعة حاليًا.');
    }
    renderTeamTable();
  }
  App.renderTeams = renderTeams;

  /* Full leaderboard table (all agents: volume, quality, sentiment mix) */
  function renderTeamTable() {
    var tbody = document.getElementById('teamTable');
    if (!tbody) return;

    var acc = {};
    App.state.calls.forEach(function (c) {
      if (c.user_id == null) return;
      var e = acc[c.user_id] || (acc[c.user_id] = { user_id: c.user_id, name: (c.users && c.users.full_name) || '—', n: 0, pos: 0, neg: 0, sum: 0, sn: 0 });
      e.n++;
      var sc = App.sentimentClass(c.sentiment);
      if (sc === 'positive') e.pos++; else if (sc === 'negative') e.neg++;
      var s = App.scoreOf(c); if (s != null) { e.sum += s; e.sn++; }
    });
    var rows = Object.keys(acc).map(function (k) {
      var e = acc[k];
      return { user_id: e.user_id, name: e.name, n: e.n, pos: e.pos, neg: e.neg, avg: e.sn ? Math.round(e.sum / e.sn) : null };
    });
    rows.sort(function (a, b) { return (b.avg == null ? -1 : b.avg) - (a.avg == null ? -1 : a.avg) || b.n - a.n; });

    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="7">' + emptyState('fa-trophy', 'لا توجد بيانات بعد', 'ستظهر لوحة الصدارة فور تحليل المكالمات.') + '</td></tr>';
      return;
    }

    tbody.innerHTML = rows.map(function (r, i) {
      var k = App.scoreColor(r.avg);
      var posPct = r.n ? Math.round((r.pos / r.n) * 100) : 0;
      var negPct = r.n ? Math.round((r.neg / r.n) * 100) : 0;
      var medal = i < 3 ? [' 🥇', ' 🥈', ' 🥉'][i] : '';
      return '<tr class="row-click" onclick="App.openUserProfile && App.openUserProfile(\'' + r.user_id + '\')">'
        + '<td><span class="rank-num">' + (i + 1) + '</span></td>'
        + '<td><div class="cell-name"><span class="avatar sq-sm">' + App.escapeHtml(App.initials(r.name)) + '</span><b>' + App.escapeHtml(r.name) + medal + '</b></div></td>'
        + '<td>' + r.n + '</td>'
        + '<td>' + App.scorePill(r.avg) + '</td>'
        + '<td><span class="badge pos"><i class="fas fa-face-smile"></i> ' + posPct + '%</span></td>'
        + '<td><span class="badge neg"><i class="fas fa-face-angry"></i> ' + negPct + '%</span></td>'
        // The bar carries no text, so without a key this column would sort as
        // 30 identical blanks.
        + '<td style="min-width:140px" data-sort="' + (r.avg == null ? '' : r.avg) + '"><div class="rank-bar"><i style="width:' + (r.avg || 0) + '%;background:' + k.c + '"></i></div></td>'
        + '</tr>';
    }).join('');
  }
  App.renderTeamTable = renderTeamTable;

  /* ════════════ Notifications drawer + SSE capture ════════════ */
  function categoryOf(n) {
    var hay = ((n.title || '') + ' ' + (n.body || '') + ' ' + (n.type || '')).toLowerCase();
    if (/(دخول|خروج|مرور|أمان|login|logout|password|security)/.test(hay)) return 'security';
    if (/(مكالم|call|تحليل)/.test(hay)) return 'calls';
    if (/(ذكاء|sentiment|ai|توصية|مشاعر)/.test(hay)) return 'ai';
    if (/(مستخدم|user|دور|حساب|account|role)/.test(hay)) return 'users';
    return 'system';
  }
  var CAT_ICON = { security: { i: 'fa-shield-halved', t: 'fi-red' }, calls: { i: 'fa-phone-volume', t: 'fi-violet' }, ai: { i: 'fa-robot', t: 'fi-blue' }, users: { i: 'fa-user-group', t: 'fi-green' }, system: { i: 'fa-gear', t: 'fi-amber' } };

  function recordNotif(n) {
    var cat = categoryOf(n);
    App._notifs.unshift({ title: n.title || '', body: n.body || '', type: n.type || 'info', cat: cat, ts: Date.now(), read: false });
    App._notifs = App._notifs.slice(0, 80);
    App._liveEvents.unshift({ ts: Date.now(), icon: CAT_ICON[cat].i, tone: CAT_ICON[cat].t, title: n.title || 'إشعار', desc: n.body || '' });
    App._liveEvents = App._liveEvents.slice(0, 30);
    updateNotifBadge();
    if (document.getElementById('notifDrawer').classList.contains('open')) renderNotifs();
    buildActivityFeed();
  }
  function updateNotifBadge() {
    var unread = App._notifs.filter(function (x) { return !x.read; }).length;
    var dot = document.getElementById('notifCount');
    if (dot) { dot.style.display = unread ? '' : 'none'; dot.textContent = unread > 9 ? '9+' : unread; }
  }
  function renderNotifs() {
    var list = document.getElementById('notifList');
    if (!list) return;
    var items = App._notifs.filter(function (x) { return notifFilter === 'all' || x.cat === notifFilter; });
    if (!items.length) { list.innerHTML = emptyState('fa-bell-slash', 'لا توجد إشعارات', 'ستصلك التنبيهات والأحداث الحيّة هنا.'); return; }
    list.innerHTML = items.map(function (x) {
      var ci = CAT_ICON[x.cat];
      return '<div class="notif-item ' + (x.read ? '' : 'unread') + '"><span class="notif-ic ' + ci.t + '"><i class="fas ' + ci.i + '"></i></span>'
        + '<div class="notif-body"><b>' + App.escapeHtml(x.title) + '</b>' + (x.body ? '<p>' + App.escapeHtml(x.body) + '</p>' : '') + '<small>' + App.timeAgo(x.ts) + '</small></div></div>';
    }).join('');
  }
  App.openNotifications = function () {
    document.getElementById('notifDrawer').classList.add('open');
    document.getElementById('notifOverlay').classList.add('active');
    renderNotifs();
    setTimeout(function () { App._notifs.forEach(function (x) { x.read = true; }); updateNotifBadge(); }, 1400);
  };
  App.closeNotifications = function () {
    document.getElementById('notifDrawer').classList.remove('open');
    document.getElementById('notifOverlay').classList.remove('active');
  };

  /* helpers */
  function setText(id, v) { var el = document.getElementById(id); if (el) el.textContent = v; }
  function emptyState(icon, title, sub) {
    return '<div class="empty-state"><div class="empty-ic"><i class="fas ' + icon + '"></i></div><h4>' + title + '</h4><p>' + sub + '</p></div>';
  }
  App.emptyState = emptyState;

  /* wire drawer tabs + SSE capture on boot */
  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('#notifTabs .drawer-tab').forEach(function (tab) {
      tab.addEventListener('click', function () {
        document.querySelectorAll('#notifTabs .drawer-tab').forEach(function (t) { t.classList.remove('on'); });
        tab.classList.add('on'); notifFilter = tab.getAttribute('data-cat'); renderNotifs();
      });
    });
    // Capture every live notification (SSE → SCM.notify) into our drawer + feed.
    if (window.SCM && typeof SCM.notify === 'function') {
      var orig = SCM.notify.bind(SCM);
      SCM.notify = function (n) { try { recordNotif(n || {}); } catch (e) {} return orig(n); };
    }
    // Live-call updates: refetch the scoped registry whenever the backend pings.
    document.addEventListener('scm:event', function (e) {
      var t = e.detail && e.detail.type;
      if (t && String(t).indexOf('live') === 0) App.fetchLiveCalls();
    });
    if (App.fetchLiveCalls) App.fetchLiveCalls();
  });
})();
