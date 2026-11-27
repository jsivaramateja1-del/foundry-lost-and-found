/**
 * Header behaviour for the pages that do not load app.js.
 *
 * `Auth` is declared with `const` at the top level of api.js, so it is a global
 * binding but NOT a property of window. Reading window.Auth therefore always
 * returned undefined and every page showed "Log in" even when signed in. The
 * checks below use the bare identifier, guarded with typeof.
 */
(function () {
  "use strict";

  function auth() {
    return (typeof Auth !== 'undefined' && Auth) ? Auth : null;
  }

  function paint() {
    var A = auth();
    var inAuth = !!(A && A.isLoggedIn);
    var user = (A && A.user) || null;
    var isStaff = !!(user && ['moderator', 'admin', 'superadmin'].indexOf(user.role) !== -1);

    document.querySelectorAll('[data-auth-only]').forEach(function (el) { el.hidden = !inAuth; });
    document.querySelectorAll('[data-guest-only]').forEach(function (el) { el.hidden = inAuth; });
    document.querySelectorAll('[data-admin-only]').forEach(function (el) { el.hidden = !isStaff; });

    var who = document.getElementById('who');
    if (who) who.textContent = (inAuth && user) ? user.name : '';
  }

  function init() {
    paint();

    var logout = document.getElementById('header-logout');
    if (logout) {
      logout.addEventListener('click', function () {
        var A = auth();
        if (A && A.clear) A.clear();
        window.location.href = 'index.html?loggedout=1';
      });
    }

  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
