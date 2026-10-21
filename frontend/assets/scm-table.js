/*
 * scm-table.js — Progressive enhancement for every `.data-table` on the SCM
 * dashboards (admin / manager / supervisor).
 * ─────────────────────────────────────────────────────────────────────────
 * Adds column sorting, pagination, a sticky header, keyboard-reachable rows
 * and a live result count WITHOUT changing how the dashboards build rows.
 * They keep doing `tbody.innerHTML = list.map(…)`; a MutationObserver
 * re-applies the current sort + page afterwards. Nothing here caches the row
 * list across renders — the DOM is the single source of truth, because the
 * renderers replace it wholesale on every search keystroke and SSE refresh.
 *
 * Per-column control (all optional — every column is inferred when absent):
 *   <th data-type="num|date|text">  force a comparator
 *   <th data-nosort>                opt a column out (actions, avatars…)
 *   <td data-sort="…">              exact sort key, beats the cell's text
 *
 * `data-sort` earns its keep on dates and durations: those cells render
 * through toLocaleString('ar-EG'), which emits Arabic-Indic numerals that
 * Date.parse() rejects. The text fallback folds ٠-٩ back to ASCII so a
 * renderer that forgets `data-sort` still sorts numbers correctly, but an
 * exact key is always cheaper and never ambiguous.
 *
 * Load after scm-ui.js. Exposes window.SCMTable.
 */
