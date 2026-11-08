/* ============================================================
   api.js — one place for every call to the backend.
   Shared by index.html, auth.html, dashboard.html and admin.html.
   ============================================================ */

/**
 * Work out where the API lives.
 * When Express serves this frontend the API is on the same origin.
 * If you open index.html with VS Code Live Server instead, fall back
 * to the local backend port.
 */
const API_BASE = (() => {
  const { protocol } = window.location;

  // Opened straight off disk: there is no origin, so fall back to the dev port.
  if (protocol === 'file:') return 'http://localhost:5000/api';

  // An explicit override wins (useful for a static preview against a separate
  // backend): set window.FOUNDRY_API_BASE before this script loads.
  if (typeof window.FOUNDRY_API_BASE === 'string' && window.FOUNDRY_API_BASE) {
    return window.FOUNDRY_API_BASE.replace(/\/+$/, '');
  }

  // Otherwise the API is on the same origin that served this page. Hardcoding
  // port 5000 for every other port meant the app silently called nothing
  // whenever it ran on any other port — which is how it behaved under the
  // browser tests, and would have on any deployment not using the default port.
  return `${window.location.origin}/api`;
})();

const TOKEN_KEY = 'foundry.token';
const USER_KEY = 'foundry.user';

const Auth = {
  get token() {
    return localStorage.getItem(TOKEN_KEY) || '';
  },
  get user() {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    } catch {
      return null;
    }
  },
  get isLoggedIn() {
    return Boolean(this.token);
  },
  // Anyone who may open the admin page: moderators see the moderation panels,
  // administrators see everything. What they can actually DO is decided by the
  // server, not by this flag.
  get isAdmin() {
    return ['moderator', 'admin', 'superadmin'].includes(this.user?.role);
  },
  get isSuperAdmin() {
    return this.user?.role === 'superadmin';
  },
  save(token, user) {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  },
  clear() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
  /** Send the visitor to the login page, remembering where they came from. */
  requireLogin(redirect = window.location.pathname) {
    window.location.href = `auth.html?next=${encodeURIComponent(redirect)}`;
  }
};

/**
 * Core request helper.
 * Throws an Error with a readable message on any non-2xx response,
 * so callers can just try/catch and show err.message.
 */
