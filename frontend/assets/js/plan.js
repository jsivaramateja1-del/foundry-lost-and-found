(function () {
  'use strict';

  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var root = document.getElementById('cplan');
  if (!root) return;

  var blocks = [].slice.call(root.querySelectorAll('.blk'));
  var rows = [];
  var layerBtns = [].slice.call(root.querySelectorAll('[data-layer]'));
  var panelName = document.getElementById('cp-name');
  var panelMeta = document.getElementById('cp-meta');
  var panelBody = document.getElementById('cp-body');
  var summary = document.getElementById('cp-summary');
  var listBox = document.getElementById('cp-list');

  var byPlace = {};
  var all = [];
  var loaded = false;
  var failed = false;
  var layer = 'all';
  var selected = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function fmtDate(v) {
    if (!v) return '';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
  }

  function kindOf(it) {
    var st = String(it.status || '').toLowerCase();
    if (st === 'returned') return 'returned';
    return String(it.type || '').toLowerCase() === 'lost' ? 'lost' : 'found';
  }

  function placeOf(it) {
    return it.customLocation || it.location || 'Unknown';
  }

  function tally(items) {
    all = items;
    byPlace = {};
    items.forEach(function (it) {
      var p = placeOf(it);
      if (!byPlace[p]) byPlace[p] = { lost: [], found: [], returned: [] };
      byPlace[p][kindOf(it)].push(it);
    });
  }

  function countsFor(place) {
    var b = byPlace[place] || { lost: [], found: [], returned: [] };
    return { lost: b.lost.length, found: b.found.length, returned: b.returned.length };
  }

  function labelFor(place) {
    var c = countsFor(place);
    var n = layer === 'lost' ? c.lost
      : layer === 'found' ? c.found
      : c.lost + c.found + c.returned;
    if (!loaded) return failed ? '?' : '';
    if (n === 0) return '—';
    return String(n);
  }

  function toneFor(place) {
    var c = countsFor(place);
    if (layer === 'lost') return c.lost ? 'lost' : 'none';
    if (layer === 'found') return c.found ? 'found' : 'none';
    if (!c.lost && !c.found && !c.returned) return 'none';
    if (c.lost && c.found) return 'both';
    return c.lost ? 'lost' : 'found';
  }

  function paint() {
    blocks.forEach(function (b) {
      var place = b.getAttribute('data-place');
      var label = b.querySelector('[data-count]');
      if (label) label.textContent = labelFor(place);
      b.classList.remove('tone-lost', 'tone-found', 'tone-both', 'tone-none', 'tone-unknown');
      b.classList.add(failed && !loaded ? 'tone-unknown' : 'tone-' + toneFor(place));
      b.setAttribute('aria-label', place + ': ' + describe(place));
    });

    rows.forEach(function (r) {
      var place = r.getAttribute('data-place');
      var label = r.querySelector('[data-count]');
      if (label) label.textContent = labelFor(place);
      r.classList.remove('tone-lost', 'tone-found', 'tone-both', 'tone-none');
      r.classList.add('tone-' + toneFor(place));
    });

    if (summary) {
      if (failed && !loaded) {
        summary.textContent = 'Listings unavailable';
      } else if (!loaded) {
        summary.textContent = 'Loading listings…';
      } else {
        var withItems = Object.keys(byPlace).filter(function (p) {
          var c = countsFor(p);
          return c.lost + c.found + c.returned > 0;
        }).length;
        summary.textContent = all.length + ' listings across ' + withItems + ' of ' +
          blocks.length + ' places' + (truncated ? ' (most recent only)' : '');
      }
    }
  }

  function describe(place) {
    var c = countsFor(place);
    if (failed && !loaded) return 'listings could not be loaded';
    if (layer === 'lost') return c.lost + ' lost';
    if (layer === 'found') return c.found + ' found';
    var parts = [];
    if (c.lost) parts.push(c.lost + ' lost');
    if (c.found) parts.push(c.found + ' found');
    if (c.returned) parts.push(c.returned + ' returned');
    return parts.length ? parts.join(', ') : 'nothing reported';
  }

var CATEGORY_ART = {
  'Bottles': '<path d="M10 2h4v3l1.5 3v12a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2V8L10 5z"/><path d="M9 12h6"/>',
  'Electronics': '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="2" y="14" width="4" height="6" rx="1.5"/><rect x="18" y="14" width="4" height="6" rx="1.5"/>',
  'Clothing': '<path d="M8 3l4 2 4-2 5 3-2 4-2-1v11H7V9L5 10 3 6z"/>',
  'Books & Notes': '<path d="M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2z"/><path d="M8 3v18"/>',
  'IDs & Cards': '<rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="8" cy="11" r="2"/><path d="M13 10h6M13 14h4M5 16h5"/>',
  'Keys & Accessories': '<circle cx="8" cy="8" r="4"/><path d="M11 11l9 9M17 17l2-2M14 14l2-2"/>',
  'Other': '<path d="M3 8l9-5 9 5v9l-9 5-9-5z"/><path d="M3 8l9 5 9-5M12 13v9"/>'
};

function categoryArt(category) {
  var d = CATEGORY_ART[category] || CATEGORY_ART['Other'];
  var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.3');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = d;
  return svg;
}

  function listingRow(it) {
    var a = el('a', 'cp-item');
    a.href = '#';
    a.setAttribute('data-item-id', it.id);

    var art = el('span', 'cp-item__art');
    art.setAttribute('aria-hidden', 'true');
    if (it.imageUrl) {
      var img = el('img');
      img.src = it.imageUrl;
      img.alt = '';
      img.loading = 'lazy';
      img.addEventListener('error', function () {
        if (img.parentNode) img.parentNode.removeChild(img);
      });
      art.appendChild(img);
    } else {
      art.appendChild(categoryArt(it.category));
    }
    a.appendChild(art);

    var mid = el('span', 'cp-item__mid');
    mid.appendChild(el('span', 'cp-item__t', it.title || 'Untitled item'));
    mid.appendChild(el('span', 'cp-item__m',
      kindLabel(it) + ' · ' + fmtDate(it.date || it.createdAt)));
    a.appendChild(mid);

    a.addEventListener('click', function (ev) {
      ev.preventDefault();

      if (typeof window.FoundryOpenItem === 'function') window.FoundryOpenItem(it.id);
    });
    return a;
  }

  function kindLabel(it) {
    var k = kindOf(it);
    return k === 'lost' ? 'Lost' : k === 'found' ? 'Found' : 'Returned';
  }

  function renderPanel(place) {
    selected = place;
    var c = countsFor(place);
    var b = byPlace[place] || { lost: [], found: [], returned: [] };

    if (panelName) panelName.textContent = place;

    if (panelMeta) {
      if (failed && !loaded) {
        panelMeta.textContent = 'The listings could not be loaded. The plan above is still correct.';
      } else {
        var bits = [];
        if (c.lost) bits.push(c.lost + (c.lost === 1 ? ' lost listing' : ' lost listings'));
        if (c.found) bits.push(c.found + (c.found === 1 ? ' found listing' : ' found listings'));
        if (c.returned) bits.push(c.returned + ' returned');
        panelMeta.textContent = bits.length ? bits.join(' · ') : 'Nothing reported here yet.';
      }
    }

    if (!panelBody) return;
    panelBody.innerHTML = '';

    if (failed && !loaded) {
      panelBody.appendChild(el('p', 'cp-empty',
        'The board did not respond, so this place has no listings to show.'));
      var retry = el('button', 'btn btn--sm', 'Try again');
      retry.type = 'button';
      retry.addEventListener('click', load);
      panelBody.appendChild(retry);
      return;
    }

    var groups = [];
    if (layer !== 'found') groups.push(['lost', 'Lost here', b.lost]);
    if (layer !== 'lost') groups.push(['found', 'Found here', b.found]);
    if (layer === 'all') groups.push(['returned', 'Returned', b.returned]);

    var shown = 0;
    groups.forEach(function (g) {
      if (!g[2].length) return;
      shown += g[2].length;
      var head = el('div', 'cp-group');
      head.appendChild(el('span', 'cp-group__t', g[1]));
      head.appendChild(el('span', 'cp-group__n', String(g[2].length)));
      panelBody.appendChild(head);
      g[2].slice(0, 5).forEach(function (it) {
        panelBody.appendChild(listingRow(it));
      });
      if (g[2].length > 5) {
        var more = el('a', 'cp-more', 'All ' + g[2].length + ' at ' + place + ' →');
        more.href = 'index.html?location=' + encodeURIComponent(place);
        panelBody.appendChild(more);
      }
    });

    if (!shown) {
      panelBody.appendChild(el('p', 'cp-empty',
        'Nothing reported here yet. If you lost something here, you can be the first to report it.'));
      var rep = el('a', 'btn btn--sm', 'Report an item');
      rep.href = '#browse';
      panelBody.appendChild(rep);
    }
  }

  function select(place) {
    blocks.forEach(function (b) {
      var on = b.getAttribute('data-place') === place;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    rows.forEach(function (r) {
      r.classList.toggle('on', r.getAttribute('data-place') === place);
    });
    renderPanel(place);
  }

  if (listBox) {
    blocks.forEach(function (b, i) {
      var place = b.getAttribute('data-place');
      var btn = el('button', 'cp-row');
      btn.type = 'button';
      btn.setAttribute('data-place', place);
      btn.appendChild(el('span', 'cp-row__n', String(i + 1).padStart(2, '0')));
      btn.appendChild(el('span', 'cp-row__t', place));
      var c = el('span', 'cp-row__c');
      c.setAttribute('data-count', '');
      btn.appendChild(c);
      btn.addEventListener('click', function () { select(place); });
      listBox.appendChild(btn);
      rows.push(btn);
    });
  }

  blocks.forEach(function (b) {
    b.setAttribute('aria-pressed', 'false');
    b.addEventListener('click', function () { select(b.getAttribute('data-place')); });
    b.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        select(b.getAttribute('data-place'));
      }
    });
  });

  layerBtns.forEach(function (btn) {
    btn.addEventListener('click', function () {
      layer = btn.getAttribute('data-layer');
      layerBtns.forEach(function (o) {
        var on = o === btn;
        o.classList.toggle('on', on);
        o.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      paint();
      if (selected) renderPanel(selected);
    });
  });

  function paintSlot() {
    var grid = document.getElementById('slot');
    var count = document.getElementById('slot-count');
    if (!grid) return;

    var cells = [].slice.call(grid.querySelectorAll('[data-slot]'));
    all.slice(0, 5).forEach(function (it, i) {
      var cell = cells[i];
      if (!cell) return;
      cell.innerHTML = '';
      if (it.imageUrl) {
        var img = el('img');
        img.src = it.imageUrl;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', function () {
          if (img.parentNode) img.parentNode.removeChild(img);
        });
        cell.appendChild(img);
      }
      cell.setAttribute('title', it.title || '');
      cell.setAttribute('data-item-id', it.id);
      cell.setAttribute('role', 'button');
      cell.setAttribute('tabindex', '0');
      cell.setAttribute('aria-label', 'View ' + (it.title || 'item'));
      var open = function () {
        if (typeof window.FoundryOpenItem === 'function') window.FoundryOpenItem(it.id);
      };
      cell.addEventListener('click', open);
      cell.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); }
      });
    });

    if (count) count.textContent = all.length + ' on the board';
  }

  var MAX_PAGES = 6;
  var truncated = false;

  function fetchPage(page) {
    return fetch('/api/items?limit=50&page=' + page, { headers: { Accept: 'application/json' } })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      });
  }

  function load() {
    failed = false;
    loaded = false;
    truncated = false;
    paint();

    fetchPage(1)
      .then(function (first) {
        var items = Array.isArray(first.items) ? first.items.slice() : [];
        var pages = Math.max(1, parseInt(first.pages, 10) || 1);
        var wanted = Math.min(pages, MAX_PAGES);
        truncated = pages > MAX_PAGES;

        if (wanted <= 1) return items;

        var rest = [];
        for (var p = 2; p <= wanted; p++) rest.push(fetchPage(p));
        return Promise.all(rest).then(function (results) {
          results.forEach(function (r) {
            if (r && Array.isArray(r.items)) items = items.concat(r.items);
          });
          return items;
        });
      })
      .then(function (items) {
        loaded = true;
        tally(items);
        paintSlot();
        paint();

        var wantedPlace = null;
        try {
          wantedPlace = new URLSearchParams(window.location.search).get('location');
        } catch (e) {  }

        var linked = null;
        if (wantedPlace) {
          blocks.forEach(function (b) {
            if (b.getAttribute('data-place').toLowerCase() === wantedPlace.toLowerCase()) {
              linked = b.getAttribute('data-place');
            }
          });
        }
        if (linked) { select(linked); return; }

        var best = null;
        blocks.forEach(function (b) {
          var p = b.getAttribute('data-place');
          var c = countsFor(p);
          var n = c.lost + c.found + c.returned;
          if (n > 0 && (!best || n > best.n)) best = { p: p, n: n };
        });
        if (best) select(best.p);
        else if (blocks[0]) select(blocks[0].getAttribute('data-place'));
      })
      .catch(function () {
        failed = true;
        loaded = false;
        paint();
        if (selected) renderPanel(selected);
        else if (blocks[0]) select(blocks[0].getAttribute('data-place'));
      });
  }

  load();

  if (reduced) root.classList.add('no-motion');
})();
