// Launch Radar's dashboard, version 3. It reads window.RADAR (written
// beside dashboard/ by main.ts) and renders the ranked board, filters for
// category, chain, TVL and age, a compare view for up to three protocols,
// a per-protocol detail drawer with the model's own inputs and the
// protocol's eight-step farm plan, the full calibration table the model
// was priced from, and the method in plain words. No network: every byte
// it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = {
    q: '', category: 'all', chain: 'all', tvl: 'any', age: 'any',
    tab: 'pre-token', sort: 'implied', dir: -1, selected: null,
    compare: [], showCompare: false,
  };

  var usdFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function money(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usdFmt.format(n);
  }
  function pct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function ageLabel(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function ratioLabel(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return n.toFixed(3) + 'x';
  }
  // The model in one function: the page recomputes a row from the figures
  // data.js carries and checks the number board.json holds, so the page's
  // code and the board's data are visibly the same arithmetic.
  function revalue(row) {
    return Math.max(1, Math.round(row.tvl_usd * row.category_ratio * row.growth_multiplier * row.momentum_multiplier * row.maturity_multiplier));
  }

  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
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

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('tvl')) state.tvl = params.get('tvl');
    if (params.get('age')) state.age = params.get('age');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('cmp')) state.compare = params.get('cmp').split(',').filter(function (s) { return s; }).slice(0, 3);
    if (params.get('cmp')) state.showCompare = state.compare.length >= 2;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.tvl !== 'any') params.set('tvl', state.tvl);
    if (state.age !== 'any') params.set('age', state.age);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    if (state.compare.length) params.set('cmp', state.compare.join(','));
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function ageBand(days) {
    var d = days === null || days === undefined ? 365 : days;
    if (d < 180) return 'young';
    if (d < 365) return 'mid';
    if (d < 1095) return 'mature';
    return 'old';
  }
  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && !(r.chains || []).some(function (c) { return c === state.chain; })) return false;
      if (state.tvl !== 'any' && r.tvl_usd < Number(state.tvl)) return false;
      if (state.age !== 'any' && ageBand(r.age_days) !== state.age) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function ordered(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function rowBySlug(slug) {
    return DATA.rows.filter(function (r) { return r.slug === slug; })[0] || null;
  }
  function toggleCompare(slug) {
    var at = state.compare.indexOf(slug);
    if (at >= 0) state.compare.splice(at, 1);
    else if (state.compare.length < 3) state.compare.push(slug);
    if (state.compare.length < 2) state.showCompare = false;
    writeHash();
    render();
  }

  function pageHeader() {
    return h('header', { class: 'top' },
      h('div', { class: 'brand' },
        h('span', { class: 'radar-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'brand-name' }, 'LAUNCH RADAR', h('small', { text: 'Token launch radar' }))
      ),
      h('div', { class: 'top-meta' },
        h('span', { text: 'Snapshot ' + DATA.as_of }),
        h('span', { text: 'DefiLlama protocol index' }),
        h('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function pageLede() {
    return h('section', { class: 'lede' },
      h('h1', { text: 'Every pre-token protocol, ranked by what its token would be worth' }),
      h('p', { text: 'The watchlist is the floor: the 40 protocols the snapshot names, every one of them ranked here. The early radar adds every other genuine launch candidate in the snapshot, whatever its size — including the large ones the watchlist skipped. Implied value is a model calibrated on the market, not a price and not a promise.' }),
      h('div', { class: 'stats' },
        h('div', { class: 'stat' }, h('span', { text: 'Watchlist covered' }), h('b', { class: 'amber', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        h('div', { class: 'stat' }, h('span', { text: 'Pre-token rows scored' }), h('b', { text: String(DATA.board_size) })),
        h('div', { class: 'stat' }, h('span', { text: 'Early radar rows' }), h('b', { text: String(DATA.early_size) })),
        h('div', { class: 'stat' }, h('span', { text: 'Total implied value' }), h('b', { text: money(DATA.total_implied_usd) })),
        h('div', { class: 'stat' }, h('span', { text: 'Categories covered' }), h('b', { text: String(DATA.category_count) })),
        h('div', { class: 'stat' }, h('span', { text: 'Live protocols priced' }), h('b', { text: String(DATA.live_size) }))
      )
    );
  }

  function pageControls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chainSet = {};
    DATA.rows.forEach(function (r) { (r.chains || []).forEach(function (c) { chainSet[c] = true; }); });
    var chains = Object.keys(chainSet).sort();
    var search = h('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var catSelect = h('select', { id: 'category', 'aria-label': 'Filter by category' },
      h('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return h('option', { value: c, text: c + ' (' + DATA.rows.filter(function (r) { return (r.category || 'Other') === c; }).length + ')', selected: c === state.category ? 'selected' : null }); })
    );
    catSelect.addEventListener('change', function () { state.category = catSelect.value; writeHash(); render(); });
    var chainSelect = h('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      h('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return h('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSelect.addEventListener('change', function () { state.chain = chainSelect.value; writeHash(); render(); });
    var tvlOptions = [['any', 'Any TVL'], ['1000000000', 'TVL $1B+'], ['500000000', 'TVL $500M+'], ['100000000', 'TVL $100M+'], ['50000000', 'TVL $50M+'], ['10000000', 'TVL $10M+']];
    var tvlSelect = h('select', { id: 'tvl', 'aria-label': 'Filter by minimum TVL' },
      tvlOptions.map(function (o) { return h('option', { value: o[0], text: o[1], selected: o[0] === state.tvl ? 'selected' : null }); })
    );
    tvlSelect.addEventListener('change', function () { state.tvl = tvlSelect.value; writeHash(); render(); });
    var ageOptions = [['any', 'Any age'], ['young', 'Under 6 months'], ['mid', '6–12 months'], ['mature', '1–3 years'], ['old', 'Over 3 years']];
    var ageSelect = h('select', { id: 'age', 'aria-label': 'Filter by protocol age' },
      ageOptions.map(function (o) { return h('option', { value: o[0], text: o[1], selected: o[0] === state.age ? 'selected' : null }); })
    );
    ageSelect.addEventListener('change', function () { state.age = ageSelect.value; writeHash(); render(); });
    var pre = h('button', { type: 'button', 'aria-pressed': state.tab === 'pre-token' ? 'true' : 'false', text: 'Pre-token', onclick: function () { state.tab = 'pre-token'; render(); } });
    var live = h('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live token', onclick: function () { state.tab = 'live'; render(); } });
    return h('div', { class: 'controls' },
      h('div', { class: 'field' }, h('label', { for: 'q', text: 'Search' }), search),
      h('div', { class: 'field' }, h('label', { for: 'category', text: 'Category' }), catSelect),
      h('div', { class: 'field' }, h('label', { for: 'chain', text: 'Chain' }), chainSelect),
      h('div', { class: 'field' }, h('label', { for: 'tvl', text: 'Min TVL' }), tvlSelect),
      h('div', { class: 'field' }, h('label', { for: 'age', text: 'Age' }), ageSelect),
      h('div', { class: 'field' }, h('span', { class: 'lab', text: 'Token status' }), h('div', { class: 'tabs' }, pre, live)),
      h('span', { class: 'count', text: state.tab === 'pre-token' ? filtered().length + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function compareTray() {
    if (state.compare.length === 0) return null;
    var chips = state.compare.map(function (slug) {
      var r = rowBySlug(slug);
      return h('span', { class: 'chip' }, r ? r.name : slug,
        h('button', { type: 'button', 'aria-label': 'Remove ' + (r ? r.name : slug), text: '×', onclick: function (e) { e.stopPropagation(); toggleCompare(slug); } }));
    });
    return h('div', { class: 'tray' },
      h('b', { text: 'Compare (' + state.compare.length + '/3)' }),
      chips,
      h('button', { class: 'go', type: 'button', disabled: state.compare.length < 2 ? 'disabled' : null, text: state.showCompare ? 'Hide comparison' : 'Compare side by side', onclick: function () { state.showCompare = !state.showCompare; render(); } })
    );
  }

  function comparePanel() {
    if (!state.showCompare || state.compare.length < 2) return null;
    var picked = state.compare.map(rowBySlug).filter(function (r) { return r; });
    var best = Math.max.apply(null, picked.map(function (r) { return r.implied_value_usd; }));
    var cards = picked.map(function (r) {
      return h('div', { class: 'cmp-card' },
        h('h3', { text: r.name }),
        h('span', { class: 'sub', text: 'Rank ' + r.rank + ' · ' + (r.category || 'Other') + (r.watchlist ? ' · Watchlist' : ' · Early') }),
        h('div', { class: 'big', text: money(r.implied_value_usd) + (r.implied_value_usd === best ? ' ★' : '') }),
        h('dl', null,
          h('dt', { text: 'TVL' }), h('dd', { text: money(r.tvl_usd) }),
          h('dt', { text: 'Category ratio' }), h('dd', { text: ratioLabel(r.category_ratio) + ' · n=' + r.category_live_count }),
          h('dt', { text: '7d growth' }), h('dd', { text: pct(r.change_7d) }),
          h('dt', { text: 'Category momentum' }), h('dd', { text: pct(r.momentum_pct) + ' → ' + r.momentum_multiplier.toFixed(3) }),
          h('dt', { text: 'Maturity' }), h('dd', { text: r.maturity_multiplier.toFixed(3) + ' · ' + ageLabel(r.age_days) }),
          h('dt', { text: 'Chains' }), h('dd', { text: (r.chains || []).slice(0, 3).join(', ') || '—' }),
          h('dt', { text: 'Farm steps' }), h('dd', { text: String(r.farm_steps.length) })
        )
      );
    });
    return h('section', { class: 'panel' },
      h('h2', { text: 'Side by side' }),
      h('p', { class: 'sub', text: 'The same model, the same figures, two or three protocols at once. The star marks the highest implied value of the set.' }),
      h('div', { class: 'cmp-grid cols-' + picked.length }, cards)
    );
  }

  function sortHead(key, label, num) {
    return h('th', { scope: 'col', class: num ? 'num' : null },
      h('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? h('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' v' : ' ^' }) : null
      )
    );
  }

  function boardTable() {
    var list = ordered(filtered());
    if (list.length === 0) {
      return h('div', { class: 'panel' }, h('div', { class: 'empty' },
        h('h2', { text: 'No protocol matches that filter' }),
        h('p', { text: 'Clear the search or loosen a filter to see the board again.' }),
        h('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.tvl = 'any'; state.age = 'any'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = h('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : pct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var picked = state.compare.indexOf(r.slug) >= 0;
      var tr = h('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        h('td', { class: 'num', text: String(r.rank) }),
        h('td', null, h('div', { class: 'name' },
          h('b', { text: r.name }),
          h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + growthClass, text: growth }),
        h('td', { class: 'num', text: ageLabel(r.age_days) }),
        h('td', null, h('div', { class: 'implied' },
          h('div', { class: 'bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          h('span', { class: 'num', text: money(r.implied_value_usd) })
        )),
        h('td', null, h('span', { class: r.watchlist ? 'badge watch' : 'badge', text: r.watchlist ? 'watchlist' : 'early' })),
        h('td', null, h('button', { class: 'cmp-btn', type: 'button', 'aria-pressed': picked ? 'true' : 'false', text: picked ? '✓ Added' : '+ Compare', onclick: function (e) { e.stopPropagation(); toggleCompare(r.slug); } }))
      );
      tbody.appendChild(tr);
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', { class: 'board-table' },
          h('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan; add up to three to the compare tray.' }),
          h('thead', null, h('tr', null,
            h('th', { scope: 'col', class: 'num', text: 'Rank' }),
            sortHead('name', 'Protocol'),
            sortHead('tvl', 'TVL', true),
            sortHead('growth', '7d', true),
            sortHead('age', 'Age', true),
            sortHead('implied', 'Implied value'),
            h('th', { scope: 'col', text: 'Board' }),
            h('th', { scope: 'col', text: 'Compare' })
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = h('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(h('tr', null,
        h('td', null, h('span', { class: 'badge live', text: 'live' })),
        h('td', null, h('div', { class: 'name' }, h('b', { text: r.name }), h('span', { class: 'sub', text: (r.category || 'Other') + ' on ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        h('td', { class: 'num', text: money(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: pct(r.change_7d) }),
        h('td', { class: 'num', text: money(r.mcap_usd) }),
        h('td', { class: 'num', text: r.mcap_usd && r.tvl_usd ? (r.mcap_usd / r.tvl_usd).toFixed(2) + 'x' : 'n/a' })
      ));
    });
    return h('div', { class: 'panel' },
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('caption', { class: 'sub', text: 'Token live: all ' + DATA.live.length + ' protocols whose token already trades, by market cap. Their market cap is a fact, not a model. They are the calibration set the pre-token ratios and momentum come from, and they are set aside from the ranking.' }),
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Status' }), h('th', { scope: 'col', text: 'Protocol' }), h('th', { scope: 'col', class: 'num', text: 'TVL' }), h('th', { scope: 'col', class: 'num', text: '7d' }), h('th', { scope: 'col', class: 'num', text: 'Market cap' }), h('th', { scope: 'col', class: 'num', text: 'Mcap / TVL' }))),
          tbody
        )
      )
    );
  }

  function methodPanel() {
    var t = DATA.tuning;
    return h('section', { class: 'panel' },
      h('h2', { text: 'How implied value is computed' }),
      h('p', { class: 'sub', text: 'One function scores every protocol. No name is special-cased, no row is hand-picked, and the dashboard recomputes every row from the same figures.' }),
      h('div', { class: 'formula' },
        'implied = round( tvl_usd x category_ratio x (1 + clamp(change_7d, ' + t.growth_low + ', ' + t.growth_high + ') / 100 x ' + t.growth_weight + ') x (1 + clamp(category_momentum, ' + t.momentum_low + ', ' + t.momentum_high + ') / 100 x ' + t.momentum_weight + ') x (' + t.maturity_low + ' + min(age_days, ' + t.maturity_days + ') / ' + t.maturity_days + ' x ' + (1 - t.maturity_low).toFixed(1) + ') )'
      ),
      h('div', { class: 'method-grid' },
        h('div', null,
          h('h3', { text: 'What the model does' }),
          h('ul', null,
            h('li', null, h('b', { text: 'Ratio. ' }), 'The median market-cap / TVL of the category\'s live protocols, shrunk toward the global median of ' + ratioLabel(DATA.global_ratio) + ' when fewer than ' + t.shrink_n + ' live protocols speak for the category, clipped to [' + t.ratio_low + ', ' + t.ratio_high + '].'),
            h('li', null, h('b', { text: 'Growth. ' }), 'The protocol\'s own seven-day TVL change, clamped and weighted by half.'),
            h('li', null, h('b', { text: 'Momentum. ' }), 'The category\'s seven-day drift: the median change of its live protocols, clamped and weighted by a quarter. A category in a broad drawdown prices below one holding steady.'),
            h('li', null, h('b', { text: 'Maturity. ' }), 'Age since first listing, the best record of how long a protocol has run with no token; an unlisted age uses ' + t.unknown_age_days + ' days, the same assumption the age filter uses.')
          )
        ),
        h('div', null,
          h('h3', { text: 'What the board leaves out' }),
          h('ul', null,
            h('li', null, h('b', { text: 'Wrapped, staked and bridged products ' }), 'of tokens that already trade are not launches: the board applies the snapshot\'s own exclusion rule to every row below the watchlist.'),
            h('li', null, h('b', { text: 'Protocols that record a token ' }), 'are set aside in the Live token tab, all ' + DATA.live_size + ' of them, whatever their market cap.'),
            h('li', null, h('b', { text: 'A protocol records no token ' }), '— it may still have one its DefiLlama record does not carry. The board never claims otherwise.'),
            h('li', null, h('b', { text: 'Farm plans ' }), 'are eight steps each, derived from the protocol\'s category, chains, TVL and age, with a cost and a time on every step.')
          )
        )
      )
    );
  }

  function calibPanel() {
    var tbody = h('tbody');
    DATA.calibration.forEach(function (c) {
      tbody.appendChild(h('tr', null,
        h('td', { text: c.category }),
        h('td', { class: 'num', text: String(c.live_count) }),
        h('td', { class: 'num', text: c.raw_median === null ? 'n/a' : ratioLabel(c.raw_median) }),
        h('td', { class: 'num', text: ratioLabel(c.ratio) }),
        h('td', { class: 'num ' + (c.momentum_pct !== null && c.momentum_pct >= 0 ? 'pos' : 'neg'), text: pct(c.momentum_pct) }),
        h('td', { class: 'num', text: c.momentum_mult.toFixed(3) })
      ));
    });
    return h('section', { class: 'panel' },
      h('h2', { text: 'Calibration: what the market pays per dollar of TVL' }),
      h('p', { class: 'sub', text: 'All ' + DATA.calibration.length + ' categories with live protocols, most live protocols first. Raw median is the unshrunk median mcap / TVL; ratio used is the shrunk, clipped value the model applies. Momentum is the median seven-day change of the category\'s live protocols, clamped to ±25% and weighted by a quarter. Categories with no live protocol use the global median and carry no momentum signal.' }),
      h('div', { class: 'table-wrap' },
        h('table', null,
          h('thead', null, h('tr', null, h('th', { scope: 'col', text: 'Category' }), h('th', { scope: 'col', class: 'num', text: 'Live protocols' }), h('th', { scope: 'col', class: 'num', text: 'Raw median' }), h('th', { scope: 'col', class: 'num', text: 'Ratio used' }), h('th', { scope: 'col', class: 'num', text: 'Momentum 7d' }), h('th', { scope: 'col', class: 'num', text: 'Momentum mult' }))),
          tbody
        )
      )
    );
  }

  var drawer = null;
  var scrim = null;

  function closeDetail() {
    state.selected = null;
    writeHash();
    if (drawer) { drawer.remove(); drawer = null; }
    if (scrim) { scrim.remove(); scrim = null; }
    render();
  }

  function openDetail(slug) {
    var row = rowBySlug(slug);
    if (!row) return;
    state.selected = slug;
    writeHash();
    if (drawer) drawer.remove();
    if (scrim) scrim.remove();
    scrim = h('div', { class: 'scrim', onclick: function () { closeDetail(); } });
    var recomputed = revalue(row);
    var steps = row.farm_steps.map(function (s) {
      var at = s.indexOf(' Cost: ');
      var action = at >= 0 ? s.slice(0, at) : s;
      var tail = at >= 0 ? s.slice(at + 1) : '';
      return h('li', null, h('b', { text: action }), h('span', { text: tail }));
    });
    drawer = h('aside', { class: 'drawer', role: 'dialog', 'aria-label': row.name + ' details' },
      h('div', { class: 'drawer-head' },
        h('div', null,
          h('span', { class: 'sub', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.watchlist ? ' · Watchlist' : ' · Early radar') }),
          h('h2', { text: row.name }),
          h('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
        ),
        h('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { closeDetail(); } })
      ),
      h('h3', { text: 'Implied value — the breakdown' }),
      h('div', { class: 'equation' },
        h('div', null, h('span', { text: 'TVL' }), h('b', { class: 'num', text: money(row.tvl_usd) })),
        h('div', null, h('span', { text: 'Category ratio (' + (row.category || 'Other') + ')' }), h('b', { class: 'num', text: ratioLabel(row.category_ratio) + ' · n=' + row.category_live_count })),
        h('div', null, h('span', { text: 'Seven-day growth' }), h('b', { class: 'num', text: pct(row.change_7d) })),
        h('div', null, h('span', { text: 'Growth multiplier' }), h('b', { class: 'num', text: row.growth_multiplier.toFixed(3) })),
        h('div', null, h('span', { text: 'Category momentum (7d)' }), h('b', { class: 'num', text: pct(row.momentum_pct) })),
        h('div', null, h('span', { text: 'Momentum multiplier' }), h('b', { class: 'num', text: row.momentum_multiplier.toFixed(3) })),
        h('div', null, h('span', { text: 'Age with no token' }), h('b', { class: 'num', text: ageLabel(row.age_days) })),
        h('div', null, h('span', { text: 'Maturity multiplier' }), h('b', { class: 'num', text: row.maturity_multiplier.toFixed(4) })),
        h('div', { class: 'wide' }, h('span', { text: 'Implied value' }), h('b', { class: 'num', text: money(row.implied_value_usd) }))
      ),
      h('p', { class: 'sub', text: 'This page recomputes the row as ' + money(recomputed) + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ' — the board would be stale if they differed.') + ' An estimate, not a price.' }),
      h('h3', { text: 'Farm plan — eight steps' }),
      h('ol', { class: 'steps' }, steps)
    );
    document.body.appendChild(scrim);
    document.body.appendChild(drawer);
  }

  function render() {
    app.textContent = '';
    var shell = h('div', { class: 'shell' });
    shell.appendChild(pageHeader());
    shell.appendChild(pageLede());
    shell.appendChild(pageControls());
    var tray = compareTray();
    if (tray) shell.appendChild(tray);
    var panel = comparePanel();
    if (panel) shell.appendChild(panel);
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') {
      shell.appendChild(methodPanel());
      shell.appendChild(calibPanel());
    }
    shell.appendChild(h('p', { class: 'foot', text: 'Data: DefiLlama protocol index, snapshot ' + DATA.as_of + '. Implied values are this radar\'s own model, never a price. A protocol records no token — it may still have one its DefiLlama record does not carry.' }));
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (state.selected && !drawer) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer) closeDetail();
  });
})();
