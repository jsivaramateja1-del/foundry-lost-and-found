/**
 * explorer.html forwards to the board, carrying ?location= through, because the
 * board now reads that parameter itself.
 *
 * This used to be an inline <script> in the page. The server sends
 * Content-Security-Policy script-src 'self', which blocks inline scripts, so the
 * redirect never ran and old links landed on the "the plan moved" page.
 */
(function () {
  "use strict";
  var q = window.location.search || '';
  window.location.replace('index.html' + q + (q ? '&' : '?') + 'from=explorer#cplan');
})();
