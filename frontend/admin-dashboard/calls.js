/* =====================================================================
   calls.js — Calls, customers & Customer 360 for the Admin Control Center
   Calls table (search + sentiment filter) · call-detail modal + PDF ·
   customers table · Customer 360° drill-down view.
   ===================================================================== */
(function () {
  'use strict';
  var App = window.App;
  if (!App) return;
  var callSent = 'all', currentCallShortId = '', currentCall = null;

  /* ════════════ Calls table ════════════ */
  function renderCallsTable() {
    var tbody = document.getElementById('callsTable');
    if (!tbody) return;
    var term = ((document.getElementById('callSearch') || {}).value || '').trim().toLowerCase();
    var list = App.state.calls.filter(function (c) {
      if (callSent !== 'all' && App.sentimentClass(c.sentiment) !== callSent) return false;
      if (term) {
        var hay = ((c.users && c.users.full_name) || '') + ' ' + ((c.customers && c.customers.name) || '') + ' ' + (c.summary || '') + ' ' + (c.issues_category || '');
        if (hay.toLowerCase().indexOf(term) < 0) return false;
      }
      return true;
    });
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="8">' + App.emptyState('fa-phone-slash', 'لا توجد مكالمات مطابقة', 'جرّب تعديل البحث أو الفلاتر.') + '</td></tr>'; return; }
    tbody.innerHTML = list.map(function (c) {
      var agent = (c.users && c.users.full_name) || '—';
      var category = c.issues_category || c.call_type || '—';
      var dur = App.callDurationSec(c);
      return '<tr class="row-click" onclick="App.openCallDetail(\'' + c.call_id + '\')" title="عرض التفاصيل">'
        + '<td><div class="cell-name"><span class="avatar sq-sm">' + App.escapeHtml(App.initials(agent)) + '</span><b>' + App.escapeHtml(agent) + '</b></div></td>'
        + '<td>' + App.escapeHtml((c.customers && c.customers.name) || '—') + '</td>'
        + '<td dir="ltr" style="text-align:start">' + App.escapeHtml((c.customers && c.customers.phone_number) || '—') + '</td>'
        // data-sort carries the raw value for scm-table.js: the visible text is
        // formatted through toLocaleString('ar-EG'), whose Arabic-Indic digits
        // no Date parser accepts back.
        + '<td data-sort="' + (c.call_start || '') + '">' + App.fmtDateTime(c.call_start) + '</td>'
        + '<td data-sort="' + (dur == null ? '' : dur) + '">' + App.fmtDuration(dur) + '</td>'
        + '<td>' + App.escapeHtml(category) + '</td>'
        + '<td>' + App.sentimentBadge(c.sentiment) + '</td>'
        + '<td>' + App.scorePill(App.scoreOf(c)) + '</td></tr>';
    }).join('');
  }
  App.renderCallsTable = renderCallsTable;

  /* ════════════ Customers table ════════════ */
  function customerStats() {
    var by = {};
    App.state.calls.forEach(function (c) {
      if (!c.customer_id) return;
      var e = by[c.customer_id] || (by[c.customer_id] = { count: 0, neg: 0, lastAgent: null, _t: 0, scoreSum: 0, scoreN: 0 });
      e.count++;
      if (App.sentimentClass(c.sentiment) === 'negative') e.neg++;
      var sc = App.scoreOf(c); if (sc != null) { e.scoreSum += sc; e.scoreN++; }
      var t = c.call_start ? new Date(c.call_start).getTime() : 0;
      if (t >= e._t) { e._t = t; e.lastAgent = (c.users && c.users.full_name) || c.handling_agent || null; }
    });
    return by;
  }
  function renderCustomersTable() {
    var tbody = document.getElementById('customersTable');
    if (!tbody) return;
    var term = ((document.getElementById('customerSearch') || {}).value || '').trim().toLowerCase();
    var by = customerStats();
    var list = App.state.customers.filter(function (c) {
      if (!term) return true;
      return (c.name || '').toLowerCase().indexOf(term) >= 0 || (c.phone_number || '').toLowerCase().indexOf(term) >= 0;
    });
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="6">' + App.emptyState('fa-address-book', 'لا يوجد عملاء', 'لم يُسجَّل أي عميل بعد.') + '</td></tr>'; return; }
    tbody.innerHTML = list.map(function (c) {
      var e = by[c.customer_id] || { count: 0, lastAgent: null };
      var agent = c.handling_agent || e.lastAgent;
      return '<tr class="row-click" onclick="App.openCustomer360(\'' + c.customer_id + '\')" title="ملف 360°">'
        + '<td><div class="cell-name"><span class="avatar sq-sm"><i class="fas fa-user"></i></span><b>' + App.escapeHtml(c.name) + '</b></div></td>'
        + '<td dir="ltr" style="text-align:start">' + App.escapeHtml(c.phone_number) + '</td>'
        + '<td>' + App.escapeHtml(c.email || '—') + '</td>'
        + '<td>' + (agent ? '<div class="cell-name"><span class="avatar sq-sm">' + App.escapeHtml(App.initials(agent)) + '</span>' + App.escapeHtml(agent) + '</div>' : '<span class="dash">—</span>') + '</td>'
        + '<td><span class="badge info">' + e.count + '</span></td>'
        + '<td><button class="icon-action ia-view"><i class="fas fa-arrow-left"></i></button></td></tr>';
    }).join('');
  }
  App.renderCustomersTable = renderCustomersTable;

  /* ════════════ Customer 360 ════════════ */
  App.openCustomer360 = function (customerId) {
    var cust = App.state.customers.filter(function (c) { return c.customer_id === customerId; })[0];
    if (!cust) { App.toast('العميل غير موجود', 'error'); return; }
    var calls = App.state.calls.filter(function (c) { return c.customer_id === customerId; })
      .sort(function (a, b) { return new Date(b.call_start || 0) - new Date(a.call_start || 0); });
    var total = calls.length;
    var neg = calls.filter(function (c) { return App.sentimentClass(c.sentiment) === 'negative'; });
    var pos = calls.filter(function (c) { return App.sentimentClass(c.sentiment) === 'positive'; }).length;
    var scores = calls.map(App.scoreOf).filter(function (s) { return s != null; });
    var avgScore = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) : null;
    var lastAgent = (calls[0] && calls[0].users && calls[0].users.full_name) || cust.handling_agent || '—';

    var ini = App.initials(cust.name);
    var html = '<button class="btn btn-ghost btn-sm btn-back" onclick="App.switchView(App._prevView||\'view-customers\')"><i class="fas fa-arrow-right"></i> رجوع</button>'
      + '<div class="profile-hero">'
      + '<span class="avatar sq-lg">' + App.escapeHtml(ini) + '</span>'
      + '<div class="ph-info"><h2>' + App.escapeHtml(cust.name) + '</h2>'
      + '<p><i class="fas fa-phone"></i> <span dir="ltr">' + App.escapeHtml(cust.phone_number) + '</span> · <i class="fas fa-envelope"></i> ' + App.escapeHtml(cust.email || '—') + '</p>'
      + '<div style="margin-top:8px"><span class="badge info"><i class="fas fa-headset"></i> ' + lastAgent + '</span></div></div>'
      + '</div>';

    html += '<div class="grid grid-kpi">'
      + kpi('fa-phone-volume', 'kc-blue', 'إجمالي المكالمات', total)
      + kpi('fa-face-smile', 'kc-green', 'مكالمات إيجابية', pos)
      + kpi('fa-face-angry', 'kc-amber', 'شكاوى / سلبية', neg.length)
      + kpi('fa-star', 'kc-violet', 'متوسط الجودة', avgScore != null ? avgScore + '/100' : '—')
      + '</div>';

    // sentiment trend mini-bars + AI recommendations + complaints + timeline
    html += '<div class="grid grid-split" style="margin-top:var(--s-4)">';
    html += '<div class="glass-panel"><div class="section-head" style="margin-bottom:var(--s-3)"><h3 style="font-size:1rem"><span class="sh-ic"><i class="fas fa-chart-simple"></i></span> اتجاه المشاعر</h3></div>'
      + sentimentTrend(calls) + '</div>';
    html += '<div class="glass-panel"><div class="section-head" style="margin-bottom:var(--s-3)"><h3 style="font-size:1rem"><span class="sh-ic"><i class="fas fa-robot"></i></span> توصيات الذكاء الاصطناعي</h3></div>'
      + aiRecommendations(cust, calls, neg.length, total) + '</div>';
    html += '</div>';

    // call history timeline
    html += '<div class="glass-panel" style="margin-top:var(--s-4)"><div class="section-head" style="margin-bottom:var(--s-3)"><h3 style="font-size:1rem"><span class="sh-ic"><i class="fas fa-timeline"></i></span> سجل المكالمات</h3></div>';
    if (!calls.length) html += App.emptyState('fa-phone-slash', 'لا توجد مكالمات', 'لم يجرِ هذا العميل أي مكالمات بعد.');
    else {
      html += '<div class="timeline">' + calls.map(function (c) {
        var sc = App.sentimentClass(c.sentiment);
        var node = sc === 'negative' ? 'fi-red' : sc === 'positive' ? 'fi-green' : 'fi-blue';
        return '<div class="tl-item"><div class="tl-rail"><span class="tl-node ' + node + '"><i class="fas fa-phone"></i></span><span class="tl-track"></span></div>'
          + '<div class="tl-card row-click" onclick="App.openCallDetail(\'' + c.call_id + '\')">'
          + '<div class="tl-card-head"><div class="tl-actor"><b>' + App.escapeHtml((c.users && c.users.full_name) || 'وكيل') + '</b></div><span class="tl-when">' + App.fmtDateTime(c.call_start) + '</span></div>'
          + '<div class="tl-meta">' + App.sentimentBadge(c.sentiment) + App.scorePill(App.scoreOf(c)) + '<span class="tl-resource">' + App.escapeHtml(c.issues_category || c.call_type || '') + '</span></div>'
          + (c.summary ? '<p style="margin-top:8px;font-size:.84rem;color:var(--muted)">' + App.escapeHtml(c.summary) + '</p>' : '')
          + '</div></div>';
      }).join('') + '</div>';
    }
    html += '</div>';

    document.getElementById('view-customer360').innerHTML = html;
    App.switchView('view-customer360');
  };
  function kpi(icon, cls, label, value) {
    return '<div class="kpi-card ' + cls + '"><div class="kpi-top"><div><div class="kpi-label">' + label + '</div><div class="kpi-value" style="font-size:1.9rem">' + value + '</div></div><div class="kpi-ic"><i class="fas ' + icon + '"></i></div></div></div>';
  }
  function sentimentTrend(calls) {
    if (!calls.length) return '<div class="cd-empty">لا توجد بيانات</div>';
    var recent = calls.slice(0, 10).reverse();
    var bars = recent.map(function (c) {
      var sc = App.sentimentClass(c.sentiment);
      var h = sc === 'positive' ? 100 : sc === 'neutral' ? 55 : 28;
      var color = sc === 'positive' ? 'var(--success)' : sc === 'neutral' ? 'var(--warning)' : 'var(--danger)';
      return '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:6px">'
        + '<div style="width:100%;height:' + h + '%;min-height:6px;border-radius:6px 6px 0 0;background:' + color + ';transform-origin:bottom;animation:barGrow .5s var(--ease) both"></div></div>';
    }).join('');
    return '<div style="display:flex;align-items:flex-end;gap:8px;height:140px">' + bars + '</div>'
      + '<div class="muted" style="font-size:.76rem;text-align:center;margin-top:8px">آخر ' + recent.length + ' مكالمات (من الأقدم للأحدث)</div>';
  }
  function aiRecommendations(cust, calls, neg, total) {
    var recs = [];
    if (total === 0) recs.push(['fa-circle-info', 'لا توجد بيانات كافية لتحليل هذا العميل بعد.']);
    else {
      var negRatio = neg / total;
      if (negRatio >= 0.5) recs.push(['fa-triangle-exclamation', 'عميل عالي الخطورة — أكثر من نصف مكالماته سلبية. يُنصح بتصعيده لمشرف أول ومتابعة شخصية.']);
      else if (negRatio >= 0.25) recs.push(['fa-circle-exclamation', 'مؤشرات استياء متكررة. راجع آخر الشكاوى وتواصل بشكل استباقي.']);
      else recs.push(['fa-face-smile', 'عميل مستقر إجمالًا. حافظ على جودة الخدمة الحالية.']);
      if (calls[0]) recs.push(['fa-clock', 'آخر تواصل كان ' + App.timeAgo(new Date(calls[0].call_start).getTime()) + '. فكّر بمكالمة متابعة.']);
      var scores = calls.map(App.scoreOf).filter(function (s) { return s != null; });
      if (scores.length && (scores.reduce(function (a, b) { return a + b; }, 0) / scores.length) < 60) recs.push(['fa-graduation-cap', 'متوسط جودة الخدمة المقدّمة لهذا العميل منخفض — راجع أداء الوكلاء المسؤولين.']);
    }
    return recs.map(function (r) {
      return '<div class="cd-insight"><b><i class="fas ' + r[0] + '" style="color:var(--primary)"></i> </b>' + App.escapeHtml(r[1]) + '</div>';
    }).join('');
  }

  /* ════════════ Call detail modal ════════════ */
  App.openCallDetail = function (callId) {
    var modal = document.getElementById('callModal'), content = document.getElementById('callDetailContent');
    currentCallShortId = (callId || '').split('-')[0] || 'call';
    content.innerHTML = '<div class="cd-empty"><span class="spinner"></span> جارٍ التحميل…</div>';
    modal.classList.add('active');
    App.authFetch('/calls/' + callId).then(function (data) { renderCallDetail(data.call); })
      .catch(function (e) { content.innerHTML = '<div class="cd-empty" style="color:var(--danger)">تعذّر تحميل التفاصيل: ' + App.escapeHtml(e.message) + '</div>'; });
  };
  App.closeCallDetail = function () { document.getElementById('callModal').classList.remove('active'); };

  function cdScore(label, val) {
    if (val == null) return '';
    var k = App.scoreColor(val);
    var w = Math.max(0, Math.min(100, Number(val) || 0));
    return '<div class="cd-score"><b style="color:' + k.c + '">' + val + '</b><span>' + label + '</span><span class="cd-score-bar"><i style="width:' + w + '%;background:' + k.c + '"></i></span></div>';
  }
  // Prominent "what actually happened" block: resolution status + evidence +
  // follow-up commitment + outcome, so the saved report clearly reflects it.
  function resolutionBlock(a) {
    var status = (a.resolution_status || '').trim(), solved = (a.problem_solved || '').trim();
    var outcome = (a.call_outcome || '').trim(), evidence = (a.resolution_evidence || '').trim();
    var followUp = (a.follow_up_commitment || '').trim();
    if (!status && !solved && !outcome) return '';
    var badge = function (val, cls) { return '<span class="badge ' + cls + '">' + App.escapeHtml(val) + '</span>'; };
    var statusCls = status === 'تم الحل' ? 'pos' : status === 'لم يتم الحل' ? 'neg' : (!status || status === 'غير واضح') ? 'info' : 'warn';
    var solvedCls = solved === 'نعم' ? 'pos' : solved === 'لا' ? 'neg' : 'warn';
    var outcomeCls = outcome === 'ناجحة' ? 'pos' : outcome === 'تصعيد مطلوب' ? 'neg' : 'warn';
    var chips = (status ? badge(status, statusCls) : '') + (solved ? badge('تم الحل؟ ' + solved, solvedCls) : '') + (outcome ? badge(outcome, outcomeCls) : '');
    var out = '<div class="cd-insight" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><b>حالة الحل:</b> ' + chips + '</div>';
    if (evidence) out += '<div class="cd-insight"><b>🧾 الدليل من المكالمة:</b> ' + App.escapeHtml(evidence) + '</div>';
    if (followUp && followUp !== 'لا يوجد') out += '<div class="cd-insight"><b>📅 التزام المتابعة:</b> ' + App.escapeHtml(followUp) + '</div>';
    return out;
  }
  function analysisInsights(analysis) {
    if (!analysis || typeof analysis !== 'object') return '';
    // Single-value fields → clean labeled rows.
    var textLabels = { issue_category: '🏷️ تصنيف المشكلة', customer_issue: '❗ مشكلة العميل', root_cause: '🔎 السبب الجذري', resolution_provided: '🛠️ الحل المقدّم' };
    var textRows = Object.keys(textLabels).filter(function (k) { return analysis[k] != null && String(analysis[k]).trim(); })
      .map(function (k) { return '<div class="cd-insight"><b>' + textLabels[k] + ':</b> ' + App.escapeHtml(String(analysis[k])) + '</div>'; }).join('');
    // List fields → color-coded panels (strengths / weaknesses / …).
    var panel = function (kind, title, arr) {
      if (!Array.isArray(arr) || !arr.length) return '';
      return '<div class="cd-panel ' + kind + '"><div class="cd-panel-h">' + title + '</div><ul>' + arr.map(function (x) { return '<li>' + App.escapeHtml(String(x)) + '</li>'; }).join('') + '</ul></div>';
    };
    var panels = panel('good', '💪 نقاط القوة', analysis.strengths) + panel('bad', '⚠️ نقاط الضعف', analysis.weaknesses)
      + panel('warn', '🎯 فرص ضائعة', analysis.missed_opportunities) + panel('info', '➡️ الخطوات التالية', analysis.next_steps)
      + panel('info', '📌 توصيات للمشرف', analysis.recommended_actions) + panel('bad', '🔥 لحظات حرجة', analysis.critical_moments);
    var head = resolutionBlock(analysis);
    var grid = panels ? '<div class="cd-panels">' + panels + '</div>' : '';
    if (!textRows && !head && !grid) return '';
    return '<div class="cd-section"><h4><i class="fas fa-robot"></i> تحليل الذكاء الاصطناعي</h4>' + head + textRows + grid + '</div>';
  }
  function renderCallDetail(call) {
    currentCall = call;
    var ps = Array.isArray(call.performance_scores) ? call.performance_scores[0] : call.performance_scores;
    var agent = call.users || {}, cust = call.customers || {}, tx = call.transcripts || [];
    var scoresHtml = ps ? [cdScore('الإجمالي', ps.total_score), cdScore('رضا العميل', ps.customer_satisfaction_score), cdScore('الالتزام بالنص', ps.script_compliance), cdScore('التعاطف', ps.empathy_score), cdScore('حل المشكلة', ps.resolution_score)].join('') : '';
    var txHtml = tx.length
      ? '<div class="cd-transcript">' + tx.map(function (t) { return '<div class="tx-line"><span class="tx-time">' + App.escapeHtml(t.timestamp || '') + '</span><span class="tx-speaker">' + App.escapeHtml(t.speaker || '—') + '</span><span class="tx-text">' + App.escapeHtml(t.text || '') + '</span></div>'; }).join('') + '</div>'
      : '<div class="cd-empty">لا يوجد تفريغ محفوظ لهذه المكالمة</div>';
    document.getElementById('callDetailContent').innerHTML =
      '<div class="cd-section"><h4><i class="fas fa-circle-info"></i> بيانات المكالمة</h4><div class="cd-grid">'
      + cdBox('التاريخ والوقت', App.fmtDateTime(call.call_start)) + cdBox('المدة', App.fmtDuration(App.callDurationSec(call)))
      + cdBox('النوع', App.escapeHtml(call.call_type || '—')) + cdBox('التصنيف', App.escapeHtml(call.issues_category || '—'))
      + cdBox('المشاعر', App.escapeHtml(call.sentiment || '—')) + '</div></div>'
      + '<div class="cd-section"><h4><i class="fas fa-users"></i> الأطراف المعنية</h4><div class="cd-grid">'
      + cdBox('الوكيل', App.escapeHtml(agent.full_name || '—')) + cdBox('بريد الوكيل', '<span dir="ltr">' + App.escapeHtml(agent.email || '—') + '</span>')
      + cdBox('العميل', App.escapeHtml(cust.name || '—')) + cdBox('هاتف العميل', '<span dir="ltr">' + App.escapeHtml(cust.phone_number || '—') + '</span>') + '</div></div>'
      + (scoresHtml ? '<div class="cd-section"><h4><i class="fas fa-chart-pie"></i> تقييم الأداء</h4><div class="cd-scores">' + scoresHtml + '</div></div>' : '')
      + (call.summary ? '<div class="cd-section"><h4><i class="fas fa-align-left"></i> ملخّص المكالمة</h4><div class="cd-summary">' + App.escapeHtml(call.summary) + '</div></div>' : '')
      + analysisInsights(call.analysis)
      + suggestionsSection(call.suggestions)
      + '<div class="cd-section" style="margin-bottom:0"><h4><i class="fas fa-comments"></i> التفريغ النصّي (' + tx.length + ')</h4>' + txHtml + '</div>';
  }
  function suggestionsSection(items) {
    if (!Array.isArray(items) || !items.length) return '';
    var rows = items.map(function (s) {
      var cls = s.priority === 'high' ? 'neg' : s.priority === 'low' ? 'pos' : 'warn';
      var lbl = s.priority === 'high' ? '⚠️ عالية' : s.priority === 'low' ? '💡 نصيحة' : 'توجيه';
      var cats = (s.problem_type ? '<span class="badge info" style="margin-inline-start:6px">' + App.escapeHtml(s.problem_type) + '</span>' : '')
        + (s.suggestion_type ? '<span class="badge" style="margin-inline-start:6px;background:rgba(14,165,233,.1);color:#0369A1">' + App.escapeHtml(s.suggestion_type) + '</span>' : '');
      return '<div class="cd-insight"><b><span class="badge ' + cls + '">' + lbl + '</span></b>' + cats + ' ' + App.escapeHtml(s.suggest_text) + '</div>';
    }).join('');
    return '<div class="cd-section"><h4><i class="fas fa-lightbulb"></i> اقتراحات المدرّب اللحظي (' + items.length + ')</h4>' + rows + '</div>';
  }
  function cdBox(label, value) { return '<div class="cd-box"><span>' + label + '</span><strong>' + value + '</strong></div>'; }

  App.downloadCallPdf = function () {
    var el = document.getElementById('callDetailContent');
    if (!el) return;
    if (!window.SCM || !SCM.printReport) { App.toast('مكتبة PDF غير متاحة', 'error'); return; }
    SCM.audit('GENERATE_REPORT', { call: currentCallShortId });
    if (currentCall && SCM.printCallReport) { SCM.printReport(null, { call: currentCall, shortId: currentCallShortId }); return; }
    SCM.printReport(el.innerHTML, {
      title: 'تقرير المكالمة', subtitle: 'CALL REPORT', filename: 'call_' + currentCallShortId + '_report.pdf',
      meta: [{ label: 'رقم المكالمة', value: currentCallShortId }, { label: 'تاريخ التصدير', value: new Date().toLocaleString('ar-EG') }],
    });
  };

  /* ════════════ CSV exports ════════════ */
  App.exportCallsCsv = function () {
    var typeAr = function (t) { return (window.SCMCharts && SCMCharts.CALL_TYPE_AR[t]) || t || ''; };
    var rows = [['الوكيل', 'العميل', 'رقم العميل', 'وقت البدء', 'النوع', 'التصنيف', 'المشاعر', 'التقييم']];
    App.state.calls.forEach(function (c) {
      rows.push([(c.users && c.users.full_name) || '', (c.customers && c.customers.name) || '', (c.customers && c.customers.phone_number) || '',
      c.call_start ? new Date(c.call_start).toLocaleString('ar-EG') : '', typeAr(c.call_type), c.issues_category || '', c.sentiment || '', App.scoreOf(c) != null ? App.scoreOf(c) : '']);
    });
    if (window.SCM) SCM.exportCSV('all-calls.csv', rows);
  };
  App.exportCustomersCsv = function () {
    var rows = [['الاسم', 'رقم الهاتف', 'البريد الإلكتروني']];
    App.state.customers.forEach(function (c) { rows.push([c.name || '', c.phone_number || '', c.email || '']); });
    if (window.SCM) SCM.exportCSV('customers.csv', rows);
  };

  /* ════════════ wiring ════════════ */
  document.addEventListener('DOMContentLoaded', function () {
    var cs = document.getElementById('callSearch'); if (cs) cs.addEventListener('input', renderCallsTable);
    document.querySelectorAll('#callSentChips .chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        document.querySelectorAll('#callSentChips .chip').forEach(function (c) { c.classList.remove('on'); });
        chip.classList.add('on'); callSent = chip.getAttribute('data-sent'); renderCallsTable();
      });
    });
    var cust = document.getElementById('customerSearch'); if (cust) cust.addEventListener('input', renderCustomersTable);
    var modal = document.getElementById('callModal'); if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) App.closeCallDetail(); });
  });
})();
