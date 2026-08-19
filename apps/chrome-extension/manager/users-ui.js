/**
 * Users section of InboxPulse.
 *
 * Mirrors the main app's Users page — sortable table with name+email, role,
 * reports-to count, customers count, last login, and status; active/inactive
 * filter; search by name/email/role.
 *
 * Clicking a row opens an overlay drawer (right side, like the main app)
 * with an editable form. Save sends a PATCH to /api/users/:id.
 */

const PAGE_SIZE = 50;

const STATUS_OPTIONS = [
  { value: 0, label: 'Active' },
  { value: 1, label: 'Inactive' },
  { value: 2, label: 'Archived' },
];

// Matches the main app's SUPPORTED_TIMEZONES so the dropdown reads the same.
const TIMEZONES = [
  { value: 'Asia/Kolkata',         label: 'India (IST)' },
  { value: 'America/New_York',     label: 'US Eastern (EST)' },
  { value: 'America/Chicago',      label: 'US Central (CST)' },
  { value: 'America/Denver',       label: 'US Mountain (MST)' },
  { value: 'America/Los_Angeles',  label: 'US Pacific (PST)' },
];

const TEMPLATE = `
  <div class="ip-users">
    <header class="ip-users__header">
      <div class="ip-users__title">
        <h2>Users</h2>
        <span data-el="user-count" class="ip-users__count">&mdash;</span>
      </div>
      <div class="ip-users__tools">
        <div class="ip-users__status">
          <button type="button" data-status="active"   class="active">Active</button>
          <button type="button" data-status="inactive">Inactive</button>
        </div>
        <input data-el="user-search" type="search" placeholder="Search by name, email, or role..." />
      </div>
    </header>

    <div class="ip-customers__table-wrap">
      <table class="ip-table ip-users__table">
        <thead>
          <tr>
            <th data-sort="name"        class="sortable">Name</th>
            <th data-sort="role"        class="sortable">Role</th>
            <th                                          class="num">Reports To</th>
            <th                                          class="num">Customers</th>
            <th data-sort="lastLoginAt" class="sortable">Last Login</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody data-el="user-body"></tbody>
      </table>
      <div data-el="user-empty" class="ip-empty" hidden>No users match.</div>
      <div data-el="user-error" class="list-error" hidden></div>
    </div>

    <footer class="ip-customers__pager">
      <span data-el="user-page-info"></span>
      <div>
        <button data-el="user-prev" type="button">&lsaquo;</button>
        <button data-el="user-next" type="button">&rsaquo;</button>
      </div>
    </footer>

    <!-- Edit drawer -->
    <div class="ip-drawer" data-el="drawer" hidden>
      <div class="ip-drawer__scrim" data-el="drawer-scrim"></div>
      <aside class="ip-drawer__panel" role="dialog" aria-modal="true" aria-labelledby="ip-drawer-title">
        <header class="ip-drawer__header ip-drawer__header--user">
          <div class="ip-drawer__title-row">
            <div class="ip-avatar ip-avatar--xl ip-drawer__avatar" data-el="drawer-avatar">?</div>
            <h3 id="ip-drawer-title">Edit User</h3>
          </div>
          <button class="ip-drawer__close" type="button" data-el="drawer-close" aria-label="Close">&times;</button>
        </header>

        <div class="ip-drawer__body">
          <div class="ip-form__grid">
            <div class="ip-form__field">
              <label for="f-first">First Name</label>
              <input data-el="f-first" id="f-first" type="text" />
            </div>
            <div class="ip-form__field">
              <label for="f-last">Last Name</label>
              <input data-el="f-last" id="f-last" type="text" />
            </div>
          </div>

          <div class="ip-form__field">
            <label for="f-email">Email</label>
            <input data-el="f-email" id="f-email" type="email" disabled />
          </div>

          <div class="ip-form__grid">
            <div class="ip-form__field">
              <label for="f-role">Role</label>
              <select data-el="f-role" id="f-role"></select>
            </div>
            <div class="ip-form__field">
              <label for="f-timezone">Timezone</label>
              <select data-el="f-timezone" id="f-timezone">
                ${TIMEZONES.map((tz) => `<option value="${tz.value}">${tz.label}</option>`).join('')}
              </select>
            </div>
          </div>

          <div class="ip-form__row-toggle">
            <div>
              <div class="ip-form__row-toggle-label">Can Login</div>
              <div class="ip-form__row-toggle-sub">Allow this user to login to the application</div>
            </div>
            <label class="ip-toggle">
              <input data-el="f-canlogin" type="checkbox" />
              <span class="ip-toggle__track"><span class="ip-toggle__thumb"></span></span>
            </label>
          </div>

          <div class="ip-form__field">
            <label>Reports To</label>
            <button type="button" class="ip-form__combobox" data-el="f-managers-toggle">
              <span data-el="f-managers-label">Select managers...</span>
              <span class="ip-form__combobox-caret" aria-hidden="true">⌄</span>
            </button>
            <div class="ip-form__popover" data-el="f-managers-popover" hidden>
              <input class="ip-form__popover-search" data-el="f-managers-search" type="search" placeholder="Search managers..." />
              <div class="ip-form__popover-list" data-el="f-managers-list"></div>
            </div>
            <div class="ip-form__chips" data-el="f-managers-chips"></div>
          </div>

          <div class="ip-form__field">
            <label>Assigned Customers</label>
            <div class="ip-form__assignments" data-el="f-customers-list"></div>
            <button type="button" class="ip-form__add-btn" data-el="f-customer-add">+ Add Customer</button>
          </div>

          <div class="ip-form__field ip-form__field--inline">
            <label for="f-status">Status</label>
            <select data-el="f-status" id="f-status">
              ${STATUS_OPTIONS.map((s) => `<option value="${s.value}">${s.label}</option>`).join('')}
            </select>
          </div>

          <div data-el="drawer-error" class="list-error" hidden></div>
          <div class="ip-drawer__meta" data-el="drawer-meta"></div>
        </div>

        <footer class="ip-drawer__footer">
          <button class="ip-drawer__btn-ghost"  data-el="drawer-cancel" type="button">Cancel</button>
          <button class="ip-drawer__btn-primary" data-el="drawer-save" type="button">Save Changes</button>
        </footer>
      </aside>
    </div>
  </div>
`;

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmtRelative(value) {
  if (!value) return 'Never';
  const ms = Date.now() - new Date(value).getTime();
  const day = 86_400_000;
  if (ms < 60_000)        return 'just now';
  if (ms < 3_600_000)     return `${Math.round(ms / 60_000)}m ago`;
  if (ms < day)           return `${Math.round(ms / 3_600_000)}h ago`;
  if (ms < 30 * day)      return `${Math.round(ms / day)}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function debounce(fn, ms) {
  let t;
  return function (...args) {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), ms);
  };
}

/**
 * `res.error` is where the transport puts the sentence that actually explains
 * the failure — "start the gcloud proxy", "the extension was reloaded". Status 0
 * means the request never reached a server at all, so "Request failed: 0" told
 * the reader nothing they could act on. Prefer the transport's own words.
 */
function requestError(res) {
  return new Error(res.error || `Request failed: ${res.status}`);
}

async function postJson(apiFetch, path, body) {
  const res = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw requestError(res);
  return res.json;
}

async function patchJson(apiFetch, path, body) {
  const res = await apiFetch(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  // A rejected edit carries a server-side reason in the body; keep preferring
  // that over the transport's generic text.
  if (!res.ok) throw new Error(res.json?.error || res.error || `HTTP ${res.status}`);
  return res.json;
}

async function getJson(apiFetch, path) {
  const res = await apiFetch(path, { method: 'GET' });
  if (!res.ok) throw requestError(res);
  return res.json;
}

export function mountUsers(root, { apiFetch }) {
  root.classList.add('ip-users-host');
  root.innerHTML = TEMPLATE;

  const $ = (name) => root.querySelector(`[data-el="${name}"]`);
  const els = {
    search:   $('user-search'),
    body:     $('user-body'),
    empty:    $('user-empty'),
    error:    $('user-error'),
    count:    $('user-count'),
    pageInfo: $('user-page-info'),
    prev:     $('user-prev'),
    next:     $('user-next'),

    drawer:        $('drawer'),
    drawerScrim:   $('drawer-scrim'),
    drawerClose:   $('drawer-close'),
    drawerCancel:  $('drawer-cancel'),
    drawerSave:    $('drawer-save'),
    drawerError:   $('drawer-error'),
    drawerMeta:    $('drawer-meta'),
    drawerAvatar:  $('drawer-avatar'),
    fFirst:        $('f-first'),
    fLast:         $('f-last'),
    fEmail:        $('f-email'),
    fRole:         $('f-role'),
    fTimezone:     $('f-timezone'),
    fStatus:       $('f-status'),
    fCanlogin:     $('f-canlogin'),
    fMgrToggle:    $('f-managers-toggle'),
    fMgrLabel:     $('f-managers-label'),
    fMgrPopover:   $('f-managers-popover'),
    fMgrSearch:    $('f-managers-search'),
    fMgrList:      $('f-managers-list'),
    fMgrChips:     $('f-managers-chips'),
    fCustList:     $('f-customers-list'),
    fCustAddBtn:   $('f-customer-add'),
  };

  const state = {
    search: '',
    status: 'active',
    sortBy: 'name',
    sortOrder: 'asc',
    page: 0,
    total: 0,
    items: [],
    inflight: null,
    roles: [],
    editing: null, // current user being edited
    // Form working state — replaced on each openDrawer call.
    form: {
      managerIds: new Set(),
      customerAssignments: [], // [{customerId, customerName, roleId, roleName}]
    },
    // Lookups (lazily populated on first drawer open).
    allUsers: null,
    allCustomers: null,
    managerSearch: '',
    managersOpen: false,
  };

  // ----- list -----

  async function loadList() {
    if (state.inflight) state.inflight.aborted = true;
    const controller = { aborted: false };
    state.inflight = controller;
    els.error.hidden = true;
    try {
      const res = await postJson(apiFetch, '/api/users/search', {
        search: state.search,
        status: state.status,
        sortBy: state.sortBy,
        sortOrder: state.sortOrder,
        limit: PAGE_SIZE,
        offset: state.page * PAGE_SIZE,
      });
      if (controller.aborted) return;
      state.items = res.items;
      state.total = res.total;
      renderList();
    } catch (err) {
      if (controller.aborted) return;
      els.error.hidden = false;
      els.error.textContent = err.message;
      state.items = [];
      state.total = 0;
      renderList();
    }
  }

  function renderList() {
    els.body.replaceChildren();
    els.empty.hidden = state.items.length > 0;
    for (const u of state.items) {
      const fullName = `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim();
      const tr = document.createElement('tr');
      tr.className = 'ip-users__row';
      tr.dataset.id = u.id;
      tr.innerHTML = `
        <td>
          <div class="ip-users__name">${escapeHtml(fullName || '(no name)')}</div>
          <div class="ip-users__email muted">${escapeHtml(u.email || '')}</div>
        </td>
        <td>${escapeHtml(u.role || '—')}</td>
        <td class="num muted">${u.reportsToCount ?? 0}</td>
        <td class="num muted">${u.customerCount ?? 0}</td>
        <td class="muted">${fmtRelative(u.lastLoginAt)}</td>
        <td><span class="ip-users__badge ip-users__badge--s${u.rowStatus}">${escapeHtml(u.statusLabel)}</span></td>
      `;
      tr.addEventListener('click', () => openDrawer(u.id));
      els.body.appendChild(tr);
    }

    els.count.textContent = state.total === 0 ? '(0)' : `(${state.total.toLocaleString()})`;
    const start = state.items.length === 0 ? 0 : state.page * PAGE_SIZE + 1;
    const end   = state.page * PAGE_SIZE + state.items.length;
    els.pageInfo.textContent = state.total === 0 ? '' : `${start}–${end} of ${state.total.toLocaleString()}`;
    els.prev.disabled = state.page === 0;
    els.next.disabled = end >= state.total;

    for (const th of root.querySelectorAll('th[data-sort]')) {
      th.classList.remove('asc', 'desc');
      if (th.dataset.sort === state.sortBy) th.classList.add(state.sortOrder);
    }
  }

  async function loadRoles() {
    if (state.roles.length) return;
    try {
      state.roles = await getJson(apiFetch, '/api/roles');
    } catch (err) {
      state.roles = [];
    }
    els.fRole.replaceChildren();
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— No role —';
    els.fRole.appendChild(blank);
    for (const r of state.roles) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      els.fRole.appendChild(opt);
    }
  }

  async function loadAllUsers() {
    if (state.allUsers !== null) return;
    try {
      const res = await postJson(apiFetch, '/api/users/search', {
        status: 'active',
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 500,
        offset: 0,
      });
      state.allUsers = res.items || [];
    } catch {
      state.allUsers = [];
    }
  }

  async function loadAllCustomers() {
    if (state.allCustomers !== null) return;
    try {
      const res = await postJson(apiFetch, '/api/customers/search', {
        sortBy: 'name',
        sortOrder: 'asc',
        limit: 500,
        offset: 0,
      });
      state.allCustomers = res.items || [];
    } catch {
      state.allCustomers = [];
    }
  }

  // ----- drawer -----

  async function openDrawer(userId) {
    els.drawerError.hidden = true;
    els.drawer.hidden = false;
    document.body && (document.body.style.overflow = 'hidden');

    // Kick off the picker lookups in parallel with the user fetch so the
    // managers / customers controls aren't empty when the drawer renders.
    const [u] = await Promise.all([
      getJson(apiFetch, `/api/users/${userId}`).catch((err) => {
        els.drawerError.hidden = false;
        els.drawerError.textContent = err.message;
        return null;
      }),
      loadRoles(),
      loadAllUsers(),
      loadAllCustomers(),
    ]);
    if (!u) return;
    state.editing = u;
    fillForm(u);
  }

  function closeDrawer() {
    els.drawer.hidden = true;
    state.editing = null;
    state.managersOpen = false;
    els.fMgrPopover.hidden = true;
    document.body && (document.body.style.overflow = '');
  }

  function userInitials(u) {
    const f = (u.firstName || '').trim()[0];
    const l = (u.lastName  || '').trim()[0];
    return ((f || '') + (l || '')).toUpperCase() || (u.email || '?').slice(0, 2).toUpperCase();
  }

  function fillForm(u) {
    els.fFirst.value    = u.firstName || '';
    els.fLast.value     = u.lastName  || '';
    els.fEmail.value    = u.email     || '';
    els.fRole.value     = u.roleId    || '';
    els.fTimezone.value = u.timezone  || 'Asia/Kolkata';
    els.fStatus.value   = String(u.rowStatus ?? 0);
    els.fCanlogin.checked = !!u.canLogin;
    els.drawerAvatar.textContent = userInitials(u);
    els.drawerMeta.textContent = u.lastLoginAt
      ? `Last login ${fmtRelative(u.lastLoginAt)}`
      : 'Never logged in';

    state.form.managerIds = new Set((u.managers || []).map((m) => m.id));
    state.form.customerAssignments = (u.customerAssignments || []).map((a) => ({ ...a }));
    state.managerSearch = '';
    els.fMgrSearch.value = '';
    state.managersOpen = false;
    els.fMgrPopover.hidden = true;
    renderManagerLabel();
    renderManagerChips();
    renderManagerList();
    renderCustomerAssignments();
  }

  // --- Reports To picker ---

  function visibleManagers() {
    const all = state.allUsers || [];
    const q = state.managerSearch.trim().toLowerCase();
    const list = all.filter((u) => u.id !== state.editing?.id);
    if (!q) return list;
    return list.filter((u) =>
      `${u.firstName || ''} ${u.lastName || ''} ${u.email || ''}`.toLowerCase().includes(q)
    );
  }

  function renderManagerLabel() {
    const count = state.form.managerIds.size;
    els.fMgrLabel.textContent = count === 0
      ? 'Select managers...'
      : `${count} manager${count > 1 ? 's' : ''} selected`;
    els.fMgrLabel.classList.toggle('is-placeholder', count === 0);
  }

  function renderManagerList() {
    els.fMgrList.replaceChildren();
    const list = visibleManagers();
    if (list.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ip-form__popover-empty';
      empty.textContent = 'No managers found.';
      els.fMgrList.appendChild(empty);
      return;
    }
    for (const u of list) {
      const selected = state.form.managerIds.has(u.id);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'ip-form__popover-row' + (selected ? ' is-selected' : '');
      row.innerHTML = `
        <span class="ip-form__checkbox${selected ? ' is-checked' : ''}" aria-hidden="true">${selected ? '✓' : ''}</span>
        <span class="ip-form__popover-row-text">
          ${escapeHtml(`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email)}
          <span class="ip-form__popover-row-meta">${escapeHtml(u.email || '')}</span>
        </span>
      `;
      row.addEventListener('click', () => {
        if (state.form.managerIds.has(u.id)) state.form.managerIds.delete(u.id);
        else state.form.managerIds.add(u.id);
        renderManagerList();
        renderManagerChips();
        renderManagerLabel();
      });
      els.fMgrList.appendChild(row);
    }
  }

  function renderManagerChips() {
    els.fMgrChips.replaceChildren();
    const all = state.allUsers || [];
    for (const id of state.form.managerIds) {
      const u = all.find((x) => x.id === id);
      if (!u) continue;
      const chip = document.createElement('span');
      chip.className = 'ip-form__chip';
      const name = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.email;
      chip.innerHTML = `${escapeHtml(name)} <button type="button" aria-label="Remove">×</button>`;
      chip.querySelector('button').addEventListener('click', () => {
        state.form.managerIds.delete(id);
        renderManagerList();
        renderManagerChips();
        renderManagerLabel();
      });
      els.fMgrChips.appendChild(chip);
    }
  }

  // --- Assigned customers ---

  function renderCustomerAssignments() {
    els.fCustList.replaceChildren();
    if (state.form.customerAssignments.length === 0) return;

    const usedIds = new Set(state.form.customerAssignments.map((a) => a.customerId).filter(Boolean));

    state.form.customerAssignments.forEach((a, idx) => {
      const row = document.createElement('div');
      row.className = 'ip-form__assignment-row';

      // Customer select
      const custSel = document.createElement('select');
      custSel.className = 'ip-form__assignment-select';
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = 'Select customer...';
      custSel.appendChild(blank);
      for (const c of (state.allCustomers || [])) {
        if (c.id !== a.customerId && usedIds.has(c.id)) continue;
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.domain ? `${c.name} (${c.domain})` : c.name;
        custSel.appendChild(opt);
      }
      custSel.value = a.customerId || '';
      custSel.addEventListener('change', () => {
        const picked = (state.allCustomers || []).find((c) => c.id === custSel.value);
        a.customerId   = custSel.value || null;
        a.customerName = picked?.name || '';
        renderCustomerAssignments();
      });

      // Role select
      const roleSel = document.createElement('select');
      roleSel.className = 'ip-form__assignment-role';
      const blankR = document.createElement('option');
      blankR.value = '';
      blankR.textContent = '— Role —';
      roleSel.appendChild(blankR);
      for (const r of state.roles) {
        const opt = document.createElement('option');
        opt.value = r.id;
        opt.textContent = r.name;
        roleSel.appendChild(opt);
      }
      roleSel.value = a.roleId || '';
      roleSel.addEventListener('change', () => {
        a.roleId = roleSel.value || null;
      });

      // Remove button
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'ip-form__assignment-remove';
      remove.textContent = '×';
      remove.title = 'Remove';
      remove.addEventListener('click', () => {
        state.form.customerAssignments.splice(idx, 1);
        renderCustomerAssignments();
      });

      row.append(custSel, roleSel, remove);
      els.fCustList.appendChild(row);
    });
  }

  function addCustomerAssignment() {
    state.form.customerAssignments.push({ customerId: null, customerName: '', roleId: null, roleName: null });
    renderCustomerAssignments();
  }

  // --- Save ---

  async function saveDrawer() {
    if (!state.editing) return;
    els.drawerError.hidden = true;
    els.drawerSave.disabled = true;
    els.drawerSave.textContent = 'Saving…';
    try {
      const patch = {
        firstName: els.fFirst.value.trim(),
        lastName:  els.fLast.value.trim(),
        roleId:    els.fRole.value || null,
        timezone:  els.fTimezone.value,
        canLogin:  !!els.fCanlogin.checked,
        rowStatus: parseInt(els.fStatus.value, 10) || 0,
        managerIds: [...state.form.managerIds],
        customerAssignments: state.form.customerAssignments
          .filter((a) => a.customerId)
          .map((a) => ({ customerId: a.customerId, roleId: a.roleId || null })),
      };
      const updated = await patchJson(apiFetch, `/api/users/${state.editing.id}`, patch);
      const idx = state.items.findIndex((it) => it.id === updated.id);
      if (idx >= 0) {
        state.items[idx] = { ...state.items[idx], ...updated };
        renderList();
      } else {
        loadList();
      }
      closeDrawer();
    } catch (err) {
      els.drawerError.hidden = false;
      els.drawerError.textContent = err.message;
    } finally {
      els.drawerSave.disabled = false;
      els.drawerSave.textContent = 'Save Changes';
    }
  }

  // ----- wire up -----

  // Read from the input element, not the event: this handler is debounced, so
  // by the time it runs the native event's `target` has been reset inside the
  // Shadow DOM and `ev.target.value` would be undefined.
  els.search.addEventListener('input', debounce(() => {
    state.search = els.search.value.trim();
    state.page = 0;
    loadList();
  }, 250));

  for (const btn of root.querySelectorAll('.ip-users__status button')) {
    btn.addEventListener('click', () => {
      state.status = btn.dataset.status;
      for (const b of root.querySelectorAll('.ip-users__status button')) {
        b.classList.toggle('active', b === btn);
      }
      state.page = 0;
      loadList();
    });
  }

  for (const th of root.querySelectorAll('th[data-sort]')) {
    const key = th.dataset.sort;
    if (!key) continue;
    th.addEventListener('click', () => {
      if (state.sortBy === key) {
        state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortBy = key;
        state.sortOrder = key === 'lastLoginAt' ? 'desc' : 'asc';
      }
      state.page = 0;
      loadList();
    });
  }

  els.prev.addEventListener('click', () => {
    if (state.page > 0) { state.page -= 1; loadList(); }
  });
  els.next.addEventListener('click', () => {
    if ((state.page + 1) * PAGE_SIZE < state.total) { state.page += 1; loadList(); }
  });

  els.drawerScrim.addEventListener('click', closeDrawer);
  els.drawerClose.addEventListener('click', closeDrawer);
  els.drawerCancel.addEventListener('click', closeDrawer);
  els.drawerSave.addEventListener('click', saveDrawer);

  // Reports-To popover
  els.fMgrToggle.addEventListener('click', () => {
    state.managersOpen = !state.managersOpen;
    els.fMgrPopover.hidden = !state.managersOpen;
    if (state.managersOpen) {
      els.fMgrSearch.value = '';
      state.managerSearch = '';
      renderManagerList();
      setTimeout(() => els.fMgrSearch.focus(), 0);
    }
  });
  els.fMgrSearch.addEventListener('input', debounce(() => {
    state.managerSearch = els.fMgrSearch.value;
    renderManagerList();
  }, 100));

  // Close the manager popover when clicking outside it. Scoped to the
  // drawer so we don't fight other listeners on the page.
  els.drawer.addEventListener('click', (ev) => {
    if (!state.managersOpen) return;
    if (els.fMgrPopover.contains(ev.target) || els.fMgrToggle.contains(ev.target)) return;
    state.managersOpen = false;
    els.fMgrPopover.hidden = true;
  });

  els.fCustAddBtn.addEventListener('click', addCustomerAssignment);

  loadList();

  return {
    setDateRange() { /* users section ignores the global date range */ },
  };
}
