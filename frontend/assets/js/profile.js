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

  /* Split on purpose: if Auth itself is missing, calling requireLogin on it
     would throw a ReferenceError instead of sending the visitor to log in. */
  if (typeof Auth === "undefined") { window.location.replace("auth.html"); return; }
  if (!Auth.isLoggedIn) { Auth.requireLogin("profile.html"); return; }

  function row(label, value) {
    return '<div class="detail-row"><span class="detail-row__k">' + esc(label) +
           '</span><span class="detail-row__v">' + esc(value) + "</span></div>";
  }

  api("/auth/me", { auth: true }).then(function (d) {
    var u = (d && d.user) || {};
    var av = document.getElementById("avatar-preview");
    if (av) {
      if (u.avatarUrl) { av.style.backgroundImage = 'url(' + u.avatarUrl + ')'; av.textContent = ''; }
      else { av.textContent = (u.name || "?").trim().charAt(0).toUpperCase(); }
    }
    document.getElementById("profile-fields").innerHTML =
      row("Name", u.name) +
      row("Email", u.email) +
      row("Role", u.role) +
      row("Joined", when(u.createdAt));
    document.getElementById("profile-points").innerHTML =
      row("Points", u.points == null ? "0" : u.points) +
      row("Items returned", u.returns == null ? "0" : u.returns) +
      row("On the leaderboard", u.leaderboardOptOut ? "No, you opted out" : "Yes");
  }).catch(function (e) { fail((e && e.message) || "Could not load your profile"); });

  /* Shrink before upload, the same way item photos are shrunk. */
  var fileInput = document.getElementById("avatar-file");
  var preview = document.getElementById("avatar-preview");

  function upload(f) {
    if (!f) return;
    var note = document.getElementById("avatar-note");

    /* Same path as shrinkImage in app.js, which already uploads item photos
       successfully in this browser: FileReader -> data URL -> canvas.
       A blob: URL was tried first and failed with net::ERR_FAILED and a 0 KB
       transfer, even with blob: allowed in img-src. data: URLs work. */
    if (!/^image\/(png|jpeg|webp)$/.test(f.type || "")) {
      note.textContent = "Choose a PNG, JPEG or WebP image. This file is " +
        (f.type || "an unknown type") + ".";
      return;
    }
    if (!f.size) {
      note.textContent = "That file is empty (0 bytes).";
      return;
    }

    note.textContent = "Reading the file…";
    var reader = new FileReader();

    reader.onerror = function () {
      note.textContent = "That file could not be read from disk.";
    };

    reader.onload = function () {
      var img = new Image();

      img.onerror = function () {
        note.textContent = "That image could not be decoded by this browser.";
      };

      img.onload = function () {
        try {
          var scale = Math.min(1, 320 / Math.max(img.width, img.height));
          var c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          var ctx = c.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);

          var data = c.toDataURL("image/jpeg", 0.85);
          var bytes = Math.floor(((data.split(",")[1] || "").length * 3) / 4);
          if (bytes > 400 * 1024) {
            data = c.toDataURL("image/jpeg", 0.7);
            bytes = Math.floor(((data.split(",")[1] || "").length * 3) / 4);
          }
          note.textContent = "Uploading… (" + Math.round(bytes / 1024) + " KB)";

          api("/auth/me/avatar", { method: "PATCH", auth: true, body: { avatar: data } })
            .then(function (r) {
              var av = document.getElementById("avatar-preview");
              av.style.backgroundImage = "url(" + r.avatarUrl + ")";
              av.textContent = "";
              note.textContent = "Photo updated.";
            })
            .catch(function (e) { note.textContent = (e && e.message) || "That photo could not be saved."; });
        } catch (e) {
          note.textContent = "That image could not be processed: " + (e && e.message);
        }
      };

      img.src = reader.result;
    };

    reader.readAsDataURL(f);
  }

  if (fileInput) {
    fileInput.addEventListener("change", function () {
      upload(fileInput.files && fileInput.files[0]);
    });
  }

  /* Two more ways in, so a picker that will not open cannot block this:
     drop the file on the circle, or click the circle itself. */
  /* The whole photo panel accepts a drop, not just the circle - a small target
     is easy to miss, and the file dialog is out of our hands. */
  var dropZone = document.getElementById("avatar-drop") || preview;
  if (dropZone) {
    ["dragenter", "dragover"].forEach(function (t) {
      dropZone.addEventListener(t, function (e) { e.preventDefault(); dropZone.classList.add("avatar--over"); });
    });
    ["dragleave", "drop"].forEach(function (t) {
      dropZone.addEventListener(t, function (e) { e.preventDefault(); dropZone.classList.remove("avatar--over"); });
    });
    dropZone.addEventListener("drop", function (e) {
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files[0]) upload(dt.files[0]);
    });
  }
  if (preview) {
    preview.style.cursor = "pointer";
    preview.addEventListener("click", function () { if (fileInput) fileInput.click(); });
  }

  if (document.getElementById("avatar-clear")) {
    document.getElementById("avatar-clear").addEventListener("click", function () {
      api("/auth/me/avatar", { method: "PATCH", auth: true, body: { avatar: "" } })
        .then(function () {
          var av = document.getElementById("avatar-preview");
          av.style.backgroundImage = "";
          av.textContent = "?";
          document.getElementById("avatar-note").textContent = "Photo removed.";
        })
        .catch(function () { document.getElementById("avatar-note").textContent = "Could not remove the photo."; });
    });
  }

  api("/dashboard/me", { auth: true }).then(function (d) {
    var items = (d && (d.items || d.listings)) || [];
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
        return "<tr><td>" + esc(c.itemTitle || c.title || c.item || "") + "</td><td>" + esc(c.message || "") +
          "</td><td>" + esc(c.status || "") + "</td><td>" + when(c.createdAt) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }).catch(function () {
    document.getElementById("profile-claims").innerHTML = '<p class="note">Could not load your claims.</p>';
  });
})();
