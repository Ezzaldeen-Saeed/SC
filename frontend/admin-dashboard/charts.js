/* =====================================================================
   charts.js — Analytics layer for the Admin Control Center
   Area / donut / bar charts (via SCMCharts), call-density heatmap,
   and the inline SVG sparkline generator used by the KPI cards.
   ===================================================================== */
(function () {
  'use strict';
  var App = window.App;
  if (!App) return;

  var SEMANTIC = ['#2563eb', '#7c3aed', '#10b981', '#f59e0b', '#ef4444', '#0ea5e9', '#ec4899', '#14b8a6'];

  var lastSignature = ''; // data state the charts were last drawn from

  /* Cheap fingerprint of everything the charts actually read. A bare
     `calls.length` check missed late-arriving analysis — sentiment and scores
     are filled in after the call row already exists, so an SSE refresh left the
     sentiment and quality charts showing stale data until the count happened to
     change. Counting the analysed rows catches that without hashing every call. */
  function dataSignature(calls) {
    var scored = 0, sentimented = 0, latest = 0;
    for (var i = 0; i < calls.length; i++) {
      var c = calls[i];
      if (App.scoreOf(c) != null) scored++;
      if (c.sentiment) sentimented++;
      var t = c.call_start ? +new Date(c.call_start) : 0;
      if (t > latest) latest = t;
    }
    return calls.length + '|' + scored + '|' + sentimented + '|' + latest;
  }
  // Force the next renderCharts() to redraw regardless of the signature.
  function invalidateCharts() { lastSignature = ''; }

  /* ── Main analytics charts ── */
  function renderCharts() {
    if (!window.SCMCharts) return;
    if (!SCMCharts.available) {
      document.querySelectorAll('#view-overview .chart-box canvas').forEach(function (cv) {
        var box = cv.closest('.chart-box');
        if (box) box.innerHTML = '<div class="chart-empty"><i class="fas fa-chart-area"></i> تعذّر تحميل مكتبة الرسوم</div>';
      });
      return;
    }

    var c = App.state.calls || [];

    // Skip the redraw when nothing the charts read has moved. The builders below
    // update in place (see mount() in scm-charts.js), so a redraw is cheap — but
    // re-running eleven aggregations on every SSE tick is not.
    var sig = dataSignature(c);
    if (sig === lastSignature) return;
    lastSignature = sig;

    (function () {
      var cvCalls = document.getElementById('chartCallsDay');
      if (cvCalls) {
        var d = SCMCharts.callsPerDay(c, 14);
        SCMCharts.line(cvCalls, { labels: d.labels, data: d.data, colors: ['#2563eb'] });
      }

      var cvSent = document.getElementById('chartSentiment');
      if (cvSent) {
        var sent = SCMCharts.sentimentSplit(c);
        SCMCharts.doughnut(cvSent, { labels: sent.labels, data: sent.data, colors: ['#10b981', '#94a3b8', '#ef4444'] });
      }

      var cvTypes = document.getElementById('chartTypes');
      if (cvTypes) {
        var t = SCMCharts.typeSplit(c);
        SCMCharts.doughnut(cvTypes, { labels: t.labels, data: t.data, colors: SEMANTIC });
      }

      var cvScores = document.getElementById('chartScores');
      if (cvScores) {
        var g = SCMCharts.avgScoreByGroup(c, function (call) { return call.user_id; }, function (call) { return (call.users && call.users.full_name) || '—'; }, 10);
        SCMCharts.bar(cvScores, { labels: g.labels, data: g.data, colors: g.colors, horizontal: true });
      }

      /* ── Trends pane ── */
      var cvWeek = document.getElementById('chartWeekCompare');
      if (cvWeek && SCMCharts.multiLine) {
        var wc = weekCompare(c);
        SCMCharts.multiLine(cvWeek, { labels: wc.labels, datasets: [
          { label: 'هذا الأسبوع', data: wc.cur, color: '#2563eb', fill: true },
          { label: 'الأسبوع الماضي', data: wc.prev, color: '#94a3b8' },
        ] });
      }

      var cvAvgDur = document.getElementById('chartAvgDur');
      if (cvAvgDur) {
        var ad = avgDurPerDay(c, 14);
        SCMCharts.bar(cvAvgDur, { labels: ad.labels, data: ad.data, colors: ad.data.map(function () { return '#0ea5e9'; }) });
      }

      var cvSentTrend = document.getElementById('chartSentTrend');
      if (cvSentTrend && SCMCharts.multiLine) {
        var st = sentimentPerDay(c, 14);
        SCMCharts.multiLine(cvSentTrend, { labels: st.labels, datasets: [
          { label: 'إيجابي', data: st.pos, color: '#10b981' },
          { label: 'محايد', data: st.neu, color: '#94a3b8' },
          { label: 'سلبي', data: st.neg, color: '#ef4444' },
        ] });
      }

      /* ── Distributions pane ── */
      var cvRes = document.getElementById('chartResolution');
      if (cvRes) {
        var rs = resolutionSplit(c);
        SCMCharts.doughnut(cvRes, { labels: rs.labels, data: rs.data, colors: ['#10b981', '#f59e0b', '#ef4444'] });
      }

      var cvHours = document.getElementById('chartHours');
      if (cvHours) {
        var hb = byHour(c);
        SCMCharts.bar(cvHours, { labels: hb.labels, data: hb.data, colors: hb.data.map(function () { return '#2563eb'; }) });
      }

      var cvDist = document.getElementById('chartScoreDist');
      if (cvDist) {
        var sd = scoreHistogram(c);
        SCMCharts.bar(cvDist, { labels: sd.labels, data: sd.data, colors: sd.colors });
      }

      /* ── Quality pane ── */
      var cvVol = document.getElementById('chartAgentVolume');
      if (cvVol) {
        var av = callsPerAgent(c, 10);
        SCMCharts.bar(cvVol, { labels: av.labels, data: av.data, colors: av.data.map(function () { return '#7c3aed'; }), horizontal: true });
      }

      renderHeatmap(c);
    })();
  }

  function renderChartsIfVisible() {
    var view = document.getElementById('view-analytics');
    if (view && view.classList.contains('active')) renderCharts();
  }

  /* ── Aggregations for the new charts ── */
  function dayCounts(calls, days) { // raw per-day counts, oldest → newest
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var map = {}, keys = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(today); d.setDate(today.getDate() - i);
      var k = d.toISOString().slice(0, 10);
      map[k] = 0; keys.push(k);
    }
    (calls || []).forEach(function (c) {
      if (!c.call_start) return;
      var k = new Date(c.call_start).toISOString().slice(0, 10);
      if (k in map) map[k]++;
    });
    return keys.map(function (k) { return map[k]; });
  }

  // This week's daily counts vs last week's, aligned by weekday.
  function weekCompare(calls) {
    var counts = dayCounts(calls, 14);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var labels = [];
    for (var i = 6; i >= 0; i--) {
      var d = new Date(today); d.setDate(today.getDate() - i);
      labels.push(d.toLocaleDateString('ar-EG', { weekday: 'short' }));
    }
    return { labels: labels, prev: counts.slice(0, 7), cur: counts.slice(7) };
  }

  // Average call duration per day, in minutes.
  function avgDurPerDay(calls, days) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var map = {}, labels = [], keys = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(today); d.setDate(today.getDate() - i);
      var k = d.toISOString().slice(0, 10);
      map[k] = { sum: 0, n: 0 }; keys.push(k);
      labels.push(d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }));
    }
    (calls || []).forEach(function (c) {
      if (!c.call_start) return;
      var k = new Date(c.call_start).toISOString().slice(0, 10);
      if (!(k in map)) return;
      var sec = App.callDurationSec(c);
      if (sec != null) { map[k].sum += sec; map[k].n++; }
    });
    return { labels: labels, data: keys.map(function (k) { var e = map[k]; return e.n ? Math.round((e.sum / e.n) / 60 * 10) / 10 : 0; }) };
  }

  // Daily positive / neutral / negative counts.
  function sentimentPerDay(calls, days) {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var map = {}, labels = [], keys = [];
    for (var i = days - 1; i >= 0; i--) {
      var d = new Date(today); d.setDate(today.getDate() - i);
      var k = d.toISOString().slice(0, 10);
      map[k] = { pos: 0, neu: 0, neg: 0 }; keys.push(k);
      labels.push(d.toLocaleDateString('ar-EG', { day: 'numeric', month: 'short' }));
    }
    (calls || []).forEach(function (c) {
      if (!c.call_start) return;
      var k = new Date(c.call_start).toISOString().slice(0, 10);
      if (!(k in map)) return;
      var s = App.sentimentClass(c.sentiment);
      if (s === 'positive') map[k].pos++; else if (s === 'negative') map[k].neg++; else map[k].neu++;
    });
    return {
      labels: labels,
      pos: keys.map(function (k) { return map[k].pos; }),
      neu: keys.map(function (k) { return map[k].neu; }),
      neg: keys.map(function (k) { return map[k].neg; }),
    };
  }

  // problem_solved from the AI analysis → solved / partial / unsolved.
  function resolutionSplit(calls) {
    var solved = 0, partial = 0, unsolved = 0;
    (calls || []).forEach(function (c) {
      var a = App.callAnalysis ? App.callAnalysis(c) : null;
      if (!a || a.problem_solved == null) return;
      if (a.problem_solved === 'نعم') solved++;
      else if (a.problem_solved === 'جزئياً') partial++;
      else unsolved++;
    });
    return { labels: ['تم الحل', 'حل جزئي', 'لم يُحل'], data: [solved, partial, unsolved] };
  }

  function byHour(calls) {
    var data = new Array(24).fill(0);
    (calls || []).forEach(function (c) {
      if (!c.call_start) return;
      var d = new Date(c.call_start);
      if (!isNaN(d)) data[d.getHours()]++;
    });
    return { labels: data.map(function (_, h) { return String(h).padStart(2, '0'); }), data: data };
  }

  function scoreHistogram(calls) {
    var buckets = [
      { label: '0–49', min: 0, max: 49, color: '#ef4444', n: 0 },
      { label: '50–64', min: 50, max: 64, color: '#f97316', n: 0 },
      { label: '65–74', min: 65, max: 74, color: '#f59e0b', n: 0 },
      { label: '75–84', min: 75, max: 84, color: '#84cc16', n: 0 },
      { label: '85–100', min: 85, max: 100, color: '#10b981', n: 0 },
    ];
    (calls || []).forEach(function (c) {
      var s = App.scoreOf(c); if (s == null) return;
      for (var i = 0; i < buckets.length; i++) {
        if (s >= buckets[i].min && s <= buckets[i].max) { buckets[i].n++; break; }
      }
    });
    return {
      labels: buckets.map(function (b) { return b.label; }),
      data: buckets.map(function (b) { return b.n; }),
      colors: buckets.map(function (b) { return b.color; }),
    };
  }

  function callsPerAgent(calls, limit) {
    var acc = {};
    (calls || []).forEach(function (c) {
      if (c.user_id == null) return;
      var e = acc[c.user_id] || (acc[c.user_id] = { name: (c.users && c.users.full_name) || '—', n: 0 });
      e.n++;
    });
    var rows = Object.keys(acc).map(function (k) { return acc[k]; });
    rows.sort(function (a, b) { return b.n - a.n; });
    if (limit) rows = rows.slice(0, limit);
    return { labels: rows.map(function (r) { return r.name; }), data: rows.map(function (r) { return r.n; }) };
  }

  /* ── Analytics tabs (trends / distributions / quality) ── */
  function setupAnalyticsTabs() {
    var tabs = document.getElementById('analyticsTabs');
    if (!tabs) return;
    tabs.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        tabs.querySelectorAll('.chip').forEach(function (t) { t.classList.remove('on'); });
        chip.classList.add('on');
        var target = chip.getAttribute('data-pane');
        document.querySelectorAll('#view-analytics .tab-pane').forEach(function (p) {
          p.classList.toggle('active', p.id === target);
        });
        // charts drawn while the pane was hidden have zero size — once visible,
        // resize them; if any is still 0×0 force a full redraw
        requestAnimationFrame(function () {
          if (!window.Chart) return;
          var dead = false;
          document.querySelectorAll('#' + target + ' canvas').forEach(function (cv) {
            var ch = Chart.getChart(cv);
            if (!ch) return;
            ch.resize();
            if (!ch.width || !ch.height) dead = true;
          });
          if (dead) { invalidateCharts(); renderCharts(); }
        });
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setupAnalyticsTabs);
  else setupAnalyticsTabs();
  App.renderCharts = renderCharts;
  App.renderChartsIfVisible = renderChartsIfVisible;

  /* ── Call-density heatmap (day × hour) ── */
  var DAYS = ['أحد', 'إثن', 'ثلا', 'أرب', 'خمي', 'جمع', 'سبت'];
  function renderHeatmap(calls) {
    var box = document.getElementById('heatmap');
    if (!box) return;
    var grid = []; for (var i = 0; i < 7; i++) { grid.push(new Array(24).fill(0)); }
    var max = 0;
    (calls || []).forEach(function (c) {
      if (!c.call_start) return;
      var d = new Date(c.call_start); if (isNaN(d)) return;
      var day = d.getDay(), hr = d.getHours();
      grid[day][hr]++; if (grid[day][hr] > max) max = grid[day][hr];
    });
    if (!max) { box.innerHTML = '<div class="chart-empty" style="height:160px"><i class="fas fa-table-cells"></i> لا توجد بيانات كافية لعرض الخريطة</div>'; return; }

    var html = '<div class="heatmap">';
    for (var dy = 0; dy < 7; dy++) {
      html += '<div class="heatmap-row"><span class="hm-label">' + DAYS[dy] + '</span>';
      for (var h = 0; h < 24; h++) {
        var v = grid[dy][h], a = v ? (0.14 + 0.86 * (v / max)) : 0;
        var style = v ? 'background:rgba(37,99,235,' + a.toFixed(2) + ')' : '';
        html += '<div class="hm-cell" style="' + style + '" title="' + DAYS[dy] + ' · ' + h + ':00 — ' + v + ' مكالمة"></div>';
      }
      html += '</div>';
    }
    html += '</div>';
    html += '<div class="heatmap-axis"><span></span>';
    for (var hh = 0; hh < 24; hh += 1) { html += '<span>' + (hh % 3 === 0 ? hh : '') + '</span>'; }
    html += '</div>';
    html += '<div class="heatmap-legend">أقل <span class="hl-scale">'
      + '<i style="background:rgba(37,99,235,.14)"></i><i style="background:rgba(37,99,235,.4)"></i><i style="background:rgba(37,99,235,.65)"></i><i style="background:rgba(37,99,235,.9)"></i>'
      + '</span> أكثر</div>';
    box.innerHTML = html;
  }
  App.renderHeatmap = renderHeatmap;

  /* ── Inline SVG sparkline ── */
  function makeSparkline(series, color) {
    series = (series && series.length) ? series : [0, 0];
    var W = 240, H = 46, n = series.length;
    var max = Math.max.apply(null, series), min = Math.min.apply(null, series);
    var range = (max - min) || 1;
    var step = W / (n - 1 || 1);
    var pts = series.map(function (v, i) {
      var x = i * step;
      var y = H - 6 - ((v - min) / range) * (H - 14);
      return [x, y];
    });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = line + ' L' + W + ' ' + H + ' L0 ' + H + ' Z';
    var gid = 'sg' + Math.random().toString(36).slice(2, 8);
    var last = pts[pts.length - 1];
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none">'
      + '<defs><linearGradient id="' + gid + '" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0%" stop-color="' + color + '" stop-opacity="0.28"/>'
      + '<stop offset="100%" stop-color="' + color + '" stop-opacity="0"/></linearGradient></defs>'
      + '<path d="' + area + '" fill="url(#' + gid + ')"/>'
      + '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'
      + '<circle cx="' + last[0].toFixed(1) + '" cy="' + last[1].toFixed(1) + '" r="3" fill="' + color + '"/>'
      + '</svg>';
  }
  App.makeSparkline = makeSparkline;
})();