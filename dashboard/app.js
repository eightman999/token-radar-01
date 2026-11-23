// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, the filters, a per-protocol detail drawer with the model's own arithmetic and the
// protocol's farm plan, and the "how this ranking works" section. No network: every byte the page
// shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtUsdLong(n) {
    return n === null || n === undefined || !isFinite(n) ? 'n/a' : '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'n/a';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(2); }

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  // ---- state in the URL hash, so a filtered view is a shareable link ----
  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('cat')) state.category = params.get('cat');
    if (params.get('ch')) state.chain = params.get('ch');
    if (params.get('tab')) state.tab = params.get('tab');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('cat', state.category);
    if (state.chain !== 'all') params.set('ch', state.chain);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // ---- filtering and sorting ----
  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Uncategorized') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'category') { av = (a.category || 'Uncategorized').toLowerCase(); bv = (b.category || 'Uncategorized').toLowerCase(); }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'ratio') { av = a.implied_value_usd / a.tvl_usd; bv = b.implied_value_usd / b.tvl_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---- page sections ----
  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' },
        el('span', { class: 'mark', 'aria-hidden': 'true' }),
        el('span', { class: 'brand-name', text: 'Token Radar' })
      ),
      el('div', { class: 'top-meta' },
        el('span', { text: 'snapshot ' + DATA.as_of }),
        el('span', { text: DATA.protocols_size + ' protocols indexed' }),
        el('span', { text: 'model ' + DATA.model_version })
      )
    );
  }

  function stat(value, label) {
    return el('div', { class: 'stat' }, el('b', { text: value }), el('span', { text: label }));
  }

  function lede() {
    var floor = '$' + Math.round(DATA.floor_usd / 1e6) + 'M';
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { text: 'Pre-token protocols, ranked by implied launch value' }),
        el('p', { text: 'Every protocol on the snapshot\u2019s watchlist (' + floor + '+ TVL, no token recorded) plus every other pre-token protocol that passes the same exclusion rules. Each implied value is what the protocol\u2019s token would be worth at its category\u2019s own market-cap-to-TVL ratio, adjusted for momentum, distribution and maturity. A model, not a promise.' })
      ),
      el('div', { class: 'stats' },
        stat(DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'watchlist covered'),
        stat(String(DATA.board_size), 'pre-token rows'),
        stat(String(DATA.early_size), 'beyond the watchlist'),
        stat(fmtMult(DATA.global_multiple), 'global mcap/tvl median')
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorized'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSel = el('select', { id: 'cat', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); render(); });
    var chainSel = el('select', { id: 'ch', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); render(); });
    var pre = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; writeHash(); render(); } });
    var live = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; writeHash(); render(); } });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'cat', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'ch', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('label', { text: 'Token status' }), el('div', { class: 'tabs' }, pre, live)),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label, cls) {
    var active = state.sort === key;
    return el('th', { scope: 'col', class: cls || '' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' || key === 'category' ? 1 : -1; } render(); } },
        label,
        active ? el('span', { class: 'dir', 'aria-hidden': 'true', text: state.dir < 0 ? '▼' : '▲' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category or chain to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growthClass = r.change_7d === null ? 'dim' : r.change_7d >= 0 ? 'pos' : 'neg';
      var chains = r.chains || [];
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        class: r.watchlist ? 'watchlist' : '',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num dim', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: r.slug })
        )),
        el('td', null, el('span', { class: 'tag', text: r.category || 'Uncategorized' })),
        el('td', { class: 'num dim', title: chains.join(', '), text: chains.length === 0 ? '—' : chains.length + ' · ' + chains.slice(0, 2).join(', ') + (chains.length > 2 ? '…' : '') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: fmtPct(r.change_7d) }),
        el('td', { class: 'num dim', text: fmtAge(r.age_days) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num dim', text: 'x' + (r.implied_value_usd / r.tvl_usd).toFixed(2) })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. A green edge marks the watchlist. Select a row for the model breakdown and farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('rank', '#'),
            sortHeader('name', 'Protocol'),
            sortHeader('category', 'Category'),
            sortHeader('chains', 'Chains'),
            sortHeader('tvl', 'TVL', 'num'),
            sortHeader('growth', '7d', 'num'),
            sortHeader('age', 'Age', 'num'),
            sortHeader('implied', 'Implied value', 'num'),
            sortHeader('ratio', 'Imp./TVL', 'num')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', { class: 'dim-row' },
        el('td', { class: 'num dim', text: 'live' }),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.slug }))),
        el('td', null, el('span', { class: 'tag', text: r.category || 'Uncategorized' })),
        el('td', { class: 'num dim', text: (r.chains || []).length === 0 ? '—' : String((r.chains || []).length) }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num dim', text: r.ratio === null ? 'n/a' : fmtMult(r.ratio) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'These protocols already trade: their market cap is a fact, not a model, and it is the peer set the implied values are derived from. They are set aside from the ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'Category' }),
            el('th', { scope: 'col', class: 'num', text: 'Chains' }),
            el('th', { scope: 'col', class: 'num', text: 'TVL' }),
            el('th', { scope: 'col', class: 'num', text: '7d' }),
            el('th', { scope: 'col', class: 'num', text: 'Market cap' }),
            el('th', { scope: 'col', class: 'num', text: 'Mcap/TVL' })
          )),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var multRows = DATA.categories.map(function (c) {
      return el('tr', null,
        el('td', { text: c.category }),
        el('td', { class: 'num', text: String(c.peers) }),
        el('td', { class: 'num', text: fmtMult(c.multiple) }),
        el('td', { class: 'dim', text: c.own_median ? 'own median' : 'global fallback' })
      );
    });
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How this ranking works' }),
      el('p', { class: 'sub dim', text: 'One function of the snapshot\u2019s own figures scores every row. No protocol name is special-cased and no row is hand-picked; the same code writes board.json.' }),
      el('div', { class: 'formula' },
        'implied_value = tvl \u00d7 category_multiple \u00d7 momentum \u00d7 distribution \u00d7 maturity\n' +
        'category_multiple = median(mcap / tvl) of the token-bearing protocols in the same category' +
        ' (' + m.min_category_peers + '+ peers, else the global median ' + fmtMult(DATA.global_multiple) + '), bounded to [' + m.multiple_floor + ', ' + m.multiple_cap + ']\n' +
        'momentum = 1 + clamp(change_7d, \u00b1' + m.momentum_clamp_pct + ') / 100 \u00d7 ' + m.momentum_weight + '\n' +
        'distribution = 1 + min(chains \u2212 1, ' + m.chain_bonus_steps + ') \u00d7 ' + m.chain_bonus + '\n' +
        'maturity = ' + m.maturity_floor + ' + ' + (1 - m.maturity_floor).toFixed(1) + ' \u00d7 min(age_days, ' + m.maturity_span_days + ') / ' + m.maturity_span_days + '  (unknown age: ' + m.default_age_days + 'd)'
      ),
      el('div', { class: 'factors' },
        el('div', { class: 'factor' }, el('b', { text: 'Category multiple' }), el('span', { text: 'What the market already pays per dollar of TVL for tokens in this category \u2014 the base value of a launch here.' })),
        el('div', { class: 'factor' }, el('b', { text: 'Momentum' }), el('span', { text: 'Seven-day TVL growth, clamped and halved. A protocol gaining TVL reads as a live launch.' })),
        el('div', { class: 'factor' }, el('b', { text: 'Distribution' }), el('span', { text: 'Each extra chain widens the user base a token could reach, up to +' + (m.chain_bonus_steps * m.chain_bonus * 100).toFixed(0) + '%.' })),
        el('div', { class: 'factor' }, el('b', { text: 'Maturity' }), el('span', { text: 'A discount for very new listings: a fresh entry keeps ' + (m.maturity_floor * 100).toFixed(0) + '% of value, earning the rest over two years.' }))
      ),
      el('h3', { text: 'Derived category multiples' }),
      el('div', { class: 'mults-wrap' },
        el('table', { class: 'mults' },
          el('thead', null, el('tr', null,
            el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Peers' }), el('th', { class: 'num', text: 'Multiple' }), el('th', { text: 'Basis' })
          )),
          el('tbody', null, multRows)
        )
      )
    );
  }

  // ---- detail drawer ----
  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function eq(label, value) {
    return el('div', null, el('span', { text: label }), el('b', { text: value }));
  }

  function openDetail(slug) {
    var row = DATA.rows.filter(function (r) { return r.slug === slug; })[0];
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var chains = row.chains || [];
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'kicker', text: 'rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' \u00b7 watchlist' : '') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Uncategorized') + ' \u00b7 ' + row.slug }),
        el('div', { class: 'chips' }, chains.map(function (c) { return el('span', { class: 'tag', text: c }); }))
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value breakdown' }),
      el('div', { class: 'equation' },
        eq('TVL', fmtUsdLong(row.tvl_usd)),
        eq('Category multiple (' + (row.category || 'Uncategorized') + ', ' + row.category_peers + ' peers)', fmtMult(row.category_multiple)),
        eq('Momentum (' + (row.change_7d === null ? '7d unreported' : fmtPct(row.momentum_pct) + ' over 7d') + ')', '\u00d7' + row.momentum_multiplier.toFixed(3)),
        eq('Distribution (' + chains.length + ' chain' + (chains.length === 1 ? '' : 's') + ')', '\u00d7' + row.distribution_multiplier.toFixed(3)),
        eq('Maturity (' + (row.age_days === null ? 'listing age unrecorded' : fmtAge(row.age_days) + ' listed') + ')', '\u00d7' + row.maturity_multiplier.toFixed(3)),
        el('div', { class: 'total' }, el('span', { text: 'Implied value' }), el('b', { text: fmtUsdLong(row.implied_value_usd) }))
      ),
      el('p', { class: 'sub', text: 'Model ' + DATA.model_version + ': the same function scores every protocol. This is an estimate of what a launch could be worth, not a price or a promise.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan' }),
      el('ol', { class: 'steps' }, row.farm_steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), tail ? el('span', { class: 'cost', text: tail }) : null);
      }))
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    // Rebuilding the shell replaces the search input: remember whether it had focus and restore it
    // (caret at the end) so typing a query does not strand the cursor.
    var refocus = document.activeElement && document.activeElement.id === 'q';
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (refocus) {
      var q = document.getElementById('q');
      if (q) { q.focus(); if (q.setSelectionRange) q.setSelectionRange(q.value.length, q.value.length); }
    }
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
