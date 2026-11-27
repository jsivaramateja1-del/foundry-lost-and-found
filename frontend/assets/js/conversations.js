/* Two modes:
   - no ?item=  -> list every conversation this user is part of
   - ?item=<id> -> open that listing's thread directly
   Opening from the nav must work, so the list is the default rather than an
   error, which is what it used to be. */
(function () {
  "use strict";
  var qs = new URLSearchParams(window.location.search);
  var itemId = (qs.get('item') || '').trim();
  var state = { withId: null, me: null, reporterId: null, timer: null };

  var empty = document.getElementById('cv-empty');
  var shell = document.getElementById('cv-shell');
  var thread = document.getElementById('cv-thread');
  var people = document.getElementById('cv-people');
  var title = document.getElementById('cv-title');
  var sub = document.getElementById('cv-sub');
  var form = document.getElementById('cv-form');
  var body = document.getElementById('cv-body');
  var sendBtn = document.getElementById('cv-send');
  var listHead = document.querySelector('.cv__listhead');
  var errorBox = document.getElementById('cv-error');

  function show(id, msg) {
    var el = document.getElementById(id);
    if (!el) return;
    el.textContent = msg || '';
    el.dataset.show = msg ? 'true' : 'false';
  }
  function pageError(msg) {
    errorBox.textContent = msg || '';
    errorBox.dataset.show = msg ? 'true' : 'false';
  }

  /* Split on purpose: if Auth itself is missing, calling requireLogin on it
     would throw a ReferenceError instead of sending the visitor to log in. */
  if (typeof Auth === "undefined") { window.location.replace("auth.html"); return; }
  if (!Auth.isLoggedIn) { Auth.requireLogin("conversations.html"); return; }
  state.me = Auth.user && Auth.user.id;

  /** Online if seen in the last two minutes, otherwise how long ago. */
  function presenceText(iso) {
    if (!iso) return "";
    var seen = new Date(iso).getTime();
    if (!seen) return "";
    var mins = Math.floor((Date.now() - seen) / 60000);
    if (mins < 2) return "Online";
    if (mins < 60) return "Last seen " + mins + "m ago";
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return "Last seen " + hrs + "h ago";
    var days = Math.floor(hrs / 24);
    return "Last seen " + (days === 1 ? "yesterday" : days + "d ago");
  }

  /* WhatsApp-style ticks drawn inline, because the design uses no icon font.
     One grey tick means sent; two teal ticks mean read. */
  function tick(readAt) {
    var path = '<path d="M1 5.5 L4 8.5 L11 1.5"></path>';
    if (!readAt) {
      return '<svg class="tick" viewBox="0 0 13 10" aria-label="Sent" role="img">' +
        '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
        'stroke-linejoin="round">' + path + '</g></svg>';
    }
    return '<svg class="tick tick--read" viewBox="0 0 18 10" aria-label="Seen" role="img">' +
      '<g fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
      'stroke-linejoin="round">' + path +
      '<path d="M6 5.5 L9 8.5 L16 1.5"></path></g></svg>';
  }

  function bubble(m) {
    var mine = m.sender_id === state.me;
    var photo = m.image_url
      ? '<img class="bubble__photo" src="' + ui.esc(m.image_url) + '" alt="Photo attached to this message">'
      : '';
    var text = m.body ? '<p class="bubble__body">' + ui.esc(m.body) + '</p>' : '';
    var del = mine
      ? '<button type="button" class="bubble__del" data-del="' + ui.esc(m.id) + '" ' +
        'aria-label="Delete this message">Delete</button>'
      : '';
    return '<div class="bubble ' + (mine ? 'bubble--mine' : '') + '">' + photo + text + del +
      '<p class="bubble__meta">' + ui.esc(m.sender_name) + ' · ' + ui.date(m.created_at) +
        (mine ? ' ' + tick(m.read_at) : '') +
      '</p>' +
    '</div>';
  }

  /* ---------- mode 1: the list ---------- */
  async function showList() {
    shell.hidden = true;
    empty.hidden = true;
    pageError('');
    try {
      var data = await api('/conversations', { auth: true });
      var rows = data.conversations || [];
      shell.hidden = false;
      listHead.textContent = 'Your conversations';
      people.innerHTML = rows.length ? rows.map(function (c) {
        return '<button class="cv__person" data-item="' + ui.esc(c.item_id) + '">' +
          '<span class="cv__name">' + ui.esc(c.item_title) + '</span>' +
          '<span class="cv__count">' + (c.unread ? c.unread + ' new' : c.message_count) + '</span>' +
          '<span class="cv__sub">' + ui.esc(c.other_name) + '</span>' +
        '</button>';
      }).join('') : '<p class="note" style="padding:14px">No conversations yet. Open a listing and choose Message.</p>';
      people.querySelectorAll('[data-item]').forEach(function (b) {
        b.addEventListener('click', function () {
          window.location.href = 'conversations.html?item=' + encodeURIComponent(b.dataset.item);
        });
      });
      title.textContent = 'Pick a conversation';
      sub.textContent = 'Each one is about one listing.';
      thread.innerHTML = '';
      form.hidden = true;
      document.getElementById('cv-claim-wrap').hidden = true;
    } catch (err) {
      shell.hidden = true;
      pageError((err && err.message) || 'Could not load your conversations.');
    }
  }

  /* ---------- mode 2: one thread ---------- */
  async function loadThread() {
    try {
      var url = '/items/' + encodeURIComponent(itemId) + '/messages' +
        (state.withId ? '?with=' + encodeURIComponent(state.withId) : '');
      var data = await api(url, { auth: true });
      state.reporterId = data.reporterId;
      if (!state.withId && !data.isReporter) state.withId = data.reporterId;
      if (!state.withId && data.conversations.length) state.withId = data.conversations[0].otherId;

      shell.hidden = false;
      empty.hidden = true;
      form.hidden = false;
      listHead.textContent = 'On this listing';
      /* The header names the person you are talking to, the way a chat app
         does, rather than describing the page. */
      var peer = null;
      if (data.isReporter) {
        var found = (data.conversations || []).filter(function (c) { return c.otherId === state.withId; })[0];
        peer = found ? found.otherName : null;
        title.textContent = peer || 'People who wrote to you';
      } else {
        peer = (data.conversations && data.conversations[0] && data.conversations[0].otherName) || null;
        title.textContent = peer || 'The person who posted this item';
      }
      if (data.otherTyping) {
        sub.textContent = 'typing…';
        sub.className = 'note cv__typing';
      } else {
        var presence = presenceText(data.otherLastSeen);
        sub.textContent = presence || 'Only the two of you can see this.';
        sub.className = presence === 'Online' ? 'note cv__online' : 'note';
      }

      people.innerHTML = data.isReporter && data.conversations.length
        ? data.conversations.map(function (c) {
            var on = c.otherId === state.withId ? ' cv__person--on' : '';
            return '<button class="cv__person' + on + '" data-with="' + ui.esc(c.otherId) + '">' +
              '<span class="cv__name">' + ui.esc(c.otherName) + '</span>' +
              '<span class="cv__count">' + c.count + '</span></button>';
          }).join('')
        : '<button class="cv__person cv__person--on" data-back="1"><span class="cv__name">← All conversations</span></button>';
      people.querySelectorAll('[data-with]').forEach(function (b) {
        b.addEventListener('click', function () { state.withId = b.dataset.with; loadThread(); });
      });
      people.querySelectorAll('[data-back]').forEach(function (b) {
        b.addEventListener('click', function () { window.location.href = 'conversations.html'; });
      });

      var list = state.withId ? data.messages : [];
      thread.innerHTML = list.length ? list.map(bubble).join('')
        : '<p class="thread__empty">No messages yet. Say hello.</p>';
      thread.querySelectorAll('[data-del]').forEach(function (b) {
        b.addEventListener('click', async function () {
          if (!window.confirm('Delete this message?')) return;
          try {
            await api('/items/' + encodeURIComponent(itemId) + '/messages/' +
              encodeURIComponent(b.dataset.del), { method: 'DELETE', auth: true });
            await loadThread();
          } catch (err) {
            pageError((err && err.message) || 'That message could not be deleted.');
          }
        });
      });
      thread.scrollTop = thread.scrollHeight;
      document.getElementById('cv-claim-wrap').hidden = data.isReporter;
      pageError('');
    } catch (err) {
      pageError((err && err.message) || 'Could not open this conversation.');
    }
  }

  /* Tell the other side we are typing, at most once every two seconds. */
  var lastPing = 0;
  body.addEventListener('input', function () {
    var now = Date.now();
    if (now - lastPing < 1500 || !itemId) return;
    lastPing = now;
    api('/items/' + encodeURIComponent(itemId) + '/messages/typing', { method: 'POST', auth: true })
      .catch(function () { /* a missed ping is harmless */ });
  });

  /* A photo is shrunk here before it is sent, the same way item photos are,
     so a phone picture does not travel at full size. */
  var pendingPhoto = "";
  var photoInput = document.getElementById("cv-photo");
  var attachBtn = document.getElementById("cv-attach");
  var attachNote = document.getElementById("cv-attach-note");

  if (attachBtn && photoInput) {
    attachBtn.addEventListener("click", function () { photoInput.click(); });
    photoInput.addEventListener("change", function () {
      var f = photoInput.files && photoInput.files[0];
      if (!f) return;
      if (!/^image\//.test(f.type || "")) {
        attachNote.textContent = "That is not an image: " + (f.type || "unknown type");
        return;
      }
      attachNote.textContent = "Reading…";
      var reader = new FileReader();
      reader.onerror = function () { attachNote.textContent = "That file could not be read."; };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { attachNote.textContent = "That image could not be decoded."; };
        img.onload = function () {
          var scale = Math.min(1, 1200 / Math.max(img.width, img.height));
          var c = document.createElement("canvas");
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          var ctx = c.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, c.width, c.height);
          ctx.drawImage(img, 0, 0, c.width, c.height);
          pendingPhoto = c.toDataURL("image/jpeg", 0.8);
          attachNote.textContent = "Photo ready (" +
            Math.round(((pendingPhoto.split(",")[1] || "").length * 3) / 4 / 1024) + " KB). Press Send.";
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(f);
    });
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var text = (body.value || '').trim();
    if (!text && !pendingPhoto) return;
    var to = state.withId || state.reporterId;
    if (!to) { show('cv-send-error', 'There is no one to send to yet'); return; }
    sendBtn.disabled = true;
    try {
      await api('/items/' + encodeURIComponent(itemId) + '/messages',
        { method: 'POST', auth: true, body: { recipientId: to, body: text, image: pendingPhoto } });
      body.value = '';
      pendingPhoto = '';
      if (photoInput) photoInput.value = '';
      if (attachNote) attachNote.textContent = '';
      show('cv-send-error', '');
      await loadThread();
    } catch (err) {
      show('cv-send-error', (err && err.message) || 'That message did not send');
    } finally { sendBtn.disabled = false; }
  });

  var claimBtn = document.getElementById('cv-claim');
  claimBtn.addEventListener('click', async function () {
    var reason = (body.value || '').trim();
    if (!reason) { show('cv-send-error', 'Write why this item is yours in the box above, then press Claim.'); return; }
    claimBtn.disabled = true;
    try {
      await api('/claims', { method: 'POST', auth: true, body: { item: itemId, message: reason } });
      body.value = '';
      var ok = document.getElementById('cv-claim-ok');
      ok.textContent = 'Claim sent. The person who posted this item will reply here.';
      ok.dataset.show = 'true';
      document.getElementById('cv-claim-wrap').hidden = true;
      await loadThread();
    } catch (err) {
      show('cv-send-error', (err && err.message) || 'That claim did not send');
    } finally { claimBtn.disabled = false; }
  });

  if (itemId) {
    loadThread();
    state.timer = setInterval(function () { if (!document.hidden) loadThread(); }, 1500);
  } else {
    showList();
  }
  window.addEventListener('beforeunload', function () { clearInterval(state.timer); });
})();
