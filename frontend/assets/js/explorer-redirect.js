(function () {
  "use strict";
  var q = window.location.search || '';
  window.location.replace('index.html' + q + (q ? '&' : '?') + 'from=explorer#cplan');
})();
