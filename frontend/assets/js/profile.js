/**
 * Profile page: who you are, your points, your listings and your claims.
 * Every value comes from the API; nothing is trusted from the DOM.
 */
(function () {
  "use strict";

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function when(v) {
    var d = new Date(v);
    return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  }
  function fail(msg) {
    var box = document.getElementById("profile-error");
    box.textContent = msg || "";
    box.dataset.show = msg ? "true" : "false";
  }

  if (typeof Auth === "undefined" || !Auth.isLoggedIn) {
    Auth.requireLogin("profile.html");
    return;
  }

  function row(label, value) {
    return '<div class="detail-row"><span class="detail-row__k">' + esc(label) +
           '</span><span class="detail-row__v">' + esc(value) + "</span></div>";
  }

  api("/auth/me", { auth: true }).then(function (d) {
    var u = (d && d.user) || {};
    document.getElementById("profile-card").innerHTML =
      row("Name", u.name) +
      row("Email", u.email) +
      row("Role", u.role) +
      row("Joined", when(u.createdAt));
    document.getElementById("profile-points").innerHTML =
      row("Points", u.points == null ? "0" : u.points) +
      row("Items returned", u.returns == null ? "0" : u.returns) +
      row("On the leaderboard", u.leaderboardOptOut ? "No, you opted out" : "Yes");
  }).catch(function (e) { fail((e && e.message) || "Could not load your profile"); });

  api("/dashboard/mine", { auth: true }).then(function (d) {
    var items = (d && d.items) || [];
    var box = document.getElementById("profile-listings");
    if (!items.length) { box.innerHTML = '<p class="note">You have not posted anything yet.</p>'; return; }
    box.innerHTML = '<div class="grid">' + items.map(function (it) {
      return '<article class="card" style="cursor:default">' +
        '<div class="card__top"><span class="tag tag--' + esc(it.type) + '">' +
        (it.type === "lost" ? "Lost" : "Found") + '</span><span class="tag">' + esc(it.status) + "</span></div>" +
        '<h3 class="card__title">' + esc(it.title) + '</h3>' +
        '<p class="card__desc">' + esc(it.description) + "</p>" +
        '<div class="card__meta"><span>' + esc(it.location) + "</span><span>" + when(it.date) + "</span></div>" +
      "</article>";
    }).join("") + "</div>";
  }).catch(function () {
    document.getElementById("profile-listings").innerHTML = '<p class="note">Could not load your listings.</p>';
  });

  api("/claims/mine", { auth: true }).then(function (d) {
    var claims = (d && d.claims) || [];
    var box = document.getElementById("profile-claims");
    if (!claims.length) { box.innerHTML = '<p class="note">You have not claimed anything yet.</p>'; return; }
    box.innerHTML = '<table class="table"><thead><tr><th>Item</th><th>Your message</th><th>Status</th><th>Sent</th></tr></thead><tbody>' +
      claims.map(function (c) {
        return "<tr><td>" + esc(c.itemTitle || c.item || "") + "</td><td>" + esc(c.message || "") +
          "</td><td>" + esc(c.status || "") + "</td><td>" + when(c.createdAt) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }).catch(function () {
    document.getElementById("profile-claims").innerHTML = '<p class="note">Could not load your claims.</p>';
  });
})();
