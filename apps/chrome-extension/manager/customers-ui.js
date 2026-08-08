/**
 * Customers section of InboxPulse.
 *
 * Two views inside this section (mutually exclusive, like AI Analysis):
 *   - list view   : sortable table of customers with per-signal aggregates
 *   - detail view : opened by clicking a row; shows the same Emails/Contacts/Team
 *                   layout the main InboxPulse app puts in its customer drawer
 *
 * Emails respect the global date range; Contacts and Team don't (they aren't
 * time-bounded).
 */

const PAGE_SIZE = 50;

const SIGNAL_LABELS = {
  1: 'Positive', 2: 'Negative', 3: 'Neutral',
  20: 'Upsell',
  30: 'Churn (low)', 31: 'Churn (medium)', 32: 'Churn (high)', 33: 'Churn (critical)',
};

function signalKind(code) {
  if (code === 1) return 'positive';
  if (code === 2) return 'negative';
  if (code === 3) return 'neutral';
  if (code === 20) return 'upsell';
  if (code >= 30 && code <= 33) return 'churn';
  return 'other';
}

const TEMPLATE = `
  <div class="ip-customers">
    <!-- LIST VIEW -->
    <section data-el="list-view">
      <header class="ip-customers__header">
        <div class="ip-customers__title">
          <h2>Customers</h2>
          <span data-el="cust-count" class="ip-customers__count">&mdash;</span>
        </div>
        <div class="ip-customers__tools">
          <select data-el="cust-team-member" class="ip-customers__select">
            <option value="">All Team Members</option>
          </select>
          <input data-el="cust-search" type="search" placeholder="Search by company or domain..." />
        </div>
      </header>

      <div class="ip-customers__table-wrap">
        <table class="ip-table ip-customers__table">
          <thead>
            <tr>
              <th data-sort="name"            class="sortable">Customer</th>
              <th data-sort="emailCount"      class="sortable num">Emails</th>
              <th data-sort=""                                   class="num">Avg TAT</th>
              <th data-sort="upsellCount"     class="sortable num">Upsell</th>
              <th data-sort="churnCount"      class="sortable num">Churn</th>
              <th data-sort="negativeCount"   class="sortable num">Negative</th>
              <th data-sort="positiveCount"   class="sortable num">Positive</th>
              <th data-sort="lastContactDate" class="sortable">Last Email</th>
            </tr>
          </thead>
          <tbody data-el="cust-body"></tbody>
        </table>
        <div data-el="cust-empty" class="ip-empty" hidden>No customers match.</div>
        <div data-el="cust-error" class="list-error" hidden></div>
      </div>

      <footer class="ip-customers__pager">
        <span data-el="cust-page-info"></span>
        <div>
          <button data-el="cust-prev" type="button">&lsaquo;</button>
          <button data-el="cust-next" type="button">&rsaquo;</button>
        </div>
      </footer>
    </section>

    <!-- DETAIL VIEW -->
    <section data-el="detail-view" hidden>
      <button data-el="detail-back" class="ip-detail__back" type="button">
        <span aria-hidden="true">&larr;</span> Back to customers
      </button>

      <header class="ip-detail__header">
        <div class="ip-avatar ip-avatar--lg" data-el="detail-avatar">?</div>
        <div class="ip-detail__heading">
          <h2 data-el="detail-name">&mdash;</h2>
          <div class="ip-detail__domains" data-el="detail-domains"></div>
        </div>
      </header>

      <nav class="ip-detail__tabs" data-el="detail-tabs">
        <button data-tab="emails"   class="active" type="button">Emails <span data-el="tab-count-emails"></span></button>
        <button data-tab="contacts" type="button">Contacts <span data-el="tab-count-contacts"></span></button>
        <button data-tab="team"     type="button">Team <span data-el="tab-count-team"></span></button>
      </nav>

      <div class="ip-detail__panel" data-tab-panel="emails">
        <div class="ip-detail__toolbar">
          <input data-el="emails-search" type="search" placeholder="Search subject or sender..." />
          <select data-el="emails-signal">
            <option value="all">All signals</option>
            <option value="positive">Positive</option>
            <option value="negative">Negative</option>
            <option value="neutral">Neutral</option>
            <option value="upsell">Upsell</option>
            <option value="churn">Churn risk</option>
          </select>
        </div>
        <ul class="ip-detail__email-list" data-el="detail-emails"></ul>
        <div data-el="detail-emails-empty" class="ip-empty" hidden>No emails match these filters.</div>
      </div>

      <div class="ip-detail__panel" data-tab-panel="contacts" hidden>
        <div class="ip-detail__toolbar">
          <input data-el="contacts-search" type="search" placeholder="Search contacts..." />
        </div>
        <table class="ip-table ip-detail__table">
          <thead>
            <tr><th>Name</th><th>Title</th><th>Contact</th></tr>
          </thead>
          <tbody data-el="detail-contacts"></tbody>
        </table>
        <div data-el="detail-contacts-empty" class="ip-empty" hidden>No contacts match.</div>
      </div>

      <div class="ip-detail__panel" data-tab-panel="team" hidden>
        <div class="ip-detail__toolbar">
          <span class="ip-detail__toolbar-label">Team members assigned to this customer</span>
          <button data-el="team-add-btn" type="button" class="ip-detail__primary-btn">+ Add Team Member</button>
        </div>
        <table class="ip-table ip-detail__table">
          <thead>
            <tr><th>Name</th><th>Role</th><th>Email</th></tr>
          </thead>
          <tbody data-el="detail-team"></tbody>
        </table>
        <div data-el="detail-team-empty" class="ip-empty" hidden>No team members assigned.</div>
        <div data-el="team-add-error" class="list-error" hidden></div>
      </div>
    </section>
  </div>
`;

