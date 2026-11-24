/* ===========================================================================
   FOUND — the campus plan
   ---------------------------------------------------------------------------
   The plan is the board's primary navigation: place first, then the listings
   reported there. It reads the same public API the grid does and opens the same
   detail dialog, so there is one source of data and one detail experience.

   External file because the production CSP is script-src 'self'.
   =========================================================================== */
(function () {
  'use strict';

  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var root = document.getElementById('cplan');
  if (!root) return;

  var blocks = [].slice.call(root.querySelectorAll('.blk'));
  var rows = [];                 // mobile list rows, built below
  var layerBtns = [].slice.call(root.querySelectorAll('[data-layer]'));
  var panelName = document.getElementById('cp-name');
  var panelMeta = document.getElementById('cp-meta');
  var panelBody = document.getElementById('cp-body');
  var summary = document.getElementById('cp-summary');
  var listBox = document.getElementById('cp-list');

  var byPlace = {};              // place -> { lost: [], found: [], returned: [] }
  var all = [];
  var loaded = false;
  var failed = false;
  var layer = 'all';             // 'all' | 'lost' | 'found'
  var selected = null;

  /* ---------------- helpers ---------------- */
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

  /* ---------------- tally ---------------- */
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

  /* What a block or row should say for the current layer. */
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

  /* ---------------- paint ---------------- */
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

  /* ---------------- the place panel ---------------- */
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
    }
    a.appendChild(art);

    var mid = el('span', 'cp-item__mid');
    mid.appendChild(el('span', 'cp-item__t', it.title || 'Untitled item'));
    mid.appendChild(el('span', 'cp-item__m',
      kindLabel(it) + ' · ' + fmtDate(it.date || it.createdAt)));
    a.appendChild(mid);

    a.addEventListener('click', function (ev) {
      ev.preventDefault();
      // open the existing detail dialog, not a second one
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

    /* Lost and found are shown together — that is the point of place-first
       browsing. The layer switch narrows the panel, it does not replace it. */
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

  /* ---------------- mobile list, built from the same blocks ---------------- */
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

  /* ---------------- events ---------------- */
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

  /* ---------------- the missing slot (hero) ----------------
     Five real listings and one empty cell. It is the product concept in one
     composition: something is missing, and this is where it turns up. It uses
     the same fetch as the plan, so it costs no extra request. */
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

  /* ---------------- load ---------------- */
  /* The server caps `limit` at 50, so one request only ever sees the newest 50
     listings. With more than that on the board every count on the plan was
     silently understated — a place holding 60 lost items showed 50, and the
     total read 50 instead of 120.

     Fix: follow the existing pagination contract. Page 1 gives `total` and
     `pages`; if there are more pages they are fetched in parallel and tallied
     together. No new endpoint, no changed API, just the `page` parameter that
     already exists.

     Bounded on purpose: at most MAX_PAGES are read. Past that the summary says
     so rather than pretending the numbers are complete. */
  var MAX_PAGES = 6;              // 300 listings
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
        // A deep link wins: if the board was opened as index.html?location=Lords
        // the plan must open on the same place, or the two disagree about where
        // the visitor is. Otherwise open the busiest place so the panel is never
        // empty on arrival.
        var wantedPlace = null;
        try {
          wantedPlace = new URLSearchParams(window.location.search).get('location');
        } catch (e) { /* a malformed query string must not break the plan */ }

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

  /* the plan honours reduced motion by simply not animating; nothing to disable */
  if (reduced) root.classList.add('no-motion');
})();

/* ---------------------------------------------------------------------------
   Hero parallax.
   Each object carries a data-depth multiplier; the pointer position is mapped
   to a small offset and written into CSS variables, so the movement is pure
   transform and never triggers layout. Skipped entirely when the user prefers
   reduced motion, and never bound on touch devices where there is no pointer
   to track.
   --------------------------------------------------------------------------- */
(function heroParallax() {
  var root = document.querySelector('[data-parallax-root]');
  if (!root) return;

  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (reduce && reduce.matches) return;
  if (window.matchMedia && window.matchMedia('(hover: none)').matches) return;

  var objs = [].slice.call(root.querySelectorAll('[data-depth]'));
  if (!objs.length) return;
  objs.forEach(function (el) { el.style.setProperty('--d', el.getAttribute('data-depth') || '1'); });

  var frame = null;
  function apply(nx, ny) {
    // 18px of travel at most: enough to feel alive, not enough to distract.
    var px = nx * 18;
    var py = ny * 18;
    objs.forEach(function (el) {
      el.style.setProperty('--px', px.toFixed(2));
      el.style.setProperty('--py', py.toFixed(2));
    });
  }

  window.addEventListener('pointermove', function (e) {
    if (frame) return;
    frame = requestAnimationFrame(function () {
      frame = null;
      var nx = (e.clientX / window.innerWidth) * 2 - 1;
      var ny = (e.clientY / window.innerHeight) * 2 - 1;
      apply(nx, ny);
    });
  }, { passive: true });

  // Returning the pointer to rest lets the objects settle back.
  document.addEventListener('pointerleave', function () { apply(0, 0); });
})();
