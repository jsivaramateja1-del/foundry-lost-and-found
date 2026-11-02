/* admin.html page logic.
   This used to live in an inline <script> block, which the Content-Security-Policy
   (script-src 'self') blocked in the browser, so the page never ran its own code. */
    if (!Auth.isLoggedIn) {
      Auth.requireLogin('admin.html');
    }

    document.getElementById('who').textContent = Auth.user ? Auth.user.name : '';

    document.getElementById('logout').addEventListener('click', () => {
      try { Auth.clear(); } catch { /* the link still navigates */ }
    });

    function row(cells) {
      return `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
    }

    function drawBars(container, rows, labelKey, valueKey) {
      const max = Math.max(...rows.map((r) => r[valueKey]), 1);
      container.innerHTML = rows.length
        ? rows.map((r) => `
            <div class="chart__row">
              <span>${ui.esc(r[labelKey])}</span>
              <span class="chart__bar"><span class="chart__fill" style="width:${(r[valueKey] / max) * 100}%"></span></span>
              <span class="chart__val">${r[valueKey]}</span>
            </div>`).join('')
        : '<p class="form-note">No data yet.</p>';
    }

    async function loadAdmin() {
      if (!Auth.isAdmin) {
        document.getElementById('guard').hidden = false;
        return;
      }
      document.getElementById('admin-content').hidden = false;

      try {
        const stats = await api('/admin/stats', { auth: true });
        Object.entries(stats.totals).forEach(([key, value]) => {
          const node = document.querySelector(`[data-total="${key}"]`);
          if (node) node.textContent = value;
        });
        drawBars(document.getElementById('chart-category'), stats.byCategory, 'category', 'count');
        drawBars(document.getElementById('chart-perday'), stats.perDay, 'date', 'count');

        const items = await api('/admin/items', { auth: true });
        document.getElementById('items-count').textContent = `${items.count} listings`;
        document.getElementById('admin-items').innerHTML = items.items.length
          ? items.items.map((i) => row([
              ui.esc(i.title),
              i.type === 'lost' ? 'Lost' : 'Found',
              ui.esc(i.category),
              ui.esc(i.reportedBy?.name || '—'),
              ui.date(i.date),
              `<select class="select" data-admin-status="${i.id}" aria-label="Status for ${ui.esc(i.title)}">
                 ${['open', 'claimed', 'returned', 'closed'].map((s) => `<option value="${s}"${s === i.status ? ' selected' : ''}>${s}</option>`).join('')}
               </select>`,
              `<button class="btn btn--ghost" data-admin-delete="${i.id}">Delete</button>`
            ])).join('')
          : '<tr><td colspan="7" style="color:var(--muted)">No listings.</td></tr>';

        // A moderator is not allowed to see the account list. That is a
        // server decision, so the page has to cope with the 403.
        let users = { count: 0, users: [] };
        try {
          users = await api('/admin/users', { auth: true });
        } catch (err) {
          document.getElementById('users-count').textContent = 'not available for your role';
        }
        document.getElementById('users-count').textContent = users.count ? `${users.count} accounts` : document.getElementById('users-count').textContent;
        document.getElementById('admin-users').innerHTML = users.users.length
          ? users.users.map((u) => row([
              ui.esc(u.name),
              ui.esc(u.email),
              `<span class="status">${ui.esc(u.role)}</span>${u.suspended ? ' <span class="status status--rejected">suspended</span>' : ''}`,
              u.points,
              ui.date(u.createdAt),
              [
                u.role === 'admin'
                  ? `<button class="btn btn--ghost" data-user="${u.id}" data-role="student">Make student</button>`
                  : `<button class="btn btn--ghost" data-user="${u.id}" data-role="admin">Make admin</button>`,
                u.role === 'admin'
                  ? ''
                  : u.suspended
                    ? `<button class="btn btn--ghost" data-unsuspend="${u.id}">Reinstate</button>`
                    : `<button class="btn btn--ghost" data-suspend="${u.id}">Suspend</button>`
              ].join(' ')
            ])).join('')
          : '<tr><td colspan="6" style="color:var(--muted)">No accounts.</td></tr>';

        const reports = await api('/admin/reports', { auth: true });
        document.getElementById('reports-count').textContent = `${reports.count} open`;
        document.getElementById('admin-reports').innerHTML = reports.reports.length
          ? reports.reports.map((r) => row([
              r.item ? ui.esc(r.item.title) : '<span class="form-note">Listing removed</span>',
              ui.esc(r.reportedBy?.name || '—'),
              ui.esc(r.reason),
              ui.esc(r.details || '—'),
              `<span class="status ${r.status === 'open' ? 'status--pending' : 'status--approved'}">${ui.esc(r.status)}</span>`,
              r.status === 'open'
                ? `<button class="btn btn--ghost" data-resolve="${r.id}">Resolve</button>
                   <button class="btn btn--ghost" data-dismiss="${r.id}">Dismiss</button>`
                : '<span class="form-note">Closed</span>'
            ])).join('')
          : '<tr><td colspan="6" style="color:var(--muted)">Nothing has been reported.</td></tr>';

        const auditTrail = await api('/admin/audit', { auth: true });
        document.getElementById('audit-count').textContent = `${auditTrail.count} recent`;
        document.getElementById('admin-audit').innerHTML = auditTrail.entries.length
          ? auditTrail.entries.map((e) => row([
              ui.esc(e.action.replace(/_/g, ' ')),
              ui.esc(e.actor || '—'),
              ui.esc(e.note || '—'),
              ui.date(e.createdAt)
            ])).join('')
          : '<tr><td colspan="4" style="color:var(--muted)">No administrative actions recorded yet.</td></tr>';

        let claims = { count: 0, claims: [] };
        try {
          claims = await api('/admin/claims', { auth: true });
        } catch (err) {
          document.getElementById('claims-count').textContent = 'not available for your role';
        }
        document.getElementById('claims-count').textContent = claims.count ? `${claims.count} claims` : document.getElementById('claims-count').textContent;
        document.getElementById('admin-claims').innerHTML = claims.claims.length
          ? claims.claims.map((c) => row([
              ui.esc(c.item?.title || 'Item removed'),
              ui.esc(c.claimant?.name || '—'),
              ui.esc(String(c.message).slice(0, 70)),
              `<span class="status status--${c.status}">${ui.esc(c.status)}</span>`,
              ui.date(c.createdAt)
            ])).join('')
          : '<tr><td colspan="5" style="color:var(--muted)">No claims.</td></tr>';
      } catch (err) {
        // If the user just logged out, don't flash the guard message
        if (!Auth.isLoggedIn) return;
        if (err.status === 401 || err.status === 403) {
          document.getElementById('admin-content').hidden = true;
          document.getElementById('guard').hidden = false;
        } else {
          ui.toast(err.message);
        }
      }
    }

    /* ---------------- admin actions ---------------- */

    // Changing the status dropdown on a listing saves immediately
    document.addEventListener('change', async (event) => {
      const select = event.target.closest('[data-admin-status]');
      if (!select) return;
      select.disabled = true;
      try {
        await api(`/admin/items/${select.dataset.adminStatus}/status`, {
          method: 'PATCH',
          body: { status: select.value },
          auth: true
        });
        ui.toast(`Status set to ${select.value}`);
      } catch (err) {
        ui.toast(err.message);
        await loadAdmin();
      } finally {
        select.disabled = false;
      }
    });

    // Delete a listing, promote / demote an account, resolve a report, suspend
    document.addEventListener('click', async (event) => {
      const remove = event.target.closest('[data-admin-delete]');
      const role = event.target.closest('[data-role]');
      const resolve = event.target.closest('[data-resolve]');
      const dismiss = event.target.closest('[data-dismiss]');
      const suspend = event.target.closest('[data-suspend]');
      const reinstate = event.target.closest('[data-unsuspend]');
      const button = remove || role || resolve || dismiss || suspend || reinstate;
      if (!button) return;

      if (remove) {
        const title = remove.closest('tr')?.querySelector('td')?.textContent?.trim() || 'this listing';
        if (!window.confirm(`Delete "${title}"? Its claims are deleted too. This cannot be undone.`)) return;
      }
      if (role) {
        const who = role.closest('tr')?.querySelector('td')?.textContent?.trim() || 'this account';
        if (!window.confirm(`Change the role of "${who}" to ${role.dataset.role}?`)) return;
      }

      if (suspend) {
        const who = suspend.closest('tr')?.querySelector('td')?.textContent?.trim() || 'this account';
        const reason = window.prompt(`Suspend "${who}"? Give a short reason (the student will see it in the logs).`, 'Misuse of the portal');
        if (reason === null) return;
        button.disabled = true;
        try {
          await api(`/admin/users/${suspend.dataset.suspend}/suspend`, {
            method: 'PATCH', body: { suspended: true, reason }, auth: true
          });
          ui.toast('Account suspended');
          await loadAdmin();
        } catch (err) {
          ui.toast(err.message);
          button.disabled = false;
        }
        return;
      }

      button.disabled = true;
      try {
        if (resolve || dismiss) {
          const id = (resolve || dismiss).dataset.resolve || (resolve || dismiss).dataset.dismiss;
          const status = resolve ? 'resolved' : 'dismissed';
          await api(`/admin/reports/${id}`, { method: 'PATCH', body: { status }, auth: true });
          ui.toast(`Report ${status}`);
        } else if (reinstate) {
          await api(`/admin/users/${reinstate.dataset.unsuspend}/suspend`, {
            method: 'PATCH', body: { suspended: false }, auth: true
          });
          ui.toast('Account reinstated');
        } else if (remove) {
          await api(`/admin/items/${remove.dataset.adminDelete}`, { method: 'DELETE', auth: true });
          ui.toast('Listing removed');
        } else {
          await api(`/admin/users/${role.dataset.user}/role`, {
            method: 'PATCH',
            body: { role: role.dataset.role },
            auth: true
          });
          ui.toast(`Role changed to ${role.dataset.role}`);
        }
        await loadAdmin();
      } catch (err) {
        ui.toast(err.message);
        button.disabled = false;
      }
    });

    loadAdmin();
    initNotifications();
    initTheme();
  