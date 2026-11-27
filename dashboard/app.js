// Token Launch Radar dashboard — plain script, no framework, no network.
// Reads window.RADAR (written by main.ts from the sealed snapshot) and renders
// the ranked board, a per-protocol detail panel, filters, sorting, two
// hand-drawn canvas charts and the full methodology with peer multiples.
(function () {
  'use strict';
  var R = window.RADAR;
  var app = document.getElementById('app');
  if (!R) { app.innerHTML = '<p class="empty">No radar data: run main.ts first so data.js sits beside this page.</p>'; return; }

  var state = { q: '', cat: 'All', grade: 'All', wl: false, sort: 'rank', dir: 1, sel: R.rows.length ? R.rows[0].slug : null };

  function money(v) {
    if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
    if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return '$' + (v / 1e3).toFixed(0) + 'K';
    return '$' + v;
  }
  function pct(v) {
    if (v === null || v === undefined) return '<span class="flat">—</span>';
    var cls = v > 0.05 ? 'up' : (v < -0.05 ? 'down' : 'flat');
    return '<span class="' + cls + '">' + (v >= 0 ? '▲ +' : '▼ ') + v.toFixed(1) + '%</span>';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function bySlug(slug) { for (var i = 0; i < R.rows.length; i++) if (R.rows[i].slug === slug) return R.rows[i]; return R.rows[0]; }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var list = R.rows.filter(function (r) {
      if (state.cat !== 'All' && r.category !== state.cat) return false;
      if (state.grade !== 'All' && r.grade !== state.grade) return false;
      if (state.wl && !r.on_watchlist) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0 && r.category.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var key = state.sort;
    // dir = 1 is each key's natural order: rank ascending, name A–Z, and
    // largest-first for every numeric column. Clicking a header flips it.
    function valueOf(r) {
      if (key === 'tvl') return r.tvl_usd;
      if (key === 'value') return r.implied_value_usd;
      if (key === 'growth') return r.change_7d === null ? -999 : r.change_7d;
      if (key === 'score') return r.signal_score;
      if (key === 'age') return r.age_days === null ? -1 : r.age_days;
      return r.rank;
    }
    list.sort(function (a, b) {
      if (key === 'name') {
        var na = a.name.toLowerCase(), nb = b.name.toLowerCase();
        return (na < nb ? -1 : na > nb ? 1 : 0) * state.dir;
      }
      var diff = valueOf(b) - valueOf(a); // largest first
      if (key === 'rank') diff = valueOf(a) - valueOf(b); // smallest first
      return diff * state.dir;
    });
    return list;
  }

  function statsHtml() {
    return '<section class="stats">' +
      '<div class="stat hot"><b>' + R.eligible + '</b><span>pre-token protocols ranked</span></div>' +
      '<div class="stat"><b>' + R.scanned + '</b><span>protocols scanned in snapshot</span></div>' +
      '<div class="stat"><b>' + R.watchlist_size + '</b><span>on the house $50M watchlist</span></div>' +
      '<div class="stat"><b>' + money(R.total_tvl_usd) + '</b><span>TVL behind the board</span></div>' +
      '<div class="stat"><b>' + money(R.total_implied_usd) + '</b><span>combined implied value</span></div>' +
      '<div class="stat"><b>' + R.global_multiple.toFixed(2) + '×</b><span>global peer mcap / TVL median</span></div>' +
      '</section>';
  }

  function controlsHtml() {
    var cats = ['All'].concat(R.categories);
    var catOpts = cats.map(function (c) { return '<option' + (c === state.cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    var grades = ['All', 'A', 'B', 'C', 'D'].map(function (g) { return '<option' + (g === state.grade ? ' selected' : '') + '>' + g + '</option>'; }).join('');
    return '<section class="controls">' +
      '<input type="search" id="q" placeholder="Search name, slug or category…" value="' + esc(state.q) + '">' +
      '<label>Category <select id="cat">' + catOpts + '</select></label>' +
      '<label>Signal <select id="grade">' + grades + '</select></label>' +
      '<button class="chip' + (state.wl ? ' on' : '') + '" id="wl">Watchlist ≥ $50M only</button>' +
      '<span class="count" id="count"></span></section>';
  }

  function boardHtml(list) {
    if (!list.length) return '<div class="board"><p class="empty">No protocol matches this filter. Loosen the search or clear a filter.</p></div>';
    var head = '<div class="board"><table><thead><tr>' +
      '<th data-k="rank">#</th><th data-k="name">Protocol</th><th class="hideS">Category</th>' +
      '<th class="num" data-k="tvl">TVL</th><th class="num hideS" data-k="growth">7d</th>' +
      '<th class="num" data-k="value">Implied value</th><th class="num hideS">Range</th>' +
      '<th class="num" data-k="score">Signal</th></tr></thead><tbody>';
    var body = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (r.slug === state.sel ? ' class="sel"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><span class="pname">' + esc(r.name) + '</span>' + (r.on_watchlist ? '<span class="wl">WATCHLIST</span>' : '') + '<br><span class="pcat">' + esc(r.chains.slice(0, 3).join(' · ')) + '</span></td>' +
        '<td class="hideS pcat">' + esc(r.category) + '</td>' +
        '<td class="num mono">' + money(r.tvl_usd) + '</td>' +
        '<td class="num hideS mono">' + pct(r.change_7d) + '</td>' +
        '<td class="num mono"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num hideS mono pcat">' + money(r.value_low_usd) + ' – ' + money(r.value_high_usd) + '</td>' +
        '<td class="num"><span class="grade g' + r.grade + '">' + r.grade + '</span> <span class="mono">' + r.signal_score + '</span></td></tr>';
    }).join('');
    return head + body + '</tbody></table></div>';
  }

  function detailHtml() {
    var r = bySlug(state.sel);
    if (!r) return '<aside class="detail"><p class="empty">Select a protocol.</p></aside>';
    var age = r.age_days === null ? 'unknown' : (r.age_days >= 365 ? (r.age_days / 365).toFixed(1) + ' years' : r.age_days + ' days');
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    return '<aside class="detail" id="detail">' +
      '<h2>' + esc(r.name) + '</h2>' +
      '<div class="sub">Rank #' + r.rank + ' of ' + R.eligible + ' · ' + esc(r.category) + ' · ' + esc(r.chains.join(', ')) + (r.on_watchlist ? ' · on the house watchlist' : ' · radar find beyond the watchlist') + '</div>' +
      '<div class="cards">' +
      '<div class="card"><b>' + money(r.implied_value_usd) + '</b><span>implied value if launched today</span></div>' +
      '<div class="card"><b>' + money(r.tvl_usd) + '</b><span>TVL in snapshot</span></div>' +
      '<div class="card"><b>' + r.peer_multiple.toFixed(2) + '×</b><span>peer multiple · ' + r.peer_count + ' priced peers in category</span></div>' +
      '<div class="card"><b>' + age + '</b><span>running with no recorded token</span></div>' +
      '</div>' +
      '<h3>Value range</h3><div class="rangebar"><i style="left:6%;width:62%"></i></div>' +
      '<p class="mono">' + money(r.value_low_usd) + ' conservative ——— ' + money(r.value_high_usd) + ' if it prices like the stronger half of its peers</p>' +
      '<h3>How this number is built</h3>' +
      '<div class="formula">TVL ' + money(r.tvl_usd) + ' × peer ' + r.peer_multiple.toFixed(2) + '×\n× momentum ' + r.momentum_factor.toFixed(2) + ' (7d ' + (r.change_7d === null ? 'n/a' : r.change_7d.toFixed(1) + '%') + ')' +
      '\n× seasoning ' + r.seasoning_factor.toFixed(2) + ' · × reach ' + r.reach_factor.toFixed(2) + ' (' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') + ')\n= ' + money(r.implied_value_usd) + ' implied</div>' +
      '<h3>Why it ranks here</h3><p>' + esc(r.why) + '</p>' +
      '<h3>Farm plan — concrete steps</h3><ol class="steps">' + steps + '</ol>' +
      '<h3>Risk note</h3><div class="risk">' + esc(r.risks) + '</div>' +
      '</aside>';
  }

  function methodHtml() {
    var multRows = R.category_multiples.slice(0, 14).map(function (m) {
      return '<tr><td>' + esc(m.category) + '</td><td class="num mono">' + m.multiple.toFixed(2) + '×</td><td class="num mono">' + m.peers + '</td></tr>';
    }).join('');
    return '<section class="method" id="method"><h2>METHOD — HOW THE RADAR PRICES A TOKEN THAT DOES NOT EXIST YET</h2>' +
      '<p><b>Step 1 · Separate.</b> Of the ' + R.scanned + ' protocols in the snapshot, ' + R.tokened + ' already record a token (a symbol or CoinGecko id) and are used only as pricing evidence. ' + R.set_aside + ' record no token but are set aside: wrapped, staked and bridged products of tokens that already trade, central exchanges, exchange-branded staking, and version-suffix clones (a “V2” is a redeploy, not a new launch). The remaining <b>' + R.eligible + '</b> are the board. Every one of the ' + R.watchlist_size + ' house-watchlist protocols is on it, plus the early protocols between the snapshot’s $5M inclusion line and the $50M watchlist floor.</p>' +
      '<h3>Step 2 · Borrow the peers’ price</h3><p>For each category, take every token-bearing protocol with a market cap and compute market cap ÷ TVL. The category’s <i>peer multiple</i> is the median of those ratios (categories with fewer than three priced peers borrow the global median, ' + R.global_multiple.toFixed(2) + '×). Medians, not means, so one moonshot cannot price a whole category; every multiple is clamped to 0.03×–3.00× for the same reason.</p>' +
      '<h3>Step 3 · Adjust with the snapshot’s own facts</h3><ul>' +
      '<li><b>Momentum:</b> 1 + clamp(7-day TVL change, −40%, +60%) × 0.45 — growth helps, damped.</li>' +
      '<li><b>Seasoning:</b> 0.90 + 0.04 per year tracked with no token, capped at five years; unknown start dates get 0.92 — surviving without a token is evidence, not a launch promise.</li>' +
      '<li><b>Reach:</b> +2% per extra chain, capped at four — distribution a launch can switch on.</li></ul>' +
      '<p>Implied value = TVL × peer multiple × momentum × seasoning × reach, rounded to whole dollars. The range shown per protocol is 0.52×–1.85× that figure, roughly the spread between the weaker and stronger halves of its peer set. The signal grade (A–D) is triage only — a 0–100 blend of size, momentum, seasoning and reach; the rank itself is pure implied value.</p>' +
      '<h3>Peer multiples used (top categories by priced peers)</h3><table><thead><tr><th>Category</th><th class="num">Median mcap / TVL</th><th class="num">Priced peers</th></tr></thead><tbody>' + multRows + '</tbody></table>' +
      '<h3>Limits, stated plainly</h3><ul>' +
      '<li>DefiLlama recording no token is not proof a protocol has none, and TVL is not revenue: a protocol can hold value it never captures.</li>' +
      '<li>Peer multiples price a category’s past, not this protocol’s future tokenomics — supply, unlocks and float are unknowable from the snapshot and are not guessed here.</li>' +
      '<li>Farm plans assume a launch rewards genuine, repeated use; a protocol may never launch, may exclude your region, or may snapshot without warning.</li></ul></section>';
  }

  function drawCharts() {
    var catCanvas = document.getElementById('chartCat');
    var scatCanvas = document.getElementById('chartScat');
    if (!catCanvas || !scatCanvas) return;
    var dpr = window.devicePixelRatio || 1;
    [catCanvas, scatCanvas].forEach(function (c) {
      var w = c.clientWidth, h = c.clientHeight;
      c.width = w * dpr; c.height = h * dpr; c.getContext('2d').scale(dpr, dpr);
    });
    // Category TVL bars (top 7 categories on the board)
    (function () {
      var ctx = catCanvas.getContext('2d'), w = catCanvas.clientWidth, h = catCanvas.clientHeight;
      var totals = {};
      R.rows.forEach(function (r) { totals[r.category] = (totals[r.category] || 0) + r.tvl_usd; });
      var top = Object.keys(totals).map(function (k) { return [k, totals[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, 7);
      var max = top[0][1];
      ctx.font = '11px sans-serif';
      top.forEach(function (t, i) {
        var y = 8 + i * 23, bw = (w - 205) * (t[1] / max);
        ctx.fillStyle = '#93a9b4'; ctx.fillText(t[0].slice(0, 17), 0, y + 11);
        ctx.fillStyle = i === 0 ? '#3dff9a' : '#1d7a4c'; ctx.fillRect(118, y, Math.max(bw, 2), 13);
        ctx.fillStyle = '#e8f3ec'; ctx.fillText(money(t[1]), 122 + bw + 4, y + 11);
      });
    })();
    // Scatter: log TVL (x) vs log implied value (y), watchlist in amber
    (function () {
      var ctx = scatCanvas.getContext('2d'), w = scatCanvas.clientWidth, h = scatCanvas.clientHeight;
      function lx(v) { return (Math.log10(v) - 6.6) / (10.2 - 6.6) * (w - 26) + 14; }
      function ly(v) { return h - 14 - (Math.log10(v) - 5.6) / (10.2 - 5.6) * (h - 26); }
      ctx.strokeStyle = '#1d3648'; ctx.beginPath(); ctx.moveTo(14, h - 14); ctx.lineTo(w - 8, h - 14); ctx.moveTo(14, 6); ctx.lineTo(14, h - 14); ctx.stroke();
      R.rows.forEach(function (r) {
        ctx.fillStyle = r.on_watchlist ? '#ffb347' : 'rgba(61,255,154,.65)';
        ctx.beginPath(); ctx.arc(lx(r.tvl_usd), ly(r.implied_value_usd), r.on_watchlist ? 3.4 : 2.4, 0, 7); ctx.fill();
      });
      ctx.fillStyle = '#93a9b4'; ctx.font = '11px sans-serif';
      ctx.fillText('x: TVL (log) · y: implied value (log) · amber = watchlist', 18, 16);
    })();
  }

  function render() {
    var list = filtered();
    if (!list.some(function (r) { return r.slug === state.sel; }) && list.length) state.sel = list[0].slug;
    document.getElementById('asof').innerHTML = 'SNAPSHOT ' + esc(R.as_of) + '<br>' + esc(R.source.split(', fetched')[0].replace('DefiLlama ', ''));
    app.innerHTML = statsHtml() + controlsHtml() +
      '<section class="charts"><div class="chart"><h3>Board TVL by category</h3><canvas id="chartCat"></canvas></div>' +
      '<div class="chart"><h3>TVL vs implied value — every ranked protocol</h3><canvas id="chartScat"></canvas></div></section>' +
      '<div class="layout"><div>' + boardHtml(list) + '</div>' + detailHtml() + '</div>' + methodHtml();
    app.setAttribute('aria-busy', 'false');
    document.getElementById('count').textContent = list.length + ' shown · click a row for its farm plan';
    bind();
    drawCharts();
  }

  function bind() {
    var q = document.getElementById('q');
    q.addEventListener('input', function () { state.q = q.value; refreshBoardOnly(); });
    document.getElementById('cat').addEventListener('change', function (e) { state.cat = e.target.value; render(); });
    document.getElementById('grade').addEventListener('change', function (e) { state.grade = e.target.value; render(); });
    document.getElementById('wl').addEventListener('click', function () { state.wl = !state.wl; render(); });
    app.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () { state.sel = tr.getAttribute('data-slug'); render(); document.getElementById('detail').scrollIntoView({ block: 'nearest' }); });
    });
    app.querySelectorAll('thead th[data-k]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = 1; }
        render();
      });
    });
  }

  // Typing in search should not rebuild the whole page (it would lose focus):
  // rebuild only the board + detail columns.
  function refreshBoardOnly() {
    var list = filtered();
    var layout = app.querySelector('.layout');
    if (!layout) { render(); return; }
    if (!list.some(function (r) { return r.slug === state.sel; }) && list.length) state.sel = list[0].slug;
    layout.innerHTML = '<div>' + boardHtml(list) + '</div>' + detailHtml();
    document.getElementById('count').textContent = list.length + ' shown · click a row for its farm plan';
    app.querySelectorAll('tbody tr').forEach(function (tr) {
      tr.addEventListener('click', function () { state.sel = tr.getAttribute('data-slug'); render(); });
    });
    app.querySelectorAll('thead th[data-k]').forEach(function (th) {
      th.addEventListener('click', function () {
        var k = th.getAttribute('data-k');
        if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = 1; }
        render();
      });
    });
  }

  render();
})();