(function () {
  'use strict';

  var LS_SIZE = 'scm_table_page_size';
  var SIZES = [10, 25, 50, 100, 0];   // 0 = show every row
  var DEFAULT_SIZE = 25;
  var PAGINATE_FROM = 11;             // below this a pager is just noise
  var STAGGER_CAP = 14;               // rows past this share the last delay

  /* ── strings ──────────────────────────────────────────────────────────
   * Self-translated rather than routed through scm-ui's ar→en dictionary:
   * that dictionary is keyed by whole Arabic strings, and the words this UI
   * needs ("من", "الكل") are common enough that adding them would rewrite
   * unrelated text elsewhere on the page. The footer is marked
   * data-scm-noi18n so the shared translator leaves it to us.
   */
  var STR = {
    showing:  { ar: 'عرض',            en: 'Showing' },
    of:       { ar: 'من',             en: 'of' },
    perPage:  { ar: 'لكل صفحة',       en: 'Per page' },
    all:      { ar: 'الكل',           en: 'All' },
    prev:     { ar: 'الصفحة السابقة', en: 'Previous page' },
    next:     { ar: 'الصفحة التالية', en: 'Next page' },
    page:     { ar: 'صفحة',           en: 'Page' },
    pager:    { ar: 'ترقيم الصفحات',  en: 'Pagination' },
    sortAsc:  { ar: 'ترتيب تصاعدي',   en: 'Sort ascending' },
    sortDesc: { ar: 'ترتيب تنازلي',   en: 'Sort descending' },
    sortNone: { ar: 'إلغاء الترتيب',  en: 'Clear sort' },
  };
  function lang() {
    if (window.SCM && SCM.lang) return SCM.lang();
    return document.documentElement.getAttribute('lang') || 'ar';
  }
  function s(k) { var e = STR[k]; return e ? (e[lang()] || e.ar) : k; }
  // Latin numerals in both languages, matching the KPI tiles. The Arabic-Indic
  // digits elsewhere come from date formatting, not from a deliberate choice.
  function num(n) { return Number(n).toLocaleString('en-US'); }

  /* Arabic doesn't agree as "one vs. many": 2 takes a dual, 3–10 a plural, and
   * 11+ goes back to an accusative singular. The obvious `n === 1 ? 'صف' :
   * 'صفوف'` prints "2 صفوف", which is simply ungrammatical — so ask
   * Intl.PluralRules which of the six categories applies and template from
   * there. `one` and `two` carry the count in the noun, so they omit {n}. */
  var PLURAL = {
    ar: { zero: 'لا صفوف', one: 'صف واحد', two: 'صفان', few: '{n} صفوف', many: '{n} صفًا', other: '{n} صف' },
    en: { one: '{n} row', other: '{n} rows' },
  };
  var _pr = {};
  function rowCount(n) {
    var l = lang() === 'en' ? 'en' : 'ar';
    if (!_pr[l]) { try { _pr[l] = new Intl.PluralRules(l); } catch (e) { _pr[l] = null; } }
    var cat = _pr[l] ? _pr[l].select(n) : (n === 1 ? 'one' : 'other');
    var tpl = PLURAL[l][cat] || PLURAL[l].other;
    return tpl.replace('{n}', '<b>' + num(n) + '</b>');
  }

  /* ── sort keys ── */
  function foldDigits(str) {
    return str
      .replace(/[٠-٩]/g, function (d) { return String(d.charCodeAt(0) - 0x0660); })
      .replace(/[۰-۹]/g, function (d) { return String(d.charCodeAt(0) - 0x06F0); });
  }
  var NUM_RE = /^-?\d+(?:\.\d+)?$/;
  function asNum(v) {
    var t = foldDigits(String(v)).replace(/[,\s%٪]/g, '');
    return NUM_RE.test(t) ? parseFloat(t) : NaN;
  }
  function keyOf(tr, i) {
    var td = tr.cells[i];
    if (!td) return '';
    var k = td.getAttribute('data-sort');
    return k != null ? k : td.textContent.trim();
  }
  function isBlank(v) { return v === '' || v === '—' || v === '-'; }

  /* A row the dashboards inject in place of data — the empty state, a loading
   * placeholder, a skeleton. Never sorted, never paginated, never counted. */
  function isDataRow(tr) { return !tr.querySelector('td[colspan]'); }

  var collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  function detectType(rows, i) {
    var seen = 0, nums = 0, dates = 0;
    for (var r = 0; r < rows.length && seen < 12; r++) {
      var v = keyOf(rows[r], i);
      if (isBlank(v)) continue;
      seen++;
      if (!isNaN(asNum(v))) nums++;
      // Guarded by the numeric check below: Date.parse('85') is a valid 1985.
      if (!isNaN(Date.parse(v))) dates++;
    }
    if (!seen) return 'text';
    if (nums === seen) return 'num';
    if (dates === seen) return 'date';
    return 'text';
  }

  function comparator(type, i, dir) {
    var sign = dir === 'desc' ? -1 : 1;
    return function (a, b) {
      var va = keyOf(a, i), vb = keyOf(b, i);
      var ba = isBlank(va), bb = isBlank(vb);
      // Blanks sink in BOTH directions. A descending sort that leads with a
      // column of em-dashes is never the answer to "show me the worst scores".
      if (ba || bb) return ba && bb ? 0 : ba ? 1 : -1;
      var r;
      if (type === 'num') r = asNum(va) - asNum(vb);
      else if (type === 'date') r = Date.parse(va) - Date.parse(vb);
      else r = collator.compare(va, vb);
      return r * sign;
    };
  }

  /* ── pager model ── */
  function pageList(cur, total) {
    var out = [], i;
    if (total <= 7) { for (i = 1; i <= total; i++) out.push(i); return out; }
    out.push(1);
    var lo = Math.max(2, cur - 1), hi = Math.min(total - 1, cur + 1);
    if (lo > 2) out.push('…');
    for (i = lo; i <= hi; i++) out.push(i);
    if (hi < total - 1) out.push('…');
    out.push(total);
    return out;
  }

  function loadSize() {
    var v = parseInt(localStorage.getItem(LS_SIZE), 10);
    return SIZES.indexOf(v) >= 0 ? v : DEFAULT_SIZE;
  }

  /* ── scroll affordance ──
   * A fade on whichever edge has content beyond it, so a table wider than its
   * column is visibly a table wider than its column. RTL reports scrollLeft as
   * 0 at the start and negative toward the end, hence the abs(). */
  function edges(el) {
    var max = el.scrollWidth - el.clientWidth;
    if (max <= 1) return [true, true];
    var x = Math.abs(el.scrollLeft);
    return [x <= 1, x >= max - 1];
  }

  /* ── enhancement ── */
  function enhance(table) {
    if (table.__scm) return table.__scm;

    var tbody = table.tBodies[0];
    var thead = table.tHead;
    if (!tbody || !thead || !thead.rows.length) return null;

    var wrap = table.closest('.table-wrap, .table-wrapper');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
    }
    wrap.classList.add('is-enhanced');

    // A non-scrolling shell to hang the edge fades on. They can't live on
    // .table-wrap itself: that IS the scroll container, so its pseudo-elements
    // would scroll away with the columns they're meant to be fading.
    var shell = document.createElement('div');
    shell.className = 'table-shell';
    wrap.parentNode.insertBefore(shell, wrap);
    shell.appendChild(wrap);

    var st = { idx: -1, dir: null, page: 1, size: loadSize(), painted: false, type: {} };
    var headRow = thead.rows[thead.rows.length - 1];
    var cells = [].slice.call(headRow.cells);

    /* header: sort buttons */
    var buttons = [];
    cells.forEach(function (th, i) {
      th.setAttribute('scope', 'col');
      var sortable = !th.hasAttribute('data-nosort') && th.textContent.trim() !== '';
      if (!sortable) { buttons.push(null); th.classList.add('th-plain'); return; }

      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'th-sort';
      // Move the existing nodes rather than re-creating them from innerHTML:
      // scm-ui's translator keeps per-text-node state in a WeakMap, and a
      // rebuilt node would lose its Arabic original on the next ar→en flip.
      while (th.firstChild) btn.appendChild(th.firstChild);
      var ic = document.createElement('i');
      ic.className = 'fas fa-sort th-ic';
      ic.setAttribute('aria-hidden', 'true');
      btn.appendChild(ic);
      th.appendChild(btn);
      th.setAttribute('aria-sort', 'none');
      btn.addEventListener('click', function () { toggle(i); });
      buttons.push(btn);
    });

    /* footer: count + page size + pager */
    var foot = document.createElement('div');
    foot.className = 'table-foot';
    foot.setAttribute('data-scm-noi18n', '');
    shell.parentNode.insertBefore(foot, shell.nextSibling);

    function toggle(i) {
      if (st.idx !== i) { st.idx = i; st.dir = 'asc'; }
      else if (st.dir === 'asc') st.dir = 'desc';
      else if (st.dir === 'desc') { st.idx = -1; st.dir = null; }
      else st.dir = 'asc';
      st.page = 1;
      apply('sort');
    }

    function syncHead() {
      cells.forEach(function (th, i) {
        var btn = buttons[i];
        if (!btn) return;
        var on = st.idx === i && st.dir;
        th.setAttribute('aria-sort', !on ? 'none' : st.dir === 'asc' ? 'ascending' : 'descending');
        th.classList.toggle('is-sorted', !!on);
        var ic = btn.querySelector('.th-ic');
        ic.className = 'fas th-ic ' + (!on ? 'fa-sort' : st.dir === 'asc' ? 'fa-sort-up' : 'fa-sort-down');
        // Announce what the next click will DO, not what is already true —
        // aria-sort on the th already carries the current state.
        var next = !on ? s('sortAsc') : st.dir === 'asc' ? s('sortDesc') : s('sortNone');
        btn.title = next;
        btn.setAttribute('aria-label', btn.textContent.trim() + ' — ' + next);
      });
    }

    function renderFoot(total, from, to, pages) {
      if (!total) { foot.innerHTML = ''; foot.hidden = true; return; }
      foot.hidden = false;

      var paged = st.size && total > st.size;
      var count = paged
        ? s('showing') + ' <b>' + num(from) + '–' + num(to) + '</b> ' + s('of') + ' <b>' + num(total) + '</b>'
        : rowCount(total);

      var sizeSel = '<label class="tf-size">' + s('perPage') +
        '<select class="mini-select tf-select">' +
        SIZES.map(function (v) {
          return '<option value="' + v + '"' + (v === st.size ? ' selected' : '') + '>' + (v === 0 ? s('all') : v) + '</option>';
        }).join('') + '</select></label>';

      var pager = '';
      if (paged) {
        pager = '<nav class="tf-pager" aria-label="' + s('pager') + '">' +
          '<button type="button" class="tf-btn tf-nav" data-go="' + (st.page - 1) + '"' + (st.page === 1 ? ' disabled' : '') +
            ' aria-label="' + s('prev') + '" title="' + s('prev') + '"><i class="fas fa-chevron-right" aria-hidden="true"></i></button>' +
          pageList(st.page, pages).map(function (p) {
            if (p === '…') return '<span class="tf-gap" aria-hidden="true">…</span>';
            var cur = p === st.page;
            return '<button type="button" class="tf-btn tf-page' + (cur ? ' is-current' : '') + '" data-go="' + p + '"' +
              (cur ? ' aria-current="page"' : '') + ' aria-label="' + s('page') + ' ' + p + '">' + num(p) + '</button>';
          }).join('') +
          '<button type="button" class="tf-btn tf-nav" data-go="' + (st.page + 1) + '"' + (st.page === pages ? ' disabled' : '') +
            ' aria-label="' + s('next') + '" title="' + s('next') + '"><i class="fas fa-chevron-left" aria-hidden="true"></i></button>' +
        '</nav>';
      }
      foot.innerHTML = '<div class="tf-count">' + count + '</div><div class="tf-right">' + sizeSel + pager + '</div>';
    }

    var obs = new MutationObserver(function () { apply('data'); });

    function render(reason) {
      var rows = [].slice.call(tbody.rows).filter(isDataRow);

      // DOM order == the renderer's order for rows we haven't touched yet, so
      // this doubles as the "unsorted" key that tri-state sorting returns to.
      rows.forEach(function (tr, i) { if (tr.__i == null) tr.__i = i; });

      if (st.idx >= 0 && st.dir) {
        var type = st.type[st.idx];
        if (type == null) {
          var forced = cells[st.idx] && cells[st.idx].getAttribute('data-type');
          type = forced || detectType(rows, st.idx);
          // Only memoise a type we had rows to infer from. Sorting a table
          // whose data hasn't arrived yet would otherwise pin the column to
          // 'text' permanently, and it would still be 'text' once the numbers
          // showed up.
          if (forced || rows.length) st.type[st.idx] = type;
        }
        rows.sort(comparator(type, st.idx, st.dir));
      } else {
        rows.sort(function (a, b) { return a.__i - b.__i; });
      }

      var total = rows.length;
      var size = total >= PAGINATE_FROM ? st.size : 0;
      var pages = size ? Math.max(1, Math.ceil(total / size)) : 1;
      if (st.page > pages) st.page = pages;
      var start = size ? (st.page - 1) * size : 0;
      var end = size ? Math.min(total, start + size) : total;

      var frag = document.createDocumentFragment();
      var shown = 0;
      rows.forEach(function (tr, i) {
        var vis = !size || (i >= start && i < end);
        tr.hidden = !vis;
        tr.classList.toggle('alt', vis && shown % 2 === 1);
        if (vis) {
          // Stagger is capped: at 25 rows an uncapped 25ms step would make the
          // last row land half a second after the first, which reads as lag.
          tr.style.setProperty('--i', Math.min(shown, STAGGER_CAP));
          shown++;
        }
        frag.appendChild(tr);
      });
      tbody.appendChild(frag);

      wireRows(rows);
      syncHead();
      renderFoot(total, start + 1, end, pages);

      // Re-animate on an intentional view change (sort, page) and on first
      // paint — never on a plain re-render, or typing in the search box would
      // restart the animation on every keystroke.
      var animate = reason === 'sort' || reason === 'page' || (reason === 'data' && !st.painted);
      if (total) st.painted = true;
      tbody.classList.toggle('is-fresh', !!animate);
      if (animate) {
        // Restart the CSS animation: read back layout, then re-add the class.
        void tbody.offsetWidth;
        tbody.classList.add('is-fresh');
      }
      syncEdges();
    }

    function apply(reason) {
      // The observer must not see our own writes — its callback is a microtask,
      // so a plain "busy" flag would already be false by the time it ran.
      obs.disconnect();
      try { render(reason); } finally { obs.observe(tbody, { childList: true }); }
    }

    function wireRows(rows) {
      rows.forEach(function (tr) {
        if (!tr.classList.contains('row-click') && !tr.classList.contains('row-link')) return;
        if (!tr.hasAttribute('tabindex')) tr.setAttribute('tabindex', '0');
      });
    }

    // One delegated listener instead of one per row: the renderers throw every
    // row away on each refresh, and re-binding hundreds of handlers per
    // keystroke is exactly the cost this layer is supposed to avoid.
    tbody.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if (e.target.tagName !== 'TR') return;   // let real controls in the row win
      var tr = e.target;
      if (!tr.classList.contains('row-click') && !tr.classList.contains('row-link')) return;
      e.preventDefault();
      tr.click();
    });

    foot.addEventListener('click', function (e) {
      var b = e.target.closest('.tf-btn');
      if (!b || b.disabled) return;
      var p = parseInt(b.getAttribute('data-go'), 10);
      if (!isNaN(p) && p !== st.page) { st.page = p; apply('page'); scrollIntoView(); }
    });
    foot.addEventListener('change', function (e) {
      if (!e.target.classList.contains('tf-select')) return;
      st.size = parseInt(e.target.value, 10) || 0;
      localStorage.setItem(LS_SIZE, st.size);
      st.page = 1;
      apply('page');
    });

    function scrollIntoView() {
      var top = wrap.getBoundingClientRect().top;
      if (top < 0) wrap.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    function syncEdges() {
      var e = edges(wrap);
      shell.classList.toggle('at-start', e[0]);
      shell.classList.toggle('at-end', e[1]);
    }
    wrap.addEventListener('scroll', syncEdges, { passive: true });
    window.addEventListener('resize', syncEdges);

    document.addEventListener('scm:langchange', function () { apply('lang'); });

    obs.observe(tbody, { childList: true });
    apply('init');

    table.__scm = {
      refresh: function () { apply('data'); },
      sort: function (i, dir) { st.idx = i; st.dir = dir; st.page = 1; apply('sort'); },
    };
    return table.__scm;
  }

  function enhanceAll(root) {
    root = root || document;
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    var list = root.querySelectorAll ? root.querySelectorAll('table.data-table') : [];
    [].slice.call(list).forEach(function (t) {
      try { enhance(t); } catch (err) { if (window.console) console.warn('[scm-table] skipped a table:', err); }
    });
    if (root.nodeType === 1 && root.matches && root.matches('table.data-table')) {
      try { enhance(root); } catch (err) { if (window.console) console.warn('[scm-table] skipped a table:', err); }
    }
  }

  /* The profile drill-downs (manager/supervisor `callsTable()`, the admin's
   * Customer 360) build whole tables with innerHTML long after load, so a
   * one-time sweep would miss every one of them. Re-parenting a table into its
   * shell also re-adds it here — enhance() is idempotent, which is what stops
   * that from recursing. */
  var docObs = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var added = muts[i].addedNodes;
      for (var j = 0; j < added.length; j++) enhanceAll(added[j]);
    }
  });
  function start() {
    enhanceAll();
    docObs.observe(document.body, { childList: true, subtree: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();

  window.SCMTable = { enhance: enhance, enhanceAll: enhanceAll };
})();
