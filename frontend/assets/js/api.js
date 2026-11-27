const API_BASE = (() => {
  const { protocol } = window.location;

  if (protocol === 'file:') return 'http://localhost:5000/api';

  if (typeof window.FOUNDRY_API_BASE === 'string' && window.FOUNDRY_API_BASE) {
    return window.FOUNDRY_API_BASE.replace(/\/+$/, '');
  }

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

  requireLogin(redirect = window.location.pathname) {
    window.location.href = `auth.html?next=${encodeURIComponent(redirect)}`;
  }
};

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

const ui = {

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

  date(value) {
    if (!value) return '—';
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? new Date(value + 'T00:00:00') : new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  },

  esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }
};

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

    }
  }
}

const THEME_KEY = 'foundry.theme';

function applyTheme(theme) {
  const value = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = value;
  document.querySelectorAll('[data-theme-icon]').forEach((node) => {
    node.textContent = value === 'light' ? '\u263e' : '\u2600';
  });
  document.querySelectorAll('[data-theme-toggle]').forEach((node) => {
    node.setAttribute('aria-label', value === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
  });
}

function initTheme() {

  var decided = document.documentElement.getAttribute('data-theme');
  if (decided === 'light' || decided === 'dark') {
    applyTheme(decided);
  } else {
    var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
  }
}

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

const SAFE_NOTIFICATION_TARGET = /^(index|dashboard|admin)\.html(#(listings|claims-received|claims-made))?$/;

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

      readAll.disabled = unread === 0;
      readAll.setAttribute('aria-disabled', String(unread === 0));
    }

    list.innerHTML = data.notifications.length
      ? data.notifications.map((n) => {
          const target = safeNotificationTarget(n.link);

          const prefix = n.read ? '' : '<span class="visually-hidden">Unread: </span>';
          const body = `<p>${prefix}${ui.esc(n.message)}</p><time>${ui.date(n.createdAt)}</time>`;
          const classes = `notifications__item${n.read ? '' : ' is-unread'}`;

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

  list.addEventListener('click', async (event) => {
    const item = event.target.closest('[data-notif-id]');
    if (!item) return;
    const target = item.dataset.notifTarget || '';
    const wasUnread = item.classList.contains('is-unread');

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

(function () {
  function init() {
    var toggle = document.querySelector('.menu-toggle');
    var bar = document.querySelector('.site-header__inner');
    if (!toggle || !bar) return;

    var setOpen = function (open) {
      bar.setAttribute('data-nav-open', open ? 'true' : 'false');
      toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    setOpen(false);

    toggle.addEventListener('click', function () {
      setOpen(bar.getAttribute('data-nav-open') !== 'true');
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && bar.getAttribute('data-nav-open') === 'true') {
        setOpen(false);
        toggle.focus();
      }
    });

    document.addEventListener('click', function (e) {
      if (bar.getAttribute('data-nav-open') !== 'true') return;
      if (bar.contains(e.target) || toggle.contains(e.target)) return;
      setOpen(false);
    });

    if (window.matchMedia) {
      var mq = window.matchMedia('(min-width: 641px)');
      var onChange = function () { if (mq.matches) setOpen(false); };
      if (mq.addEventListener) mq.addEventListener('change', onChange);
      else if (mq.addListener) mq.addListener(onChange);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
