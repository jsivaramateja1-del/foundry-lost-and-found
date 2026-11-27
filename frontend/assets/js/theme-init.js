(function () {
  var stored = null;
  try { stored = localStorage.getItem('foundry.theme'); } catch (e) {  }

  var theme = stored;
  if (theme !== 'light' && theme !== 'dark') {
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    theme = prefersDark ? 'dark' : 'light';
  }
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.add('js');
})();
