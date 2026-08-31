/**
 * InboxPulse sidebar shell.
 *
 * Ported from the standalone extension's full-pane shell into Gmail's ~400px
 * right-hand rail. The section model is unchanged — each section is mounted
 * into its own container once and kept alive across nav switches so its state
 * (scroll position, selected thread, open drill-down) survives — but the
 * chrome around it is rebuilt for a narrow column:
 *
 *   full pane                     sidebar
 *   ─────────────────────────     ─────────────────────
 *   left rail nav + topbar   ->   brand row + tab strip
 *   always-visible filters   ->   collapsible drawer
 *   3-column section grid    ->   single vertical stack (see manager.css)
 *
 * Sections are supplied by the caller so the thread-scoped "Thread" view
 * (React, from the original CRM sidebar) can sit alongside the manager
 * sections (vanilla, from the standalone dashboard) as a peer tab. A section
 * that sets `usesFilters: false` hides the filter drawer while it is active.
 *
 * The shell owns the canonical filters; sections receive them at mount time
 * via `initialFilters` and on every change via `setFilters`.
 */

import { mountAiAnalysis } from './inbox-ui.js';
import { mountDashboard }  from './dashboard-ui.js';
import { mountCustomers }  from './customers-ui.js';
import { mountUsers }      from './users-ui.js';

/**
 * The manager sections. `mount` receives (host, ctx) where ctx carries
 * apiFetch, the current filters, and the cross-section navigation callbacks.
 */
export const MANAGER_SECTIONS = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    usesFilters: true,
    mount: (host, ctx) => mountDashboard(host, {
      apiFetch: ctx.apiFetch,
      initialFilters: ctx.filters,
      onOpenInAiAnalysis: ctx.openInAiAnalysis,
      onDrillIntoAiAnalysis: ctx.drillIntoAiAnalysis,
      onOpenCustomer: ctx.openInCustomers,
      onResetGlobalFilters: ctx.resetAll,
    }),
  },
  {
    id: 'ai-analysis',
    label: 'AI Analysis',
    usesFilters: true,
    mount: (host, ctx) => mountAiAnalysis(host, {
      apiFetch: ctx.apiFetch,
      initialFilters: ctx.filters,
      onResetGlobalFilters: ctx.resetAll,
    }),
  },
  {
    id: 'customers',
    label: 'Customers',
    usesFilters: true,
    mount: (host, ctx) => mountCustomers(host, {
      apiFetch: ctx.apiFetch,
      initialFilters: ctx.filters,
      onOpenInAiAnalysis: ctx.openInAiAnalysis,
    }),
  },
  {
    id: 'users',
    label: 'Users',
    usesFilters: false,
    mount: (host, ctx) => mountUsers(host, { apiFetch: ctx.apiFetch }),
  },
];

function shellTemplate(sections) {
  return `
  <header class="ip-shell__head">
    <div class="ip-shell__brand">
      <span class="ip-shell__brand-mark" aria-hidden="true">IP</span>
      <span class="ip-shell__brand-name">InboxPulse</span>
      <button
        type="button"
        class="ip-shell__filter-toggle"
        data-el="filter-toggle"
        aria-expanded="false"
        title="Filters"
      >Filters</button>
    </div>
    <nav class="ip-shell__tabs" data-el="nav" role="tablist">
      ${sections.map((s) => `
        <button
          type="button"
          role="tab"
          class="ip-shell__tab"
          data-section="${s.id}"
        >${s.label}</button>
      `).join('')}
    </nav>
    <div class="ip-shell__filters" data-el="filters" hidden>
      <div class="ip-shell__presets">
        <button type="button" data-preset="7">7d</button>
        <button type="button" data-preset="30" class="active">30d</button>
        <button type="button" data-preset="90">90d</button>
        <button type="button" class="ip-shell__reset" data-el="global-reset">Reset</button>
      </div>
      <div class="ip-shell__dates">
        <label class="ip-shell__field">
          <span>From</span>
          <input data-el="global-date-from" type="date" />
        </label>
        <label class="ip-shell__field">
          <span>To</span>
          <input data-el="global-date-to" type="date" />
        </label>
      </div>
      <select class="ip-shell__select" data-el="global-customer">
        <option value="">All Customers</option>
      </select>
      <select class="ip-shell__select" data-el="global-user">
        <option value="">All Users</option>
      </select>
    </div>
  </header>
  <div class="ip-section-host" data-el="section-host">
    ${sections.map((s) => `
      <section class="ip-section" data-section="${s.id}" hidden></section>
    `).join('')}
  </div>
`;
}