async function api(path, { method = 'GET', body, auth = false, signal } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && Auth.token) headers.Authorization = `Bearer ${Auth.token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new Error('Cannot reach Foundry. Check your connection and try again.');
  }

  let data = null;
  const text = await response.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const error = new Error(data?.message || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

/** Small helpers used across pages */
const ui = {
  /** Show a toast message for a couple of seconds. */
  toast(message) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
      document.body.appendChild(el);
    }
    el.textContent = message;
    el.dataset.show = 'true';
    clearTimeout(el._timer);
    el._timer = setTimeout(() => {
      el.dataset.show = 'false';
    }, 3200);
  },

  /** Format a date as 12 Oct 2026 */
  date(value) {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  /** Escape user text before putting it in HTML. */
  esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
};

/**
 * Log out. Clears the session and navigates IMMEDIATELY, then tells the
 * server as a fire-and-forget request. Never await anything before
 * redirecting — a slow or failing request must not block the user.
 */
function logoutAndGo(target = 'index.html') {
  const token = Auth.token;
  Auth.clear();
  window.location.replace(target);
  if (token) {
    try {
      fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => {});
    } catch {
      /* the token is stateless — the session is already gone locally */
    }
  }
}

/* ---------------- colour theme ---------------- */

const THEME_KEY = 'foundry.theme';

/**
 * Dark is the default. The choice is stored locally and applied to <html>
 * before paint on every page, so there is no flash of the wrong theme.
 */
function applyTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = value;
  document.querySelectorAll('[data-theme-icon]').forEach((node) => {
    node.textContent = value === 'light' ? '☀' : '☾';
  });
  document.querySelectorAll('[data-theme-toggle]').forEach((node) => {
    node.setAttribute('aria-label', value === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  });
}

function initTheme() {
  // theme-init.js already resolved stored -> OS preference -> Paper before
  // first paint. Trust that decision instead of re-deriving it with a
  // different rule, which caused a flash of the wrong theme and ignored the
  // operating system setting entirely.
  var decided = document.documentElement.getAttribute('data-theme');
  if (decided === 'light' || decided === 'dark') {
    applyTheme(decided);
  } else {
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  }
}

/** Reveal elements as they scroll into view. */
function initScrollReveal() {
  const targets = document.querySelectorAll('[data-reveal]');
  if (!targets.length) return;
  if (!('IntersectionObserver' in window) ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    targets.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-in');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  targets.forEach((el) => observer.observe(el));
}

/** Wire the mobile menu button. */
function initMobileNav() {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.nav');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const open = nav.dataset.open === 'true';
    nav.dataset.open = String(!open);
    toggle.setAttribute('aria-expanded', String(!open));
  });
}

/**
 * In-app notifications.
 * Any page with a [data-notifications] block gets the same bell. The list is
 * real: the server writes a notification when a claim arrives, when a claim is
 * reviewed, and when an item is marked returned. This only reads them.
 */
// Only in-app pages, and only the dashboard sections that exist
const SAFE_NOTIFICATION_TARGET = /^(index|dashboard|admin)\.html(#(listings|claims-received|claims-made))?$/;

/** Return the link only if it is a known in-app destination, else ''. */
function safeNotificationTarget(link) {
  const value = String(link || '');
  return SAFE_NOTIFICATION_TARGET.test(value) ? value : '';
}

async function initNotifications() {
  const root = document.querySelector('[data-notifications]');
  if (!root || !Auth.isLoggedIn) return;

  const toggle = root.querySelector('[data-notif-toggle]');
  const panel = root.querySelector('[data-notif-panel]');
  const badge = root.querySelector('[data-notif-badge]');
  const list = root.querySelector('[data-notif-list]');
  const readAll = root.querySelector('[data-notif-read-all]');
  const count = root.querySelector('[data-notif-count]');
  if (!toggle || !panel || !badge || !list) return;

  const paint = (data) => {
    const unread = Number(data.unread) || 0;

    badge.textContent = unread > 99 ? '99+' : String(unread);
    badge.hidden = unread === 0;

    if (count) count.textContent = unread ? `${unread} unread` : 'All read';
    if (readAll) {
      // Nothing to do when nothing is unread: the button says so rather than
      // looking broken
      readAll.disabled = unread === 0;
      readAll.setAttribute('aria-disabled', String(unread === 0));
    }

    list.innerHTML = data.notifications.length
      ? data.notifications.map((n) => {
          const target = safeNotificationTarget(n.link);
          // Read state must reach a screen reader, not only the eye. A real
          // span works for both the button and the plain-div variant, whereas
          // aria-label on a div is ignored by assistive technology.
          const prefix = n.read ? '' : '<span class="visually-hidden">Unread: </span>';
          const body = `<p>${prefix}${ui.esc(n.message)}</p><time>${ui.date(n.createdAt)}</time>`;
          const classes = `notifications__item${n.read ? '' : ' is-unread'}`;
          // A notification with nowhere to go is rendered as plain text, so it
          // never looks clickable while doing nothing
          return target
            ? `<li><button type="button" class="${classes} notifications__item--link"
                 data-notif-id="${n.id}" data-notif-target="${ui.esc(target)}">${body}</button></li>`
            : `<li><div class="${classes}">${body}</div></li>`;
        }).join('')
      : '<li class="notifications__empty">Nothing yet. Claims and returns show up here.</li>';
  };

  const load = async () => {
    try {
      paint(await api('/notifications', { auth: true }));
    } catch {
      // A failed fetch must not break the page, but it must not look like
      // "you have no notifications" either
      badge.hidden = true;
      if (count) count.textContent = '';
      if (readAll) readAll.disabled = true;
      list.innerHTML = '<li class="notifications__empty">Could not load notifications. Please try again.</li>';
    }
  };

  toggle.addEventListener('click', async () => {
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    toggle.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) {
      list.innerHTML = '<li class="notifications__empty">Loading…</li>';
      await load();
    }
  });

  if (readAll) {
    readAll.addEventListener('click', async () => {
      try {
        const result = await api('/notifications/read-all', { method: 'PATCH', auth: true });
        await load();
        const updated = Number(result && result.updated) || 0;
        ui.toast(updated
          ? `${updated} notification${updated === 1 ? '' : 's'} marked as read`
          : 'No unread notifications');
      } catch (err) {
        ui.toast(err.message);
      }
    });
  }

  // Clicking a notification marks it read and, when it points somewhere,
  // takes the reader to that section of the dashboard
  list.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-notif-id]');
    if (!item) return;
    const target = item.dataset.notifTarget || '';
    const wasUnread = item.classList.contains('is-unread');

    // An already-read row needs no request; it simply navigates
    if (wasUnread) {
      try {
        await api(`/notifications/${item.dataset.notifId}/read`, { method: 'PATCH', auth: true });
      } catch (err) {
        ui.toast(err.message);
        return;
      }
      item.classList.remove('is-unread');
      const srPrefix = item.querySelector('.visually-hidden');
      if (srPrefix) srPrefix.remove();
    }

    if (target) {
      window.location.href = target;
      return;
    }
    if (wasUnread) {
      ui.toast('Marked as read');
      await load();
    }
  });

  document.addEventListener('click', (event) => {
    if (!panel.hidden && !root.contains(event.target)) {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  await load();
}