function initials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function paletteIndex(key) {
  const s = String(key || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 8;
}

function fmtDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function fmtTat(days) {
  if (days == null || Number.isNaN(days)) return '—';
  if (days < 1) {
    const hours = Math.round(days * 24);
    return `${Math.max(1, hours)}h`;
  }
  return `${days.toFixed(1)}d`;
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
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

async function getJson(apiFetch, path) {
  const res = await apiFetch(path, { method: 'GET' });
  if (!res.ok) throw requestError(res);
  return res.json;
}

export function mountCustomers(root, { apiFetch, initialFilters, onOpenInAiAnalysis }) {
  root.classList.add('ip-customers-host');
  root.innerHTML = TEMPLATE;

  const $ = (name) => root.querySelector(`[data-el="${name}"]`);
  const els = {
    listView:   root.querySelector('[data-el="list-view"]'),
    detailView: root.querySelector('[data-el="detail-view"]'),

    // list
    search:   $('cust-search'),
    teamMember: $('cust-team-member'),
    body:     $('cust-body'),
    empty:    $('cust-empty'),
    error:    $('cust-error'),
    count:    $('cust-count'),
    pageInfo: $('cust-page-info'),
    prev:     $('cust-prev'),
    next:     $('cust-next'),

    // detail
    back:           $('detail-back'),
    avatar:         $('detail-avatar'),
    name:           $('detail-name'),
    domains:        $('detail-domains'),
    tabs:           $('detail-tabs'),
    tabCountEmails: $('tab-count-emails'),
    tabCountContacts: $('tab-count-contacts'),
    tabCountTeam:   $('tab-count-team'),

    // detail / emails
    emailsSearch:   $('emails-search'),
    emailsSignal:   $('emails-signal'),
    emails:         $('detail-emails'),
    emailsEmpty:    $('detail-emails-empty'),

    // detail / contacts
    contactsSearch: $('contacts-search'),
    contacts:       $('detail-contacts'),
    contactsEmpty:  $('detail-contacts-empty'),

    // detail / team
    teamAddBtn:     $('team-add-btn'),
    teamAddError:   $('team-add-error'),
    team:           $('detail-team'),
    teamEmpty:      $('detail-team-empty'),
  };

  const state = {
    // list
    search: '',
    sortBy: 'name',
    sortOrder: 'asc',
    page: 0,
    total: 0,
    items: [],
    inflight: null,
    range: { ...(initialFilters?.dateRange || {}) },
    // Global filters shared with dashboard / AI Analysis. `customerId` is
    // applied as an "only show this customer" filter; `teamMemberId` further
    // narrows to customers a given user is attached to. The local team-member
    // select can override the global value when the user picks one here.
    globalCustomerId: initialFilters?.customerId || '',
    globalTeamMemberId: initialFilters?.teamMemberId || '',
    localTeamMemberId: '',

    // detail
    selectedId: null,
    detail: null,
    emailFilters: { search: '', signal: 'all' },
    emailInflight: null,
    contactSearch: '',
    teamAdding: false,
    teamUsers: null,
    teamRoles: null,
    // Inline-edit state for the Team table: the id of the team member
    // currently being edited (only one at a time), plus the staged role
    // selection so Cancel can revert without re-fetching.
    editingTeamMemberId: null,
  };

  function effectiveTeamMemberId() {
    return state.localTeamMemberId || state.globalTeamMemberId || '';
  }

  // ----- LIST -----

  async function loadList() {
    if (state.inflight) state.inflight.aborted = true;
    const controller = { aborted: false };
    state.inflight = controller;
    els.error.hidden = true;
    try {
      const res = await postJson(apiFetch, '/api/customers/search', {
        search: state.search,
        sortBy: state.sortBy,
        sortOrder: state.sortOrder,
        limit: PAGE_SIZE,
        offset: state.page * PAGE_SIZE,
        dateFrom: state.range.from || undefined,
        dateTo:   state.range.to   || undefined,
        customerId:   state.globalCustomerId || undefined,
        teamMemberId: effectiveTeamMemberId() || undefined,
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

    for (const c of state.items) {
      const tr = document.createElement('tr');
      tr.className = 'ip-customers__row';
      tr.dataset.id = c.id;
      tr.innerHTML = `
        <td class="ip-customers__name">
          <div class="ip-customers__name-line">${escapeHtml(c.name)}</div>
          ${c.domain ? `<div class="ip-customers__domain">@${escapeHtml(c.domain)}</div>` : ''}
        </td>
        <td class="num ip-customers__emails">${c.totalEmails}</td>
        <td class="num muted">${fmtTat(c.avgTatDays)}</td>
        <td class="num ${c.upsellCount   > 0 ? 'ip-signal--upsell'   : ''}">${c.upsellCount   || 0}</td>
        <td class="num ${c.churnCount    > 0 ? 'ip-signal--churn'    : ''}">${c.churnCount    || 0}</td>
        <td class="num ${c.negativeCount > 0 ? 'ip-signal--negative' : ''}">${c.negativeCount || 0}</td>
        <td class="num ${c.positiveCount > 0 ? 'ip-signal--positive' : ''}">${c.positiveCount || 0}</td>
        <td class="muted">${fmtDate(c.lastContact)}</td>
      `;
      tr.addEventListener('click', () => openDetail(c.id));
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

  // ----- DETAIL -----

  async function openDetail(customerId) {
    state.selectedId = customerId;
    els.listView.hidden = true;
    els.detailView.hidden = false;
    // The two views want opposite scroll behaviour from the section around
    // them — see the `--detail` rules in manager.css.
    root.classList.add('ip-customers-host--detail');

    // Reset to emails tab on each open.
    showTab('emails');

    // Reset filters/search every time so a new customer doesn't inherit
    // prior search state.
    state.emailFilters = { search: '', signal: 'all' };
    state.contactSearch = '';
    state.teamAdding = false;
    state.editingTeamMemberId = null;
    els.emailsSearch.value = '';
    els.emailsSignal.value = 'all';
    els.contactsSearch.value = '';
    els.teamAddError.hidden = true;

    els.name.textContent = '—';
    els.domains.replaceChildren();
    els.tabCountEmails.textContent = '';
    els.tabCountContacts.textContent = '';
    els.tabCountTeam.textContent = '';
    els.avatar.textContent = '?';
    els.avatar.dataset.color = '0';
    els.emails.replaceChildren();
    els.contacts.replaceChildren();
    els.team.replaceChildren();

    try {
      // Roles are fetched in parallel so the inline role select on each
      // team row can be a real dropdown immediately rather than waiting for
      // the user to click Add. We use /api/team-roles (well-known job
      // titles — Book Keeper, Account Manager, …) rather than /api/roles
      // (system roles — Administrator/Manager/User), because that's the
      // vocabulary stored in `user_customers.role_id`.
      const [info, contacts, team, roles] = await Promise.all([
        getJson(apiFetch, `/api/customers/${customerId}`),
        getJson(apiFetch, `/api/customers/${customerId}/contacts`),
        getJson(apiFetch, `/api/customers/${customerId}/team`),
        state.teamRoles ? Promise.resolve(state.teamRoles) : getJson(apiFetch, '/api/team-roles').catch(() => []),
      ]);
      if (state.selectedId !== customerId) return;

      state.teamRoles = roles || [];
      state.detail = { info, contacts, team };

      els.name.textContent = info.name;
      els.avatar.textContent = initials(info.name);
      els.avatar.dataset.color = String(paletteIndex(info.name));

      els.domains.replaceChildren();
      for (const d of info.domains) {
        const chip = document.createElement('span');
        chip.className = 'ip-detail__domain-chip';
        chip.textContent = `@${d}`;
        els.domains.appendChild(chip);
      }
      els.tabCountContacts.textContent = `(${contacts.length})`;
      els.tabCountTeam.textContent     = `(${team.length})`;
      renderContacts();
      renderTeam();

      // Emails depend on date range — load them last (single-flight).
      loadDetailEmails(customerId);
    } catch (err) {
      els.name.textContent = `Failed to load: ${err.message}`;
    }
  }

  async function loadDetailEmails(customerId) {
    // Single-flight: drop any in-progress query so older results can't
    // overwrite newer ones when the user types fast.
    if (state.emailInflight) state.emailInflight.aborted = true;
    const controller = { aborted: false };
    state.emailInflight = controller;
    try {
      const res = await postJson(apiFetch, '/api/emails/analyzed/search', {
        customerId,
        sortBy: 'receivedAt',
        sortOrder: 'desc',
        limit: 100,
        offset: 0,
        groupByThread: true,
        search: state.emailFilters.search || undefined,
        signal: state.emailFilters.signal !== 'all' ? state.emailFilters.signal : undefined,
        teamMemberId: effectiveTeamMemberId() || undefined,
        dateFrom: state.range.from ? toIsoStart(state.range.from) : undefined,
        dateTo:   state.range.to   ? toIsoEnd(state.range.to)   : undefined,
      });
      if (controller.aborted || state.selectedId !== customerId) return;
      els.tabCountEmails.textContent = `(${res.total})`;
      renderEmails(res.items);
    } catch (err) {
      if (controller.aborted) return;
      els.tabCountEmails.textContent = '';
      els.emailsEmpty.hidden = false;
      els.emailsEmpty.textContent = `Failed to load emails: ${err.message}`;
    }
  }

  function toIsoStart(yyyymmdd) {
    const d = new Date(yyyymmdd);
    d.setUTCHours(0, 0, 0, 0);
    return d.toISOString();
  }
  function toIsoEnd(yyyymmdd) {
    const d = new Date(yyyymmdd);
    d.setUTCHours(23, 59, 59, 999);
    return d.toISOString();
  }

  function renderEmails(items) {
    els.emails.replaceChildren();
    els.emailsEmpty.hidden = items.length > 0;
    for (const item of items) {
      const li = document.createElement('li');
      li.className = 'ip-detail__email';
      li.title = 'Open in AI Analysis';
      li.addEventListener('click', () => onOpenInAiAnalysis?.(item.id));

      const left = document.createElement('div');
      left.className = 'ip-detail__email-left';
      const subj = document.createElement('div');
      subj.className = 'ip-detail__email-subject';
      subj.textContent = item.subject || '(no subject)';
      const from = document.createElement('div');
      from.className = 'ip-detail__email-from';
      from.textContent = item.fromName || item.fromEmail || '';
      left.append(subj, from);

      const badges = document.createElement('div');
      badges.className = 'signal-badges';
      for (const code of (item.signals || [])) {
        const label = SIGNAL_LABELS[code];
        if (!label) continue;
        const b = document.createElement('span');
        b.className = 'signal-badge';
        b.dataset.kind = signalKind(code);
        b.textContent = label;
        badges.appendChild(b);
      }

      const date = document.createElement('div');
      date.className = 'ip-detail__email-date';
      date.textContent = fmtDate(item.receivedAt);

      li.append(left, badges, date);
      els.emails.appendChild(li);
    }
  }

  // Contact list is small enough to filter on the client — keeps the search
  // instantaneous and avoids a server round-trip per keystroke.
  function renderContacts() {
    const all = state.detail?.contacts || [];
    const q = state.contactSearch.toLowerCase();
    const filtered = q
      ? all.filter((c) =>
          (c.name  || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.title || '').toLowerCase().includes(q))
      : all;

    els.contacts.replaceChildren();
    els.contactsEmpty.hidden = filtered.length > 0;
    for (const c of filtered) {
      const tr = document.createElement('tr');
      const contactLine = c.email
        ? `<span class="ip-contact__email">✉ ${escapeHtml(c.email)}</span>`
        : (c.phone ? escapeHtml(c.phone) : '—');
      tr.innerHTML = `
        <td>${escapeHtml(c.name || '—')}</td>
        <td class="muted">${escapeHtml(c.title || '')}</td>
        <td>${contactLine}</td>
      `;
      els.contacts.appendChild(tr);
    }
  }

  function renderTeam() {
    const team = state.detail?.team || [];
    els.team.replaceChildren();
    els.teamEmpty.hidden = team.length > 0 || state.teamAdding;

    // Each team row renders in one of two modes:
    //   - display: role text + pen icon (default). Accidental clicks can't
    //     change anyone's role.
    //   - edit:    role select + save (✓) + cancel (✕). Save POSTs the
    //     change; cancel just re-renders.
    for (const m of team) {
      const tr = document.createElement('tr');
      const fullName = [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || '—';

      const tdName = document.createElement('td');
      tdName.textContent = fullName;

      const tdRole = document.createElement('td');
      tdRole.className = 'ip-detail__role-cell';
      if (state.editingTeamMemberId === m.id) {
        tdRole.append(...renderRoleEditor(m));
      } else {
        tdRole.append(...renderRoleDisplay(m));
      }

      const tdEmail = document.createElement('td');
      tdEmail.textContent = m.email || '';

      tr.append(tdName, tdRole, tdEmail);
      els.team.appendChild(tr);
    }

    // Inline add-row appears at the bottom while teamAdding is true.
    if (state.teamAdding) {
      renderTeamAddRow();
    }

    els.teamAddBtn.disabled = state.teamAdding;
  }

  function renderRoleDisplay(member) {
    const label = document.createElement('span');
    label.className = 'ip-detail__role-badge';
    label.textContent = member.role || '—';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'ip-detail__role-edit-btn';
    editBtn.title = 'Edit role';
    editBtn.setAttribute('aria-label', `Edit role for ${[member.firstName, member.lastName].filter(Boolean).join(' ')}`);
    editBtn.innerHTML = '<span aria-hidden="true">✎</span>';
    editBtn.addEventListener('click', () => {
      els.teamAddError.hidden = true;
      state.editingTeamMemberId = member.id;
      renderTeam();
    });

    return [label, editBtn];
  }

  function renderRoleEditor(member) {
    const select = document.createElement('select');
    select.className = 'ip-detail__role-select';
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = '— No role —';
    select.appendChild(blank);
    const roles = state.teamRoles || [];
    // Preserve the current role as an option even if it isn't in the
    // lookup yet — same defensive fallback as before, just only relevant
    // while the row is being edited.
    const hasCurrent = roles.some((r) => r.name === member.role || r.id === member.roleId);
    if (member.role && !hasCurrent) {
      const opt = document.createElement('option');
      opt.value = member.roleId || `__current__${member.role}`;
      opt.textContent = member.role;
      opt.selected = true;
      select.appendChild(opt);
    }
    for (const r of roles) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      if (r.id === member.roleId || r.name === member.role) opt.selected = true;
      select.appendChild(opt);
    }
    if (!member.role && !member.roleId) blank.selected = true;

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ip-detail__role-save-btn';
    saveBtn.title = 'Save';
    saveBtn.innerHTML = '<span aria-hidden="true">✓</span>';
    saveBtn.addEventListener('click', () => updateTeamMemberRole(member, select, saveBtn));

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ip-detail__role-cancel-btn';
    cancelBtn.title = 'Cancel';
    cancelBtn.innerHTML = '<span aria-hidden="true">✕</span>';
    cancelBtn.addEventListener('click', () => {
      state.editingTeamMemberId = null;
      renderTeam();
    });

    return [select, saveBtn, cancelBtn];
  }

  async function updateTeamMemberRole(member, select, saveBtn) {
    const rawValue = select.value;
    // `__current__...` is a placeholder we add when the existing role
    // isn't in the lookup yet — saving that would round-trip to null,
    // which isn't what the user meant. Treat it as "no change", just
    // close the editor.
    if (rawValue.startsWith('__current__')) {
      state.editingTeamMemberId = null;
      renderTeam();
      return;
    }
    const newRoleId = rawValue || null;
    els.teamAddError.hidden = true;
    saveBtn.disabled = true;
    select.disabled = true;
    try {
      const newTeam = await postJson(apiFetch, `/api/customers/${state.selectedId}/team`, {
        userId: member.id,
        roleId: newRoleId,
      });
      state.detail.team = newTeam;
      els.tabCountTeam.textContent = `(${newTeam.length})`;
      state.editingTeamMemberId = null;
      renderTeam();
    } catch (err) {
      els.teamAddError.hidden = false;
      els.teamAddError.textContent = err.message;
      saveBtn.disabled = false;
      select.disabled = false;
    }
  }

  function renderTeamAddRow() {
    const tr = document.createElement('tr');
    tr.className = 'ip-detail__add-row';

    // User select
    const tdUser = document.createElement('td');
    const userSel = document.createElement('select');
    userSel.dataset.role = 'user';
    const existingIds = new Set((state.detail?.team || []).map((m) => m.id));
    const blank = document.createElement('option');
    blank.value = '';
    blank.textContent = 'Select user…';
    userSel.appendChild(blank);
    for (const u of (state.teamUsers || [])) {
      if (existingIds.has(u.id)) continue;
      const opt = document.createElement('option');
      opt.value = u.id;
      opt.textContent = `${[u.firstName, u.lastName].filter(Boolean).join(' ')} <${u.email}>`;
      userSel.appendChild(opt);
    }
    tdUser.appendChild(userSel);
    tr.appendChild(tdUser);

    // Role select + action buttons share a cell to keep the table tidy.
    const tdRole = document.createElement('td');
    tdRole.className = 'ip-detail__add-row-actions';
    const roleSel = document.createElement('select');
    roleSel.dataset.role = 'role';
    const noRole = document.createElement('option');
    noRole.value = '';
    noRole.textContent = '— No role —';
    roleSel.appendChild(noRole);
    for (const r of (state.teamRoles || [])) {
      const opt = document.createElement('option');
      opt.value = r.id;
      opt.textContent = r.name;
      roleSel.appendChild(opt);
    }
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ip-detail__primary-btn';
    saveBtn.textContent = 'Add';
    saveBtn.addEventListener('click', async () => {
      const userId = userSel.value;
      const roleId = roleSel.value || null;
      if (!userId) {
        els.teamAddError.hidden = false;
        els.teamAddError.textContent = 'Pick a user first.';
        return;
      }
      els.teamAddError.hidden = true;
      saveBtn.disabled = true;
      try {
        const newTeam = await postJson(apiFetch, `/api/customers/${state.selectedId}/team`, { userId, roleId });
        state.detail.team = newTeam;
        els.tabCountTeam.textContent = `(${newTeam.length})`;
        state.teamAdding = false;
        renderTeam();
      } catch (err) {
        els.teamAddError.hidden = false;
        els.teamAddError.textContent = err.message;
        saveBtn.disabled = false;
      }
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'ip-detail__ghost-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      state.teamAdding = false;
      els.teamAddError.hidden = true;
      renderTeam();
    });

    tdRole.append(roleSel, saveBtn, cancelBtn);
    tr.appendChild(tdRole);

    // Empty 3rd column to align with the existing header.
    tr.appendChild(document.createElement('td'));

    els.team.appendChild(tr);
  }

  async function startAddingTeamMember() {
    state.teamAdding = true;
    els.teamAddError.hidden = true;

    // Lazily fetch the user + role lookups the first time the form is opened.
    if (state.teamUsers === null) {
      try {
        const [usersRes, rolesRes] = await Promise.all([
          postJson(apiFetch, '/api/users/search', {
            status: 'active',
            sortBy: 'name',
            sortOrder: 'asc',
            limit: 200,
            offset: 0,
          }),
          getJson(apiFetch, '/api/team-roles'),
        ]);
        state.teamUsers = usersRes.items || [];
        state.teamRoles = rolesRes || [];
      } catch (err) {
        els.teamAddError.hidden = false;
        els.teamAddError.textContent = `Failed to load options: ${err.message}`;
        state.teamUsers = [];
        state.teamRoles = [];
      }
    }
    renderTeam();
  }

  function showTab(name) {
    for (const btn of els.tabs.querySelectorAll('[data-tab]')) {
      btn.classList.toggle('active', btn.dataset.tab === name);
    }
    for (const panel of root.querySelectorAll('[data-tab-panel]')) {
      panel.hidden = panel.dataset.tabPanel !== name;
    }
  }

  function backToList() {
    state.selectedId = null;
    state.detail = null;
    els.detailView.hidden = true;
    els.listView.hidden = false;
    root.classList.remove('ip-customers-host--detail');
  }

  // ----- wire up -----

  // Read the value from the input element (not the event): this handler is
  // debounced, so it runs ~250ms after the event, by which point Chrome has
  // reset the native event's `target` inside the Shadow DOM and
  // `ev.target.value` would be undefined.
  els.search.addEventListener('input', debounce(() => {
    state.search = els.search.value.trim();
    state.page = 0;
    loadList();
  }, 250));

  els.teamMember.addEventListener('change', () => {
    state.localTeamMemberId = els.teamMember.value || '';
    state.page = 0;
    loadList();
  });

  // Paginate /api/users/search so the dropdown shows every active user,
  // not just the first 200 the server returns per page.
  async function fetchAllUsers() {
    const all = [];
    let offset = 0;
    const limit = 200;
    while (true) {
      const res = await postJson(apiFetch, '/api/users/search', {
        status: 'active',
        sortBy: 'name',
        sortOrder: 'asc',
        limit,
        offset,
      });
      const items = res?.items || [];
      all.push(...items);
      const total = res?.total ?? all.length;
      if (items.length < limit || all.length >= total) break;
      offset += limit;
    }
    return all;
  }

  async function populateTeamMembers() {
    try {
      const users = await fetchAllUsers();
      for (const u of users) {
        const opt = document.createElement('option');
        opt.value = u.id;
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '(no name)';
        opt.textContent = name;
        els.teamMember.appendChild(opt);
      }
    } catch (err) {
      console.error('[ip] team member list load failed', err);
    }
  }
  populateTeamMembers();

  for (const th of root.querySelectorAll('th[data-sort]')) {
    const key = th.dataset.sort;
    if (!key) continue;
    th.addEventListener('click', () => {
      if (state.sortBy === key) {
        state.sortOrder = state.sortOrder === 'asc' ? 'desc' : 'asc';
      } else {
        state.sortBy = key;
        state.sortOrder = key === 'name' || key === 'lastContactDate' ? 'asc' : 'desc';
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

  els.back.addEventListener('click', backToList);
  els.tabs.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-tab]');
    if (!btn) return;
    showTab(btn.dataset.tab);
  });

  // Detail / Emails — debounced search + immediate signal-change.
  els.emailsSearch.addEventListener('input', debounce(() => {
    state.emailFilters.search = els.emailsSearch.value.trim();
    if (state.selectedId) loadDetailEmails(state.selectedId);
  }, 250));
  els.emailsSignal.addEventListener('change', () => {
    state.emailFilters.signal = els.emailsSignal.value;
    if (state.selectedId) loadDetailEmails(state.selectedId);
  });

  // Detail / Contacts — client-side filter.
  els.contactsSearch.addEventListener('input', debounce(() => {
    state.contactSearch = els.contactsSearch.value.trim();
    renderContacts();
  }, 150));

  // Detail / Team — add-member flow.
  els.teamAddBtn.addEventListener('click', startAddingTeamMember);

  loadList();

  return {
    setFilters({ dateRange, customerId, teamMemberId }) {
      state.range = { ...(dateRange || {}) };
      state.globalCustomerId   = customerId   || '';
      state.globalTeamMemberId = teamMemberId || '';
      state.page = 0;
      loadList();
      // Refresh the Emails tab if a detail view is currently open.
      if (state.selectedId) loadDetailEmails(state.selectedId);
    },
    // Programmatic detail open — used when the dashboard's Most Escalated
    // tile is clicked. Re-uses the same path as a row click.
    openCustomer(customerId) {
      if (!customerId) return;
      openDetail(customerId);
    },
  };
}
