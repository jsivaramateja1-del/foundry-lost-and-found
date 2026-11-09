/* dashboard.html page logic.
   This used to live in an inline <script> block, which the Content-Security-Policy
   (script-src 'self') blocked in the browser, so the page never ran its own code. */
    if (!Auth.isLoggedIn) Auth.requireLogin('dashboard.html');

    document.getElementById('who').textContent = Auth.user ? Auth.user.name : '';
    document.querySelectorAll('[data-admin-only]').forEach((n) => { n.hidden = !Auth.isAdmin; });

    document.getElementById('logout').addEventListener('click', () => {
      try { Auth.clear(); } catch { /* the link still navigates */ }
    });

    const row = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
    const statusTag = (s) => `<span class="status status--${s}">${ui.esc(s)}</span>`;

    /** Load everything and paint the three tables. */
    /**
     * Reload everything the dashboard shows.
     *
     * Returns { ok: true } or { ok: false, message } so a caller that has just
     * changed something can report both outcomes in one message. Pass
     * { silent: true } when the caller will do the reporting itself.
     */
    async function refresh({ silent = false } = {}) {
      let data;
      try {
        data = await api('/dashboard/me', { auth: true });
      } catch (err) {
    var _ie = document.getElementById('impact-summary');
    if (_ie) _ie.textContent = 'Could not load your impact.';
    var _bl = document.getElementById('badges-list');
    if (_bl) _bl.innerHTML = '<li class="form-note">Could not load your badges.</li>';
        // If the user just logged out, stay quiet instead of bouncing them back
        if (!Auth.isLoggedIn) return { ok: false, message: 'You have been signed out.' };
        if (err.status === 401) {
          Auth.requireLogin('dashboard.html');
          return { ok: false, message: 'Your session expired.' };
        }
        if (!silent) ui.toast(err.message);
        return { ok: false, message: err.message };
      }

      Object.entries(data.stats).forEach(([key, value]) => {
        const node = document.querySelector(`[data-metric="${key}"]`);
        if (node) node.textContent = value;
      });

      // Personal impact and badges come from the same response, so they can
      // never disagree with the counters above
      const summary = document.getElementById('impact-summary');
      if (summary && data.impact) {
        const c = data.impact.contributions;
        const r = data.impact.returns;
        summary.textContent = `${c} verified contribution${c === 1 ? '' : 's'}`
          + ` · ${r} successful return${r === 1 ? '' : 's'}`
          + ` · ${data.impact.points} points`;
      }
      const badgeList = document.getElementById('badges-list');
      if (badgeList && Array.isArray(data.badges)) {
        badgeList.innerHTML = data.badges.map((b) => `
          <li class="badge ${b.earned ? 'badge--earned' : 'badge--locked'}">
            <span class="badge__dot" aria-hidden="true"></span>
            <span class="badge__body">
              <strong>${ui.esc(b.label)}</strong>
              <span class="form-note">${ui.esc(b.description)}${b.earned && b.earnedAt ? ' · earned ' + ui.date(b.earnedAt) : ''}</span>
            </span>
          </li>`).join('');
      }

      // --- your listings ---
      document.getElementById('listings-body').innerHTML = data.items.length
        ? data.items.map((i) => row([
            ui.esc(i.title),
            i.type === 'lost' ? 'Lost' : 'Found',
            ui.esc(i.location),
            ui.date(i.date),
            statusTag(i.status),
            [
              i.status === 'returned'
                ? '<span class="form-note">Returned</span>'
                : '',
              `<button class="btn btn--ghost" data-edit="${i.id}">Edit</button>`,
              `<button class="btn btn--ghost" data-delete="${i.id}">Delete</button>`
            ].join(' ')
          ])).join('')
        : '<tr><td colspan="6" style="color:var(--muted)">You have not posted anything yet.</td></tr>';

      // --- claims you made ---
      // The six-digit handover code is returned only by /claims/mine. Without
      // this the claimant never sees it and the owner's prompt cannot be met.
      try {
        const mine = await api('/claims/mine', { auth: true });
        const codes = {};
        (mine.claims || []).forEach((c) => { if (c.handoverCode) codes[c.id] = c.handoverCode; });
        data.claims.forEach((c) => { if (codes[c.id]) c.handoverCode = codes[c.id]; });
      } catch (err) { /* the table still renders, just without codes */ }

      document.getElementById('claims-body').innerHTML = data.claims.length
        ? data.claims.map((c) => row([
            ui.esc(c.itemTitle || c.item?.title || 'Item removed'),
            ui.esc(String(c.message).slice(0, 80)),
            c.handoverCode && c.status === 'approved'
              ? '<code class="handover-code">' + ui.esc(c.handoverCode) + '</code>'
              : '\u2014',
            statusTag(c.status),
            ui.date(c.createdAt || c.created_at)
          ])).join('')
        : '<tr><td colspan="5" class="table__empty">No claims yet.</td></tr>';

      // --- claims received on your listings ---
      // One request for all of them. The old version asked per listing and
      // swallowed every error, so a failure looked identical to "no claims".
      let received = [];
  let receivedFailed = false;
      try {
        const res = await api('/claims/received', { auth: true });
        received = res.claims;
      } catch (err) {
        ui.toast(`Could not load claims received: ${err.message}`);
        received = [];
        receivedFailed = true;
      }
      document.getElementById('received-count').textContent =
        receivedFailed ? '—' : received.length ? `${received.length} total` : '';

      document.getElementById('received-body').innerHTML = receivedFailed
        ? '<tr><td colspan="5" class="table__empty">Claims could not be loaded. <button type="button" class="link-button" data-retry-received>Retry</button></td></tr>'
        : received.length
        ? received.map((c) => row([
            ui.esc(c.itemTitle),
            ui.esc(c.claimantName || c.claimant?.name || 'A student'),
            ui.esc(c.message),
            c.handoverCode && c.status === 'approved'
              ? '<code class="handover-code">' + ui.esc(c.handoverCode) + '</code>'
              : '—',
            statusTag(c.status),
            c.status === 'pending'
              ? `<button class="btn btn--ghost" data-approve="${c.id}">Approve</button>
                 <button class="btn btn--ghost" data-reject="${c.id}">Reject</button>`
              : c.status === 'approved' && !c.handoverConfirmedAt
                ? `<button class="btn btn--ghost" data-handover="${c.id}">Confirm handover</button>`
                : '<span class="form-note">Reviewed</span>'
          ])).join('')
        : '<tr><td colspan="5" style="color:var(--muted)">Nobody has claimed any of your items yet.</td></tr>';

      return { ok: true };
    }

    /* ---------------- community leaderboard ---------------- */
    let leaderboardPeriod = 'all';

    async function loadLeaderboard(period = leaderboardPeriod) {
      const list = document.getElementById('leaderboard-list');
      if (!list) return;
      leaderboardPeriod = period;
      try {
        const data = await api(`/leaderboard?period=${encodeURIComponent(period)}`);
        list.innerHTML = data.leaderboard.length
          ? data.leaderboard.map((r) => `<li class="leaderboard__row">
               <span class="leaderboard__rank">${r.rank}</span>
               <strong>${ui.esc(r.name)}</strong>
               <span class="form-note">${r.points} pts · ${r.returns} return${r.returns === 1 ? '' : 's'}</span>
             </li>`).join('')
          : `<li class="form-note">No points earned ${period === 'all' ? 'yet' : 'in this period'}. Complete a return to start the board.</li>`;
      } catch {
        list.innerHTML = '<li class="form-note">Could not load the leaderboard.</li>';
      }
    }

    const leaderboardVisible = document.getElementById('leaderboard-visible');
    if (leaderboardVisible && Auth.user?.role !== 'student') {
      const preferenceLabel = leaderboardVisible.closest('label');
      if (preferenceLabel) preferenceLabel.hidden = true;
    }
    if (leaderboardVisible && Auth.user?.role === 'student') {
      // The API stores an opt-out; the checkbox reads as "show me"
      leaderboardVisible.checked = !(Auth.user && Auth.user.leaderboardOptOut);
      leaderboardVisible.addEventListener('change', async () => {
        const wanted = leaderboardVisible.checked;
        leaderboardVisible.disabled = true;
        try {
          const res = await api('/auth/preferences', {
            method: 'PATCH',
            body: { leaderboardOptOut: !wanted },
            auth: true
          });
          Auth.save(Auth.token, res.user);
          ui.toast(res.message);
          await loadLeaderboard();
        } catch (err) {
          leaderboardVisible.checked = !wanted;   // put the switch back
          ui.toast(err.message);
        } finally {
          leaderboardVisible.disabled = false;
        }
      });
    }

    document.querySelectorAll('[data-leaderboard-period]').forEach((button) => {
      button.addEventListener('click', () => {
        document.querySelectorAll('[data-leaderboard-period]').forEach((b) => {
          b.setAttribute('aria-pressed', String(b === button));
        });
        loadLeaderboard(button.dataset.leaderboardPeriod);
      });
    });

    loadLeaderboard();

    /* ---------------- edit and delete ---------------- */
    const editModal = document.getElementById('modal-edit');
    const meta = { categories: [], locations: [] };
    let editingId = null;
    let editingStatus = '';   // the status the listing had when the modal opened

    /* Focus management. app.js has this but the dashboard does not load it, so
       the dialog opened with focus still on the page behind it and Tab walked
       straight out. */
    const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), '
      + 'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    let _lastFocused = null;
    let _trapHandler = null;

    function trapModal(node) {
      const nodes = [...node.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!nodes.length) return;
      _trapHandler = function (event) {
        if (event.key !== 'Tab') return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first.focus();
        }
      };
      node.addEventListener('keydown', _trapHandler);
      (nodes.find((n) => n.classList.contains('modal__close')) || nodes[0]).focus();
    }

    function untrapModal(node) {
      if (_trapHandler) node.removeEventListener('keydown', _trapHandler);
      _trapHandler = null;
      if (_lastFocused && _lastFocused.isConnected) _lastFocused.focus();
      _lastFocused = null;
    }

    function openModalEl(node) {
      _lastFocused = document.activeElement;
      node.dataset.open = 'true';
      trapModal(node);
      document.body.style.overflow = 'hidden';
    }
    function closeModalEl(node) {
      node.dataset.open = 'false';
      untrapModal(node);
      document.body.style.overflow = '';
    }
    function fillSelect(node, values, selected) {
      node.innerHTML = values.map((v) => `<option value="${ui.esc(v)}">${ui.esc(v)}</option>`).join('');
      if (selected && values.includes(selected)) node.value = selected;
    }

    // Dropdown values come from the API so the form can never offer a value
    // the server would reject
    (async () => {
      try {
        const data = await api('/items/meta');
        meta.categories = data.categories;
        meta.locations = data.locations;
      } catch {
        /* the edit form simply stays empty if this fails */
      }
    })();

    async function openEdit(id) {
      try {
        const { item } = await api(`/items/${id}`);
        editingId = item.id;
        document.getElementById('ef-type').value = item.type;
        document.getElementById('ef-title').value = item.title;
        document.getElementById('ef-description').value = item.description;
        document.getElementById('ef-date').value = (() => { const d = new Date(item.date); return [d.getFullYear(),
      String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); })();
        editingStatus = item.status;
        // A moderated listing's status is not one of the editable options.
        // Show it, disabled, so the select cannot silently misrepresent it.
        const statusSelect = document.getElementById('ef-status');
        // Remove any placeholder left over from a listing opened earlier, so
        // options never accumulate and a stale one can never be shown
        statusSelect.querySelectorAll('option[data-temporary-status]').forEach((o) => o.remove());
        const known = [...statusSelect.options].some((o) => o.value === item.status);
        if (!known) {
          const extra = document.createElement('option');
          extra.value = item.status;
          extra.textContent = item.status.charAt(0).toUpperCase() + item.status.slice(1);
          extra.disabled = true;
          extra.dataset.temporaryStatus = 'true';
          statusSelect.appendChild(extra);
        }
        // Set after the options are settled, so the select shows this listing's
        // real status rather than whatever the previous listing left behind
        statusSelect.value = item.status;
        fillSelect(document.getElementById('ef-category'), meta.categories, item.category);
        fillSelect(document.getElementById('ef-location'), meta.locations, item.location);
        document.getElementById('ef-custom-category').value = item.customCategory || '';
        document.getElementById('ef-custom-location').value = item.customLocation || '';
        document.getElementById('ef-custom-category-field').hidden = item.category !== 'Other';
        document.getElementById('ef-custom-location-field').hidden = item.location !== 'Other';
        document.getElementById('edit-error').dataset.show = 'false';
        openModalEl(editModal);
      } catch (err) {
        ui.toast(err.message);
      }
    }

    document.getElementById('ef-category').addEventListener('change', (event) => {
      document.getElementById('ef-custom-category-field').hidden = event.target.value !== 'Other';
    });
    document.getElementById('ef-location').addEventListener('change', (event) => {
      document.getElementById('ef-custom-location-field').hidden = event.target.value !== 'Other';
    });
    document.querySelectorAll('[data-close-edit]').forEach((btn) => {
      btn.addEventListener('click', () => closeModalEl(editModal));
    });
    editModal.addEventListener('click', (event) => {
      if (event.target === editModal) closeModalEl(editModal);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && editModal.dataset.open === 'true') closeModalEl(editModal);
    });

    document.getElementById('edit-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const box = document.getElementById('edit-error');
      const showError = (message) => { box.textContent = message; box.dataset.show = 'true'; };
      box.dataset.show = 'false';

      const payload = {
        type: document.getElementById('ef-type').value,
        title: document.getElementById('ef-title').value.trim(),
        category: document.getElementById('ef-category').value,
        location: document.getElementById('ef-location').value,
        date: document.getElementById('ef-date').value,
        description: document.getElementById('ef-description').value.trim()
      };
      if (payload.category === 'Other') {
        payload.customCategory = document.getElementById('ef-custom-category').value.trim();
        if (!payload.customCategory) return showError('Please describe the category.');
      }
      if (payload.location === 'Other') {
        payload.customLocation = document.getElementById('ef-custom-location').value.trim();
        if (!payload.customLocation) return showError('Please describe the location.');
      }
      if (!payload.title) return showError('Please give the item a name.');
      if (!payload.description) return showError('Please add a short description.');
      if (!payload.date) return showError('Please choose a date.');

      const btn = document.getElementById('ef-submit');
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        try {
          await api(`/items/${editingId}`, { method: 'PUT', body: payload, auth: true });
        } catch (err) {
          // Nothing was saved, so the modal stays open for the user to correct it
          showError(err.message);
          return;
        }

        // From here the details ARE saved. A status failure below is a partial
        // success and must never be reported as "nothing was saved".
        // Status is managed by its own endpoint, so its guards (terminal states,
        // takedowns, one-off points and notifications) always apply. Only call
        // it when the value actually changed, or it would 400 on "already open".
        const wantedStatus = document.getElementById('ef-status').value;
        const statusChanged = Boolean(wantedStatus) && wantedStatus !== editingStatus;
        let statusError = null;

        if (statusChanged) {
          try {
            await api(`/items/${editingId}/status`, { method: 'PATCH', body: { status: wantedStatus }, auth: true });
          } catch (err) {
            statusError = err;
          }
        }

        // Close and reload either way: the table must show what the server
        // holds, not what the user hoped for. The reload reports its own
        // failure instead of toasting it, so one message can cover both.
        closeModalEl(editModal);
        const reload = await refresh({ silent: true });
        const reloadFailed = !reload.ok;

        // Exactly one toast, because the toast element is reused and a second
        // message would overwrite the first. Every combination is covered, so
        // a failed reload can never hide a failed status change.
        if (statusError && reloadFailed) {
          ui.toast(`Listing details saved, but the status could not be changed to "${wantedStatus}" (${statusError.message}), and the dashboard could not be refreshed (${reload.message}). Reload the page to see the latest state.`);
        } else if (statusError) {
          ui.toast(`Listing details saved, but the status could not be changed to "${wantedStatus}": ${statusError.message}`);
        } else if (reloadFailed) {
          ui.toast(`Listing updated, but the dashboard could not be refreshed (${reload.message}). Reload the page to see the latest state.`);
        } else {
          ui.toast('Listing updated');
        }
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save changes';
      }
    });

    // Approve / reject / handover / edit / delete — one delegated listener
    document.addEventListener('click', async (event) => {
      const approve = event.target.closest('[data-approve]');
      const reject = event.target.closest('[data-reject]');
      const edit = event.target.closest('[data-edit]');
      const remove = event.target.closest('[data-delete]');
      const handover = event.target.closest('[data-handover]');
      const button = approve || reject || edit || remove || handover;
      if (!button) return;

      if (edit) return openEdit(edit.dataset.edit);

      if (remove) {
        const rowTitle = remove.closest('tr')?.querySelector('td')?.textContent?.trim() || 'this listing';
        const sure = window.confirm(`Delete "${rowTitle}"? Its claims are deleted too. This cannot be undone.`);
        if (!sure) return;
      }

      button.disabled = true;
      try {
        if (approve) {
          await api(`/claims/${approve.dataset.approve}/review`, { method: 'PATCH', body: { decision: 'approve' }, auth: true });
          ui.toast('Claim approved');
        } else if (reject) {
          await api(`/claims/${reject.dataset.reject}/review`, { method: 'PATCH', body: { decision: 'reject' }, auth: true });
          ui.toast('Claim rejected');
        } else if (handover) {
          // The claimant reads their six-digit code from their own dashboard
          // and tells the owner in person; the owner enters it here to prove
          // the item actually changed hands.
          const code = window.prompt('Enter the six-digit handover code from the claimant:');
          if (!code) { button.disabled = false; return; }
          await api(`/claims/${handover.dataset.handover}/complete`, { method: 'POST', body: { code: code.trim() }, auth: true });
          ui.toast('Handover confirmed — the listing is now marked returned');
        } else if (remove) {
          await api(`/items/${remove.dataset.delete}`, { method: 'DELETE', auth: true });
          ui.toast('Listing deleted');
        }
        await refresh();
      } catch (err) {
        ui.toast(err.message);
        button.disabled = false;
      }
    });

    refresh();
    initNotifications();
    initTheme();

/* The error row offers a Retry; without this it did nothing. */
document.addEventListener('click', (event) => {
  if (event.target.closest('[data-retry-received]')) {
    event.preventDefault();
    if (typeof refresh === 'function') refresh();
  }
});

