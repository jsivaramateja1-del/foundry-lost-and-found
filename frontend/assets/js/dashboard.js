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
    async function refresh() {
      let data;
      try {
        data = await api('/dashboard/me', { auth: true });
      } catch (err) {
        // If the user just logged out, stay quiet instead of bouncing them back
        if (!Auth.isLoggedIn) return;
        if (err.status === 401) return Auth.requireLogin('dashboard.html');
        ui.toast(err.message);
        return;
      }

      Object.entries(data.stats).forEach(([key, value]) => {
        const node = document.querySelector(`[data-metric="${key}"]`);
        if (node) node.textContent = value;
      });

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
                : `<button class="btn btn--ghost" data-return="${i.id}">Mark returned</button>`,
              `<button class="btn btn--ghost" data-edit="${i.id}">Edit</button>`,
              `<button class="btn btn--ghost" data-delete="${i.id}">Delete</button>`
            ].join(' ')
          ])).join('')
        : '<tr><td colspan="6" style="color:var(--muted)">You have not posted anything yet.</td></tr>';

      // --- claims you made ---
      document.getElementById('claims-body').innerHTML = data.claims.length
        ? data.claims.map((c) => row([
            ui.esc(c.item?.title || 'Item removed'),
            ui.esc(String(c.message).slice(0, 80)),
            statusTag(c.status),
            ui.date(c.createdAt)
          ])).join('')
        : '<tr><td colspan="4" style="color:var(--muted)">No claims yet.</td></tr>';

      // --- claims received on your listings ---
      // One request for all of them. The old version asked per listing and
      // swallowed every error, so a failure looked identical to "no claims".
      let received = [];
      try {
        const res = await api('/claims/received', { auth: true });
        received = res.claims;
      } catch (err) {
        ui.toast(`Could not load claims received: ${err.message}`);
        received = [];
      }
      document.getElementById('received-count').textContent =
        received.length ? `${received.length} total` : '';

      document.getElementById('received-body').innerHTML = received.length
        ? received.map((c) => row([
            ui.esc(c.itemTitle),
            ui.esc(c.claimant?.name || 'A student'),
            ui.esc(c.message),
            statusTag(c.status),
            c.status === 'pending'
              ? `<button class="btn btn--ghost" data-approve="${c.id}">Approve</button>
                 <button class="btn btn--ghost" data-reject="${c.id}">Reject</button>`
              : c.status === 'approved' && !c.handoverConfirmedAt
                ? `<button class="btn btn--ghost" data-handover="${c.id}">Confirm handover</button>`
                : '<span class="form-note">Reviewed</span>'
          ])).join('')
        : '<tr><td colspan="5" style="color:var(--muted)">Nobody has claimed any of your items yet.</td></tr>';
    }

    /* ---------------- edit and delete ---------------- */
    const editModal = document.getElementById('modal-edit');
    const meta = { categories: [], locations: [] };
    let editingId = null;

    function openModalEl(node) {
      node.dataset.open = 'true';
      document.body.style.overflow = 'hidden';
    }
    function closeModalEl(node) {
      node.dataset.open = 'false';
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
        document.getElementById('ef-date').value = new Date(item.date).toISOString().slice(0, 10);
        document.getElementById('ef-status').value = item.status;
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
        description: document.getElementById('ef-description').value.trim(),
        status: document.getElementById('ef-status').value
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
        await api(`/items/${editingId}`, { method: 'PUT', body: payload, auth: true });
        closeModalEl(editModal);
        ui.toast('Listing updated');
        await refresh();
      } catch (err) {
        showError(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = 'Save changes';
      }
    });

    // Approve / reject / mark returned / edit / delete — one delegated listener
    document.addEventListener('click', async (event) => {
      const approve = event.target.closest('[data-approve]');
      const reject = event.target.closest('[data-reject]');
      const markReturned = event.target.closest('[data-return]');
      const edit = event.target.closest('[data-edit]');
      const remove = event.target.closest('[data-delete]');
      const handover = event.target.closest('[data-handover]');
      const button = approve || reject || markReturned || edit || remove || handover;
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
          await api(`/claims/${approve.dataset.approve}`, { method: 'PATCH', body: { status: 'approved' }, auth: true });
          ui.toast('Claim approved');
        } else if (reject) {
          await api(`/claims/${reject.dataset.reject}`, { method: 'PATCH', body: { status: 'rejected' }, auth: true });
          ui.toast('Claim rejected');
        } else if (handover) {
          await api(`/claims/${handover.dataset.handover}/handover`, { method: 'POST', auth: true });
          ui.toast('Handover confirmed — the listing is now marked returned');
        } else if (remove) {
          await api(`/items/${remove.dataset.delete}`, { method: 'DELETE', auth: true });
          ui.toast('Listing deleted');
        } else {
          await api(`/items/${markReturned.dataset.return}/status`, { method: 'PATCH', body: { status: 'returned' }, auth: true });
          ui.toast('Marked as returned — points awarded');
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
  