/* =====================================================================
   audit.js — Audit-log timeline for the Admin Control Center
   Modern vertical timeline with action/period filters + live search.
   ===================================================================== */
(function () {
  'use strict';
  var App = window.App;
  if (!App) return;

  var LABELS = {
    LOGIN: 'تسجيل دخول', LOGOUT: 'تسجيل خروج', CREATE_USER: 'إنشاء مستخدم', UPDATE_USER: 'تعديل مستخدم',
    DELETE_USER: 'حذف مستخدم', CREATE_CALL: 'إنشاء مكالمة', ASSIGN_SUPERVISOR: 'تعيين مشرف',
    ASSIGN_AGENT: 'تعيين موظف', GENERATE_REPORT: 'توليد تقرير',
  };
  var META = {
    DELETE_USER: { ic: 'fa-user-xmark', tone: 'fi-red' },
    CREATE_USER: { ic: 'fa-user-plus', tone: 'fi-green' },
    CREATE_CALL: { ic: 'fa-phone-volume', tone: 'fi-violet' },
    UPDATE_USER: { ic: 'fa-user-pen', tone: 'fi-amber' },
    ASSIGN_SUPERVISOR: { ic: 'fa-user-gear', tone: 'fi-violet' },
    ASSIGN_AGENT: { ic: 'fa-user-gear', tone: 'fi-violet' },
    LOGIN: { ic: 'fa-right-to-bracket', tone: 'fi-blue' },
    LOGOUT: { ic: 'fa-right-from-bracket', tone: 'fi-blue' },
    GENERATE_REPORT: { ic: 'fa-file-pdf', tone: 'fi-blue' },
  };
  function metaOf(a) { return META[a] || { ic: 'fa-circle-dot', tone: 'fi-blue' }; }

  function loadAuditLogs() {
    var box = document.getElementById('auditTimeline');
    if (box) box.innerHTML = '<div class="cd-empty"><span class="spinner"></span> جارٍ تحميل السجل…</div>';
    return App.authFetch('/audit-logs').then(function (d) { App.state.audit = d.logs || []; render(); })
      .catch(function (e) { if (box) box.innerHTML = '<div class="cd-empty" style="color:var(--danger)">تعذّر التحميل: ' + App.escapeHtml(e.message) + '</div>'; });
  }
  App.loadAuditLogs = loadAuditLogs;

  function filtered() {
    var action = (document.getElementById('auditAction') || {}).value || '';
    var period = (document.getElementById('auditPeriod') || {}).value || 'all';
    var term = ((document.getElementById('auditSearch') || {}).value || '').trim().toLowerCase();
    var cutoff = 0;
    if (period === 'today') { var d = new Date(); d.setHours(0, 0, 0, 0); cutoff = d.getTime(); }
    else if (period === '7') cutoff = Date.now() - 7 * 864e5;
    else if (period === '30') cutoff = Date.now() - 30 * 864e5;
    return App.state.audit.filter(function (l) {
      if (action && l.action !== action) return false;
      if (cutoff && new Date(l.created_at).getTime() < cutoff) return false;
      if (term) {
        var u = l.users || {};
        var hay = ((u.full_name || '') + ' ' + (u.email || '') + ' ' + (l.action || '') + ' ' + (LABELS[l.action] || '') + ' ' + (l.resource || '')).toLowerCase();
        if (hay.indexOf(term) < 0) return false;
      }
      return true;
    });
  }

  function render() {
    var box = document.getElementById('auditTimeline');
    if (!box) return;
    var rows = filtered();
    var count = document.getElementById('auditCount');
    if (count) count.textContent = 'عرض ' + rows.length + ' من ' + App.state.audit.length + ' حدث';
    if (!rows.length) { box.innerHTML = App.emptyState('fa-clipboard-list', 'لا توجد سجلات مطابقة', 'عدّل الفلاتر أو البحث لعرض الأحداث.'); return; }
    box.innerHTML = rows.map(function (l) {
      var u = l.users || {};
      var name = u.full_name || (l.user_id ? 'مستخدم محذوف' : 'النظام');
      var m = metaOf(l.action);
      return '<div class="tl-item"><div class="tl-rail"><span class="tl-node ' + m.tone + '"><i class="fas ' + m.ic + '"></i></span><span class="tl-track"></span></div>'
        + '<div class="tl-card"><div class="tl-card-head">'
        + '<div class="tl-actor"><span class="avatar sq-sm">' + App.escapeHtml(App.initials(name)) + '</span><div><b>' + App.escapeHtml(name) + '</b><small>' + App.escapeHtml(u.email || '') + '</small></div></div>'
        + '<span class="tl-when">' + App.fmtDateTime(l.created_at) + '</span></div>'
        + '<div class="tl-meta"><span class="badge ' + toneToBadge(m.tone) + '">' + App.escapeHtml(LABELS[l.action] || l.action || '—') + '</span>'
        + (l.resource ? '<span class="tl-resource"><i class="fas fa-cube"></i> ' + App.escapeHtml(l.resource) + '</span>' : '') + '</div>'
        + '</div></div>';
    }).join('');
  }
  function toneToBadge(tone) {
    return { 'fi-red': 'neg', 'fi-green': 'pos', 'fi-amber': 'warn', 'fi-violet': 'violet', 'fi-blue': 'info' }[tone] || 'info';
  }

  App.exportAuditCsv = function () {
    var rows = [['المستخدم', 'البريد', 'الإجراء', 'المورد', 'التاريخ']].concat(filtered().map(function (l) {
      var u = l.users || {};
      return [u.full_name || '', u.email || '', l.action || '', l.resource || '', App.fmtDateTime(l.created_at)];
    }));
    if (window.SCM) SCM.exportCSV('audit-logs.csv', rows);
  };

  document.addEventListener('DOMContentLoaded', function () {
    ['auditAction', 'auditPeriod'].forEach(function (id) { var el = document.getElementById(id); if (el) el.addEventListener('change', render); });
    var s = document.getElementById('auditSearch'); if (s) s.addEventListener('input', render);
    var r = document.getElementById('auditRefreshBtn'); if (r) r.addEventListener('click', loadAuditLogs);
  });
})();