function isoFromDateInput(value) {
  // <input type="date"> returns "YYYY-MM-DD". Treat as a UTC bound — start
  // of day for `from`, end of day for `to` — so the SQL between matches the
  // calendar dates the user picked.
  return value || '';
}

function dateRangePreset(days) {
  const to = new Date();
  const from = new Date(to.getTime() - days * 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to:   to.toISOString().slice(0, 10),
  };
}

/**
 * @param {HTMLElement} root
 * @param {object}   opts
 * @param {Function} opts.apiFetch      (path, init) => { ok, status, json }
 * @param {Array}    [opts.sections]    section descriptors; defaults to the manager set
 * @param {string}   [opts.initialSection]
 */
export function mountApp(root, { apiFetch, sections = MANAGER_SECTIONS, initialSection } = {}) {
  root.classList.add('ip-app', 'ip-app--sidebar');
  root.innerHTML = shellTemplate(sections);

  const $ = (name) => root.querySelector(`[data-el="${name}"]`);
  const nav          = $('nav');
  const sectionHost  = $('section-host');
  const filtersEl    = $('filters');
  const filterToggle = $('filter-toggle');
  const dateFromEl   = $('global-date-from');
  const dateToEl     = $('global-date-to');
  const customerEl   = $('global-customer');
  const userEl       = $('global-user');
  const resetBtn     = $('global-reset');
  const presetBtns   = root.querySelectorAll('[data-preset]');

  // One section is not a choice. A lone tab reads as leftover chrome, and the
  // strip costs ~28px of a ~400px rail that the content can have instead.
  // Derived from the array rather than hardcoded, so the harness — which passes
  // the full set — still renders its strip.
  nav.hidden = sections.length <= 1;

  // Filters — default to last 30 days, all customers, all users. Sections
  // are mounted with these initial values and updated through setFilters().
  const DEFAULTS = {
    dateRange: dateRangePreset(30),
    customerId: '',
    teamMemberId: '',
  };
  let currentRange      = { ...DEFAULTS.dateRange };
  let currentCustomer   = DEFAULTS.customerId;
  let currentTeamMember = DEFAULTS.teamMemberId;
  dateFromEl.value = currentRange.from;
  dateToEl.value   = currentRange.to;

  const mounted = {};
  let activeId = null;
  // The drawer is user-controlled, but sections that ignore filters force it
  // shut while active. Remember the user's intent so it comes back when they
  // navigate to a section that does use filters.
  let filtersOpen = false;

  function currentFilters() {
    return {
      dateRange: { ...currentRange },
      customerId: currentCustomer || '',
      teamMemberId: currentTeamMember || '',
    };
  }

  function openInAiAnalysis(emailId) {
    showSection('ai-analysis');
    mounted['ai-analysis']?.openEmail?.(emailId);
  }

  // Drill-in from a dashboard KPI tile: switch to AI Analysis and apply the
  // requested filter set (signal/status/search/churnLevel). Date range
  // stays as the global filter so the user sees the same window they were
  // just looking at.
  function drillIntoAiAnalysis(filters) {
    showSection('ai-analysis');
    mounted['ai-analysis']?.openInbox?.(filters || {});
  }

  // Open a customer's detail view in the Customers tab — used by the
  // dashboard's "Most Escalated Customers" tile.
  function openInCustomers(customerId) {
    showSection('customers');
    mounted['customers']?.openCustomer?.(customerId);
  }

  function mountSection(id) {
    const host = sectionHost.querySelector(`[data-section="${id}"]`);
    const descriptor = sections.find((s) => s.id === id);
    if (!host || !descriptor?.mount) return null;
    return descriptor.mount(host, {
      apiFetch,
      filters: currentFilters(),
      openInAiAnalysis,
      drillIntoAiAnalysis,
      openInCustomers,
      resetAll,
    });
  }

  function syncFilterVisibility() {
    const descriptor = sections.find((s) => s.id === activeId);
    const supported = descriptor?.usesFilters !== false;
    filterToggle.hidden = !supported;
    const show = supported && filtersOpen;
    filtersEl.hidden = !show;
    filterToggle.setAttribute('aria-expanded', String(show));
  }

  function showSection(id) {
    // The cross-section jumps below name ids by string, so a section filtered
    // out of this build would set activeId to something that does not exist and
    // then hide every host — a blank panel with no error.
    if (!sections.some((s) => s.id === id)) return;
    activeId = id;
    for (const btn of nav.querySelectorAll('[data-section]')) {
      btn.classList.toggle('active', btn.dataset.section === id);
      btn.setAttribute('aria-selected', String(btn.dataset.section === id));
    }
    for (const host of sectionHost.querySelectorAll('[data-section]')) {
      host.hidden = host.dataset.section !== id;
    }
    syncFilterVisibility();
    // Lazy mount on first activation.
    if (!mounted[id]) mounted[id] = mountSection(id);
  }

  function broadcast() {
    const filters = currentFilters();
    for (const inst of Object.values(mounted)) {
      inst?.setFilters?.(filters);
    }
  }

  function fireDateRangeChange() {
    currentRange = {
      from: isoFromDateInput(dateFromEl.value),
      to:   isoFromDateInput(dateToEl.value),
    };
    broadcast();
  }

  function applyPreset(days) {
    const r = dateRangePreset(days);
    dateFromEl.value = r.from;
    dateToEl.value   = r.to;
    for (const b of presetBtns) {
      b.classList.toggle('active', parseInt(b.dataset.preset, 10) === days);
    }
    fireDateRangeChange();
  }

  function resetAll() {
    currentRange      = { ...DEFAULTS.dateRange };
    currentCustomer   = DEFAULTS.customerId;
    currentTeamMember = DEFAULTS.teamMemberId;
    dateFromEl.value = currentRange.from;
    dateToEl.value   = currentRange.to;
    customerEl.value = '';
    userEl.value     = '';
    for (const b of presetBtns) {
      b.classList.toggle('active', parseInt(b.dataset.preset, 10) === 30);
    }
    broadcast();
  }

  // Paginated fetch — the server caps limit at MAX_PAGE_SIZE (200), so a
  // single call would truncate the dropdown mid-alphabet for tenants with
  // 2k+ customers. We loop until we have everything so the native <select>
  // can scroll through the full list.
  async function fetchAll(path, body) {
    const all = [];
    let offset = 0;
    const limit = 200;
    while (true) {
      const res = await apiFetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, limit, offset }),
      });
      if (!res.ok || !res.json?.items) break;
      const items = res.json.items;
      all.push(...items);
      const total = res.json.total ?? all.length;
      if (items.length < limit || all.length >= total) break;
      offset += limit;
    }
    return all;
  }

  async function populateDropdowns() {
    try {
      const customers = await fetchAll('/api/customers/search', {
        sortBy: 'name',
        sortOrder: 'asc',
      });
      for (const c of customers) {
        const opt = document.createElement('option');
        opt.value = c.id;
        opt.textContent = c.domain ? `${c.name} (${c.domain})` : c.name;
        customerEl.appendChild(opt);
      }
    } catch (err) {
      console.error('[ip] customer list load failed', err);
    }
    try {
      const users = await fetchAll('/api/users/search', {
        status: 'active',
        sortBy: 'name',
        sortOrder: 'asc',
      });
      for (const u of users) {
        const opt = document.createElement('option');
        opt.value = u.id;
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '(no name)';
        opt.textContent = name;
        userEl.appendChild(opt);
      }
    } catch (err) {
      console.error('[ip] user list load failed', err);
    }
  }

  // Wire up
  nav.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-section]');
    if (!btn || btn.disabled) return;
    showSection(btn.dataset.section);
  });

  filterToggle.addEventListener('click', () => {
    filtersOpen = !filtersOpen;
    syncFilterVisibility();
  });

  dateFromEl.addEventListener('change', () => {
    for (const b of presetBtns) b.classList.remove('active');
    fireDateRangeChange();
  });
  dateToEl.addEventListener('change', () => {
    for (const b of presetBtns) b.classList.remove('active');
    fireDateRangeChange();
  });
  for (const b of presetBtns) {
    b.addEventListener('click', () => applyPreset(parseInt(b.dataset.preset, 10)));
  }
  customerEl.addEventListener('change', () => {
    currentCustomer = customerEl.value || '';
    broadcast();
  });
  userEl.addEventListener('change', () => {
    currentTeamMember = userEl.value || '';
    broadcast();
  });
  resetBtn.addEventListener('click', resetAll);

  // Only the manager sections need the customer/user dropdowns; skip the
  // (paginated, multi-request) load entirely if none of them are present.
  if (sections.some((s) => s.usesFilters !== false)) populateDropdowns();

  showSection(initialSection && sections.some((s) => s.id === initialSection)
    ? initialSection
    : sections[0].id);

  return {
    showSection,
    getFilters: currentFilters,
    destroy() {
      for (const inst of Object.values(mounted)) inst?.destroy?.();
    },
  };
}
