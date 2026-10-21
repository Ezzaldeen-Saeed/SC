/*
 * scm-ui.js — Shared UI layer for all SCM pages.
 * ───────────────────────────────────────────────
 * • Settings modal (Language AR/EN, Theme, Density, Notifications) — opened by
 *   a per-dashboard button via SCM.openSettings(). No floating icons.
 * • i18n engine: AR⇄EN dictionary applied to the live DOM (incl. dynamically
 *   rendered content via MutationObserver) with RTL/LTR direction switching.
 * • In-app notification center (fed by SSE /api/events) + toast popups.
 * • Command palette (Ctrl/⌘+K), CSV export, skeletons, count-up, mobile nav.
 * • Professional PDF report generator (Enterprise-ready) — enhanced with
 *   premium styling, SVG-like bar charts, cover page, and detailed sections.
 *
 * Each page includes:  <script src="../assets/scm-ui.js"></script>  (in <head>)
 * and adds a Settings button:  class="scm-settings-btn" onclick="SCM.openSettings()".
 *
 * Public API (window.SCM): notify, toast, theme, applyTheme, toggleTheme,
 * onThemeChange, lang, applyLang, t, openSettings, closeSettings,
 * density, applyDensity, countUp, exportCSV, skeletonRows, registerCommands,
 * openPalette, audit, printReport, printCallReport, callToReportModel.
 */
