/* Runs before paint so the page never flashes the wrong theme.
   Separate file because the CSP forbids inline scripts.

   Order of precedence:
     1. an explicit choice the visitor made (stored)
     2. the operating system preference
     3. Paper
*/
(function () {
  var stored = null;
  try { stored = localStorage.getItem('foundry.theme'); } catch (e) { /* private mode */ }

  var theme = stored;
  if (theme !== 'light' && theme !== 'dark') {
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme = prefersDark ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
})();
