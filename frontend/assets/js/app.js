/* ============================================================
   app.js — homepage behaviour
   Search, filters, listing grid, item modal, report form, claims.
   ============================================================ */

const state = {
  q: '',
  type: 'all',
  category: 'all',
  location: 'all',
  from: '',
  to: '',
  sort: 'newest',
  items: [],
  activeItemId: null,
  pendingImage: '' // data URL of the photo chosen in the report form
};

const el = {
  grid: document.getElementById('item-grid'),
  empty: document.getElementById('empty-state'),
  emptyTitle: document.getElementById('empty-title'),
  emptyText: document.getElementById('empty-text'),
  count: document.getElementById('result-count'),
  search: document.getElementById('search'),
  type: document.getElementById('filter-type'),
  category: document.getElementById('filter-category'),
  location: document.getElementById('filter-location'),
  from: document.getElementById('filter-from'),
  to: document.getElementById('filter-to'),
  sort: document.getElementById('filter-sort'),
  reset: document.getElementById('reset-filters'),
  clearFromEmpty: document.getElementById('clear-from-empty'),
  statLost: document.getElementById('stat-lost'),
  statFound: document.getElementById('stat-found'),
  statReturned: document.getElementById('stat-returned'),
  statActive: document.getElementById('stat-active')
};

// Everything focusable inside a modal, for the focus trap
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let lastFocused = null;

// Matches IMAGE_LIMIT_BYTES in backend/src/routes/item.routes.js
const MAX_IMAGE_BYTES = 400 * 1024;

/* ---------------- header state ---------------- */
function paintAuthState() {
  const loggedIn = Auth.isLoggedIn;
  document.querySelectorAll('[data-auth-only]').forEach((n) => { n.hidden = !loggedIn; });
  document.querySelectorAll('[data-guest-only]').forEach((n) => { n.hidden = loggedIn; });
  document.querySelectorAll('[data-admin-only]').forEach((n) => { n.hidden = !Auth.isAdmin; });
}

/* ---------------- dropdowns ---------------- */
async function loadMeta() {
  try {
    const meta = await api('/items/meta');
    meta.categories.forEach((c) => {
      el.category.insertAdjacentHTML('beforeend', `<option value="${ui.esc(c)}">${ui.esc(c)}</option>`);
    });
    meta.locations.forEach((l) => {
      el.location.insertAdjacentHTML('beforeend', `<option value="${ui.esc(l)}">${ui.esc(l)}</option>`);
    });
    return meta;
  } catch (err) {
    ui.toast(err.message);
    return { categories: [], locations: [] };
  }
}

/* ---------------- photos ---------------- */

