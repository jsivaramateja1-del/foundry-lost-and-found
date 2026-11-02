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
  const { protocol, hostname, port } = window.location;
  if (protocol === 'file:') return 'http://localhost:5000/api';
  // Served by our own Express server (port 5000 by default)
  if (port === '5000' || port === '') return `${window.location.origin}/api`;
  // Live Server / any other static preview
  return `http://${hostname || 'localhost'}:5000/api`;
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
  get isAdmin() {
    return this.user?.role === 'admin';
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
    throw new Error('Cannot reach the server. Is the backend running on port 5000?');
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
async function initNotifications() {
  const root = document.querySelector('[data-notifications]');
  if (!root || !Auth.isLoggedIn) return;

  const toggle = root.querySelector('[data-notif-toggle]');
  const panel = root.querySelector('[data-notif-panel]');
  const badge = root.querySelector('[data-notif-badge]');
  const list = root.querySelector('[data-notif-list]');
  const readAll = root.querySelector('[data-notif-read-all]');
  if (!toggle || !panel || !badge || !list) return;

  const paint = (data) => {
    badge.textContent = data.unread > 99 ? '99+' : String(data.unread);
    badge.hidden = data.unread === 0;
    list.innerHTML = data.notifications.length
      ? data.notifications.map((n) => `
          <li class="notifications__item${n.read ? '' : ' is-unread'}">
            <p>${ui.esc(n.message)}</p>
            <time>${ui.date(n.createdAt)}</time>
          </li>`).join('')
      : '<li class="notifications__empty">Nothing yet. Claims and returns show up here.</li>';
  };

  const load = async () => {
    try {
      paint(await api('/notifications', { auth: true }));
    } catch {
      // A failed notification fetch must never break the page it sits on
      badge.hidden = true;
    }
  };

  toggle.addEventListener('click', async () => {
    const willOpen = panel.hidden;
    panel.hidden = !willOpen;
    toggle.setAttribute('aria-expanded', String(willOpen));
    if (willOpen) await load();
  });

  if (readAll) {
    readAll.addEventListener('click', async () => {
      try {
        await api('/notifications/read-all', { method: 'PATCH', auth: true });
        await load();
      } catch (err) {
        ui.toast(err.message);
      }
    });
  }

  document.addEventListener('click', (event) => {
    if (!panel.hidden && !root.contains(event.target)) {
      panel.hidden = true;
      toggle.setAttribute('aria-expanded', 'false');
    }
  });

  await load();
}
