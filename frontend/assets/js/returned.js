(function () {
  "use strict";

  function fatal(e) {
    var box = document.getElementById('ret-error');
    if (box) {
      box.textContent = 'This page could not load its data: ' +
        ((e && e.message) || e || 'unknown error');
      box.dataset.show = 'true';
    }
    try { console.error('[returned]', e); } catch (_) {}
  }
  window.addEventListener('error', function (ev) { fatal(ev.error || ev.message); });
  window.addEventListener('unhandledrejection', function (ev) { fatal(ev.reason); });

  var grid = document.getElementById('ret-grid');
  var empty = document.getElementById('ret-empty');
  var count = document.getElementById('ret-count');
  var errorBox = document.getElementById('ret-error');
  var q = document.getElementById('ret-q');
  var type = document.getElementById('ret-type');
  var cat = document.getElementById('ret-cat');
  var loc = document.getElementById('ret-loc');
  var sort = document.getElementById('ret-sort');

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function when(v) {
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }
  function showError(msg) {
    errorBox.textContent = msg || '';
    errorBox.dataset.show = msg ? 'true' : 'false';
  }

  const CATEGORY_ART = {
  'Bottles': '<path d="M10 2h4v3l1.5 3v12a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2V8L10 5z"/><path d="M9 12h6"/>',
  'Electronics': '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2" y="14" width="4" height="6" rx="1.5"/><rect x="18" y="14" width="4" height="6" rx="1.5"/>',
  'Clothing': '<path d="M8 3l4 2 4-2 5 3-2 4-2-1v11H7V9L5 10 3 6z"/>',
  'Books & Notes': '<path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z"/><path d="M8 3v18"/>',
  'IDs & Cards': '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M13 10h6M13 14h4M5 16h5"/>',
  'Keys & Accessories': '<circle cx="8" cy="8" r="4"/><path d="M11 11l9 9M17 17l2-2M14 14l2-2"/>',
  'Other': '<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/>'
};

function artFor(category) {
  const d = CATEGORY_ART[category] || CATEGORY_ART['Other'];
  return '<svg viewBox="0 0 24 24" width="46" height="46" fill="none" stroke="currentColor" '
    + 'stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
    + d + '</svg>';
}

function card(item) {
    var place = item.location === 'Other' && item.customLocation ? item.customLocation : item.location;
    var media = item.imageUrl
      ? '<div class="card__media"><img src="' + esc(item.imageUrl) + '" alt="' + esc(item.title) + '" loading="lazy"></div>'
      : '<div class="card__media card__media--empty" aria-hidden="true">' +
        artFor(item.category) +
        '<span>' + esc(item.subcategory || item.category || 'Item') + '</span></div>';
    return '<a class="card" href="index.html?item=' + encodeURIComponent(item.id) +
      '" aria-label="Open ' + esc(item.title) + '">' +
      media +
      '<div class="card__top">' +
        '<span class="tag tag--' + esc(item.type) + '">' + (item.type === 'lost' ? 'Lost' : 'Found') + '</span>' +
        '<span class="status-pill status-pill--returned">Returned</span>' +
      '</div>' +
      '<h3 class="card__title">' + esc(item.title) + '</h3>' +
      '<p class="card__desc">' + esc(item.description) + '</p>' +
      '<div class="card__meta"><span>' + esc(place) + '</span><span>' + when(item.date) + '</span></div>' +
    '</a>';
  }

  function load() {
    showError('');
    grid.setAttribute('aria-busy', 'true');
    var p = new URLSearchParams();
    p.set('status', 'returned');
    p.set('limit', '60');
    if (q.value.trim()) p.set('q', q.value.trim());
    if (type.value) p.set('type', type.value);
    if (cat.value) p.set('category', cat.value);
    if (loc.value) p.set('location', loc.value);
    if (sort.value) p.set('sort', sort.value);

    var base = (typeof window.FOUNDRY_API_BASE === 'string' && window.FOUNDRY_API_BASE)
      ? window.FOUNDRY_API_BASE.replace(/\/+$/, '')
      : window.location.origin + '/api';

    fetch(base + '/items?' + p.toString(), { headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('The server answered ' + r.status);
        return r.json();
      })
      .then(function (data) {
        var items = (data && data.items) || [];
        grid.setAttribute('aria-busy', 'false');
        count.textContent = items.length + (items.length === 1 ? ' item' : ' items');
        if (!items.length) {
          grid.innerHTML = '';
          var filtered = !!(q.value.trim() || type.value || cat.value || loc.value);
          document.getElementById('ret-empty-title').textContent =
            filtered ? 'No returned items match those filters.' : 'Nothing has been returned yet.';
          document.getElementById('ret-empty-note').textContent =
            filtered ? 'Try clearing a filter.' : 'When an item is handed back, it moves here from the board.';
          empty.hidden = false;
          return;
        }
        empty.hidden = true;
        grid.innerHTML = items.map(card).join('');
      })
      .catch(function (err) {
        grid.setAttribute('aria-busy', 'false');
        count.textContent = '—';
        empty.hidden = true;
        showError((err && err.message) || 'Could not load returned items.');
      });
  }

  (function meta() {
    var base = (typeof window.FOUNDRY_API_BASE === 'string' && window.FOUNDRY_API_BASE)
      ? window.FOUNDRY_API_BASE.replace(/\/+$/, '')
      : window.location.origin + '/api';
    fetch(base + '/items/meta', { headers: { Accept: 'application/json' } })
      .then(function (r) { return r.json(); })
      .then(function (m) {
        (m.categories || []).forEach(function (c) {
          var o = document.createElement('option'); o.value = c; o.textContent = c; cat.appendChild(o);
        });
        (m.locations || []).forEach(function (l) {
          var o = document.createElement('option'); o.value = l; o.textContent = l; loc.appendChild(o);
        });
      })
      .catch(function () {  });
  })();

  var timer = null;
  q.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(load, 250); });
  [type, cat, loc, sort].forEach(function (el) { el.addEventListener('change', load); });
  document.getElementById('ret-reset').addEventListener('click', function () {
    q.value = ''; type.value = ''; cat.value = ''; loc.value = ''; sort.value = 'newest'; load();
  });

  load();
})();
