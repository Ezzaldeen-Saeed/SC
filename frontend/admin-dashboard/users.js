/* =====================================================================
   users.js — User management for the Admin Control Center
   Users table (search + role filter) · create / role / parent / delete ·
   organizational hierarchy tree · user profile drill-down (+ team view).
   ===================================================================== */
(function () {
  'use strict';
  var App = window.App;
  if (!App) return;
  var roleFilter = 'all';

  /* ════════════ Users table ════════════ */
  function parentRoleFor(role) { return role === 'agent' ? 'supervisor' : role === 'supervisor' ? 'manager' : null; }
  function managerOptionsHtml(selectedId, filterRole) {
    var list = filterRole ? App.state.users.filter(function (u) { return u.role === filterRole; }) : App.state.users;
    return '<option value="">— اختر المسؤول —</option>' + list.map(function (u) {
      return '<option value="' + u.user_id + '"' + (u.user_id === selectedId ? ' selected' : '') + '>' + App.escapeHtml(u.full_name || u.email) + '</option>';
    }).join('');
  }

  function applyUserFilter() {
    var term = ((document.getElementById('userSearch') || {}).value || '').trim().toLowerCase();
    var list = App.state.users.filter(function (u) {
      if (roleFilter !== 'all' && u.role !== roleFilter) return false;
      if (term && !((u.full_name || '').toLowerCase().indexOf(term) >= 0 || (u.email || '').toLowerCase().indexOf(term) >= 0)) return false;
      return true;
    });
    renderUsersTable(list);
  }
  App.applyUserFilter = applyUserFilter;
  App.renderUsersTable = function () { applyUserFilter(); };

  function renderUsersTable(arr) {
    var tbody = document.getElementById('usersTable');
    if (!tbody) return;
    if (!arr.length) { tbody.innerHTML = '<tr><td colspan="6">' + App.emptyState('fa-user-slash', 'لا يوجد مستخدمون', 'عدّل معايير البحث أو أضِف مستخدمًا جديدًا.') + '</td></tr>'; return; }
    tbody.innerHTML = arr.map(function (u) {
      var statusCls = u.is_active ? 'status-active' : 'status-inactive';
      var statusTxt = u.is_active ? 'نشط' : 'معطل';
      var parentCell = (u.role === 'admin' || u.role === 'manager')
        ? '<span class="muted" style="font-size:.82rem">— إدارة عليا</span>'
        : '<select class="mini-select manager-select" data-userid="' + u.user_id + '">' + managerOptionsHtml(u.parent_id, parentRoleFor(u.role)) + '</select>';
      return '<tr>'
        + '<td><div class="cell-name"><span class="avatar sq-sm">' + App.escapeHtml(App.initials(u.full_name)) + '</span><b>' + App.escapeHtml(u.full_name || '—') + '</b></div></td>'
        + '<td><span class="cell-sub">' + App.escapeHtml(u.email || '—') + '</span></td>'
        + '<td><select class="mini-select role-select" data-userid="' + u.user_id + '">'
        + roleOpt('admin', u.role) + roleOpt('manager', u.role) + roleOpt('supervisor', u.role) + roleOpt('agent', u.role) + '</select></td>'
        + '<td>' + parentCell + '</td>'
        + '<td><span class="status-badge ' + statusCls + '">' + statusTxt + '</span></td>'
        + '<td><div class="flex gap-8">'
        + '<button class="icon-action ia-view" onclick="App.openUserProfile(\'' + u.user_id + '\')" title="الملف"><i class="fas fa-eye"></i></button>'
        + '<button class="icon-action ia-del" data-delete="' + u.user_id + '" title="حذف"><i class="fas fa-trash-can"></i></button>'
        + '</div></td></tr>';
    }).join('');

    tbody.querySelectorAll('.role-select').forEach(function (sel) { sel.addEventListener('change', function () { updateRole(sel.dataset.userid, sel.value); }); });
    tbody.querySelectorAll('.manager-select').forEach(function (sel) { sel.addEventListener('change', function () { assignManager(sel.dataset.userid, sel.value); }); });
    tbody.querySelectorAll('[data-delete]').forEach(function (btn) { btn.addEventListener('click', function () { deleteUserById(btn.dataset.delete); }); });
  }
  function roleOpt(role, current) {
    var labels = { admin: 'أدمن', manager: 'مدير', supervisor: 'مشرف', agent: 'وكيل' };
    return '<option value="' + role + '"' + (current === role ? ' selected' : '') + '>' + labels[role] + '</option>';
  }

  function updateRole(id, role) {
    App.authFetch('/users/' + id + '/role', { method: 'PUT', body: JSON.stringify({ role: role }) })
      .then(function () { return App.loadOverview(); }).then(function () { App.toast('تم تغيير الدور بنجاح', 'success'); })
      .catch(function (e) { App.toast('فشل تحديث الدور: ' + e.message, 'error'); });
  }
  function assignManager(id, parentId) {
    App.authFetch('/users/' + id + '/parent', { method: 'PUT', body: JSON.stringify({ parent_id: parentId || null }) })
      .then(function () { return App.loadOverview(); }).then(function () { App.toast('تم تحديث المسؤول المباشر', 'success'); })
      .catch(function (e) { App.toast('فشل: ' + e.message, 'error'); });
  }
  function deleteUserById(id) {
    if (!confirm('⚠️ تأكيد حذف هذا المستخدم وبياناته نهائيًا؟')) return;
    App.authFetch('/users/' + id, { method: 'DELETE' })
      .then(function () { return App.loadOverview(); }).then(function () { App.toast('تم حذف المستخدم', 'success'); })
      .catch(function (e) { App.toast('فشل الحذف: ' + e.message, 'error'); });
  }

  /* role-chip filter wiring */
  document.addEventListener('DOMContentLoaded', function () {
    var search = document.getElementById('userSearch');
    if (search) search.addEventListener('input', applyUserFilter);
    document.querySelectorAll('#userRoleChips .chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        document.querySelectorAll('#userRoleChips .chip').forEach(function (c) { c.classList.remove('on'); });
        chip.classList.add('on'); roleFilter = chip.getAttribute('data-role'); applyUserFilter();
      });
    });
    var roleSel = document.getElementById('newRole');
    if (roleSel) roleSel.addEventListener('change', syncParentField);
    var createBtn = document.getElementById('createUserBtn');
    if (createBtn) createBtn.addEventListener('click', createNewUser);
    var modal = document.getElementById('userModal');
    if (modal) modal.addEventListener('click', function (e) { if (e.target === modal) App.closeUserModal(); });
    var treeRefresh = document.getElementById('treeRefreshBtn');
    if (treeRefresh) treeRefresh.addEventListener('click', function () { App.silentRefresh(); });
  });

  /* ════════════ Create user modal ════════════ */
  function syncParentField() {
    var pRole = parentRoleFor(document.getElementById('newRole').value);
    var wrap = document.getElementById('newManagerWrap'), sel = document.getElementById('newManager');
    if (!pRole) { wrap.style.display = 'none'; sel.innerHTML = ''; return; }
    wrap.style.display = 'flex';
    document.getElementById('newManagerLabel').textContent = pRole === 'manager' ? 'المدير المسؤول' : 'المشرف المسؤول';
    sel.innerHTML = managerOptionsHtml('', pRole);
  }
  App.openUserModal = function () { document.getElementById('userModal').classList.add('active'); syncParentField(); };
  App.closeUserModal = function () { document.getElementById('userModal').classList.remove('active'); };

  function createNewUser() {
    var payload = {
      full_name: val('newFullName'), username: val('newUsername'), email: val('newEmail'), phone: val('newPhone'),
      password: document.getElementById('newPassword').value, role: val('newRole'),
      is_active: val('newStatus') === 'true', parent_id: document.getElementById('newManager').value || null,
    };
    if (!payload.full_name || !payload.username || !payload.email || !payload.password) { App.toast('يرجى ملء الحقول الأساسية', 'error'); return; }
    if (payload.password.length < 6) { App.toast('كلمة المرور 6 أحرف على الأقل', 'error'); return; }
    App.authFetch('/users', { method: 'POST', body: JSON.stringify(payload) })
      .then(function () {
        ['newFullName', 'newUsername', 'newEmail', 'newPhone', 'newPassword'].forEach(function (id) { document.getElementById(id).value = ''; });
        App.closeUserModal();
        return App.loadOverview();
      }).then(function () { App.toast('تم إنشاء المستخدم بنجاح', 'success'); })
      .catch(function (e) { App.toast('فشل الإنشاء: ' + e.message, 'error'); });
  }
  function val(id) { return (document.getElementById(id).value || '').trim(); }

  App.exportUsers = function () {
    var rows = [['الاسم', 'البريد', 'الدور', 'الحالة']];
    App.state.users.forEach(function (u) { rows.push([u.full_name || '', u.email || '', App.roleLabelAr(u.role), u.is_active ? 'نشط' : 'معطل']); });
    if (window.SCM) SCM.exportCSV('users.csv', rows);
  };

  /* ════════════ Organizational tree ════════════ */
  var ROLE_ICON = { admin: 'fa-user-shield', manager: 'fa-user-tie', supervisor: 'fa-user-gear', agent: 'fa-headset' };
  function buildOrgTree() {
    var box = document.getElementById('orgTree');
    if (!box) return;
    var users = App.state.users;
    if (!users.length) { box.innerHTML = App.emptyState('fa-sitemap', 'لا توجد بيانات للهيكل', 'أضِف مستخدمين لبناء الهيكل التنظيمي.'); return; }
    var ids = {}; users.forEach(function (u) { ids[u.user_id] = true; });
    var byParent = {};
    users.forEach(function (u) { var p = (u.parent_id && ids[u.parent_id]) ? u.parent_id : '__root__'; (byParent[p] = byParent[p] || []).push(u); });
    var order = { admin: 1, manager: 2, supervisor: 3, agent: 4 };

    function node(u, level) {
      var children = (byParent[u.user_id] || []).sort(function (a, b) { return order[a.role] - order[b.role]; });
      var count = children.length, has = count > 0;
      var collapsed = level >= 1 ? ' collapsed' : '';
      var toggle = has
        ? '<button class="org-toggle" onclick="event.stopPropagation();this.closest(\'.org-node\').classList.toggle(\'collapsed\')"><i class="fas fa-chevron-down"></i></button>'
        : '<span class="org-spacer"></span>';
      var childCount = has ? '<span class="badge info">' + count + ' تابع</span>' : '<span class="muted" style="font-size:.78rem">—</span>';
      var status = u.is_active ? '<span class="status-badge status-active">نشط</span>' : '<span class="status-badge status-inactive">معطل</span>';
      var html = '<div class="org-node' + collapsed + '">'
        + '<div class="org-row">'
        + toggle
        + '<span class="avatar sq-md" style="background:var(--grad-primary-soft)"><i class="fas ' + (ROLE_ICON[u.role] || 'fa-user') + '"></i></span>'
        + '<div class="org-main"><b>' + App.escapeHtml(u.full_name || (u.email || '').split('@')[0]) + '</b><small>' + App.escapeHtml(u.email) + '</small></div>'
        + '<span class="role-badge r-' + u.role + '">' + App.roleLabelAr(u.role).toUpperCase() + '</span>'
        + childCount + status
        + '<button class="icon-action ia-view" onclick="event.stopPropagation();App.openUserProfile(\'' + u.user_id + '\')" title="الملف"><i class="fas fa-eye"></i></button>'
        + '</div>';
      if (has) html += '<div class="org-children">' + children.map(function (c) { return node(c, level + 1); }).join('') + '</div>';
      return html + '</div>';
    }
    var roots = (byParent['__root__'] || []).sort(function (a, b) { return order[a.role] - order[b.role]; });
    box.innerHTML = roots.map(function (r) { return node(r, 0); }).join('');
  }
  App.buildOrgTree = buildOrgTree;

  /* ════════════ User profile drill-down ════════════ */
  App.openUserProfile = function (uid) {
    var local = App.state.users.filter(function (x) { return x.user_id === uid; })[0] || { user_id: uid };
    renderProfileShell(local, { user: local, parent: null, calls: [], stats: null, team: null }, true);
    App.switchView('view-profile');
    App.authFetch('/users/' + uid).then(function (detail) { renderProfileShell(detail.user, detail, false); })
      .catch(function (e) {
        var parent = local.parent_id ? App.state.users.filter(function (x) { return x.user_id === local.parent_id; })[0] : null;
        renderProfileShell(local, { user: local, parent: parent, calls: [], stats: null, team: null }, false);
        App.toast('تعذّر تحميل كل التفاصيل: ' + e.message, 'error');
      });
  };
  App.closeUserProfile = function () { App.switchView(App._prevView || 'view-users'); };

  function renderProfileShell(u, detail, loading) {
    var view = document.getElementById('view-profile');
    if (!view) return;
    u = u || {};
    var ini = App.initials(u.full_name || u.email);
    var statusHtml = u.is_active
      ? '<span style="color:var(--success);font-weight:700"><i class="fas fa-circle" style="font-size:.5rem;vertical-align:middle"></i> نشط</span>'
      : '<span style="color:var(--danger);font-weight:700"><i class="fas fa-circle" style="font-size:.5rem;vertical-align:middle"></i> معطّل</span>';
    var parent = detail.parent;
    var html = '<button class="btn btn-ghost btn-sm btn-back" onclick="App.closeUserProfile()"><i class="fas fa-arrow-right"></i> رجوع</button>'
      + '<div class="profile-hero">'
      + '<span class="avatar sq-lg">' + App.escapeHtml(ini) + '</span>'
      + '<div class="ph-info"><h2>' + App.escapeHtml(u.full_name || 'بدون اسم') + '</h2>'
      + '<p><i class="fas fa-envelope"></i> ' + App.escapeHtml(u.email || '—') + '</p>'
      + '<div style="margin-top:8px"><span class="role-badge r-' + (u.role || '') + '">' + App.roleLabelAr(u.role).toUpperCase() + '</span></div></div>'
      + '</div>'
      + '<div class="glass-panel"><div class="section-head" style="margin-bottom:var(--s-3)"><h3 style="font-size:1rem"><span class="sh-ic"><i class="fas fa-address-card"></i></span> البيانات الوظيفية</h3></div>'
      + '<div class="detail-grid">'
      + box('الدور الوظيفي', App.roleLabelAr(u.role))
      + box('اسم المستخدم', u.username || '—')
      + box('رقم الهاتف', u.phone || '—')
      + box('المسؤول المباشر', parent ? (App.escapeHtml(parent.full_name || parent.email) + ' (' + App.roleLabelAr(parent.role) + ')') : 'إدارة عليا')
      + box('حالة الحساب', statusHtml)
      + box('تاريخ الإنشاء', App.fmtDate(u.created_at))
      + box('آخر تسجيل دخول', u.last_login ? App.fmtDateTime(u.last_login) : 'لم يسجّل بعد')
      + '</div></div>';

    if (detail.team) html += teamHtml(u, detail.team);
    else html += agentHtml(u, detail, loading);

    view.innerHTML = html;
  }
  function box(label, value) { return '<div class="detail-box"><span>' + label + '</span><strong>' + value + '</strong></div>'; }

  function agentHtml(u, detail, loading) {
    var calls = detail.calls || [], stats = detail.stats;
    var show = (u.role === 'agent' || calls.length > 0);
    if (!show) return '';
    var kpis = '<div class="grid grid-kpi" style="margin-top:var(--s-4)">'
      + miniKpi('fa-headset', 'kc-blue', 'إجمالي المكالمات', stats ? stats.totalCalls : calls.length)
      + miniKpi('fa-star', 'kc-green', 'متوسط الأداء', (stats && stats.avgScore != null) ? stats.avgScore + ' / 100' : '—')
      + miniKpi('fa-stopwatch', 'kc-amber', 'متوسط المدة', (stats && stats.avgDurationSec) ? App.fmtDuration(stats.avgDurationSec) : '0 ث')
      + '</div>';
    var table;
    if (loading) table = '<div class="cd-empty"><span class="spinner"></span> جارٍ تحميل المكالمات…</div>';
    else if (!calls.length) table = App.emptyState('fa-phone-slash', 'لا توجد مكالمات', 'لم يُسجّل هذا الموظف أي مكالمات بعد.');
    else table = '<div class="table-wrap"><table class="data-table"><thead><tr><th>العميل</th><th>وقت البدء</th><th>المدة</th><th>التصنيف</th><th>المشاعر</th><th>التقييم</th></tr></thead><tbody>'
      + calls.map(function (c) {
        return '<tr class="row-click" onclick="App.openCallDetail(\'' + c.call_id + '\')">'
          + '<td><b>' + App.escapeHtml(c.customer_name || '—') + '</b></td>'
          + '<td>' + App.fmtDateTime(c.call_start) + '</td>'
          + '<td>' + App.fmtDuration(App.callDurationSec(c)) + '</td>'
          + '<td>' + App.escapeHtml(c.issues_category || c.call_type || '—') + '</td>'
          + '<td>' + App.sentimentBadge(c.sentiment) + '</td>'
          + '<td>' + App.scorePill(c.total_score) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return kpis + '<div class="glass-panel" style="margin-top:var(--s-4)"><div class="section-head" style="margin-bottom:var(--s-3)"><h3 style="font-size:1rem"><span class="sh-ic"><i class="fas fa-list"></i></span> سجل مكالمات الموظف</h3></div>' + table + '</div>';
  }
  function miniKpi(icon, cls, label, value) {
    return '<div class="kpi-card ' + cls + '"><div class="kpi-top"><div><div class="kpi-label">' + label + '</div><div class="kpi-value" style="font-size:1.8rem">' + value + '</div></div><div class="kpi-ic"><i class="fas ' + icon + '"></i></div></div></div>';
  }

  function teamHtml(u, team) {
    var isManager = team.role === 'manager', sum = team.summary || {};
    var kpis = '<div class="grid grid-kpi" style="margin-top:var(--s-4)">'
      + miniKpi('fa-medal', 'kc-green', 'متوسط تقييم الوحدة', sum.avgScore != null ? sum.avgScore + ' / 100' : '—')
      + miniKpi(isManager ? 'fa-user-tie' : 'fa-headset', 'kc-blue', isManager ? 'عدد المشرفين' : 'عدد الوكلاء', (team.members || []).length)
      + miniKpi('fa-phone-volume', 'kc-violet', 'إجمالي المكالمات', sum.callsCount || 0)
      + '</div>';
    var members = team.members || [];
    var table;
    if (!members.length) table = App.emptyState('fa-users', 'لا يوجد أعضاء', 'لا يوجد من يتبع هذا المستخدم بعد.');
    else table = '<div class="table-wrap"><table class="data-table"><thead><tr><th>' + (isManager ? 'المشرف' : 'الوكيل') + '</th>'
      + (isManager ? '<th>عدد الوكلاء</th>' : '') + '<th>عدد المكالمات</th><th>متوسط التقييم</th><th>الحالة</th></tr></thead><tbody>'
      + members.map(function (m) {
        return '<tr class="row-click" onclick="App.openUserProfile(\'' + m.user_id + '\')">'
          + '<td><div class="cell-name"><span class="avatar sq-sm">' + App.escapeHtml(App.initials(m.full_name)) + '</span><b>' + App.escapeHtml(m.full_name || m.email) + '</b></div></td>'
          + (isManager ? '<td>' + (m.agentsCount != null ? m.agentsCount : 0) + '</td>' : '')
          + '<td>' + (m.callsCount != null ? m.callsCount : 0) + '</td>'
          + '<td>' + App.scorePill(m.avgScore) + '</td>'
          + '<td>' + (m.is_active ? '<span class="status-badge status-active">نشط</span>' : '<span class="status-badge status-inactive">معطل</span>') + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    return kpis + '<div class="glass-panel" style="margin-top:var(--s-4)"><div class="section-head" style="margin-bottom:var(--s-3)"><h3 style="font-size:1rem"><span class="sh-ic"><i class="fas fa-ranking-star"></i></span> ' + (isManager ? 'تقييم المشرفين' : 'تقييم الوكلاء') + '</h3></div>' + table + '</div>';
  }
})();