(function () {
  'use strict';

  var LS_THEME = 'scm_theme';
  var LS_NOTIFS = 'scm_notifs';
  var LS_LANG = 'scm_lang';
  var LS_DENSITY = 'scm_density';
  var ICON = { success: '✅', error: '⛔', warn: '⚠️', info: '🔔' };

  /* ════════════════ i18n ════════════════ */
  var T = {
    // sidebar / nav
    'نظرة عامة': 'Overview', 'إدارة المستخدمين': 'User Management', 'الهيكل التنظيمي': 'Org Chart',
    'سجل المكالمات': 'Call Log', 'العملاء': 'Customers', 'سجل التدقيق': 'Audit Logs',
    'فريقي وأداؤه': 'My Team', 'المكالمات والتقارير': 'Calls & Reports', 'عملائي': 'My Customers',
    'المشرفون التابعون': 'Supervisors', 'مكالمات الوحدة': 'Unit Calls', 'عملاء الوحدة': 'Unit Customers',
    'ملفي الشخصي': 'My Profile', 'تسجيل خروج': 'Logout', 'الإعدادات': 'Settings',
    'الرئيسية': 'Main', 'إدارة النظام': 'System', 'الصلاحيات والهيكلة': 'Access & Structure',
    'إدارة الوحدة': 'Unit Management', 'فريقي': 'My Team', 'التحليل اللحظي للمكالمات': 'Live Call Analysis',
    'الوضع الداكن': 'Dark Mode', 'الوضع الفاتح': 'Light Mode',
    // KPI cards
    '👥 إجمالي المستخدمين': '👥 Total Users', '📞 إجمالي المكالمات': '📞 Total Calls',
    '🟢 نشطون الآن': '🟢 Active Now', '🏢 قاعدة العملاء': '🏢 Customer Base',
    '👥 موظفو فريقي': '👥 My Team', '📞 إجمالي مكالماتهم': '📞 Their Total Calls',
    '⭐ متوسط أداء الفريق': '⭐ Avg. Team Score', '👔 المشرفون التابعون': '👔 Supervisors',
    '🎧 الموظفون بالوحدة': '🎧 Unit Agents', '📞 مكالمات الوحدة': '📞 Unit Calls',
    '⭐ متوسط أداء الوحدة': '⭐ Avg. Unit Score', '🎯 متوسط تقييم الأداء': '🎯 Avg. Performance',
    '⏱️ متوسط مدة المكالمة': '⏱️ Avg. Call Duration', '🎯 متوسط تقييم الوحدة': '🎯 Avg. Unit Score',
    '📞 إجمالي مكالمات الوحدة': '📞 Unit Total Calls',
    // table headers
    'الاسم': 'Name', 'البريد': 'Email', 'البريد الإلكتروني': 'Email', 'الدور': 'Role',
    'الدور الوظيفي': 'Role', 'المسؤول المباشر': 'Manager', 'الحالة': 'Status', 'إجراءات': 'Actions',
    'الإجراء': 'Action', 'الموظف والتسلسل': 'Employee & Hierarchy', 'عدد التابعين': 'Reports',
    'الوكيل': 'Agent', 'الموظف': 'Agent', 'العميل': 'Customer', 'اسم العميل': 'Customer Name',
    'رقم العميل': 'Customer No.', 'رقم الهاتف': 'Phone', 'التليفون': 'Phone', 'وقت البدء': 'Start Time',
    'المدة': 'Duration', 'النوع': 'Type', 'التصنيف': 'Category', 'المشاعر': 'Sentiment',
    'التقييم': 'Score', 'الملخّص': 'Summary', 'الموظف المسؤول': 'Handling Agent',
    'عدد المكالمات': 'Calls', 'عدد الوكلاء': 'Agents', 'المستخدم': 'User', 'المورد': 'Resource',
    'التاريخ والوقت': 'Date & Time', 'المشرف': 'Supervisor', 'متوسط التقييم': 'Avg. Score',
    'متوسط الأداء': 'Avg. Score', 'الموظفون': 'Agents', 'المكالمات': 'Calls', 'الملف': 'Profile',
    // section titles / headings
    'البيانات': 'Details', 'إعدادات الأمان': 'Security Settings', 'البيانات الوظيفية والشخصية': 'Profile Details',
    'أداء الموظف (KPIs)': 'Agent Performance (KPIs)', 'سجل مكالمات هذا الموظف': "This Agent's Calls",
    'إنشاء مستخدم جديد': 'Create New User', 'إضافة مشرف جديد (تحت إدارتك)': 'Add New Supervisor',
    'سجل التدقيق (Audit Logs)': 'Audit Logs',
    // buttons / actions
    'إضافة مستخدم جديد': 'Add New User', 'إضافة مشرف': 'Add Supervisor', 'تصدير': 'Export',
    'تحديث': 'Refresh', 'حفظ البيانات': 'Save Changes', 'تحديث كلمة المرور': 'Update Password',
    'إنشاء المشرف': 'Create Supervisor', 'حفظ المستخدم': 'Save User', 'إلغاء': 'Cancel',
    'حفظ المكالمة': 'Save Call', 'رجوع': 'Back', 'رجوع للنظام': 'Back to System',
    // status badges
    'نشط': 'Active', 'غير نشط': 'Inactive', 'معطل': 'Disabled', 'معطّل': 'Disabled',
    // filters / misc
    'فلترة حسب الموظف': 'Filter by agent', '— كل الموظفين —': '— All agents —', 'الفترة': 'Period',
    'كل الفترات': 'All time', 'اليوم': 'Today', 'آخر 7 أيام': 'Last 7 days', 'آخر 30 يوم': 'Last 30 days',
    '— كل الإجراءات —': '— All actions —', 'بحث': 'Search', 'تحميل...': 'Loading...', 'جاري التحميل...': 'Loading...',
    'لا توجد بيانات كافية لعرض الرسم': 'Not enough data to display',
    // ── Admin Control Center (2026 redesign) ──
    'مركز تحكم الأدمن': 'Admin Control Center', 'لوحة القيادة الذكية': 'Smart Dashboard',
    'مرحبًا بعودتك،': 'Welcome back,', 'إليك ملخّص أداء منظومة المكالمات في الوقت الحقيقي.': "Here's your real-time call operations summary.",
    'ملخّص الذكاء الاصطناعي': 'AI Summary', 'صحة النظام': 'System Health', 'مكالمات اليوم': 'Calls Today',
    'موظفون نشطون': 'Active Agents', 'مكالمات سلبية': 'Negative Calls',
    'إجمالي المستخدمين': 'Total Users', 'إجمالي المكالمات': 'Total Calls', 'نشطون الآن': 'Active Now',
    'قاعدة العملاء': 'Customer Base', 'آخر 30 يومًا': 'Last 30 days', 'من إجمالي المستخدمين': 'of total users',
    'عميل مُسجّل': 'registered customers', 'التحليلات المتقدمة': 'Advanced Analytics',
    'رؤى مرئية مبنية على بيانات المكالمات': 'Visual insights from call data', 'حجم المكالمات': 'Call Volume',
    'آخر 14 يومًا': 'Last 14 days', 'توزيع المشاعر': 'Sentiment Distribution', 'إيجابي · محايد · سلبي': 'Positive · Neutral · Negative',
    'أنواع المكالمات': 'Call Types', 'حسب التصنيف': 'By category', 'أعلى الموظفين أداءً': 'Top Performing Agents',
    'متوسط درجة الجودة': 'Average quality score', 'خريطة كثافة المكالمات': 'Call Density Heatmap', 'حسب اليوم والساعة': 'By day & hour',
    'المراقبة اللحظية': 'Live Monitoring', 'أحدث المكالمات': 'Latest calls', 'النشاط الحيّ': 'Live Activity',
    'أداء الفريق': 'Team Performance', 'الترتيب حسب متوسط الجودة': 'Ranked by average quality',
    'الأعلى أداءً': 'Top performers', 'بحاجة لمتابعة': 'Needs attention', 'التنبيهات الذكية': 'Smart Alerts',
    'توصيات مبنية على الذكاء الاصطناعي': 'AI-powered recommendations', 'مكالمة حيّة': 'live calls', 'إضافة مستخدم': 'Add User',
    'بحث شامل، تنقّل، أو إجراء…': 'Search, navigate, or run an action…', 'مركز الإشعارات': 'Notification Center',
    'النظام': 'System', 'الأمان': 'Security', 'تنبيهات AI': 'AI Alerts', 'المستخدمون': 'Users',
    'سجل المكالمات': 'Call Log', 'كل المكالمات المُحللة عبر المنظومة.': 'All analyzed calls across the platform.',
    'تصدير CSV': 'Export CSV', 'العملاء': 'Customers', 'قاعدة العملاء — اضغط على عميل لعرض ملف 360°.': 'Customer base — click a customer for a 360° view.',
    'إنشاء الحسابات، تعيين الأدوار والمسؤولين المباشرين.': 'Create accounts, assign roles and managers.',
    'تسلسل الإدارة — اضغط لتوسيع الفروع.': 'Management hierarchy — click to expand branches.',
    'خط زمني لكل الأحداث الحسّاسة في النظام.': 'A timeline of every sensitive system event.',
    'البيانات الوظيفية': 'Profile Details', 'سجل مكالمات الموظف': "Agent's Call Log", 'رجوع': 'Back',
    'إنشاء مستخدم جديد': 'Create New User', 'حفظ المستخدم': 'Save User', 'إلغاء': 'Cancel',
    'تفاصيل المكالمة والتحليل': 'Call Details & Analysis', 'تقرير PDF': 'PDF Report', 'ملفي الشخصي': 'My Profile',
    'حفظ البيانات': 'Save Changes', 'تحديث كلمة المرور': 'Update Password', 'تحديث': 'Refresh',
    'اتجاه المشاعر': 'Sentiment Trend', 'توصيات الذكاء الاصطناعي': 'AI Recommendations', 'سجل المكالمات ': 'Call History',
    'إجمالي المكالمات ': 'Total Calls', 'مكالمات إيجابية': 'Positive Calls', 'شكاوى / سلبية': 'Complaints', 'متوسط الجودة': 'Avg Quality',
    // ── Live Agent Console (2026 redesign) ──
    'كونسول الموظف اللحظي': 'Live Agent Console', 'بحث أو إجراء…': 'Search or run…',
    'مدة المكالمة': 'Call Duration', 'أسطر التفريغ': 'Transcript Lines', 'الصوت': 'Audio',
    'غير متصل': 'Offline', 'جارٍ الاتصال': 'Connecting', 'متصل · جاهز': 'Connected · Ready',
    'مكالمة مباشرة': 'Live Call', 'انتهت المكالمة': 'Call Ended',
    'مكالماتي اليوم': 'My Calls Today', 'منذ بداية اليوم': 'Since start of day',
    'إجمالي مكالماتي': 'My Total Calls', 'كل المكالمات المحفوظة': 'All saved calls',
    'متوسط أدائي': 'My Avg Score', 'من تقييم الذكاء الاصطناعي': 'From AI evaluation',
    'حالة الجلسة': 'Session Status', 'اضغط «بدء الاتصال» للبدء': 'Press “Start” to begin',
    'الكونسول غير متصل': 'Console is offline', 'اضغط «بدء الاتصال» لتشغيل التحليل اللحظي للمكالمات.': 'Press “Start” to launch live call analysis.',
    'جارٍ الاتصال بمحرك التحليل…': 'Connecting to the analysis engine…', 'يتم تهيئة محرك التفريغ والتحليل اللحظي.': 'Initializing the live transcription & analysis engine.',
    'جاهز لاستقبال المكالمات': 'Ready for calls', 'المحرك يعمل — ستبدأ المراقبة تلقائيًا فور بدء المكالمة.': 'Engine running — monitoring starts automatically when a call begins.',
    'مكالمة مباشرة الآن': 'Live call in progress', 'يتم تفريغ المكالمة وتحليلها لحظيًا لمساعدتك.': 'The call is being transcribed and analyzed in real time to assist you.',
    'انتهت المكالمة — جاهزة للحفظ': 'Call ended — ready to save', 'أدخل بيانات العميل ثم اضغط «حفظ المكالمة».': 'Enter the customer details, then press “Save Call”.',
    'بدء الاتصال': 'Start', 'قطع الاتصال': 'Disconnect',
    'تفريغ المكالمة': 'Call Transcript', 'المساعد اللحظي — مشاكل واقتراحات': 'Live Assistant — Issues & Suggestions',
    'في انتظار بدء المكالمة…': 'Waiting for the call to start…', 'سيظهر تفريغ الكلام هنا لحظيًا.': 'Speech transcript will appear here live.',
    'ستصلك نصائح لحظية أثناء المكالمة لمساعدتك.': 'Live tips will reach you during the call.',
    'بيانات المكالمة الحالية': 'Current Call', 'بيانات العميل': 'Customer Details',
    'أدخل اسم العميل ورقمه أثناء المكالمة — مطلوبة قبل الحفظ.': 'Enter the customer name & phone during the call — required before saving.',
    'اسم العميل': 'Customer Name', 'رقم هاتف العميل': 'Customer Phone', 'تفاصيل المكالمة وحفظها': 'Call Details & Save',
    'تُحفظ بيانات العميل تلقائيًا مع المكالمة في قاعدة البيانات.': 'Customer details are saved with the call automatically.',
    'نوع المكالمة': 'Call Type', 'تصنيف المشكلة': 'Issue Category', 'حفظ المكالمة': 'Save Call',
    'مكالماتي الأخيرة': 'My Recent Calls', 'تقرير ما بعد المكالمة': 'Post-Call Report', 'سجلات النظام': 'System Logs',
    'جارٍ تحميل مكالماتك…': 'Loading your calls…', 'الأمان': 'Security',
    // ── Manager console ──
    'لوحة المدير': 'Manager Dashboard', 'لوحة قيادة الوحدة': 'Unit Dashboard',
    'أداء وحدتك ومشرفيك في الوقت الحقيقي.': "Your unit & supervisors, in real time.", 'جارٍ تحليل بيانات الوحدة…': 'Analyzing unit data…',
    'صحة الوحدة': 'Unit Health', 'موظفو الوحدة': 'Unit Agents', 'رؤى مرئية لبيانات الوحدة': 'Visual insights from unit data',
    'أداء المشرفين': 'Supervisor Performance', 'متوسط الجودة لكل وحدة': 'Average quality per unit', 'ترتيب المشرفين': 'Supervisor Ranking',
    'إنشاء وإدارة مشرفي وحدتك.': 'Create and manage your supervisors.', 'كل مكالمات موظفي وحدتك.': "All your unit's calls.",
    'إضافة مشرف جديد': 'Add New Supervisor', 'حفظ المشرف': 'Save Supervisor', 'وكلاء المشرف': "Supervisor's Agents",
    // ── Supervisor console ──
    'لوحة المشرف': 'Supervisor Dashboard', 'لوحة قيادة الفريق': 'Team Dashboard',
    'أداء فريقك من الوكلاء في الوقت الحقيقي.': "Your agents' performance, in real time.", 'جارٍ تحليل بيانات الفريق…': 'Analyzing team data…',
    'صحة الفريق': 'Team Health', 'وكلاء نشطون': 'Active Agents', 'وكلاء فريقي': 'My Agents',
    'رؤى مرئية لبيانات الفريق': 'Visual insights from team data', 'مكالمات فريقي': "My Team's Calls",
    'أداء الوكلاء': 'Agent Performance', 'متوسط الجودة لكل وكيل': 'Average quality per agent', 'ترتيب الوكلاء': 'Agent Ranking',
    'حسب متوسط الجودة': 'By average quality', 'الوكلاء التابعون لك وتقييم أدائهم.': 'Your agents and their performance.',
    'كل مكالمات فريقك مع تقييماتها.': "All your team's calls with evaluations.", 'العملاء الذين تعامل معهم فريقك.': 'Customers your team handled.',
    'سجل مكالمات الوكيل': "Agent's Call Log", 'سجل مكالمات العميل': "Customer's Call Log",
    // ── Shared dashboard chrome ──
    'بحث، تنقّل، أو إجراء…': 'Search, navigate, or run…', 'الموظف المسؤول': 'Handling Agent', 'متوسط الأداء': 'Avg. Score',
    'الملخّص': 'Summary', 'وحدة': 'Unit',
  };

  var UI = {
    settings: { ar: 'الإعدادات', en: 'Settings' },
    language: { ar: 'اللغة', en: 'Language' },
    appearance: { ar: 'المظهر', en: 'Appearance' },
    theme: { ar: 'السمة', en: 'Theme' },
    light: { ar: 'فاتح', en: 'Light' },
    dark: { ar: 'داكن', en: 'Dark' },
    density: { ar: 'كثافة العرض', en: 'Density' },
    comfortable: { ar: 'مريحة', en: 'Comfortable' },
    compact: { ar: 'مدمجة', en: 'Compact' },
    notifications: { ar: 'الإشعارات', en: 'Notifications' },
    markRead: { ar: 'تعليم الكل كمقروء', en: 'Mark all read' },
    clearAll: { ar: 'مسح الكل', en: 'Clear all' },
    noNotifs: { ar: 'لا توجد إشعارات بعد', en: 'No notifications yet' },
    arabic: { ar: 'العربية', en: 'العربية' },
    english: { ar: 'English', en: 'English' },
    exported: { ar: 'تم تصدير الملف', en: 'File exported' },
    cmdPlaceholder: { ar: 'ابحث أو نفّذ أمرًا…', en: 'Search or run a command…' },
    cmdNoResults: { ar: 'لا توجد نتائج', en: 'No results' },
    cmdTab: { ar: 'تبويب', en: 'Tab' }, cmdAppearance: { ar: 'مظهر', en: 'Appearance' },
    cmdAccount: { ar: 'حساب', en: 'Account' }, cmdLogout: { ar: 'تسجيل الخروج', en: 'Logout' },
    cmdDark: { ar: 'الوضع الليلي', en: 'Dark mode' }, cmdLight: { ar: 'الوضع النهاري', en: 'Light mode' },
    cmdNav: { ar: '↑↓ تنقّل', en: '↑↓ navigate' }, cmdRun: { ar: 'Enter تنفيذ', en: 'Enter run' },
    cmdClose: { ar: 'Esc إغلاق', en: 'Esc close' },
    preparingPdf: { ar: 'جارٍ تجهيز ملف PDF…', en: 'Preparing PDF…' },
    pdfUnavailable: { ar: 'مكتبة PDF غير متاحة', en: 'PDF library unavailable' },
  };

  function currentLang() { return localStorage.getItem(LS_LANG) || 'ar'; }
  function t(k) { var l = currentLang(); return (UI[k] && (UI[k][l] || UI[k].en)) || k; }

  (function setDirEarly() {
    var l = currentLang(), e = document.documentElement;
    e.setAttribute('lang', l); e.setAttribute('dir', l === 'ar' ? 'rtl' : 'ltr');
  })();

  var origMap = new WeakMap();
  function inScmUi(node) {
    var el = node.parentElement;
    while (el) {
      if (el.nodeType === 1) {
        if (el.id && el.id.indexOf('scm-') === 0) return true;
        if (el.hasAttribute && el.hasAttribute('data-scm-noi18n')) return true;
        if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return true;
      }
      el = el.parentElement;
    }
    return false;
  }
  function translateTextNode(node, lang) {
    var raw = node.nodeValue; if (!raw || !raw.trim()) return;
    if (inScmUi(node)) return;
    if (lang === 'en') {
      var orig = origMap.has(node) ? origMap.get(node) : raw;
      var en = T[orig.trim()];
      if (en !== undefined) { if (!origMap.has(node)) origMap.set(node, raw); node.nodeValue = raw.replace(orig.trim(), en); }
    } else if (origMap.has(node)) {
      node.nodeValue = origMap.get(node); origMap.delete(node);
    }
  }
  function translateAttrs(el, lang) {
    if (!el.querySelectorAll) return;
    var list = [].slice.call(el.querySelectorAll('[placeholder],[title]'));
    if (el.nodeType === 1 && (el.hasAttribute('placeholder') || el.hasAttribute('title'))) list.push(el);
    list.forEach(function (n) {
      if (n.id && String(n.id).indexOf('scm-') === 0) return;
      ['placeholder', 'title'].forEach(function (attr) {
        if (!n.hasAttribute(attr)) return;
        var dk = 'i18n' + attr;
        if (lang === 'en') {
          var orig = n.dataset[dk] != null ? n.dataset[dk] : n.getAttribute(attr);
          var en = T[(orig || '').trim()];
          if (en !== undefined) { if (n.dataset[dk] == null) n.dataset[dk] = orig; n.setAttribute(attr, en); }
        } else if (n.dataset[dk] != null) { n.setAttribute(attr, n.dataset[dk]); delete n.dataset[dk]; }
      });
    });
  }
  function translateNode(root, lang) {
    if (!root) return;
    if (root.nodeType === 3) { translateTextNode(root, lang); return; }
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [], n; while ((n = walker.nextNode())) nodes.push(n);
    nodes.forEach(function (node) { translateTextNode(node, lang); });
    translateAttrs(root, lang);
  }
  function applyLang(lang) {
    lang = lang === 'en' ? 'en' : 'ar';
    localStorage.setItem(LS_LANG, lang);
    var e = document.documentElement; e.setAttribute('lang', lang); e.setAttribute('dir', lang === 'ar' ? 'rtl' : 'ltr');
    if (document.body) translateNode(document.body, lang);
    renderSettings();
    try { document.dispatchEvent(new CustomEvent('scm:langchange', { detail: lang })); } catch (e2) {}
  }
  var i18nObs = null;
  function startI18nObserver() {
    if (i18nObs || !document.body) return;
    i18nObs = new MutationObserver(function (muts) {
      if (currentLang() !== 'en') return;
      muts.forEach(function (m) {
        for (var i = 0; i < m.addedNodes.length; i++) {
          var nd = m.addedNodes[i];
          if (nd.nodeType === 1) translateNode(nd, 'en');
          else if (nd.nodeType === 3) translateTextNode(nd, 'en');
        }
      });
    });
    i18nObs.observe(document.body, { childList: true, subtree: true });
  }

  /* ════════════════ Theme ════════════════ */
  function theme() { return localStorage.getItem(LS_THEME) || 'light'; }
  var themeCbs = [];
  function onThemeChange(cb) { if (typeof cb === 'function') themeCbs.push(cb); }
  function applyTheme(tm) {
    document.documentElement.setAttribute('data-theme', tm);
    localStorage.setItem(LS_THEME, tm);
    renderSettings();
    themeCbs.forEach(function (fn) { try { fn(tm); } catch (e) {} });
    try { document.dispatchEvent(new CustomEvent('scm:themechange', { detail: tm })); } catch (e) {}
  }
  document.documentElement.setAttribute('data-theme', theme());
  function toggleTheme() { applyTheme(theme() === 'dark' ? 'light' : 'dark'); }
  function reduceMotion() { try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } }

  /* ════════════════ Density ════════════════ */
  function density() { return localStorage.getItem(LS_DENSITY) || 'comfortable'; }
  function applyDensity(d) {
    d = d === 'compact' ? 'compact' : 'comfortable';
    document.documentElement.setAttribute('data-density', d);
    localStorage.setItem(LS_DENSITY, d);
    renderSettings();
  }
  document.documentElement.setAttribute('data-density', density());

  /* ════════════════ Notifications store ════════════════ */
  function userKey() { try { return JSON.parse(localStorage.getItem('user') || '{}').user_id || 'anon'; } catch (e) { return 'anon'; } }
  function load() { try { return JSON.parse(localStorage.getItem(LS_NOTIFS) || '{}')[userKey()] || []; } catch (e) { return []; } }
  function save(list) { var all = {}; try { all = JSON.parse(localStorage.getItem(LS_NOTIFS) || '{}'); } catch (e) {} all[userKey()] = list.slice(0, 60); localStorage.setItem(LS_NOTIFS, JSON.stringify(all)); }
  var notifs = load();

  function notify(n) {
    n = n || {};
    notifs.unshift({ title: n.title || '', body: n.body || '', type: n.type || 'info', ts: Date.now(), read: false });
    save(notifs); renderList(); updateUnread();
    toast(n.title || n.body, n.type, n.body && n.title ? n.body : '');
  }
  function markAllRead() { notifs.forEach(function (x) { x.read = true; }); save(notifs); renderList(); updateUnread(); }
  function clearAll() { notifs = []; save(notifs); renderList(); updateUnread(); }
  function unread() { return notifs.filter(function (x) { return !x.read; }).length; }
  function updateUnread() { if (document.body) document.body.classList.toggle('scm-has-unread', unread() > 0); }

  /* ════════════════ Toast ════════════════ */
  function toast(title, type, body) {
    if (!title) return;
    var c = document.getElementById('scm-toasts');
    if (!c) { c = document.createElement('div'); c.id = 'scm-toasts'; document.body.appendChild(c); }
    var el = document.createElement('div');
    el.className = 'scm-toast scm-' + (type || 'info');
    el.innerHTML = '<i class="scm-ico">' + (ICON[type] || ICON.info) + '</i><div class="scm-toast-main"><div class="scm-toast-title">' + esc(title) + '</div>' + (body ? '<div class="scm-toast-body">' + esc(body) + '</div>' : '') + '</div>';
    c.appendChild(el);
    setTimeout(function () { el.classList.add('out'); setTimeout(function () { el.remove(); }, 320); }, 4200);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]; }); }
  function timeAgo(ts) {
    var s = Math.floor((Date.now() - ts) / 1000), en = currentLang() === 'en';
    if (s < 60) return en ? 'now' : 'الآن';
    var m = Math.floor(s / 60); if (m < 60) return en ? m + 'm ago' : 'منذ ' + m + ' د';
    var h = Math.floor(m / 60); if (h < 24) return en ? h + 'h ago' : 'منذ ' + h + ' س';
    return en ? Math.floor(h / 24) + 'd ago' : 'منذ ' + Math.floor(h / 24) + ' ي';
  }

  /* ════════════════ Settings modal ════════════════ */
  function injectSettings() {
    if (document.getElementById('scm-settings-bd')) return;
    var bd = document.createElement('div');
    bd.id = 'scm-settings-bd'; bd.className = 'scm-set-bd'; bd.setAttribute('data-scm-noi18n', '');
    bd.innerHTML = '<div id="scm-settings" class="scm-set" role="dialog" aria-modal="true"></div>';
    document.body.appendChild(bd);
    bd.addEventListener('click', function (e) { if (e.target === bd) closeSettings(); });
    renderSettings();
  }
  function seg(opts) {
    return '<div class="scm-seg">' + opts.items.map(function (it) {
      return '<button class="scm-seg-btn' + (it.val === opts.current ? ' on' : '') + '" data-act="' + opts.act + '" data-val="' + it.val + '">' + esc(it.label) + '</button>';
    }).join('') + '</div>';
  }
  function renderSettings() {
    var box = document.getElementById('scm-settings'); if (!box) return;
    box.innerHTML =
      '<div class="scm-set-head"><div class="scm-set-title"><i class="scm-ico">⚙️</i> ' + esc(t('settings')) + '</div>' +
        '<button class="scm-set-x" data-act="close" aria-label="close">✕</button></div>' +
      '<div class="scm-set-body">' +
        '<div class="scm-set-row"><div class="scm-set-label"><i class="scm-ico">🌐</i> ' + esc(t('language')) + '</div>' +
          seg({ act: 'lang', current: currentLang(), items: [{ val: 'ar', label: t('arabic') }, { val: 'en', label: t('english') }] }) + '</div>' +
        '<div class="scm-set-row"><div class="scm-set-label"><i class="scm-ico">🎨</i> ' + esc(t('theme')) + '</div>' +
          seg({ act: 'theme', current: theme(), items: [{ val: 'light', label: '☀️ ' + t('light') }, { val: 'dark', label: '🌙 ' + t('dark') }] }) + '</div>' +
        '<div class="scm-set-row"><div class="scm-set-label"><i class="scm-ico">📏</i> ' + esc(t('density')) + '</div>' +
          seg({ act: 'density', current: density(), items: [{ val: 'comfortable', label: t('comfortable') }, { val: 'compact', label: t('compact') }] }) + '</div>' +
        '<div class="scm-set-notifs"><div class="scm-set-nhead"><div class="scm-set-label"><i class="scm-ico">🔔</i> ' + esc(t('notifications')) + '</div>' +
          '<div class="scm-set-nact"><button data-act="read" title="' + esc(t('markRead')) + '">✓</button><button data-act="clear" title="' + esc(t('clearAll')) + '">🗑</button></div></div>' +
          '<div id="scm-set-notiflist" class="scm-list"></div></div>' +
      '</div>';
    box.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        var act = b.dataset.act, val = b.dataset.val;
        if (act === 'close') closeSettings();
        else if (act === 'lang') applyLang(val);
        else if (act === 'theme') applyTheme(val);
        else if (act === 'density') applyDensity(val);
        else if (act === 'read') markAllRead();
        else if (act === 'clear') clearAll();
      });
    });
    renderList();
  }
  function renderList() {
    var list = document.getElementById('scm-set-notiflist'); if (!list) return;
    if (!notifs.length) { list.innerHTML = '<div class="scm-empty"><div class="scm-empty-ic">🔔</div>' + esc(t('noNotifs')) + '</div>'; return; }
    list.innerHTML = notifs.map(function (x) {
      return '<div class="scm-item scm-' + x.type + (x.read ? '' : ' unread') + '"><span class="scm-dot"></span>' +
        '<div class="scm-item-main"><div class="scm-item-title">' + esc(x.title) + '</div>' +
        (x.body ? '<div class="scm-item-body">' + esc(x.body) + '</div>' : '') +
        '<div class="scm-item-time">' + esc(timeAgo(x.ts)) + '</div></div></div>';
    }).join('');
  }
  function openSettings() { injectSettings(); document.getElementById('scm-settings-bd').classList.add('open'); renderSettings(); setTimeout(markAllRead, 1500); }
  function closeSettings() { var bd = document.getElementById('scm-settings-bd'); if (bd) bd.classList.remove('open'); }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSettings(); });

  /* ════════════════ Live events (SSE) ════════════════ */
  var es = null, esRetry = 0, esTimer = null;
  function apiBase() { return (localStorage.getItem('api_base') || (location.protocol + '//' + location.hostname + ':3000')).replace(/\/+$/, ''); }
  function sessionToken() { try { return (JSON.parse(localStorage.getItem('session') || 'null') || {}).access_token || null; } catch (e) { return null; } }
  function tokenUsable(tok) {
    if (!tok) return false;
    var parts = tok.split('.'); if (parts.length !== 3) return false;
    try { var b = parts[1].replace(/-/g, '+').replace(/_/g, '/'); while (b.length % 4) b += '='; var p = JSON.parse(atob(b)); return !p.exp || p.exp * 1000 > Date.now(); }
    catch (e) { return true; }
  }
  function scheduleReconnect() {
    if (!tokenUsable(sessionToken())) return;
    var delay = Math.min(300000, 5000 * Math.pow(2, esRetry++));
    esTimer = setTimeout(connectEvents, delay);
  }
  function connectEvents() {
    if (esTimer) { clearTimeout(esTimer); esTimer = null; }
    if (es) { try { es.close(); } catch (e) {} es = null; }
    if (typeof EventSource === 'undefined') return;
    var token = sessionToken();
    if (!tokenUsable(token)) return;
    try {
      es = new EventSource(apiBase() + '/api/events?token=' + encodeURIComponent(token));
      es.onopen = function () { esRetry = 0; };
      es.onmessage = function (e) {
        try {
          var d = JSON.parse(e.data); if (!d) return;
          // Expose every event so dashboards can react (e.g. live-call updates).
          try { document.dispatchEvent(new CustomEvent('scm:event', { detail: d })); } catch (_) {}
          if (d.title && d.type !== 'connected') notify({ title: d.title, body: d.body, type: d.notifType });
        } catch (_) {}
      };
      es.onerror = function () { if (es) { try { es.close(); } catch (e) {} es = null; } scheduleReconnect(); };
    } catch (_) { scheduleReconnect(); }
  }

  /* ════════════════ Count-up animation ════════════════ */
  function countUp(el, finalText) {
    if (!el) return;
    finalText = String(finalText == null ? '' : finalText);
    var m = finalText.match(/-?\d[\d,]*\.?\d*/);
    if (!m || reduceMotion()) { el.textContent = finalText; return; }
    var target = parseFloat(m[0].replace(/,/g, ''));
    if (!isFinite(target)) { el.textContent = finalText; return; }
    var pre = finalText.slice(0, m.index), suf = finalText.slice(m.index + m[0].length);
    var isInt = m[0].indexOf('.') < 0, start = performance.now(), dur = 650;
    function step(now) {
      var p = Math.min(1, (now - start) / dur), eased = 0.5 - Math.cos(Math.PI * p) / 2, v = target * eased;
      el.textContent = pre + (isInt ? Math.round(v).toLocaleString('en-US') : v.toFixed(1)) + suf;
      if (p < 1) requestAnimationFrame(step); else el.textContent = finalText;
    }
    requestAnimationFrame(step);
  }

  /* ════════════════ CSV export ════════════════ */
  function exportCSV(filename, rows) {
    if (!rows || !rows.length) return;
    var csv = rows.map(function (r) { return r.map(function (c) { var s = String(c == null ? '' : c); return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(','); }).join('\r\n');
    var blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename || 'export.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
    toast(t('exported'), 'success');
  }

  /* ════════════════ Skeleton rows ════════════════ */
  function skeletonRows(cols, rows) {
    rows = rows || 5;
    var tds = ''; for (var i = 0; i < cols; i++) tds += '<td><span class="scm-skel"></span></td>';
    var out = ''; for (var r = 0; r < rows; r++) out += '<tr class="scm-skel-row">' + tds + '</tr>';
    return out;
  }

  /* ════════════════ Command palette (Ctrl/⌘+K) ════════════════ */
  var customCmds = [];
  function registerCommands(arr) { customCmds = arr || []; }
  var paletteItems = [], paletteIdx = 0;
  function gatherCommands() {
    var cmds = [];
    document.querySelectorAll('.nav-item').forEach(function (n) {
      var label = (n.querySelector('span') || n).textContent.trim();
      if (label) cmds.push({ label: label, hint: t('cmdTab'), icon: '📂', run: function () { n.click(); } });
    });
    cmds.push({ label: t('settings'), hint: t('cmdAppearance'), icon: '⚙️', run: openSettings });
    cmds.push({ label: theme() === 'dark' ? t('cmdLight') : t('cmdDark'), hint: t('cmdAppearance'), icon: '🌓', run: toggleTheme });
    customCmds.forEach(function (c) { cmds.push(c); });
    var lo = document.getElementById('logoutBtn') || document.getElementById('logout-btn') || document.getElementById('logoutBtnSide');
    if (lo) cmds.push({ label: t('cmdLogout'), hint: t('cmdAccount'), icon: '🚪', run: function () { lo.click(); } });
    return cmds;
  }
  function injectPalette() {
    if (document.getElementById('scm-cmdk')) return;
    var w = document.createElement('div'); w.id = 'scm-cmdk'; w.className = 'scm-cmdk'; w.setAttribute('data-scm-noi18n', '');
    w.innerHTML = '<div class="scm-cmdk-box" role="dialog"><input id="scm-cmdk-input" class="scm-cmdk-input" placeholder="' + esc(t('cmdPlaceholder')) + '" autocomplete="off"><div id="scm-cmdk-list" class="scm-cmdk-list" role="listbox"></div><div class="scm-cmdk-foot"><span>' + esc(t('cmdNav')) + '</span><span>' + esc(t('cmdRun')) + '</span><span>' + esc(t('cmdClose')) + '</span></div></div>';
    document.body.appendChild(w);
    w.addEventListener('click', function (e) { if (e.target === w) closePalette(); });
    var input = document.getElementById('scm-cmdk-input');
    input.addEventListener('input', function () { renderPalette(input.value); });
    input.addEventListener('keydown', paletteKeys);
  }
  function openPalette() { injectPalette(); document.getElementById('scm-cmdk').classList.add('open'); var input = document.getElementById('scm-cmdk-input'); input.value = ''; renderPalette(''); setTimeout(function () { input.focus(); }, 30); }
  function closePalette() { var w = document.getElementById('scm-cmdk'); if (w) w.classList.remove('open'); }
  function renderPalette(q) {
    q = (q || '').trim().toLowerCase();
    var all = gatherCommands();
    paletteItems = q ? all.filter(function (c) { return c.label.toLowerCase().indexOf(q) >= 0 || (c.hint || '').toLowerCase().indexOf(q) >= 0; }) : all;
    paletteIdx = 0;
    var list = document.getElementById('scm-cmdk-list');
    if (!paletteItems.length) { list.innerHTML = '<div class="scm-cmdk-empty">' + esc(t('cmdNoResults')) + '</div>'; return; }
    list.innerHTML = paletteItems.map(function (c, i) { return '<div class="scm-cmdk-item' + (i === 0 ? ' active' : '') + '" role="option" data-i="' + i + '"><span class="scm-cmdk-ic">' + (c.icon || '•') + '</span><span class="scm-cmdk-label">' + esc(c.label) + '</span><span class="scm-cmdk-hint">' + esc(c.hint || '') + '</span></div>'; }).join('');
    list.querySelectorAll('.scm-cmdk-item').forEach(function (el) {
      el.addEventListener('click', function () { runPalette(+el.dataset.i); });
      el.addEventListener('mousemove', function () { setActive(+el.dataset.i); });
    });
  }
  function setActive(i) { paletteIdx = i; var items = document.querySelectorAll('.scm-cmdk-item'); items.forEach(function (el, idx) { el.classList.toggle('active', idx === i); }); if (items[i]) items[i].scrollIntoView({ block: 'nearest' }); }
  function runPalette(i) { var c = paletteItems[i]; if (!c) return; closePalette(); try { c.run(); } catch (e) {} }
  function paletteKeys(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(paletteItems.length - 1, paletteIdx + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, paletteIdx - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); runPalette(paletteIdx); }
    else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
  }
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); var w = document.getElementById('scm-cmdk'); if (w && w.classList.contains('open')) closePalette(); else openPalette(); }
  });

  /* ════════════════ Mobile sidebar drawer ════════════════ */
  function injectMobileNav() {
    if (document.getElementById('scm-burger') || !document.querySelector('.sidebar')) return;
    if (document.querySelector('.sidebar-toggle, #sidebarToggle, [data-sidebar-toggle]')) return;
    var b = document.createElement('button');
    b.id = 'scm-burger'; b.className = 'scm-burger'; b.setAttribute('aria-label', 'menu');
    b.innerHTML = '<i class="fas fa-bars"></i>';
    b.addEventListener('click', function (e) { e.stopPropagation(); document.body.classList.toggle('scm-nav-open'); });
    document.body.appendChild(b);
    var bd = document.createElement('div'); bd.id = 'scm-nav-backdrop'; bd.className = 'scm-nav-backdrop';
    bd.addEventListener('click', function () { document.body.classList.remove('scm-nav-open'); });
    document.body.appendChild(bd);
    document.querySelectorAll('.nav-item').forEach(function (n) { n.addEventListener('click', function () { document.body.classList.remove('scm-nav-open'); }); });
  }

  /* ════════════════ Client audit beacon ════════════════ */
  function audit(action, details) {
    try {
      var session = JSON.parse(localStorage.getItem('session') || 'null');
      if (!session || !session.access_token) return;
      fetch(apiBase() + '/api/auth/audit', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.access_token }, body: JSON.stringify({ action: action, details: details || {} }) }).catch(function () {});
    } catch (e) {}
  }

  /* ════════════════ Styles ════════════════ */
  var css = [
    '.scm-ico{font-style:normal;line-height:1;}',
    /* settings button unread dot */
    '.scm-settings-btn{position:relative;}',
    'body.scm-has-unread .scm-settings-btn::after{content:"";position:absolute;top:6px;inset-inline-end:8px;width:9px;height:9px;border-radius:50%;background:#e11d48;border:2px solid rgba(255,255,255,.9);}',
    /* settings modal */
    '.scm-set-bd{position:fixed;inset:0;z-index:99700;display:none;align-items:center;justify-content:center;background:rgba(15,23,42,.6);backdrop-filter:blur(4px);padding:1rem;}',
    '.scm-set-bd.open{display:flex;}',
    '.scm-set{width:480px;max-width:94vw;max-height:90vh;overflow-y:auto;background:#fff;border:1px solid #e6ecf5;border-radius:20px;box-shadow:0 30px 70px rgba(15,23,42,.4);animation:scmPop .2s ease;}',
    'html[data-theme="dark"] .scm-set{background:#131d31;border-color:#25324a;color:#e6edf7;}',
    '.scm-set-head{display:flex;justify-content:space-between;align-items:center;padding:18px 20px;border-bottom:1px solid #e6ecf5;}',
    'html[data-theme="dark"] .scm-set-head{border-color:#25324a;}',
    '.scm-set-title{font-weight:800;font-size:1.1rem;display:flex;align-items:center;gap:10px;color:#1e2a3e;}',
    'html[data-theme="dark"] .scm-set-title{color:#e6edf7;}',
    '.scm-set-x{width:34px;height:34px;border:none;border-radius:50%;background:#f1f5f9;color:#64748b;cursor:pointer;font-size:.9rem;transition:.2s;}',
    '.scm-set-x:hover{background:#e11d48;color:#fff;transform:rotate(90deg);}',
    'html[data-theme="dark"] .scm-set-x{background:#1c2942;color:#9fb0c9;}',
    '.scm-set-body{padding:18px 20px;display:flex;flex-direction:column;gap:18px;}',
    '.scm-set-row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;}',
    '.scm-set-label{font-weight:700;font-size:.92rem;color:#1e2a3e;display:flex;align-items:center;gap:8px;}',
    'html[data-theme="dark"] .scm-set-label{color:#e6edf7;}',
    '.scm-seg{display:inline-flex;background:#f1f5f9;border-radius:12px;padding:4px;gap:4px;}',
    'html[data-theme="dark"] .scm-seg{background:#0f1a2e;}',
    '.scm-seg-btn{border:none;background:transparent;padding:7px 16px;border-radius:9px;cursor:pointer;font-family:inherit;font-weight:700;font-size:.85rem;color:#5b6e8c;transition:.18s;}',
    '.scm-seg-btn.on{background:#2563eb;color:#fff;box-shadow:0 3px 10px rgba(37,99,235,.3);}',
    'html[data-theme="dark"] .scm-seg-btn{color:#9fb0c9;}html[data-theme="dark"] .scm-seg-btn.on{background:#2563eb;color:#fff;}',
    '.scm-set-notifs{border-top:1px solid #e6ecf5;padding-top:14px;}',
    'html[data-theme="dark"] .scm-set-notifs{border-color:#25324a;}',
    '.scm-set-nhead{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;}',
    '.scm-set-nact{display:flex;gap:6px;}',
    '.scm-set-nact button{width:30px;height:30px;border:none;border-radius:9px;background:#eef2f8;color:#5b6e8c;cursor:pointer;transition:.15s;}',
    '.scm-set-nact button:hover{background:#2563eb;color:#fff;}',
    'html[data-theme="dark"] .scm-set-nact button{background:#1c2942;color:#9fb0c9;}',
    '.scm-list{max-height:240px;overflow-y:auto;}',
    '.scm-empty{text-align:center;color:#94a3b8;padding:30px 12px;font-size:.9rem;}',
    '.scm-empty-ic{font-size:2rem;opacity:.4;margin-bottom:8px;}',
    '.scm-item{display:flex;gap:11px;padding:11px;border-radius:13px;align-items:flex-start;}',
    '.scm-item:hover{background:#f6f9fe;}html[data-theme="dark"] .scm-item:hover{background:#1a2740;}',
    '.scm-item.unread{background:#eff5ff;}html[data-theme="dark"] .scm-item.unread{background:#16233a;}',
    '.scm-dot{flex:none;width:9px;height:9px;border-radius:50%;margin-top:5px;background:#94a3b8;}',
    '.scm-item.scm-success .scm-dot{background:#16a34a;}.scm-item.scm-error .scm-dot{background:#dc2626;}.scm-item.scm-warn .scm-dot{background:#d97706;}.scm-item.scm-info .scm-dot{background:#2563eb;}',
    '.scm-item-main{flex:1;min-width:0;}',
    '.scm-item-title{font-weight:700;font-size:.86rem;color:#1e2a3e;line-height:1.55;}html[data-theme="dark"] .scm-item-title{color:#e6edf7;}',
    '.scm-item-body{font-size:.78rem;color:#5b6e8c;margin-top:3px;line-height:1.6;}html[data-theme="dark"] .scm-item-body{color:#9fb0c9;}',
    '.scm-item-time{font-size:.68rem;color:#a3b1c6;margin-top:5px;}',
    '@keyframes scmPop{from{opacity:0;transform:translateY(-10px) scale(.98);}to{opacity:1;transform:none;}}',
    /* toasts */
    '#scm-toasts{position:fixed;bottom:22px;inset-inline-end:22px;z-index:99500;display:flex;flex-direction:column;gap:11px;max-width:370px;}',
    '.scm-toast{padding:13px 15px;border-radius:14px;background:#fff;display:flex;align-items:flex-start;gap:11px;box-shadow:0 14px 34px rgba(15,43,77,.22);border-inline-start:4px solid #2563eb;animation:scmIn .4s cubic-bezier(.34,1.4,.5,1);}',
    'html[data-theme="dark"] .scm-toast{background:#1b2942;box-shadow:0 14px 34px rgba(0,0,0,.55);}',
    '.scm-toast.out{opacity:0;transform:translateX(-24px);transition:all .32s;}',
    '.scm-toast>i{font-size:1.05rem;margin-top:1px;}',
    '.scm-toast-title{font-weight:800;font-size:.88rem;color:#1e2a3e;line-height:1.5;}html[data-theme="dark"] .scm-toast-title{color:#e6edf7;}',
    '.scm-toast-body{font-size:.78rem;color:#5b6e8c;margin-top:2px;}html[data-theme="dark"] .scm-toast-body{color:#9fb0c9;}',
    '.scm-toast.scm-success{border-inline-start-color:#16a34a;}.scm-toast.scm-error{border-inline-start-color:#dc2626;}.scm-toast.scm-warn{border-inline-start-color:#d97706;}',
    '@keyframes scmIn{from{opacity:0;transform:translateX(-34px);}to{opacity:1;transform:none;}}',
    /* command palette */
    '.scm-cmdk{position:fixed;inset:0;z-index:99800;display:none;align-items:flex-start;justify-content:center;background:rgba(15,23,42,.55);backdrop-filter:blur(4px);padding-top:12vh;}',
    '.scm-cmdk.open{display:flex;}',
    '.scm-cmdk-box{width:560px;max-width:92vw;background:#fff;border:1px solid #e6ecf5;border-radius:18px;box-shadow:0 30px 70px rgba(15,23,42,.4);overflow:hidden;animation:scmPop .18s ease;}',
    'html[data-theme="dark"] .scm-cmdk-box{background:#111c2e;border-color:#243044;}',
    '.scm-cmdk-input{width:100%;border:none;outline:none;padding:18px 20px;font-size:1.05rem;font-family:inherit;background:transparent;color:#1e293b;border-bottom:1px solid #e6ecf5;}',
    'html[data-theme="dark"] .scm-cmdk-input{color:#e6edf7;border-color:#243044;}',
    '.scm-cmdk-list{max-height:46vh;overflow-y:auto;padding:8px;}',
    '.scm-cmdk-item{display:flex;align-items:center;gap:12px;padding:11px 14px;border-radius:11px;cursor:pointer;}',
    '.scm-cmdk-item.active{background:#eff6ff;}html[data-theme="dark"] .scm-cmdk-item.active{background:rgba(37,99,235,.2);}',
    '.scm-cmdk-ic{width:24px;text-align:center;font-style:normal;}',
    '.scm-cmdk-label{flex:1;font-weight:700;font-size:.92rem;color:#1e293b;}html[data-theme="dark"] .scm-cmdk-label{color:#e6edf7;}',
    '.scm-cmdk-hint{font-size:.7rem;color:#64748b;background:#f1f5f9;padding:3px 9px;border-radius:20px;}html[data-theme="dark"] .scm-cmdk-hint{background:#0f1a2e;color:#9fb0c9;}',
    '.scm-cmdk-empty{padding:28px;text-align:center;color:#94a3b8;}',
    '.scm-cmdk-foot{display:flex;gap:16px;justify-content:flex-end;padding:10px 16px;border-top:1px solid #e6ecf5;font-size:.7rem;color:#94a3b8;}html[data-theme="dark"] .scm-cmdk-foot{border-color:#243044;}',
    /* skeletons */
    '.scm-skel{display:block;height:14px;width:100%;border-radius:7px;background:linear-gradient(90deg,#e6ecf5 25%,#f1f5f9 37%,#e6ecf5 63%);background-size:400% 100%;animation:scmShimmer 1.3s ease infinite;}',
    'html[data-theme="dark"] .scm-skel{background:linear-gradient(90deg,#1b2640 25%,#243044 37%,#1b2640 63%);background-size:400% 100%;}',
    '@keyframes scmShimmer{0%{background-position:100% 0;}100%{background-position:-100% 0;}}',
    /* density */
    /* Row height is driven through one variable rather than by setting th/td
       padding here: the sort button injected by scm-table.js owns the header
       cell's padding, so a rule that targeted `th` directly would stack on top
       of the button's own and make compact rows taller than comfortable ones. */
    'html[data-density="compact"] .data-table{--cell-y:8px;}',
    'html[data-density="compact"] .stat-card{padding:1rem 1.2rem;}',
    'html[data-density="compact"] .glass-panel{padding:1.3rem;}',
    /* mobile drawer */
    '.scm-burger{display:none;position:fixed;top:14px;inset-inline-end:14px;z-index:1300;width:44px;height:44px;border:none;border-radius:12px;background:#2563eb;color:#fff;font-size:1.1rem;cursor:pointer;box-shadow:0 8px 20px rgba(15,43,77,.25);align-items:center;justify-content:center;}',
    '.scm-nav-backdrop{position:fixed;inset:0;background:rgba(15,23,42,.5);opacity:0;visibility:hidden;transition:opacity .25s;z-index:1150;}',
    '@media (max-width:820px){ .scm-burger{display:flex;} body.scm-nav-open .scm-nav-backdrop{opacity:1;visibility:visible;} }',
    /* sidebar polish */
    '.nav-section-title{font-size:.64rem;font-weight:800;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,.42);padding:14px 14px 6px;user-select:none;}',
    '.sidebar.collapsed .nav-section-title{font-size:0;padding:10px 0;text-align:center;}',
    '.sidebar.collapsed .nav-section-title::after{content:"•";font-size:.7rem;color:rgba(255,255,255,.3);}',
    '.admin-avatar,.me-avatar,.agent-avatar{position:relative;}',
    '.admin-avatar::after,.me-avatar::after,.agent-avatar::after{content:"";position:absolute;bottom:-1px;inset-inline-end:-1px;width:11px;height:11px;border-radius:50%;background:#22c55e;border:2px solid rgba(255,255,255,.9);box-shadow:0 0 0 2px rgba(34,197,94,.3);}',
    '.scm-spin{width:18px;height:18px;border:3px solid #2563eb;border-top-color:transparent;border-radius:50%;display:inline-block;animation:scmSpin .8s linear infinite;}',
    '@keyframes scmSpin{to{transform:rotate(360deg);}}',
    '@media (prefers-reduced-motion: reduce){ .scm-skel{animation:none;} }',
  ].join('');
  var st = document.createElement('style'); st.textContent = css;
  (document.head || document.documentElement).appendChild(st);

  /* ════════════════ ENHANCED PDF REPORT GENERATOR ════════════════ */

  /* Professional A4 print stylesheet — produces a true vector, text-selectable
     PDF via the browser's native print engine (perfect Arabic shaping/bidi). */
  var PRINT_CSS = [
    '@page{size:A4;margin:13mm 10mm 15mm;}',
    '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact;}',
    'html,body{margin:0;padding:0;background:#fff;}',
    '#scm-doc{font-family:"Tajawal","Segoe UI","Tahoma",sans-serif;color:#0f172a;font-size:11px;line-height:1.6;}',
    /* running footer repeated on every printed page */
    '.rpt-foot{position:fixed;left:0;right:0;bottom:0;height:9mm;display:flex;align-items:center;justify-content:space-between;padding:0 4mm;font-size:8px;color:#94a3b8;border-top:1px solid #e2e8f0;background:#fff;}',
    '.rpt-foot b{color:#475569;font-weight:800;}',
    /* masthead */
    '.rpt-mast{position:relative;overflow:hidden;border-radius:14px;padding:20px 22px;color:#f8fafc;background:linear-gradient(135deg,#0b1220 0%,#12294a 55%,#1e3a8a 100%);break-inside:avoid;}',
    '.rpt-mast::after{content:"";position:absolute;inset:0;background:radial-gradient(circle at 88% -30%,rgba(59,130,246,.55),transparent 46%);}',
    '.rpt-mast .row{position:relative;z-index:1;display:flex;justify-content:space-between;align-items:flex-start;gap:16px;}',
    '.rpt-brand{display:flex;align-items:center;gap:11px;}',
    '.rpt-logo{width:44px;height:44px;border-radius:12px;background:linear-gradient(135deg,#3b82f6,#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:21px;box-shadow:0 6px 16px rgba(59,130,246,.4);}',
    '.rpt-brand .nm{font-size:15px;font-weight:800;letter-spacing:.3px;}',
    '.rpt-brand .sub{font-size:8px;color:#93c5fd;letter-spacing:2.5px;}',
    '.rpt-tag{display:inline-block;font-size:8px;font-weight:800;padding:4px 11px;border-radius:20px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.22);}',
    '.rpt-mast .ttl{position:relative;z-index:1;margin-top:14px;}',
    '.rpt-mast .ttl h1{margin:0;font-size:21px;font-weight:800;}',
    '.rpt-mast .ttl p{margin:3px 0 0;font-size:10px;color:#cbd5e1;}',
    '.rpt-metar{position:relative;z-index:1;display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:14px;padding-top:11px;border-top:1px solid rgba(255,255,255,.14);}',
    '.rpt-metar .m span{display:block;font-size:7px;color:#93a4bc;text-transform:uppercase;letter-spacing:1px;}',
    '.rpt-metar .m b{font-size:10.5px;color:#f1f5f9;font-weight:700;}',
    /* hero stat row */
    '.rpt-hero{display:grid;grid-template-columns:1.15fr 1fr 1fr 1fr;gap:9px;margin-top:11px;break-inside:avoid;}',
    '.rpt-stat{border:1px solid #e5e9f0;border-radius:12px;padding:11px 13px;background:#fff;box-shadow:0 1px 3px rgba(15,23,42,.05);display:flex;flex-direction:column;gap:5px;justify-content:center;}',
    '.rpt-stat .lab{font-size:8px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.6px;}',
    '.rpt-stat .val{font-size:17px;font-weight:800;line-height:1.1;color:#0f172a;}',
    '.rpt-stat .foot{font-size:8px;}',
    '.rpt-stat.score{align-items:center;text-align:center;background:linear-gradient(135deg,#eff6ff,#fff);border-color:#bfdbfe;gap:3px;}',
    '.rpt-stat.score .dl{font-size:8.5px;color:#475569;font-weight:800;}',
    /* sections */
    '.rpt-sec{margin-top:16px;}',
    '.rpt-h{display:flex;align-items:center;gap:8px;margin:0 0 9px;break-after:avoid;}',
    '.rpt-h .ic{width:23px;height:23px;border-radius:7px;background:#eff6ff;color:#2563eb;display:flex;align-items:center;justify-content:center;font-size:11px;flex-shrink:0;}',
    '.rpt-h h2{margin:0;font-size:13px;font-weight:800;color:#0f172a;}',
    '.rpt-h .ln{flex:1;height:1px;background:linear-gradient(270deg,#e2e8f0,transparent);}',
    'html[dir="ltr"] .rpt-h .ln{background:linear-gradient(90deg,#e2e8f0,transparent);}',
    /* info grid */
    '.rpt-grid{display:grid;gap:8px;}',
    '.g2{grid-template-columns:1fr 1fr;}.g3{grid-template-columns:1fr 1fr 1fr;}.g4{grid-template-columns:repeat(4,1fr);}.g5{grid-template-columns:repeat(5,1fr);}',
    '.rpt-cell{border:1px solid #e5e9f0;border-radius:10px;padding:9px 12px;background:#f8fafc;break-inside:avoid;}',
    '.rpt-cell .k{display:block;font-size:7.5px;color:#64748b;font-weight:800;text-transform:uppercase;letter-spacing:.5px;margin-bottom:3px;}',
    '.rpt-cell .v{font-size:11.5px;font-weight:700;color:#0f172a;}',
    /* score bars */
    '.rpt-bar{margin:0 0 9px;break-inside:avoid;}',
    '.rpt-bar:last-child{margin-bottom:0;}',
    '.rpt-bar .top{display:flex;justify-content:space-between;font-size:10px;font-weight:700;margin-bottom:3px;}',
    '.rpt-bar .top b{font-weight:800;}',
    '.rpt-bar .trk{height:8px;border-radius:6px;background:#eef2f7;overflow:hidden;display:flex;}',
    '.rpt-bar .fil{height:100%;border-radius:6px;}',
    /* two-column panels (strengths / weaknesses / lists) */
    '.rpt-sw{display:grid;grid-template-columns:1fr 1fr;gap:9px;}',
    '.rpt-panel{border:1px solid #e5e9f0;border-radius:12px;overflow:hidden;background:#fff;}',
    '.rpt-panel .ph{padding:7px 12px;font-size:10.5px;font-weight:800;display:flex;align-items:center;gap:6px;}',
    '.rpt-panel.good .ph{background:#ecfdf5;color:#047857;}',
    '.rpt-panel.bad .ph{background:#fef2f2;color:#b91c1c;}',
    '.rpt-panel.warn .ph{background:#fffbeb;color:#b45309;}',
    '.rpt-panel.info .ph{background:#eff6ff;color:#1d4ed8;}',
    '.rpt-panel ul{margin:0;padding:6px 12px;list-style:none;}',
    '.rpt-panel li{position:relative;padding:4px 14px 4px 0;font-size:10px;line-height:1.55;border-bottom:1px dashed #eef2f7;break-inside:avoid;}',
    'html[dir="ltr"] .rpt-panel li{padding:4px 0 4px 14px;}',
    '.rpt-panel li:last-child{border-bottom:0;}',
    '.rpt-panel li::before{content:"";position:absolute;top:8px;width:5px;height:5px;border-radius:50%;right:2px;}',
    'html[dir="ltr"] .rpt-panel li::before{right:auto;left:2px;}',
    '.rpt-panel.good li::before{background:#10b981;}.rpt-panel.bad li::before{background:#ef4444;}.rpt-panel.warn li::before{background:#f59e0b;}.rpt-panel.info li::before{background:#3b82f6;}',
    /* labeled analysis rows */
    '.rpt-kv{border:1px solid #e5e9f0;border-radius:10px;padding:8px 12px;margin:0 0 7px;background:#fff;font-size:10.5px;line-height:1.6;break-inside:avoid;}',
    '.rpt-kv:last-child{margin-bottom:0;}',
    '.rpt-kv b{color:#1e293b;font-weight:800;}',
    /* summary */
    '.rpt-summary{border:1px solid #e5e9f0;border-inline-start:3px solid #2563eb;border-radius:10px;padding:11px 14px;background:#f8fafc;font-size:11px;line-height:1.85;color:#1e293b;break-inside:avoid;}',
    /* badges */
    '.rpt-badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:8.5px;font-weight:800;}',
    '.b-pos{background:#dcfce7;color:#166534;}.b-neg{background:#fee2e2;color:#991b1b;}.b-warn{background:#fef9c3;color:#854d0e;}.b-info{background:#dbeafe;color:#1e40af;}',
    '.rpt-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-bottom:8px;}',
    /* coach suggestions */
    '.rpt-sug{border:1px solid #e5e9f0;border-radius:10px;padding:8px 12px;margin:0 0 6px;font-size:10px;background:#fff;display:flex;gap:8px;align-items:flex-start;break-inside:avoid;}',
    '.rpt-sug:last-child{margin-bottom:0;}',
    '.rpt-sug .pri{flex-shrink:0;}',
    '.rpt-sug .tx{flex:1;line-height:1.55;}',
    /* transcript */
    '.rpt-tx{border:1px solid #e5e9f0;border-radius:12px;overflow:hidden;}',
    '.rpt-tx .ln{display:flex;gap:9px;padding:6px 12px;font-size:9.5px;border-bottom:1px solid #f1f5f9;break-inside:avoid;}',
    '.rpt-tx .ln:nth-child(even){background:#f8fafc;}',
    '.rpt-tx .ln:last-child{border-bottom:0;}',
    '.rpt-tx .sp{flex-shrink:0;font-weight:800;color:#2563eb;min-width:60px;}',
    '.rpt-tx .tm{flex-shrink:0;color:#94a3b8;font-size:8px;min-width:40px;padding-top:1px;}',
    '.rpt-tx .tt{flex:1;color:#334155;line-height:1.55;}',
    '.rpt-empty{padding:13px;text-align:center;color:#94a3b8;font-size:10px;border:1px dashed #e2e8f0;border-radius:10px;}',
    '.rpt-note{font-size:9px;color:#94a3b8;margin-top:4px;}',
  ].join('');

  /* ════════════════ Report helpers ════════════════ */
  function clampScore(v) { v = Number(v); return isFinite(v) ? Math.max(0, Math.min(100, Math.round(v))) : null; }
  function scoreHue(v) { v = Number(v) || 0; return v >= 85 ? '#10b981' : v >= 70 ? '#22c55e' : v >= 50 ? '#f59e0b' : '#ef4444'; }
  function gradeFor(v) { v = Number(v); if (!isFinite(v)) return null; return v >= 90 ? 'A+' : v >= 85 ? 'A' : v >= 78 ? 'B+' : v >= 70 ? 'B' : v >= 60 ? 'C' : v >= 50 ? 'D' : 'E'; }
  function fmtDur(sec) { sec = Math.max(0, Number(sec) || 0); var m = Math.floor(sec / 60), s = sec % 60; return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s; }
  function asList(v) { return Array.isArray(v) ? v.filter(function (x) { return x != null && String(x).trim(); }).map(String) : (v && String(v).trim() ? [String(v)] : []); }
  function sentimentInfo(s) {
    var v = String(s || '').trim();
    if (/إيجاب|positive|راض|سعيد/i.test(v)) return { cls: 'b-pos', txt: v || 'إيجابي' };
    if (/سلب|غاضب|negative|محبط|إحباط/i.test(v)) return { cls: 'b-neg', txt: v || 'سلبي' };
    if (/محايد|neutral/i.test(v)) return { cls: 'b-info', txt: v || 'محايد' };
    return v ? { cls: 'b-warn', txt: v } : { cls: 'b-info', txt: '—' };
  }
  /* Vector SVG donut gauge — crisp at any zoom, no rasterization. */
  function scoreDonut(value) {
    var v = clampScore(value); if (v == null) v = 0;
    var r = 21, c = 2 * Math.PI * r, off = c * (1 - v / 100), col = scoreHue(v);
    return '<svg width="60" height="60" viewBox="0 0 60 60" role="img" aria-label="' + v + '%">' +
      '<circle cx="30" cy="30" r="' + r + '" fill="none" stroke="#eef2f7" stroke-width="7"/>' +
      '<circle cx="30" cy="30" r="' + r + '" fill="none" stroke="' + col + '" stroke-width="7" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 30 30)"/>' +
      '<text x="30" y="35" text-anchor="middle" font-size="16" font-weight="800" fill="#0f172a" font-family="Tajawal,Segoe UI,sans-serif">' + v + '</text>' +
    '</svg>';
  }

  /**
   * callToReportModel(call, opts) — normalizes a persisted call object (as
   * returned by GET /calls/:id) into a display-ready report model. Reads the
   * same fields the on-screen call-detail modal uses (see the call-analysis
   * data contract): performance_scores, analysis (jsonb), suggestions, transcripts.
   */
  function callToReportModel(call, opts) {
    call = call || {}; opts = opts || {};
    var ps = Array.isArray(call.performance_scores) ? call.performance_scores[0] : call.performance_scores;
    ps = ps || {};
    var a = call.analysis || {};
    var agent = call.users || {}, cust = call.customers || {};
    var tx = Array.isArray(call.transcripts) ? call.transcripts : [];

    var durSec = null;
    if (opts.durationSec != null) durSec = Number(opts.durationSec);
    else if (call.duration_seconds != null) durSec = Number(call.duration_seconds);
    else if (call.duration != null && !isNaN(Number(call.duration))) durSec = Number(call.duration);
    else if (call.call_start && call.call_end) durSec = Math.round((new Date(call.call_end) - new Date(call.call_start)) / 1000);

    // Performance metrics — include only those present, in a sensible order.
    var scoreDefs = [
      ['customer_satisfaction_score', 'رضا العميل'], ['script_compliance', 'الالتزام بالنص'],
      ['professionalism_score', 'الاحترافية'], ['communication_score', 'التواصل'],
      ['empathy_score', 'التعاطف'], ['problem_solving_score', 'حل المشكلات'],
      ['resolution_score', 'حل المشكلة']
    ];
    var scores = [];
    scoreDefs.forEach(function (d) { var val = clampScore(ps[d[0]]); if (val != null) scores.push({ lab: d[1], val: val }); });
    var overall = clampScore(ps.total_score);
    if (overall == null && scores.length) { var sum = 0; scores.forEach(function (s) { sum += s.val; }); overall = Math.round(sum / scores.length); }

    var status = (a.resolution_status || '').trim(), solved = (a.problem_solved || '').trim(), outcome = (a.call_outcome || '').trim();
    var resChips = [];
    if (status) resChips.push({ txt: status, cls: status === 'تم الحل' ? 'b-pos' : status === 'لم يتم الحل' ? 'b-neg' : 'b-info' });
    if (solved) resChips.push({ txt: 'تم الحل؟ ' + solved, cls: solved === 'نعم' ? 'b-pos' : solved === 'لا' ? 'b-neg' : 'b-warn' });
    if (outcome) resChips.push({ txt: outcome, cls: outcome === 'ناجحة' ? 'b-pos' : outcome === 'تصعيد مطلوب' ? 'b-neg' : 'b-warn' });

    var suggestions = (Array.isArray(call.suggestions) ? call.suggestions : []).map(function (s) {
      return {
        cls: s.priority === 'high' ? 'b-neg' : s.priority === 'low' ? 'b-pos' : 'b-warn',
        lbl: s.priority === 'high' ? 'عالية' : s.priority === 'low' ? 'نصيحة' : 'توجيه',
        cats: [s.problem_type, s.suggestion_type].filter(Boolean),
        text: s.suggest_text || ''
      };
    });

    return {
      shortId: opts.shortId || (String(call.id || '').split('-')[0]) || 'call',
      exportedBy: opts.exportedBy || '',
      callInfo: [
        { k: 'التاريخ والوقت', v: call.call_start ? new Date(call.call_start).toLocaleString('ar-EG') : '—' },
        { k: 'المدة', v: durSec != null ? fmtDur(durSec) : '—' },
        { k: 'النوع', v: call.call_type || '—' },
        { k: 'التصنيف', v: call.issues_category || a.issue_category || '—' }
      ],
      parties: [
        { k: 'الوكيل', v: agent.full_name || opts.agentName || '—' },
        { k: 'بريد الوكيل', v: agent.email || '—', ltr: true },
        { k: 'العميل', v: cust.name || '—' },
        { k: 'هاتف العميل', v: cust.phone_number || '—', ltr: true }
      ],
      sentiment: call.sentiment || '',
      overall: overall,
      grade: gradeFor(overall),
      scores: scores,
      satisfaction: clampScore(ps.customer_satisfaction_score),
      resolutionStatus: status || (solved === 'نعم' ? 'تم الحل' : (solved === 'لا' ? 'لم يتم الحل' : '')),
      resChips: resChips,
      evidence: (a.resolution_evidence || '').trim(),
      followUp: (a.follow_up_commitment || '').trim(),
      summary: call.summary || '',
      textAnalysis: [['customer_issue', '❗ مشكلة العميل'], ['root_cause', '🔎 السبب الجذري'], ['resolution_provided', '🛠️ الحل المقدّم']]
        .filter(function (d) { return a[d[0]]; }).map(function (d) { return { k: d[1], v: String(a[d[0]]) }; }),
      strengths: asList(a.strengths),
      weaknesses: asList(a.weaknesses),
      missedOpps: asList(a.missed_opportunities),
      recommendations: asList(a.recommended_actions),
      criticalMoments: asList(a.critical_moments),
      nextSteps: asList(a.next_steps),
      suggestions: suggestions,
      transcript: tx.map(function (t) { return { tm: t.timestamp || '', sp: t.speaker || '—', tt: t.text || '' }; })
    };
  }

  /**
   * buildCallReportHTML(model) — full print-ready HTML document for a call
   * report. Rendered by the browser's native print engine into a true vector,
   * text-selectable PDF (perfect Arabic shaping via the browser text engine).
   */
  function buildCallReportHTML(model) {
    var m = model || {};
    var lang = currentLang(), isRTL = (lang !== 'en');
    var dir = isRTL ? 'rtl' : 'ltr';
    var sInfo = sentimentInfo(m.sentiment);

    function cell(c) { return '<div class="rpt-cell"><span class="k">' + esc(c.k) + '</span><span class="v"' + (c.ltr ? ' dir="ltr"' : '') + '>' + esc(c.v) + '</span></div>'; }
    function panel(kind, icon, title, items) {
      if (!items || !items.length) return '';
      return '<div class="rpt-panel ' + kind + '"><div class="ph">' + icon + ' ' + esc(title) + '</div><ul>' +
        items.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    }
    function section(icon, title, body) {
      if (!body) return '';
      return '<div class="rpt-sec"><div class="rpt-h"><span class="ic">' + icon + '</span><h2>' + esc(title) + '</h2><span class="ln"></span></div>' + body + '</div>';
    }

    // ── Masthead ──
    var mast = '<div class="rpt-mast"><div class="row">' +
      '<div class="rpt-brand"><span class="rpt-logo">🎙️</span><div><div class="nm">مراقب المكالمات الذكي</div><div class="sub">SMART CALL MONITOR</div></div></div>' +
      '<span class="rpt-tag">تقرير سرّي · داخلي</span>' +
      '</div>' +
      '<div class="ttl"><h1>تقرير تحليل المكالمة</h1><p>تحليل مدعوم بالذكاء الاصطناعي · بطاقة أداء الوكيل</p></div>' +
      '<div class="rpt-metar">' +
        '<div class="m"><span>معرّف المكالمة</span><b>#' + esc(m.shortId) + '</b></div>' +
        '<div class="m"><span>تاريخ الإصدار</span><b>' + esc(new Date().toLocaleString('ar-EG')) + '</b></div>' +
        (m.exportedBy ? '<div class="m"><span>أصدره</span><b>' + esc(m.exportedBy) + '</b></div>' : '') +
      '</div></div>';

    // ── Hero stat row ──
    var heroScore = (m.overall != null)
      ? '<div class="rpt-stat score">' + scoreDonut(m.overall) + '<span class="dl">الأداء العام</span>' +
        (m.grade ? '<span class="rpt-badge ' + (m.overall >= 70 ? 'b-pos' : m.overall >= 50 ? 'b-warn' : 'b-neg') + '">تقدير ' + m.grade + '</span>' : '') + '</div>'
      : '<div class="rpt-stat score"><div class="val" style="font-size:22px;color:#94a3b8">—</div><span class="dl">لا يوجد تقييم أداء</span></div>';
    var hero = '<div class="rpt-hero">' + heroScore +
      '<div class="rpt-stat"><span class="lab">مشاعر العميل</span><span class="foot"><span class="rpt-badge ' + sInfo.cls + '" style="font-size:11px;padding:3px 12px">' + esc(sInfo.txt) + '</span></span></div>' +
      '<div class="rpt-stat"><span class="lab">حالة الحل</span><span class="val" style="font-size:13px">' + esc(m.resolutionStatus || '—') + '</span></div>' +
      '<div class="rpt-stat"><span class="lab">رضا العميل</span><span class="val">' + (m.satisfaction != null ? m.satisfaction + '<span style="font-size:11px;color:#94a3b8">%</span>' : '—') + '</span></div>' +
      '</div>';

    // ── Performance bars ──
    var scoresBody = m.scores && m.scores.length
      ? m.scores.map(function (s) { var col = scoreHue(s.val); return '<div class="rpt-bar"><div class="top"><span>' + esc(s.lab) + '</span><b style="color:' + col + '">' + s.val + '%</b></div><div class="trk"><div class="fil" style="width:' + s.val + '%;background:' + col + '"></div></div></div>'; }).join('')
      : '';

    // ── Resolution ──
    var resBody = '';
    if (m.resChips.length || m.evidence || m.followUp) {
      resBody = (m.resChips.length ? '<div class="rpt-chips">' + m.resChips.map(function (c) { return '<span class="rpt-badge ' + c.cls + '" style="font-size:9.5px;padding:3px 12px">' + esc(c.txt) + '</span>'; }).join('') + '</div>' : '') +
        (m.evidence ? '<div class="rpt-kv"><b>🧾 الدليل من المكالمة:</b> ' + esc(m.evidence) + '</div>' : '') +
        (m.followUp && m.followUp !== 'لا يوجد' ? '<div class="rpt-kv"><b>📅 التزام المتابعة:</b> ' + esc(m.followUp) + '</div>' : '');
    }

    // ── AI analysis ──
    var textRows = m.textAnalysis.map(function (r) { return '<div class="rpt-kv"><b>' + esc(r.k) + ':</b> ' + esc(r.v) + '</div>'; }).join('');
    var swTop = (m.strengths.length || m.weaknesses.length)
      ? '<div class="rpt-sw">' + panel('good', '💪', 'نقاط القوة', m.strengths) + panel('bad', '⚠️', 'نقاط الضعف', m.weaknesses) + '</div>' : '';
    var swBottom = (m.missedOpps.length || m.nextSteps.length)
      ? '<div class="rpt-sw" style="margin-top:9px">' + panel('warn', '🎯', 'فرص ضائعة', m.missedOpps) + panel('info', '➡️', 'الخطوات التالية', m.nextSteps) + '</div>' : '';
    var recPanel = m.recommendations.length ? '<div style="margin-top:9px">' + panel('info', '📌', 'توصيات للمشرف', m.recommendations) + '</div>' : '';
    var critPanel = m.criticalMoments.length ? '<div style="margin-top:9px">' + panel('bad', '🔥', 'لحظات حرجة', m.criticalMoments) + '</div>' : '';
    var aiBody = textRows + swTop + swBottom + recPanel + critPanel;

    // ── Coach suggestions ──
    var sugBody = m.suggestions && m.suggestions.length
      ? m.suggestions.map(function (s) { return '<div class="rpt-sug"><span class="pri rpt-badge ' + s.cls + '">' + esc(s.lbl) + '</span><span class="tx">' + (s.cats.length ? s.cats.map(function (c) { return '<span class="rpt-badge b-info" style="margin-inline-end:4px">' + esc(c) + '</span>'; }).join('') + ' ' : '') + esc(s.text) + '</span></div>'; }).join('')
      : '';

    // ── Transcript ──
    var txBody = m.transcript.length
      ? '<div class="rpt-tx">' + m.transcript.map(function (t) { return '<div class="ln">' + (t.tm ? '<span class="tm">' + esc(t.tm) + '</span>' : '') + '<span class="sp">' + esc(t.sp) + '</span><span class="tt">' + esc(t.tt) + '</span></div>'; }).join('') + '</div>'
      : '<div class="rpt-empty">لا يوجد تفريغ نصّي محفوظ لهذه المكالمة</div>';

    var body = mast + hero +
      section('ℹ️', 'بيانات المكالمة', '<div class="rpt-grid g4">' + m.callInfo.map(cell).join('') + '</div>') +
      section('👥', 'الأطراف المعنية', '<div class="rpt-grid g4">' + m.parties.map(cell).join('') + '</div>') +
      (scoresBody ? section('📊', 'تقييم الأداء', scoresBody) : '') +
      (resBody ? section('✅', 'حالة الحل والنتيجة', resBody) : '') +
      (m.summary ? section('📝', 'الملخّص التنفيذي', '<div class="rpt-summary">' + esc(m.summary) + '</div>') : '') +
      (aiBody ? section('🤖', 'تحليل الذكاء الاصطناعي', aiBody) : '') +
      (sugBody ? section('💡', 'اقتراحات المدرّب اللحظي', sugBody) : '') +
      section('💬', 'التفريغ النصّي (' + m.transcript.length + ')', txBody);

    var foot = '<div class="rpt-foot"><b>مراقب المكالمات الذكي · Smart Call Monitor</b><span>وثيقة سرّية — للاستخدام الداخلي فقط · ' + esc(new Date().toLocaleDateString('ar-EG')) + '</span></div>';

    return '<!DOCTYPE html><html dir="' + dir + '" lang="' + (isRTL ? 'ar' : 'en') + '">' +
      '<head><meta charset="UTF-8">' +
      '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap" rel="stylesheet">' +
      '<title>تقرير المكالمة #' + esc(m.shortId) + '</title>' +
      '<style>' + PRINT_CSS + '</style></head>' +
      '<body><div id="scm-doc">' + body + foot + '</div></body></html>';
  }

  /**
   * printDocument(htmlContent) — renders a complete HTML document in a hidden
   * iframe and triggers the browser's native print dialog ("Save as PDF"),
   * producing a true vector, text-selectable PDF with perfect Arabic shaping.
   * No external library required.
   */
  function printDocument(htmlContent) {
    var prev = document.getElementById('scm-print-iframe');
    if (prev) { try { prev.remove(); } catch (e) {} }

    var iframe = document.createElement('iframe');
    iframe.id = 'scm-print-iframe';
    iframe.setAttribute('data-scm-noi18n', '');
    iframe.setAttribute('aria-hidden', 'true');
    // Off-screen but with a real size so the print engine lays the document out.
    iframe.style.cssText = 'position:fixed;left:-10000px;top:0;width:820px;height:1160px;border:0;';
    document.body.appendChild(iframe);

    // Brief progress overlay while fonts/layout settle before the dialog opens.
    var ov = document.createElement('div');
    ov.setAttribute('data-scm-noi18n', '');
    ov.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:rgba(15,23,42,0.72);backdrop-filter:blur(4px);';
    ov.innerHTML = '<div style="background:#fff;color:#1e293b;padding:16px 24px;border-radius:14px;font-family:Tajawal,Segoe UI,sans-serif;font-weight:700;box-shadow:0 20px 50px rgba(0,0,0,0.3);display:flex;align-items:center;gap:12px;"><span class="scm-spin"></span>' + esc(t('preparingPdf')) + '</div>';
    document.body.appendChild(ov);

    var doc = iframe.contentWindow.document;
    doc.open(); doc.write(htmlContent); doc.close();

    var printed = false, cleaned = false;
    function cleanup() { if (cleaned) return; cleaned = true; try { ov.remove(); } catch (e) {} setTimeout(function () { try { iframe.remove(); } catch (e) {} }, 800); }
    function doPrint() {
      if (printed) return; printed = true;
      try { ov.remove(); } catch (e) {}
      try {
        var win = iframe.contentWindow;
        win.focus();
        win.onafterprint = cleanup;
        win.print();
      } catch (e) { console.error('print error:', e); toast(t('pdfUnavailable'), 'error'); cleanup(); return; }
      // Primary cleanup is onafterprint; this is only a long safety net so the
      // iframe is never torn down while the print dialog is still open.
      setTimeout(cleanup, 60000);
    }
    iframe.onload = function () {
      var win = iframe.contentWindow;
      if (win.document.fonts && win.document.fonts.ready) {
        win.document.fonts.ready.then(function () { setTimeout(doPrint, 250); }, function () { setTimeout(doPrint, 400); });
      } else { setTimeout(doPrint, 700); }
    };
    setTimeout(function () { if (!printed) doPrint(); }, 2500); // safety net
  }

  /**
   * printCallReport(model) — builds and prints a professional call report from
   * a normalized model (see callToReportModel).
   */
  function printCallReport(model) {
    if (!model) { toast(t('pdfUnavailable'), 'error'); return; }
    printDocument(buildCallReportHTML(model));
  }

  /**
   * printReport(contentHTML, opts) — entry point kept for backward compatibility.
   *   opts.call  → normalize a persisted call object + render the pro report (preferred)
   *   opts.model → render an already-normalized report model
   *   else       → legacy: wrap raw contentHTML in a branded print document
   */
  function printReport(contentHTML, opts) {
    opts = opts || {};
    if (opts.model) { printCallReport(opts.model); return; }
    if (opts.call) { printCallReport(callToReportModel(opts.call, opts)); return; }

    var isRTL = (currentLang() !== 'en');
    var meta = (opts.meta || []).map(function (m) {
      return '<div class="rpt-cell"><span class="k">' + esc(m.label) + '</span><span class="v">' + esc(m.value) + '</span></div>';
    }).join('');
    var html = '<!DOCTYPE html><html dir="' + (isRTL ? 'rtl' : 'ltr') + '" lang="' + (isRTL ? 'ar' : 'en') + '">' +
      '<head><meta charset="UTF-8">' +
      '<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Tajawal:wght@400;500;700;800;900&display=swap" rel="stylesheet">' +
      '<title>' + esc(opts.title || 'تقرير') + '</title><style>' + PRINT_CSS + '</style></head>' +
      '<body><div id="scm-doc">' +
        '<div class="rpt-mast"><div class="row">' +
          '<div class="rpt-brand"><span class="rpt-logo">🎙️</span><div><div class="nm">مراقب المكالمات الذكي</div><div class="sub">SMART CALL MONITOR</div></div></div>' +
          '<span class="rpt-tag">تقرير سرّي · داخلي</span></div>' +
          '<div class="ttl"><h1>' + esc(opts.title || 'تقرير النظام') + '</h1>' + (opts.subtitle ? '<p>' + esc(opts.subtitle) + '</p>' : '') + '</div>' +
        '</div>' +
        (meta ? '<div class="rpt-grid g4" style="margin-top:11px">' + meta + '</div>' : '') +
        '<div class="rpt-sec">' + (contentHTML || '') + '</div>' +
        '<div class="rpt-foot"><b>مراقب المكالمات الذكي · Smart Call Monitor</b><span>' + esc(new Date().toLocaleString('ar-EG')) + '</span></div>' +
      '</div></body></html>';
    printDocument(html);
  }

  /* ════════════════ Public API ════════════════ */
  window.SCM = {
    notify: notify,
    toast: toast,
    theme: theme,
    applyTheme: applyTheme,
    toggleTheme: toggleTheme,
    onThemeChange: onThemeChange,
    lang: currentLang,
    applyLang: applyLang,
    t: t,
    density: density,
    applyDensity: applyDensity,
    openSettings: openSettings,
    closeSettings: closeSettings,
    printReport: printReport,
    printCallReport: printCallReport,
    callToReportModel: callToReportModel,
    buildCallReportHTML: buildCallReportHTML,
    countUp: countUp,
    exportCSV: exportCSV,
    skeletonRows: skeletonRows,
    registerCommands: registerCommands,
    openPalette: openPalette,
    audit: audit,
  };

  /* ════════════════ Boot ════════════════ */
  function boot() {
    injectSettings();
    injectMobileNav();
    updateUnread();
    startI18nObserver();
    applyLang(currentLang());
    connectEvents();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();