/**
 * Shrink a chosen photo in the browser before it is sent.
 * The longest side is capped at 900px and the JPEG quality is stepped down
 * until the encoded string fits the server's 400 KB limit.
 */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      reject(new Error('Choose a PNG, JPEG or WebP image.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('That file could not be read.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a readable image.'));
      img.onload = () => {
        const scale = Math.min(1, 900 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

        for (const quality of [0.82, 0.7, 0.55, 0.4]) {
          const dataUrl = canvas.toDataURL('image/jpeg', quality);
          const bytes = Math.floor(((dataUrl.split(',')[1] || '').length * 3) / 4);
          if (bytes <= MAX_IMAGE_BYTES) {
            resolve(dataUrl);
            return;
          }
        }
        reject(new Error('That photo is still too large after shrinking. Try a smaller one.'));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------- listings ---------------- */
function cardMarkup(item) {
  const place = item.location === 'Other' && item.customLocation ? item.customLocation : item.location;
  const category = item.category === 'Other' && item.customCategory ? item.customCategory : item.category;
  const photo = item.imageUrl
    ? `<div class="card__media"><img src="${ui.esc(item.imageUrl)}" alt="" loading="lazy" /></div>`
    : '';
  return `
    <button class="card" data-item-id="${item.id}" aria-label="View ${ui.esc(item.title)}">
      ${photo}
      <div class="card__top">
        <span class="tag tag--${item.type}">${item.type === 'lost' ? 'Lost' : 'Found'}</span>
        <span class="tag">${ui.esc(category)}</span>
      </div>
      <h3 class="card__title">${ui.esc(item.title)}</h3>
      <p class="card__desc">${ui.esc(item.description)}</p>
      <div class="card__meta">
        <span>${ui.esc(place)}</span>
        <span>${ui.date(item.date)}</span>
      </div>
    </button>`;
}

function hasActiveFilters() {
  return Boolean(state.q) || state.type !== 'all' || state.category !== 'all'
    || state.location !== 'all' || Boolean(state.from) || Boolean(state.to);
}

async function loadItems() {
  el.count.textContent = 'Loading listings…';
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.type !== 'all') params.set('type', state.type);
  if (state.category !== 'all') params.set('category', state.category);
  if (state.location !== 'all') params.set('location', state.location);
  if (state.from) params.set('from', state.from);
  if (state.to) params.set('to', state.to);
  params.set('sort', state.sort);
  params.set('limit', '100');

  try {
    const data = await api(`/items?${params.toString()}`);
    state.items = data.items;
    renderGrid(data);
  } catch (err) {
    el.count.textContent = 'Could not load listings';
    el.grid.innerHTML = '';
    showEmpty('The server is not responding', err.message, { firstRun: false });
  }
}

/**
 * Paint the empty state. Two different situations share one element:
 * a brand-new board with nothing on it, and filters that match nothing.
 */
function showEmpty(title, message, { firstRun }) {
  el.empty.hidden = false;
  el.emptyTitle.textContent = title;
  el.emptyText.textContent = message;
  // "Clear filters" is pointless on an empty board
  el.clearFromEmpty.hidden = firstRun;
}

function renderGrid(data) {
  const total = data.total;
  const filtered = hasActiveFilters();

  el.count.textContent = total === 0
    ? 'No listings match'
    : `${total} listing${total === 1 ? '' : 's'}${filtered ? ' match your filters' : ' on the board'}`;

  if (!data.items.length) {
    el.grid.innerHTML = '';
    if (filtered) {
      showEmpty('Nothing matches that yet',
        'Try a different keyword, or widen the filters. You can also report the item yourself.',
        { firstRun: false });
    } else {
      showEmpty('No items reported yet',
        'Be the first to report a lost or found item on campus.',
        { firstRun: true });
    }
    return;
  }

  el.empty.hidden = true;
  el.grid.innerHTML = data.items.map(cardMarkup).join('');
}

function applyFilters() {
  loadItems();
}

function resetFilters() {
  state.q = '';
  state.type = 'all';
  state.category = 'all';
  state.location = 'all';
  state.from = '';
  state.to = '';
  state.sort = 'newest';
  el.search.value = '';
  el.type.value = 'all';
  el.category.value = 'all';
  el.location.value = 'all';
  el.from.value = '';
  el.to.value = '';
  el.sort.value = 'newest';
  loadItems();
}

/* ---------------- stats ---------------- */
async function loadStats() {
  try {
    // Counted by the database, so the tiles stay correct past the page limit
    const stats = await api('/items/stats');
    el.statLost.textContent = stats.lost;
    el.statFound.textContent = stats.found;
    el.statReturned.textContent = stats.returned;
    el.statActive.textContent = stats.active;
  } catch {
    el.statLost.textContent = '—';
    el.statFound.textContent = '—';
    el.statReturned.textContent = '—';
    el.statActive.textContent = '—';
  }
}

/* ---------------- modals ---------------- */

/**
 * Keep Tab inside an open dialog.
 * Without this, Tab walks out of the modal and into the page behind it, which
 * is disorienting for keyboard and screen-reader users.
 */
function trapFocus(modal) {
  const nodes = [...modal.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);
  if (!nodes.length) return;
  const first = nodes[0];
  const last = nodes[nodes.length - 1];

  const handler = (event) => {
    if (event.key !== 'Tab') return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  modal.addEventListener('keydown', handler);
  modal._trapHandler = handler;
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  lastFocused = document.activeElement;
  modal.dataset.open = 'true';
  document.body.style.overflow = 'hidden';
  const focusable = modal.querySelector(FOCUSABLE);
  if (focusable) focusable.focus({ preventScroll: true });
  trapFocus(modal);
}

function closeModal(modal) {
  if (!modal) return;
  modal.dataset.open = 'false';
  document.body.style.overflow = '';
  if (modal._trapHandler) {
    modal.removeEventListener('keydown', modal._trapHandler);
    modal._trapHandler = null;
  }
  // Send focus back where it came from
  if (lastFocused && lastFocused.isConnected) lastFocused.focus({ preventScroll: true });
}

function closeAllModals() {
  document.querySelectorAll('.modal[data-open="true"]').forEach(closeModal);
}

/* ---------------- item detail ---------------- */
async function openItem(id) {
  try {
    const { item } = await api(`/items/${id}`);
    state.activeItemId = item.id;

    const place = item.location === 'Other' && item.customLocation ? item.customLocation : item.location;
    const category = item.category === 'Other' && item.customCategory ? item.customCategory : item.category;

    document.getElementById('modal-item-tag').textContent =
      `${item.type === 'lost' ? 'Lost' : 'Found'} · ${item.status}`;
    document.getElementById('modal-item-title').textContent = item.title;

    const photo = item.imageUrl
      ? `<div class="detail-media"><img src="${ui.esc(item.imageUrl)}" alt="Photo of ${ui.esc(item.title)}" /></div>`
      : '';

    document.getElementById('modal-item-body').innerHTML = `
      ${photo}
      <div><dt>Description</dt><dd>${ui.esc(item.description)}</dd></div>
      <div><dt>Category</dt><dd>${ui.esc(category)}</dd></div>
      <div><dt>Location</dt><dd>${ui.esc(place)}</dd></div>
      <div><dt>Date reported</dt><dd>${ui.date(item.date)}</dd></div>
      <div><dt>Status</dt><dd>${ui.esc(item.status)}</dd></div>
      <div><dt>Posted by</dt><dd>${ui.esc(item.reportedBy?.name || 'A student')}</dd></div>`;

    const claimBtn = document.getElementById('btn-claim');
    const mine = Auth.user && item.reportedBy && item.reportedBy.id === Auth.user.id;
    if (mine) {
      claimBtn.disabled = true;
      claimBtn.textContent = 'This is your listing';
    } else if (item.status !== 'open') {
      claimBtn.disabled = true;
      claimBtn.textContent = `Already ${item.status}`;
    } else {
      claimBtn.disabled = false;
      claimBtn.textContent = 'Claim this item';
    }

    openModal('modal-item');

    // Duplicate-item alert: show similar listings if any exist
    showSimilar(item.id);
  } catch (err) {
    ui.toast(err.message);
  }
}

async function showSimilar(id) {
  const body = document.getElementById('modal-item-body');
  try {
    const data = await api(`/items/${id}/similar`);
    if (!data.count) return;
    const names = data.items.map((i) => `<li>${ui.esc(i.title)} — ${ui.esc(i.location)}</li>`).join('');
    body.insertAdjacentHTML('beforeend', `
      <div><dt>Possible match</dt><dd>
        <p style="margin-bottom:.4rem;color:var(--accent);">${data.count} similar listing${data.count === 1 ? '' : 's'} found</p>
        <ul style="display:grid;gap:.3rem;font-size:.85rem;color:var(--muted);">${names}</ul>
      </dd></div>`);
  } catch {
    /* the alert is a bonus — stay quiet if it fails */
  }
}

/* ---------------- report form ---------------- */
function prepareReportForm(meta) {
  const category = document.getElementById('rf-category');
  const location = document.getElementById('rf-location');

  category.innerHTML = meta.categories.map((c) => `<option value="${ui.esc(c)}">${ui.esc(c)}</option>`).join('');
  location.innerHTML = meta.locations.map((l) => `<option value="${ui.esc(l)}">${ui.esc(l)}</option>`).join('');

  const customCategoryField = document.getElementById('rf-custom-category-field');
  const customLocationField = document.getElementById('rf-custom-location-field');

  category.addEventListener('change', () => {
    const isOther = category.value === 'Other';
    customCategoryField.hidden = !isOther;
    if (!isOther) document.getElementById('rf-custom-category').value = '';
  });
  location.addEventListener('change', () => {
    const isOther = location.value === 'Other';
    customLocationField.hidden = !isOther;
    if (!isOther) document.getElementById('rf-custom-location').value = '';
  });

  document.getElementById('rf-date').value = new Date().toISOString().slice(0, 10);

  // Photo picker: shrink the image as soon as it is chosen, so the submit
  // handler only has to send a ready-made data URL.
  const fileInput = document.getElementById('rf-image');
  const preview = document.getElementById('rf-image-preview');

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    state.pendingImage = '';
    preview.hidden = true;
    preview.innerHTML = '';
    if (!file) return;

    try {
      state.pendingImage = await shrinkImage(file);
      preview.innerHTML = `<img src="${ui.esc(state.pendingImage)}" alt="Photo preview" />`;
      preview.hidden = false;
    } catch (err) {
      fileInput.value = '';
      showFormMessage('report-error', err.message);
    }
  });
}

function showFormMessage(id, message) {
  const node = document.getElementById(id);
  node.textContent = message;
  node.dataset.show = message ? 'true' : 'false';
}

async function submitReport(event) {
  event.preventDefault();

  if (!Auth.isLoggedIn) {
    ui.toast('Please log in to post a listing');
    Auth.requireLogin('index.html');
    return;
  }

  const form = event.target;
  const errorBox = 'report-error';
  showFormMessage(errorBox, '');

  const payload = {
    type: document.getElementById('rf-type').value,
    title: document.getElementById('rf-title').value.trim(),
    category: document.getElementById('rf-category').value,
    location: document.getElementById('rf-location').value,
    date: document.getElementById('rf-date').value,
    description: document.getElementById('rf-description').value.trim()
  };
  if (state.pendingImage) payload.imageUrl = state.pendingImage;

  if (payload.category === 'Other') {
    payload.customCategory = document.getElementById('rf-custom-category').value.trim();
    if (!payload.customCategory) return showFormMessage(errorBox, 'Please describe the category.');
  }
  if (payload.location === 'Other') {
    payload.customLocation = document.getElementById('rf-custom-location').value.trim();
    if (!payload.customLocation) return showFormMessage(errorBox, 'Please describe the location.');
  }
  if (!payload.title) return showFormMessage(errorBox, 'Please give the item a name.');
  if (!payload.description) return showFormMessage(errorBox, 'Please add a short description.');
  if (!payload.date) return showFormMessage(errorBox, 'Please choose a date.');

  const submitBtn = document.getElementById('rf-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Posting…';

  try {
    await api('/items', { method: 'POST', body: payload, auth: true });
    form.reset();
    state.pendingImage = '';
    document.getElementById('rf-image-preview').hidden = true;
    document.getElementById('rf-image-preview').innerHTML = '';
    document.getElementById('rf-date').value = new Date().toISOString().slice(0, 10);
    document.getElementById('rf-custom-category-field').hidden = true;
    document.getElementById('rf-custom-location-field').hidden = true;
    showFormMessage('report-success', 'Listing posted. It now appears on the board.');
    ui.toast('Listing posted');
    closeAllModals();
    await Promise.all([loadItems(), loadStats()]);
    document.getElementById('browse').scrollIntoView({ behavior: 'smooth' });
  } catch (err) {
    showFormMessage(errorBox, err.message);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Post listing';
  }
}

/* ---------------- claim ---------------- */
function openClaim() {
  if (!Auth.isLoggedIn) {
    ui.toast('Please log in to claim an item');
    Auth.requireLogin('index.html');
    return;
  }
  document.getElementById('claim-error').dataset.show = 'false';
  document.getElementById('cf-message').value = '';
  closeAllModals();
  openModal('modal-claim');
}

async function submitClaim(event) {
  event.preventDefault();
  const box = document.getElementById('claim-error');
  const message = document.getElementById('cf-message').value.trim();
  box.dataset.show = 'false';

  if (!message) {
    box.textContent = 'Please add a detail that proves it is yours.';
    box.dataset.show = 'true';
    return;
  }

  const btn = document.getElementById('cf-submit');
  btn.disabled = true;
  btn.textContent = 'Sending…';

  try {
    await api('/claims', {
      method: 'POST',
      body: { itemId: state.activeItemId, message },
      auth: true
    });
    closeAllModals();
    ui.toast('Claim sent. The person who posted this listing can approve it from their dashboard.');
  } catch (err) {
    box.textContent = err.message;
    box.dataset.show = 'true';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send claim';
  }
}

/* ---------------- boot ---------------- */
document.addEventListener('DOMContentLoaded', async () => {
  // Arriving from a "Log out" link — make sure the session is really gone.
  if (window.location.search.includes('loggedout=1')) {
    Auth.clear();
    window.history.replaceState({}, '', window.location.pathname);
  }

  paintAuthState();
  initMobileNav();
  initScrollReveal();
  initNotifications();

  // Log out from the header
  const headerLogout = document.getElementById('header-logout');
  if (headerLogout) {
    headerLogout.addEventListener('click', () => logoutAndGo('index.html'));
  }

  const meta = await loadMeta();
  prepareReportForm(meta);
  await Promise.all([loadItems(), loadStats()]);

  // filter events
  let searchTimer;
  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = el.search.value.trim();
      applyFilters();
    }, 300);
  });
  el.type.addEventListener('change', () => { state.type = el.type.value; applyFilters(); });
  el.category.addEventListener('change', () => { state.category = el.category.value; applyFilters(); });
  el.location.addEventListener('change', () => { state.location = el.location.value; applyFilters(); });
  el.from.addEventListener('change', () => { state.from = el.from.value; applyFilters(); });
  el.to.addEventListener('change', () => { state.to = el.to.value; applyFilters(); });
  el.sort.addEventListener('change', () => { state.sort = el.sort.value; applyFilters(); });
  el.reset.addEventListener('click', resetFilters);
  el.clearFromEmpty.addEventListener('click', resetFilters);

  // grid clicks
  el.grid.addEventListener('click', (event) => {
    const card = event.target.closest('[data-item-id]');
    if (card) openItem(card.dataset.itemId);
  });

  // open report modal from anywhere; the button decides lost or found
  document.querySelectorAll('[data-open-report]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!Auth.isLoggedIn) {
        ui.toast('Please log in to report an item');
        Auth.requireLogin('index.html');
        return;
      }
      showFormMessage('report-error', '');
      showFormMessage('report-success', '');
      const wanted = btn.dataset.openReport;
      if (wanted === 'lost' || wanted === 'found') {
        document.getElementById('rf-type').value = wanted;
      }
      openModal('modal-report');
    });
  });

  document.getElementById('report-form').addEventListener('submit', submitReport);
  document.getElementById('claim-form').addEventListener('submit', submitClaim);
  document.getElementById('btn-claim').addEventListener('click', openClaim);

  // close buttons, backdrop click, Escape
  document.querySelectorAll('[data-close-modal]').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(btn.closest('.modal')));
  });
  document.querySelectorAll('.modal').forEach((modal) => {
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal(modal);
    });
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAllModals();
  });

  document.getElementById('back-to-top').addEventListener('click', (event) => {
    event.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});
