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

  function startHeartbeat() {
    var A = auth();
    if (!A || !A.isLoggedIn) return;
    var ping = function () {
      if (document.hidden) return;
      api('/auth/heartbeat', { method: 'POST', auth: true }).catch(function () {});
    };
    ping();
    setInterval(ping, 60000);
  }

  function init() {
    paint();
    startHeartbeat();

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
