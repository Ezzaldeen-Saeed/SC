/*
 * scm-charts.js — Shared analytics layer for SCM dashboards (Chart.js wrapper).
 * ──────────────────────────────────────────────────────────────────────────
 * Provides:
 *   • Theme-aware chart builders (line / bar / doughnut) that read the page's
 *     CSS variables and re-render on light/dark toggle.
 *   • Data aggregations over the calls array already loaded by each dashboard
 *     (calls-per-day, sentiment split, call-type split, avg score by group).
 *
 * Requires Chart.js (UMD global `Chart`) loaded before this file. Degrades
 * gracefully (no-ops) if Chart.js isn't available.
 *
 * Public API: window.SCMCharts = {
 *   line, bar, doughnut,            // builders → return Chart instance (or null)
 *   callsPerDay, sentimentSplit, typeSplit, avgScoreByGroup,  // aggregations
 *   sentimentClass, CALL_TYPE_AR
 * }
 */
(function () {
  'use strict';

  var hasChart = typeof window.Chart !== 'undefined';

  /* ── theme helpers ──
   * Two token vocabularies live in this frontend. The dashboard shell
   * (dashboard.css, used by admin/manager/supervisor) says --primary / --muted
   * / --border / --card; the agent console (agent.css) additionally publishes
   * the older --accent / --text-muted / --border-color / --card-bg aliases.
   * So every lookup takes an ordered list and uses the first name the host page
   * actually defines.
   *
   * This used to read one name only — the agent console's. On the other three
   * dashboards nothing defined it, so every chart silently took the hardcoded
   * fallback: manager (violet) and supervisor (amber) drew admin-blue marks,
   * and ticks, grid lines and doughnut borders kept their light-mode colours
   * in dark mode. Admin looked correct purely because its accent happens to be
   * the same blue as the fallback.
   */
  function cssVar(names, fallback) {
    if (typeof names === 'string') names = [names];
    try {
      var cs = getComputedStyle(document.documentElement);
      for (var i = 0; i < names.length; i++) {
        var v = cs.getPropertyValue(names[i]).trim();
        if (v) return v;
      }
    } catch (e) {}
    return fallback;
  }
  // The names each role's stylesheet may use for one concept, most-canonical first.
  var TOKEN = {
    accent:  ['--primary', '--accent'],
    ink:     ['--muted', '--text-muted'],
    grid:    ['--border', '--border-color'],
    surface: ['--card', '--card-bg'],
  };
  function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
  // Categorical palette (readable in both themes)
  var PALETTE = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#14b8a6', '#ec4899', '#0ea5e9', '#84cc16', '#f97316'];

  function applyDefaults() {
    if (!hasChart) return;
    Chart.defaults.font.family = "'Tajawal','Inter',system-ui,sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = cssVar(TOKEN.ink, '#64748b');
    Chart.defaults.plugins.legend.rtl = true;
    Chart.defaults.plugins.tooltip.rtl = true;
    Chart.defaults.plugins.tooltip.bodyFont = { family: "'Tajawal',sans-serif" };
    Chart.defaults.plugins.tooltip.titleFont = { family: "'Tajawal',sans-serif" };
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation = { duration: 600, easing: 'easeOutQuart' };
  }
  applyDefaults();

  // Registry so we can re-theme/re-render all live charts on theme toggle.
  var registry = []; // { canvas, build } where build() returns a Chart.js config

  /* Mounts or refreshes the chart on `canvas`.
   *
   * `build` returns a *config* rather than a Chart, which lets a refresh reuse
   * the live instance: same chart type → swap data/options and update() in
   * place, so Chart.js keeps the canvas, its event handlers and its animation
   * state and only the datasets move. Rebuilding from scratch on every refresh
   * cost a full teardown per chart (11 of them on the admin analytics view) and
   * restarted every entry animation on each SSE tick.
   *
   * Options are replaced wholesale, not merged: they carry the resolved theme
   * colours (ticks, grid, doughnut borders), so a stale merge would keep light
   * mode's greys after a flip to dark. */
  function mount(canvas, build) {
    if (!hasChart || !canvas) return null;
    var cfg = build();
    var prev = canvas._scmChart;
    if (prev && prev.config && prev.config.type === cfg.type) {
      prev.data = cfg.data;
      if (cfg.options) prev.options = cfg.options;
      prev.update();
    } else {
      if (prev) { try { prev.destroy(); } catch (e) {} }
      canvas._scmChart = new Chart(canvas.getContext('2d'), cfg);
    }
    var entry = registry.find(function (r) { return r.canvas === canvas; });
    if (entry) entry.build = build; else registry.push({ canvas: canvas, build: build });
    return canvas._scmChart;
  }

  function rethemeAll() {
    applyDefaults();
    // Drop canvases that have left the DOM first — without this the registry
    // grows without bound for any caller that replaces its canvas element.
    registry = registry.filter(function (r) { return document.body.contains(r.canvas); });
    registry.forEach(function (r) { mount(r.canvas, r.build); });
  }
  // Re-render charts when the theme flips (SCM.onThemeChange added in scm-ui.js).
  if (window.SCM && typeof SCM.onThemeChange === 'function') SCM.onThemeChange(rethemeAll);
  else document.addEventListener('scm:themechange', rethemeAll);

  function gridColor() { return cssVar(TOKEN.grid, '#e6ecf5'); }
  function tickColor() { return cssVar(TOKEN.ink, '#64748b'); }

  /* ── builders ── */
  // True only if at least one value is > 0 (a doughnut/bar with all-zeros draws nothing).
  function hasData(arr) { return Array.isArray(arr) && arr.some(function (v) { return Number(v) > 0; }); }
  // Toggle a friendly empty-state inside the .chart-box instead of leaving a blank canvas.
  function setEmpty(canvas, isEmpty, label) {
    var box = (canvas.closest && canvas.closest('.chart-box')) || canvas.parentNode;
    if (!box) return;
    var msg = box.querySelector('.chart-empty');
    if (isEmpty) {
      canvas.style.display = 'none';
      if (canvas._scmChart) { try { canvas._scmChart.destroy(); } catch (e) {} canvas._scmChart = null; }
      if (!msg) { msg = document.createElement('div'); msg.className = 'chart-empty'; box.appendChild(msg); }
      msg.innerHTML = '<i class="fas fa-chart-pie"></i> ' + (label || 'لا توجد بيانات كافية لعرض الرسم');
      msg.style.display = '';
    } else {
      canvas.style.display = '';
      if (msg) msg.remove();
    }
  }
  function line(canvas, opts) {
    if (!hasChart || !canvas) return null;
    if (!hasData(opts.data)) { setEmpty(canvas, true, 'لا توجد مكالمات في هذه الفترة'); return null; }
    setEmpty(canvas, false);
    return mount(canvas, function () {
      var accent = cssVar(TOKEN.accent, '#2563eb');
      var ctx = canvas.getContext('2d');
      var grad = ctx.createLinearGradient(0, 0, 0, canvas.height || 240);
      grad.addColorStop(0, hexA(accent, 0.28));
      grad.addColorStop(1, hexA(accent, 0));
      return {
        type: 'line',
        data: { labels: opts.labels, datasets: [{ label: opts.label || '', data: opts.data, borderColor: accent, backgroundColor: grad, fill: true, tension: 0.38, borderWidth: 3, pointRadius: 3, pointBackgroundColor: accent, pointHoverRadius: 5 }] },
        options: {
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: false }, ticks: { color: tickColor() } },
            y: { beginAtZero: true, grid: { color: gridColor() }, ticks: { color: tickColor(), precision: 0 } },
          },
        },
      };
    });
  }

  function bar(canvas, opts) {
    if (!hasChart || !canvas) return null;
    if (!hasData(opts.data)) { setEmpty(canvas, true); return null; }
    setEmpty(canvas, false);
    return mount(canvas, function () {
      var colors = (opts.colors) || opts.data.map(function (_, i) { return PALETTE[i % PALETTE.length]; });
      return {
        type: 'bar',
        data: { labels: opts.labels, datasets: [{ label: opts.label || '', data: opts.data, backgroundColor: colors, borderRadius: 8, maxBarThickness: 42 }] },
        options: {
          indexAxis: opts.horizontal ? 'y' : 'x',
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { display: !opts.horizontal ? false : true, color: gridColor() }, ticks: { color: tickColor() }, beginAtZero: true },
            y: { grid: { display: opts.horizontal ? false : true, color: gridColor() }, ticks: { color: tickColor() }, beginAtZero: true },
          },
        },
      };
    });
  }

  // Multi-series line chart: opts.datasets = [{ label, data, color, fill? }].
  function multiLine(canvas, opts) {
    if (!hasChart || !canvas) return null;
    var any = (opts.datasets || []).some(function (d) { return hasData(d.data); });
    if (!any) { setEmpty(canvas, true, opts.emptyLabel); return null; }
    setEmpty(canvas, false);
    return mount(canvas, function () {
      return {
        type: 'line',
        data: {
          labels: opts.labels,
          datasets: (opts.datasets || []).map(function (d, i) {
            var col = d.color || PALETTE[i % PALETTE.length];
            return {
              label: d.label || '', data: d.data,
              borderColor: col, backgroundColor: d.fill ? hexA(col, 0.14) : col, fill: !!d.fill,
              tension: 0.38, borderWidth: 2.5, pointRadius: 2.5, pointBackgroundColor: col, pointHoverRadius: 5,
            };
          }),
        },
        options: {
          plugins: { legend: { display: true, position: 'bottom', labels: { color: tickColor(), padding: 14, usePointStyle: true, font: { family: "'Tajawal',sans-serif" } } } },
          scales: {
            x: { grid: { display: false }, ticks: { color: tickColor() } },
            y: { beginAtZero: true, grid: { color: gridColor() }, ticks: { color: tickColor(), precision: 0 } },
          },
        },
      };
    });
  }

  function doughnut(canvas, opts) {
    if (!hasChart || !canvas) return null;
    if (!hasData(opts.data)) { setEmpty(canvas, true); return null; }
    setEmpty(canvas, false);
    return mount(canvas, function () {
      return {
        type: 'doughnut',
        data: { labels: opts.labels, datasets: [{ data: opts.data, backgroundColor: opts.colors || PALETTE, borderColor: cssVar(TOKEN.surface, '#fff'), borderWidth: 3, hoverOffset: 6 }] },
        options: { cutout: '62%', plugins: { legend: { position: 'bottom', labels: { color: tickColor(), padding: 14, usePointStyle: true, font: { family: "'Tajawal',sans-serif" } } } } },
      };
    });
  }

  // hex (#rrggbb) → rgba string with alpha
  function hexA(hex, a) {
    var h = hex.replace('#', '');
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* ── aggregations over calls ── */
  var CALL_TYPE_AR = { inquiry: 'استفسار', complaint: 'شكوى', support: 'دعم فني', sales: 'مبيعات', follow_up: 'متابعة', other: 'أخرى' };

  function scoreOf(c) { var ps = c.performance_scores; var r = Array.isArray(ps) ? ps[0] : ps; return r && r.total_score != null ? Number(r.total_score) : null; }

  function sentimentClass(s) {
    if (!s) return 'neutral';
    var v = String(s).toLowerCase();
    if (/(pos|إيجاب|راض|سعيد|good|happy)/.test(v)) return 'positive';
    if (/(neg|سلب|غاضب|غضب|bad|angry|سيّئ|سيئ|محبط)/.test(v)) return 'negative';
    return 'neutral';
  }

  function callsPerDay(calls, days) {
    days = days || 14;
    var buckets = {}, labels = [], data = [];
    var today = new Date(); today.setHours(0, 0, 0, 0);
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(today); d.setDate(today.getDate() - i);
      var key = d.toISOString().slice(0, 10);
      buckets[key] = 0;
      labels.push(d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }));
    }
    (calls || []).forEach(function (c) {
      if (!c.call_start) return;
      var key = new Date(c.call_start).toISOString().slice(0, 10);
      if (key in buckets) buckets[key]++;
    });
    Object.keys(buckets).forEach(function (k) { data.push(buckets[k]); });
    return { labels: labels, data: data };
  }

  function sentimentSplit(calls) {
    var c = { positive: 0, neutral: 0, negative: 0 };
    (calls || []).forEach(function (x) { c[sentimentClass(x.sentiment)]++; });
    return {
      labels: ['إيجابي', 'محايد', 'سلبي'],
      data: [c.positive, c.neutral, c.negative],
      colors: ['#10b981', '#94a3b8', '#ef4444'],
    };
  }

  function typeSplit(calls) {
    var counts = {};
    (calls || []).forEach(function (x) { var t = x.call_type || 'other'; counts[t] = (counts[t] || 0) + 1; });
    var keys = Object.keys(counts);
    return { labels: keys.map(function (k) { return CALL_TYPE_AR[k] || k; }), data: keys.map(function (k) { return counts[k]; }) };
  }

  // avg score per group; groupKey(call)->id, groupName(call)->label. Top `limit`.
  function avgScoreByGroup(calls, groupKey, groupName, limit) {
    var acc = {};
    (calls || []).forEach(function (c) {
      var s = scoreOf(c); if (s == null) return;
      var id = groupKey(c); if (id == null) return;
      var e = acc[id] || (acc[id] = { sum: 0, n: 0, name: groupName(c) });
      e.sum += s; e.n++;
    });
    var rows = Object.keys(acc).map(function (id) { return { name: acc[id].name, avg: Math.round(acc[id].sum / acc[id].n) }; });
    rows.sort(function (a, b) { return b.avg - a.avg; });
    if (limit) rows = rows.slice(0, limit);
    var colors = rows.map(function (r) { return r.avg >= 75 ? '#10b981' : r.avg >= 50 ? '#f59e0b' : '#ef4444'; });
    return { labels: rows.map(function (r) { return r.name; }), data: rows.map(function (r) { return r.avg; }), colors: colors };
  }

  window.SCMCharts = {
    available: hasChart,
    line: line, bar: bar, doughnut: doughnut, multiLine: multiLine, rethemeAll: rethemeAll,
    callsPerDay: callsPerDay, sentimentSplit: sentimentSplit, typeSplit: typeSplit, avgScoreByGroup: avgScoreByGroup,
    sentimentClass: sentimentClass, CALL_TYPE_AR: CALL_TYPE_AR,
  };
})();
