/* Schematic campus plan: highlight a block and offer the board filtered to
   that place. A separate file because the CSP forbids inline scripts. */
/* Schematic plan: highlight a block and offer the board filtered to that place. */
(function () {
  var detail = document.getElementById('plan-detail');
  var blocks = document.querySelectorAll('.blk[data-place]');
  function select(g) {
    blocks.forEach(function (b) { b.classList.remove('on'); });
    g.classList.add('on');
    var place = g.getAttribute('data-place');
    detail.innerHTML = '<b>' + place + '</b>'
      + 'Listings reported at this place are on the board.'
      + '<div class="empty__actions" style="margin-top:10px;">'
      + '<a class="btn btn--sm" href="index.html?location=' + encodeURIComponent(place) + '">See listings here</a>'
      + '</div>';
  }
  blocks.forEach(function (g) {
    g.addEventListener('click', function () { select(g); });
    g.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(g); }
    });
  });
})();
