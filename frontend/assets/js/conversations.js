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

  if (typeof Auth === 'undefined' || !Auth.isLoggedIn) {
    Auth.requireLogin('conversations.html');
    return;
  }
  state.me = Auth.user && Auth.user.id;

  function bubble(m) {
    var mine = m.sender_id === state.me;
    return '<div class="bubble ' + (mine ? 'bubble--mine' : '') + '">' +
      '<p class="bubble__body">' + ui.esc(m.body) + '</p>' +
      '<p class="bubble__meta">' + ui.esc(m.sender_name) + ' · ' + ui.date(m.created_at) + '</p>' +
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
      title.textContent = data.isReporter ? 'People who wrote to you' : 'Message the person who posted it';
      sub.textContent = data.isReporter
        ? 'Only you can see these. Reply to anyone who has written about this item.'
        : 'Only the person who posted this item can see what you write.';

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
      thread.scrollTop = thread.scrollHeight;
      document.getElementById('cv-claim-wrap').hidden = data.isReporter;
      pageError('');
    } catch (err) {
      pageError((err && err.message) || 'Could not open this conversation.');
    }
  }

  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    var text = (body.value || '').trim();
    if (!text) return;
    var to = state.withId || state.reporterId;
    if (!to) { show('cv-send-error', 'There is no one to send to yet'); return; }
    sendBtn.disabled = true;
    try {
      await api('/items/' + encodeURIComponent(itemId) + '/messages',
        { method: 'POST', auth: true, body: { recipientId: to, body: text } });
      body.value = '';
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
    state.timer = setInterval(function () { if (!document.hidden) loadThread(); }, 6000);
  } else {
    showList();
  }
  window.addEventListener('beforeunload', function () { clearInterval(state.timer); });
})();
