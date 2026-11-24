/**
 * Header behaviour for the pages that do not load app.js.
 *
 * app.js paints the signed-in state on the board; the Returned and
 * Conversations pages need the same header without pulling in the whole
 * homepage script. This does only that: show the right buttons, wire the theme
 * toggle, and wire Log out.
 */
(function () {
  "use strict";

  function paint() {
    var inAuth = !!(window.Auth && Auth.isLoggedIn);
    var user = (window.Auth && Auth.user) || null;
    var isStaff = user && ['moderator', 'admin', 'superadmin'].indexOf(user.role) !== -1;

    document.querySelectorAll('[data-auth-only]').forEach(function (el) { el.hidden = !inAuth; });
    document.querySelectorAll('[data-guest-only]').forEach(function (el) { el.hidden = inAuth; });
    document.querySelectorAll('[data-admin-only]').forEach(function (el) { el.hidden = !isStaff; });

    var who = document.getElementById('who');
    if (who) who.textContent = inAuth && user ? user.name : '';
  }

  function init() {
    paint();

    var logout = document.getElementById('header-logout');
    if (logout) {
      logout.addEventListener('click', function () {
        if (window.Auth && Auth.clear) Auth.clear();
        window.location.href = 'index.html?loggedout=1';
      });
    }

    var theme = document.querySelector('[data-theme-toggle]');
    if (theme) {
      var icon = theme.querySelector('[data-theme-icon]');
      function paintIcon() {
        if (icon) icon.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '☀' : '☾';
      }
      paintIcon();
      theme.addEventListener('click', function () {
        var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        try { localStorage.setItem('foundry.theme', next); } catch (e) { /* private mode */ }
        paintIcon();
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
