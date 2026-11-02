/* Runs before paint so the page never flashes the wrong theme.
   It is a separate file because the Content-Security-Policy forbids inline
   scripts (script-src 'self'). */
(function () {
  var theme = 'dark';
  try {
    theme = localStorage.getItem('foundry.theme') || 'dark';
  } catch (e) {
    /* private mode: keep the default */
  }
  document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
})();
