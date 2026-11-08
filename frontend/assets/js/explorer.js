/**
 * Campus Explorer.
 *
 * The map is centred on the university's published coordinate. Markers come
 * from /api/campus/locations — never from a hardcoded list, so a marker always
 * corresponds to a record somebody entered and can be held to.
 */
(function () {
  'use strict';

  // Verified: saiuniversity.edu.in contact page + Wikipedia 12°39′15″N 80°09′28″E
  var CAMPUS = { lat: 12.65416, lng: 80.15771, name: 'Sai University' };

  var mapEl = document.getElementById('map');
  var listEl = document.getElementById('loc-list');
  var stateEl = document.getElementById('map-state');
  var detailEl = document.getElementById('loc-detail');
  var searchEl = document.getElementById('loc-search');

  var locations = [];
  var map = null;
  var markers = {};

  function showState(message) {
    stateEl.textContent = message;
    stateEl.style.display = 'block';
  }

  function hideState() { stateEl.style.display = 'none'; }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function initMap() {
    if (typeof L === 'undefined') {
      // The CDN did not load. Say so plainly rather than showing an empty box.
      mapEl.style.display = 'none';
      showState('The map library could not be loaded. Check your connection and reload the page.');
      return false;
    }
    map = L.map('map').setView([CAMPUS.lat, CAMPUS.lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);
    L.marker([CAMPUS.lat, CAMPUS.lng])
      .addTo(map)
      .bindPopup('<strong>' + escapeHtml(CAMPUS.name) + '</strong><br>One Hub Road, OMR, Paiyanur');
    return true;
  }

  function renderList(filter) {
    var term = String(filter || '').toLowerCase().trim();
    var shown = locations.filter(function (l) {
      return !term || l.name.toLowerCase().indexOf(term) !== -1
        || (l.description || '').toLowerCase().indexOf(term) !== -1;
    });

    listEl.innerHTML = '';

    if (!locations.length) {
      var empty = document.createElement('div');
      empty.className = 'state-box';
      empty.textContent = 'No campus locations have been added yet. An administrator can add buildings and landmarks, each with the source of its coordinate.';
      listEl.appendChild(empty);
      return;
    }

    if (!shown.length) {
      var none = document.createElement('div');
      none.className = 'state-box';
      none.textContent = 'No location matches “' + filter + '”.';
      listEl.appendChild(none);
      return;
    }

    shown.forEach(function (loc) {
      var card = document.createElement('div');
      card.className = 'loc-card';
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.innerHTML =
        '<h3>' + escapeHtml(loc.name) + '</h3>' +
        '<p>' + escapeHtml(loc.description || loc.kind) + '</p>' +
        (loc.source ? '<div class="loc-source">Source: ' + escapeHtml(loc.source) + '</div>' : '');
      function focus() { selectLocation(loc); }
      card.addEventListener('click', focus);
      card.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); focus(); }
      });
      listEl.appendChild(card);
    });
  }

  function selectLocation(loc) {
    if (!map) return;
    map.setView([loc.lat, loc.lng], 18);
    if (markers[loc.id]) markers[loc.id].openPopup();

    var walk = 'https://www.openstreetmap.org/directions?engine=fossgis_osrm_foot&route='
      + CAMPUS.lat + '%2C' + CAMPUS.lng + '%3B' + loc.lat + '%2C' + loc.lng;
    var streetView = 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint='
      + loc.lat + ',' + loc.lng;

    detailEl.innerHTML =
      '<h2 style="margin:0 0 6px;font-size:18px;">' + escapeHtml(loc.name) + '</h2>' +
      '<p style="margin:0 0 10px;opacity:.8;">' + escapeHtml(loc.description || '') + '</p>' +
      '<p style="margin:0 0 6px;font-size:13px;"><strong>Coordinates:</strong> ' + loc.lat + ', ' + loc.lng + '</p>' +
      (loc.source ? '<p style="margin:0 0 10px;font-size:12px;opacity:.6;">Source: ' + escapeHtml(loc.source) + '</p>' : '') +
      '<p style="margin:0 0 10px;">' +
      '<a href="' + walk + '" target="_blank" rel="noopener">Walking directions</a> · ' +
      '<a href="' + streetView + '" target="_blank" rel="noopener">Open in Street View</a>' +
      '</p>' +
      '<p style="font-size:12px;opacity:.55;margin:0;">Street View is offered by Google and only exists where they have photographed. If the link shows no imagery, none is available for this spot.</p>';
  }

  function load() {
    fetch('/api/campus/locations', { headers: { Accept: 'application/json' } })
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed with status ' + res.status);
        return res.json();
      })
      .then(function (data) {
        locations = (data && data.locations) || [];
        renderList('');
        if (map) {
          locations.forEach(function (loc) {
            markers[loc.id] = L.marker([loc.lat, loc.lng])
              .addTo(map)
              .bindPopup('<strong>' + escapeHtml(loc.name) + '</strong>');
          });
        }
      })
      .catch(function (err) {
        listEl.innerHTML = '';
        var box = document.createElement('div');
        box.className = 'state-box';
        box.textContent = 'Campus locations could not be loaded (' + err.message + '). The map still shows the campus centre.';
        listEl.appendChild(box);
      });
  }

  if (initMap()) {
    hideState();
    load();
  } else {
    document.getElementById('loc-loading').remove();
  }

  searchEl.addEventListener('input', function () { renderList(searchEl.value); });
})();
