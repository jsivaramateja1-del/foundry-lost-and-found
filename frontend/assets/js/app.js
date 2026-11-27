const state = {
  q: '',
  type: 'all',
  status: 'all',
  category: 'all',
  subcategory: 'all',
  location: 'all',
  from: '',
  to: '',
  sort: 'newest',
  items: [],
  activeItemId: null,
  pendingImage: '',
  meta: { categories: [], subcategories: {}, locations: [] },

  requestId: 0
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
  subcategory: document.getElementById('filter-subcategory'),
  location: document.getElementById('filter-location'),
  from: document.getElementById('filter-from'),
  to: document.getElementById('filter-to'),
  sort: document.getElementById('filter-sort'),
  status: document.getElementById('filter-status'),
  reset: document.getElementById('reset-filters'),
  loadMore: document.getElementById('load-more'),
  pageStatus: document.getElementById('page-status'),
  clearFromEmpty: document.getElementById('clear-from-empty'),
  statLost: document.getElementById('stat-lost'),
  statFound: document.getElementById('stat-found'),
  statReturned: document.getElementById('stat-returned'),
  statActive: document.getElementById('stat-active')
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
let lastFocused = null;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const PAGE_SIZE = 12;
state.page = 1;
state.pages = 1;

function paintAuthState() {
  const loggedIn = Auth.isLoggedIn;
  document.querySelectorAll('[data-auth-only]').forEach((n) => { n.hidden = !loggedIn; });
  document.querySelectorAll('[data-guest-only]').forEach((n) => { n.hidden = loggedIn; });
  document.querySelectorAll('[data-admin-only]').forEach((n) => { n.hidden = !Auth.isAdmin; });
}

async function loadMeta() {
  try {
    let meta;
    try {
      meta = await api('/items/meta');
    } catch (err) {

      var btn = document.getElementById('rf-submit');
      if (btn) btn.disabled = true;
      var cat = document.getElementById('rf-category');
      if (cat) cat.innerHTML = '<option value="">Could not load categories</option>';
      var loc = document.getElementById('rf-location');
      if (loc) loc.innerHTML = '<option value="">Could not load locations</option>';
      if (typeof showFormMessage === 'function') {
        showFormMessage('report-error', 'Could not load the category and location lists. Reload the page and try again.');
      }
      return { categories: [], subcategories: {}, locations: [] };
    }
    state.meta = {
      categories: meta.categories || [],
      subcategories: meta.subcategories || {},
      locations: meta.locations || []
    };
    state.meta.categories.forEach((c) => {
      el.category.insertAdjacentHTML('beforeend', `<option value="${ui.esc(c)}">${ui.esc(c)}</option>`);
    });
    state.meta.locations.forEach((l) => {
      el.location.insertAdjacentHTML('beforeend', `<option value="${ui.esc(l)}">${ui.esc(l)}</option>`);
    });
    return meta;
  } catch (err) {
    ui.toast(err.message);
    return { categories: [], locations: [] };
  }
}

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
        const scale = Math.min(1, 4096 / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        var _ctx = canvas.getContext('2d');
    _ctx.fillStyle = '#ffffff';
    _ctx.fillRect(0, 0, canvas.width, canvas.height);
    _ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        for (const quality of [0.95, 0.9, 0.85, 0.78, 0.7]) {
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

function cardMarkup(item) {
  const place = item.location === 'Other' && item.customLocation ? item.customLocation : item.location;
  const category = item.category === 'Other' && item.customCategory ? item.customCategory : item.category;
  const subcategory = item.subcategory || '';

  const photo = item.imageUrl
    ? `<div class="card__media"><img src="${ui.esc(item.imageUrl)}" alt="" loading="lazy" /></div>`
    : `<div class="card__media card__media--empty" aria-hidden="true">
         <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.5">
           <rect x="3" y="4" width="18" height="16" rx="2" />
           <circle cx="8.5" cy="9.5" r="1.5" />
           <path d="M21 16l-5-5-4 4-2-2-5 5" />
         </svg>
         <span>No photo</span>
       </div>`;
  return `
    <div class="card" data-item-id="${item.id}" role="button" tabindex="0" aria-label="View ${ui.esc(item.title)}">
      ${photo}
      <div class="card__top">
        <span class="tag tag--${item.type}">${item.type === 'lost' ? 'Lost' : 'Found'}</span>
        <span class="tag">${ui.esc(category)}</span>
      </div>
      <h3 class="card__title">${ui.esc(item.title)}</h3>
      ${subcategory ? `<p class="card__sub">${ui.esc(category)} · ${ui.esc(subcategory)}</p>` : ''}

      <p class="card__desc">${ui.esc(item.description)}</p>

      <div class="card__meta">
        <span>${ui.esc(place)}</span>

        <span>${ui.date(item.date)}</span>

      </div>

    </div>`;

}

const FILTER_LABELS = {
  type: { lost: 'Lost', found: 'Found' },
  status: { open: 'Open', claimed: 'Claimed', returned: 'Returned', hidden: 'Hidden' }
};

function renderActiveFilters() {
  const bar = document.getElementById('active-filters');
  if (!bar) return;
  const chips = [];
  const add = (key, label, clear) => chips.push({ key, label, clear });

  if (state.q) add('q', `“${state.q}”`, () => { state.q = ''; el.search.value = ''; });
  if (state.type !== 'all') add('type', FILTER_LABELS.type[state.type] || state.type, () => { state.type = 'all'; el.type.value = 'all'; });
  if (state.status !== 'all') add('status', FILTER_LABELS.status[state.status] || state.status, () => { state.status = 'all'; el.status.value = 'all'; });
  if (state.category !== 'all') add('category', state.category, () => { state.category = 'all'; el.category.value = 'all'; });
  if (state.subcategory !== 'all') add('subcategory', state.subcategory, () => { state.subcategory = 'all'; el.subcategory.value = 'all'; });
  if (state.location !== 'all') add('location', state.location, () => { state.location = 'all'; el.location.value = 'all'; });
  if (state.from) add('from', `From ${state.from}`, () => { state.from = ''; el.from.value = ''; });
  if (state.to) add('to', `To ${state.to}`, () => { state.to = ''; el.to.value = ''; });
  if (state.sort && state.sort !== 'newest') add('sort', `Sort: ${state.sort}`, () => { state.sort = 'newest'; el.sort.value = 'newest'; });

  if (!chips.length) { bar.hidden = true; bar.innerHTML = ''; return; }
  bar.hidden = false;
  bar.innerHTML = chips.map((c, i) =>
    `<button class="chip" type="button" data-chip="${i}" aria-label="Remove filter: ${ui.esc(c.label)}">` +
    `${ui.esc(c.label)}<span class="chip__x" aria-hidden="true">&times;</span></button>`
  ).join('');

  bar.querySelectorAll('[data-chip]').forEach((btn) => {
    btn.addEventListener('click', () => {
      chips[Number(btn.dataset.chip)].clear();
      renderActiveFilters();
      loadItems({ page: 1 });
    });
  });
}

function hasActiveFilters() {
  return Boolean(state.q) || state.type !== 'all' || state.status !== 'all'
    || state.category !== 'all' || state.subcategory !== 'all'
    || state.location !== 'all' || Boolean(state.from) || Boolean(state.to);
}

async function loadItems({ page = 1, append = false } = {}) {
  const requestId = ++state.requestId;

  renderActiveFilters();
  el.count.textContent = 'Loading listings…';
  const params = new URLSearchParams();
  if (state.q) params.set('q', state.q);
  if (state.type !== 'all') params.set('type', state.type);
  if (state.status !== 'all') params.set('status', state.status);
  if (state.category !== 'all') params.set('category', state.category);
  if (state.subcategory !== 'all') params.set('subcategory', state.subcategory);
  if (state.location !== 'all') params.set('location', state.location);
  if (state.from) params.set('from', state.from);
  if (state.to) params.set('to', state.to);
  params.set('sort', state.sort);
  params.set('limit', String(PAGE_SIZE));
  params.set('page', String(page));

  try {
    const data = await api(`/items?${params.toString()}`, { auth: Auth.isLoggedIn });

    if (requestId !== state.requestId) return;
    state.items = append ? state.items.concat(data.items) : data.items;
    state.page = data.page;
    state.pages = data.pages;
    renderGrid(data, { append });
  } catch (err) {
    if (requestId !== state.requestId) return;
    el.count.textContent = 'Could not load listings';
    el.grid.innerHTML = '';

    if (el.loadMore) el.loadMore.hidden = true;
    if (el.pageStatus) el.pageStatus.textContent = '';
    showEmpty('The server is not responding', err.message, { firstRun: false });
  }
}

function showEmpty(title, message, { firstRun }) {
  el.empty.hidden = false;
  el.emptyTitle.textContent = title;
  el.emptyText.textContent = message;

  el.clearFromEmpty.hidden = firstRun;
}

function renderGrid(data, { append = false } = {}) {
  const total = data.total;
  const filtered = hasActiveFilters();

  el.count.textContent = total === 0
    ? 'No listings match'
    : `${total} listing${total === 1 ? '' : 's'}${filtered ? ' match your filters' : ' on the board'}`;

  if (!data.items.length) {
    el.grid.innerHTML = '';
    paintPagination(data);
    if (filtered) {
      showEmpty('Nothing matches that yet',
        'Try a different keyword, or widen the filters. You can also report the item yourself.',
        { firstRun: false });
    } else {
      showEmpty('No items reported yet.',
        'Be the first to report a lost or found item on campus.',
        { firstRun: true });
    }
    return;
  }

  el.empty.hidden = true;
  const markup = data.items.map(cardMarkup).join('');
  if (append) {
    el.grid.insertAdjacentHTML('beforeend', markup);
  } else {
    el.grid.innerHTML = markup;
  }
  paintPagination(data);
}

function paintPagination(data) {
  if (!el.loadMore) return;
  el.loadMore.hidden = !(data.page < data.pages);
  if (el.pageStatus) {
    el.pageStatus.textContent = data.items.length
      ? `Showing ${state.items.length} listing${state.items.length === 1 ? '' : 's'} — page ${data.page} of ${data.pages}`
      : '';
  }
}

function applyFilters() {
  loadItems();
}

function fillSubcategories(select, category, selected = '') {
  if (!select) return;
  const list = (state.meta.subcategories && state.meta.subcategories[category]) || [];
  const first = select.id === 'filter-subcategory'
    ? '<option value="all">All subcategories</option>'
    : '<option value="">Choose a subcategory</option>';
  select.innerHTML = first + list.map((v) => `<option value="${ui.esc(v)}">${ui.esc(v)}</option>`).join('');
  const wanted = selected || (select.id === 'filter-subcategory' ? 'all' : '');
  if (wanted && [...select.options].some((o) => o.value === wanted)) select.value = wanted;
}

function resetFilters() {
  state.q = '';
  state.type = 'all';
  state.status = 'all';
  state.category = 'all';
  state.subcategory = 'all';
  state.location = 'all';
  state.from = '';
  state.to = '';
  state.sort = 'newest';
  el.search.value = '';
  el.type.value = 'all';
  if (el.status) el.status.value = 'all';
  el.category.value = 'all';
  fillSubcategories(el.subcategory, 'all');
  el.location.value = 'all';
  el.from.value = '';
  el.to.value = '';
  el.sort.value = 'newest';
  loadItems();
}

async function loadStats() {
  try {

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

function trapFocus(modal) {

  const visible = () =>
    [...modal.querySelectorAll(FOCUSABLE)].filter((n) => n.offsetParent !== null);

  const handler = (event) => {
    if (event.key !== 'Tab') return;
    const nodes = visible();
    if (!nodes.length) return;

    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;

    if (!modal.contains(active)) { event.preventDefault(); first.focus(); return; }
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
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
  const focusable = [...modal.querySelectorAll(FOCUSABLE)]
    .find((n) => n.offsetParent !== null);
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

  if (lastFocused && lastFocused.isConnected) lastFocused.focus({ preventScroll: true });
}

function closeAllModals() {
  document.querySelectorAll('.modal[data-open="true"]').forEach(closeModal);
}

const threadState = { itemId: null, recipientId: null, timer: null };

function renderThread(list, messages, meId) {
  if (!messages.length) {
    list.innerHTML = '<p class="thread__empty">No messages yet. Say hello.</p>';
    return;
  }
  list.innerHTML = messages.map((m) => {
    const mine = m.sender_id === meId;
    return `<div class="bubble ${mine ? 'bubble--mine' : ''}">
      <p class="bubble__body">${ui.esc(m.body)}</p>
      <p class="bubble__meta">${ui.esc(m.sender_name)} · ${ui.date(m.created_at)}</p>
    </div>`;
  }).join('');
  list.scrollTop = list.scrollHeight;
}

async function loadThread() {
  if (!threadState.itemId) return;
  const list = document.getElementById('thread-list');
  try {
    const data = await api(`/items/${threadState.itemId}/messages`, { auth: true });
    const meId = Auth.user && Auth.user.id;
    renderThread(list, data.messages || [], meId);
    const others = data.canMessage || [];
    threadState.recipientId = others.length === 1 ? others[0] : (others[0] || null);
    const send = document.getElementById('thread-send');
    if (send) send.disabled = !threadState.recipientId;
  } catch (err) {
    list.innerHTML = `<p class="thread__empty">${ui.esc(err.message || 'Could not load this conversation')}</p>`;
  }
}

async function openThread(itemId) {
  if (!Auth.isLoggedIn) {
    ui.toast('Please log in to message about an item');
    Auth.requireLogin('index.html');
    return;
  }
  threadState.itemId = itemId;
  document.getElementById('thread-title').textContent = 'Messages';
  document.getElementById('thread-list').innerHTML = '<p class="thread__empty">Loading…</p>';
  showFormMessage('thread-error', '');
  openModal('modal-thread');
  await loadThread();

  clearInterval(threadState.timer);
  threadState.timer = setInterval(loadThread, 5000);
}

function stopThreadPolling() {
  clearInterval(threadState.timer);
  threadState.timer = null;
}

async function sendThreadMessage(event) {
  event.preventDefault();
  const box = document.getElementById('thread-body');
  const btn = document.getElementById('thread-send');
  const body = (box.value || '').trim();
  if (!body || !threadState.recipientId) return;

  btn.disabled = true;
  try {
    await api(`/items/${threadState.itemId}/messages`, {
      method: 'POST',
      auth: true,
      body: { recipientId: threadState.recipientId, body }
    });
    box.value = '';
    showFormMessage('thread-error', '');
    await loadThread();
  } catch (err) {
    showFormMessage('thread-error', err.message || 'That message did not send');
  } finally {
    btn.disabled = false;
  }
}

async function openItem(id) {

  try {
    const { item } = await api(`/items/${id}`);
    state.activeItemId = item.id;

    const place = item.location === 'Other' && item.customLocation ? item.customLocation : item.location;
    const category = item.category === 'Other' && item.customCategory ? item.customCategory : item.category;
    const categoryLine = item.subcategory ? `${category} · ${item.subcategory}` : category;

    document.getElementById('modal-item-tag').textContent =
      `${item.type === 'lost' ? 'Lost' : 'Found'} · ${item.status}`;
    document.getElementById('modal-item-title').textContent = item.title;

    const photo = item.imageUrl
      ? `<div class="detail-media"><img src="${ui.esc(item.imageUrl)}" alt="Photo of ${ui.esc(item.title)}" /></div>`
      : '';

    const statusTone = { open: 'open', claimed: 'claimed', returned: 'returned', hidden: 'hidden' }[item.status] || 'open';
    document.getElementById('modal-item-body').innerHTML = `
      ${photo}
      <div class="detail-status">
        <span class="status-pill status-pill--${statusTone}">${ui.esc(item.status)}</span>
        <span class="detail-status__place">${ui.esc(place)} · ${ui.date(item.date)}</span>
      </div>
      <div><dt>Description</dt><dd>${ui.esc(item.description)}</dd></div>
      <div><dt>Category</dt><dd>${ui.esc(categoryLine)}</dd></div>
      <div><dt>Location</dt><dd>${ui.esc(place)}</dd></div>
      <div><dt>Date reported</dt><dd>${ui.date(item.date)}</dd></div>
      <div><dt>Posted by</dt><dd>${ui.esc(item.reporterName || 'A student')}</dd></div>`;

    const shareLink = document.getElementById('btn-share-wa');
    if (shareLink) {
      const base = window.location.origin + window.location.pathname;
      const pageUrl = base + '?item=' + encodeURIComponent(item.id);
      const heading = item.type === 'lost'
        ? 'Lost on campus: ' + item.title
        : 'Found on campus: ' + item.title;
      const lines = [
        heading,
        place + ' \u00b7 ' + ui.date(item.date),
        item.description ? item.description : '',
        'Seen on Foundry \u2014 ' + pageUrl
      ].filter(Boolean);
      shareLink.href = 'https://wa.me/?text=' + encodeURIComponent(lines.join('\n'));
      shareLink.setAttribute('aria-label',
        'Share "' + item.title + '" on WhatsApp');
    }

    const claimBtn = document.getElementById('btn-claim');
    const mine = Auth.user && Auth.user && item.reportedBy === Auth.user.id;
    if (mine) {
      claimBtn.disabled = true;
      claimBtn.textContent = 'This is your listing';
    } else if (item.type !== 'found') {

      claimBtn.disabled = true;
      claimBtn.textContent = 'Only found items can be claimed';
    } else if (item.status !== 'open') {
      claimBtn.disabled = true;
      claimBtn.textContent = `Already ${item.status}`;
    } else {
      claimBtn.disabled = false;
      claimBtn.textContent = 'Claim this item';
    }

    const reportFormEl = document.getElementById('report-item-form');
    reportFormEl.hidden = true;
    document.getElementById('btn-report-item').setAttribute('aria-expanded', 'false');
    showFormMessage('report-item-error', '');
    showFormMessage('report-item-success', '');

    openModal('modal-item');

    showSimilar(item.id);
  } catch (err) {
    ui.toast(err.message);
  }
}

async function showSimilar(id) {
  state.similarSeq = (state.similarSeq || 0) + 1;
  var _seq = state.similarSeq;
  var _reqId = state.activeItemId;
  const body = document.getElementById('modal-item-body');
  try {
    const data = await api(`/items/${id}/similar`);

    if (state.similarSeq !== _seq || state.activeItemId !== _reqId) return;
    if (!data.count) return;
    const names = data.items.map((i) => `<li>${ui.esc(i.title)} — ${ui.esc(i.location)}</li>`).join('');
    body.insertAdjacentHTML('beforeend', `
      <div><dt>Possible match</dt><dd>
        <p style="margin-bottom:.4rem;color:var(--accent);">${data.count} possible match${data.count === 1 ? '' : 'es'} shown</p>
        <ul style="display:grid;gap:.3rem;font-size:.85rem;color:var(--muted);">${names}</ul>
      </dd></div>`);
  } catch {

  }
}

function prepareReportForm(meta) {
  const category = document.getElementById('rf-category');
  const location = document.getElementById('rf-location');

  if (!Array.isArray(meta.categories) || !meta.categories.length ||
      !Array.isArray(meta.locations) || !meta.locations.length) {
    state.metaFailed = true;
    return;
  }
  state.metaFailed = false;

  category.innerHTML = meta.categories.map((c) => `<option value="${ui.esc(c)}">${ui.esc(c)}</option>`).join('');
  location.innerHTML = meta.locations.map((l) => `<option value="${ui.esc(l)}">${ui.esc(l)}</option>`).join('');

  const customCategoryField = document.getElementById('rf-custom-category-field');
  const customLocationField = document.getElementById('rf-custom-location-field');
  const subcategoryField = document.getElementById('rf-subcategory');

  const syncSubcategories = () => fillSubcategories(subcategoryField, category.value);
  syncSubcategories();

  category.addEventListener('change', () => {
    const isOther = category.value === 'Other';
    customCategoryField.hidden = !isOther;
    if (!isOther) document.getElementById('rf-custom-category').value = '';

    /* With Category set to Other the subcategory list is empty, so it could
       never be satisfied - it stayed on "Choose a subcategory" with a red
       border and blocked the form. The free-text box replaces it. */
    const subField = subcategoryField.closest('.field');
    if (subField) subField.hidden = isOther;
    if (isOther) {
      subcategoryField.value = '';
      subcategoryField.required = false;
    }

    syncSubcategories();
  });
  location.addEventListener('change', () => {
    const isOther = location.value === 'Other';
    customLocationField.hidden = !isOther;
    if (!isOther) document.getElementById('rf-custom-location').value = '';
  });

  document.getElementById('rf-date').value = (() => { const d = new Date(); return [d.getFullYear(),
      String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); })();

  const fileInput = document.getElementById('rf-image');
  const preview = document.getElementById('rf-image-preview');

  const fileNameEl = document.getElementById('rf-image-name');
  const removeBtn = document.getElementById('rf-image-remove');

  const clearImage = () => {
    state.pendingImage = '';
    fileInput.value = '';
    preview.hidden = true;
    preview.innerHTML = '';
    if (fileNameEl) { fileNameEl.textContent = ''; fileNameEl.hidden = true; }
    if (removeBtn) removeBtn.hidden = true;
  };

  if (removeBtn) {
    removeBtn.addEventListener('click', () => {
      clearImage();
      fileInput.focus();
    });
  }

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    state.pendingImage = '';
    preview.hidden = true;
    preview.innerHTML = '';
    if (fileNameEl) { fileNameEl.textContent = ''; fileNameEl.hidden = true; }
    if (removeBtn) removeBtn.hidden = true;
    if (!file) return;

    try {
      state.pendingImage = await shrinkImage(file);
      preview.innerHTML = `<img src="${ui.esc(state.pendingImage)}" alt="Photo preview" />`;
      preview.hidden = false;
      if (fileNameEl) {

        const kb = Math.max(1, Math.round(state.pendingImage.length * 0.75 / 1024));
        fileNameEl.textContent = `${file.name} — ${kb} KB after shrinking`;
        fileNameEl.hidden = false;
      }
      if (removeBtn) removeBtn.hidden = false;
    } catch (err) {
      clearImage();
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
    subcategory: document.getElementById('rf-subcategory').value || undefined,
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
    document.getElementById('rf-date').value = (() => { const d = new Date(); return [d.getFullYear(),
      String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-'); })();
    document.getElementById('rf-custom-category-field').hidden = true;
    document.getElementById('rf-custom-location-field').hidden = true;
    fillSubcategories(document.getElementById('rf-subcategory'), document.getElementById('rf-category').value);
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
      body: { item: state.activeItemId, message },
      auth: true
    });
    closeAllModals();
    ui.toast('Claim submitted successfully. The listing owner has been notified. You can track your claim from your dashboard.');
  } catch (err) {
    box.textContent = err.message;
    box.dataset.show = 'true';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Send claim';
  }
}

document.addEventListener('DOMContentLoaded', async () => {

  if (window.location.search.includes('loggedout=1')) {
    Auth.clear();
    window.history.replaceState({}, '', window.location.pathname);
  }

  paintAuthState();
  initScrollReveal();
  initNotifications();
  initTheme();

  const headerLogout = document.getElementById('header-logout');
  if (headerLogout) {
    headerLogout.addEventListener('click', () => logoutAndGo('index.html'));
  }

  const meta = await loadMeta();
  prepareReportForm(meta);

  try {
    const qs = new URLSearchParams(window.location.search);

    const pick = (selectEl, wanted) => {
      if (!selectEl || !wanted) return false;
      const option = [].slice.call(selectEl.options)
        .find((o) => o.value.toLowerCase() === String(wanted).toLowerCase());
      if (!option) return false;
      selectEl.value = option.value;
      return option.value;
    };

    const appliedLocation = pick(el.location, qs.get('location'));
    if (appliedLocation) state.location = appliedLocation;

    const appliedStatus = pick(el.status, qs.get('status'));
    if (appliedStatus) state.status = appliedStatus;

    const appliedType = pick(el.type, qs.get('type'));
    if (appliedType) state.type = appliedType;

    const appliedCategory = pick(el.category, qs.get('category'));
    if (appliedCategory) state.category = appliedCategory;

    const q = (qs.get('q') || '').trim();
    if (q) {
      el.search.value = q;
      state.q = q;
    }

    if (qs.get('report') === '1' || window.location.hash === '#report') {
      if (typeof openModal === 'function') openModal('modal-report');
    }

    const deepItem = (qs.get('item') || '').trim();
    if (deepItem) {
      openItem(deepItem).catch(() => {  });
    }
  } catch (e) {  }

  await Promise.all([loadItems(), loadStats()]);

  let searchTimer;
  el.search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.q = el.search.value.trim();
      applyFilters();
    }, 300);
  });
  el.type.addEventListener('change', () => { state.type = el.type.value; applyFilters(); });
  if (el.status) {
    el.status.addEventListener('change', () => { state.status = el.status.value; applyFilters(); });
  }
  el.category.addEventListener('change', () => {
    state.category = el.category.value;

    state.subcategory = 'all';
    fillSubcategories(el.subcategory, state.category);
    applyFilters();
  });
  if (el.subcategory) {
    el.subcategory.addEventListener('change', () => {
      state.subcategory = el.subcategory.value;
      applyFilters();
    });
  }
  el.location.addEventListener('change', () => { state.location = el.location.value; applyFilters(); });
  el.from.addEventListener('change', () => { state.from = el.from.value; applyFilters(); });
  el.to.addEventListener('change', () => { state.to = el.to.value; applyFilters(); });
  el.sort.addEventListener('change', () => { state.sort = el.sort.value; applyFilters(); });
  el.reset.addEventListener('click', resetFilters);
  if (el.loadMore) {
    el.loadMore.addEventListener('click', () => loadItems({ page: state.page + 1, append: true }));
  }
  el.clearFromEmpty.addEventListener('click', resetFilters);

  const threadForm = document.getElementById('thread-form');
  if (threadForm) threadForm.addEventListener('submit', sendThreadMessage);
  document.querySelectorAll('[data-close-modal]').forEach((b) => {
    b.addEventListener('click', stopThreadPolling);
  });

  el.grid.addEventListener('click', (event) => {

    const msg = event.target.closest('[data-message-item]');
    if (msg) {
      event.stopPropagation();
      openThread(msg.dataset.messageItem);
      return;
    }
    const card = event.target.closest('[data-item-id]');
    if (card) openItem(card.dataset.itemId);
  });

  el.grid.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const card = event.target.closest('[data-item-id]');
    if (!card || event.target.closest('[data-message-item]')) return;
    event.preventDefault();
    openItem(card.dataset.itemId);
  });

  document.querySelectorAll('[data-open-report]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!Auth.isLoggedIn) {
        ui.toast('Please log in to report an item');
        Auth.requireLogin('index.html');
        return;
      }
      showFormMessage('report-success', '');

      if (!state.metaFailed) showFormMessage('report-error', '');
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

  const reportToggle = document.getElementById('btn-report-item');
  const reportForm = document.getElementById('report-item-form');

  reportToggle.addEventListener('click', () => {
    if (!Auth.isLoggedIn) {
      ui.toast('Please log in to report a listing');
      Auth.requireLogin('index.html');
      return;
    }
    const willOpen = reportForm.hidden;
    reportForm.hidden = !willOpen;
    reportToggle.setAttribute('aria-expanded', String(willOpen));
  });

  reportForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    showFormMessage('report-item-error', '');
    showFormMessage('report-item-success', '');

    const btn = document.getElementById('ri-submit');
    btn.disabled = true;
    btn.textContent = 'Sending…';
    try {
      await api('/reports', {
        method: 'POST',
        auth: true,
        body: {
          item: state.activeItemId,
          reason: document.getElementById('ri-reason').value,
          details: document.getElementById('ri-details').value.trim()
        }
      });
      reportForm.reset();
      showFormMessage('report-item-success', 'Thank you. An administrator will review this listing.');
    } catch (err) {
      showFormMessage('report-item-error', err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Send report';
    }
  });

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

window.FoundryOpenItem = openItem;
