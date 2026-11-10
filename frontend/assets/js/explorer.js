/* Campus Explorer — a schematic plan, not a geographic map.
 *
 * No coordinates are used or invented. Each block maps to one of the item
 * location values the board already understands, so the counts shown on the
 * plan are real counts from /api/items.
 */
(function () {
  'use strict';

  var detail = document.getElementById('plan-detail');
  var blocks = [].slice.call(document.querySelectorAll('.blk[data-place]'));
  var byLoc = {};      // item location -> { lost, found, items[] }
  var selected = null;

  function tally(items) {
    byLoc = {};
    items.forEach(function (it) {
      var key = it.location || 'Other';
      if (!byLoc[key]) byLoc[key] = { lost: 0, found: 0, items: [] };
      if (it.type === 'lost') byLoc[key].lost += 1;
      else byLoc[key].found += 1;
      byLoc[key].items.push(it);
    });
  }

  /* Paint the count onto every block that maps to a location with listings. */
  function paintSummary() {
    var host = document.getElementById('plan-summary');
    if (!host) return;
    var total = 0;
    var places = 0;
    Object.keys(byLoc).forEach(function (k) {
      var b = byLoc[k];
      total += b.lost + b.found;
      if (b.lost + b.found) places += 1;
    });
    host.textContent = total
      ? total + (total === 1 ? ' listing' : ' listings') + ' across ' + places + (places === 1 ? ' place' : ' places')
      : 'Nothing has been reported yet.';
  }

  function paintCounts() {
    blocks.forEach(function (g) {
      var loc = g.getAttribute('data-loc');
      var bucket = byLoc[loc];
      var n = bucket ? bucket.lost + bucket.found : 0;
      var label = g.querySelector('[data-count]');
      // Empty blocks stay silent. Fifteen "nothing yet" labels read as a broken
      // page; a count where there is something reads as a working map.
      if (label) label.textContent = n ? n + (n === 1 ? ' listing' : ' listings') : '';
      g.classList.toggle('has-items', n > 0);
      g.classList.toggle('has-lost', !!(bucket && bucket.lost));
      g.classList.toggle('has-found', !!(bucket && bucket.found));
    });
  }

  function renderDetail(place, loc) {
    var bucket = byLoc[loc] || { lost: 0, found: 0, items: [] };
    var nameEl = document.getElementById('pd-name');
    var descEl = document.getElementById('pd-desc');
    var countsEl = document.getElementById('pd-counts');
    var itemsEl = document.getElementById('pd-items');

    if (!detail) return;
    nameEl.textContent = place;
    descEl.textContent = 'Listings reported at ' + place + ' on the board.';

    if (!bucket.items.length) {
      countsEl.innerHTML = '';
      itemsEl.innerHTML = '<p class="pd-empty">Nothing has been reported here yet.</p>';
      return;
    }

    countsEl.innerHTML =
      '<span class="pill pill--lost">' + bucket.lost + ' lost</span>' +
      '<span class="pill pill--found">' + bucket.found + ' found</span>';

    itemsEl.innerHTML = '<ul class="pd-list">' + bucket.items.slice(0, 6).map(function (it) {
      var cls = it.type === 'lost' ? 'lost' : 'found';
      return '<li><span class="tag tag--' + cls + '">' + (it.type === 'lost' ? 'Lost' : 'Found') + '</span>'
        + '<span class="pd-title"></span></li>';
    }).join('') + '</ul>';

    // fill titles as text, never as markup
    var titles = itemsEl.querySelectorAll('.pd-title');
    bucket.items.slice(0, 6).forEach(function (it, i) {
      if (titles[i]) titles[i].textContent = it.title || 'Untitled';
    });

    itemsEl.insertAdjacentHTML('beforeend',
      '<a class="btn btn--sm" href="index.html">See these on the board</a>');
  }

  function select(g) {
    blocks.forEach(function (b) { b.classList.remove('on'); b.setAttribute('aria-pressed', 'false'); });
    g.classList.add('on');
    g.setAttribute('aria-pressed', 'true');
    selected = g.getAttribute('data-place');
    renderDetail(selected, g.getAttribute('data-loc'));
  }

  blocks.forEach(function (g) {
    g.setAttribute('aria-pressed', 'false');
    g.addEventListener('click', function () { select(g); });
    g.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(g); }
    });
  });

  /* Load the listings once and paint the plan. A failure leaves the plan
     visible with no counts rather than an empty page. */
  fetch('/api/items?limit=100')
    .then(function (r) { return r.ok ? r.json() : { items: [] }; })
    .then(function (data) { tally(Array.isArray(data.items) ? data.items : []); paintCounts(); paintSummary(); })
    .catch(function () { paintCounts(); paintSummary(); });
})();
