/**
 * AI Analysis section of InboxPulse.
 *
 * Mounted into a section element by the app shell via `mountAiAnalysis`.
 * The shell owns the global filters (date range / customer / team member);
 * this section consumes them through `setFilters` so they stay in sync with
 * the dashboard and customers sections.
 *
 * Each row in the list is one *thread* (not one email) — the search uses
 * groupByThread so multi-email conversations don't fragment the inbox.
 */

const PAGE_SIZE = 50;

const SIGNAL_LABELS = {
  1: 'Positive',
  2: 'Negative',
  3: 'Neutral',
  10: 'Escalation',
  20: 'Upsell',
  30: 'Churn (low)',
  31: 'Churn (medium)',
  32: 'Churn (high)',
  33: 'Churn (critical)',
  40: 'Kudos',
  50: 'Competitor',
  60: 'Spam',
  61: 'Marketing',
  62: 'Transactional',
  63: 'Automated',
  64: 'Business',
};

function signalKind(code) {
  if (code === 1) return 'positive';
  if (code === 2) return 'negative';
  if (code === 3) return 'neutral';
  if (code === 20) return 'upsell';
  if (code >= 30 && code <= 33) return 'churn';
  return 'other';
}

const AVATAR_PALETTE_SIZE = 8;

function senderInitials(item) {
  const name = (item.fromName || '').trim();
  if (name) {
    const parts = name.split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }
  if (item.fromEmail) {
    const local = item.fromEmail.split('@')[0] || item.fromEmail;
    return local.slice(0, 2).toUpperCase();
  }
  return '?';
}

function avatarColor(item) {
  const key = (item.fromEmail || item.fromName || '').toLowerCase();
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(h, 31) + key.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % AVATAR_PALETTE_SIZE;
}

// DOMParser strips HTML without executing scripts or fetching subresources —
// safer than innerHTML for previewing arbitrary email bodies.
function makeSnippet(body, limit = 160) {
  if (!body) return '';
  const doc = new DOMParser().parseFromString(body, 'text/html');
  const text = (doc.body?.textContent || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit) + '…' : text;
}

const DEFAULT_FILTERS = {
  search: '',
  signal: 'negative',
  status: 'all',
  churnLevel: 'all',
};

const TEMPLATE = `
  <header data-el="app-header" class="app-header">
    <div class="app-title">
      <span class="app-title__icon" aria-hidden="true">&#9993;</span>
      <h1>AI Analysis</h1>
    </div>
    <div class="filters">
      <input data-el="filter-search" type="search" placeholder="Search subject, sender, message text..." />
      <select data-el="filter-signal">
        <option value="all">All signals</option>
        <option value="positive">Positive</option>
        <option value="negative" selected>Negative</option>
        <option value="neutral">Neutral</option>
        <option value="upsell">Upsell</option>
      </select>
      <select data-el="filter-churn-level">
        <option value="all" selected>All churn levels</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </select>
      <select data-el="filter-status">
        <option value="all" selected>All</option>
        <option value="open">Open</option>
        <option value="done">Done</option>
      </select>
      <select data-el="filter-team-member">
        <option value="">All Team Members</option>
      </select>
      <button data-el="filter-clear" type="button">Reset</button>
    </div>
  </header>

  <main class="app-body">
    <section data-el="inbox-view" class="inbox-view" aria-label="Email inbox">
      <div class="inbox-view__meta">
        <span data-el="list-count">&mdash;</span>
        <span data-el="list-page" class="inbox-view__page"></span>
        <div class="inbox-view__pager">
          <button data-el="page-prev" type="button" disabled>&lsaquo;</button>
          <button data-el="page-next" type="button" disabled>&rsaquo;</button>
        </div>
      </div>
      <ol data-el="email-list" class="email-list"></ol>
      <div data-el="list-empty" class="list-empty" hidden>No analyzed emails match these filters.</div>
      <div data-el="list-error" class="list-error" hidden></div>
    </section>

    <section data-el="thread-view" class="thread-view" aria-label="Email thread" hidden>
      <div class="thread-view__topbar">
        <button data-el="thread-back" class="thread-view__back" type="button">
          <span aria-hidden="true">&larr;</span> Back to inbox
        </button>
        <button data-el="thread-resolve" class="thread-view__resolve" type="button" hidden>
          Mark Resolved
        </button>
      </div>
      <div data-el="thread-error" class="thread-error" hidden></div>
      <article data-el="thread-content" class="thread-content" hidden>
        <header class="thread-content__header" data-el="thread-header">
          <button type="button" class="thread-content__toggle" data-el="thread-header-toggle" aria-expanded="true" aria-controls="thread-header-details">
            <span class="thread-content__toggle-caret" aria-hidden="true">▾</span>
            <span class="thread-content__toggle-label" data-el="thread-header-toggle-label">Hide details</span>
          </button>
          <div data-el="thread-header-details" id="thread-header-details" class="thread-content__header-details">
            <div data-el="thread-signals" class="thread-content__signals signal-badges"></div>
            <h2 data-el="thread-subject" class="thread-content__subject"></h2>
            <div class="thread-content__meta">
              <div>
                <span class="kv-label">Customer</span>
                <span data-el="thread-customer"></span>
              </div>
              <div data-el="thread-msg-count-row" hidden>
                <span class="kv-label">Messages</span>
                <span data-el="thread-msg-count"></span>
              </div>
            </div>
            <div data-el="thread-task" class="thread-content__task" hidden>
              <div>
                <span class="kv-label">Status</span>
                <span data-el="thread-task-status"></span>
              </div>
              <div>
                <span class="kv-label">Assigned to</span>
                <span data-el="thread-assignee"></span>
              </div>
              <div data-el="thread-problem-row" hidden>
                <span class="kv-label">Problem</span>
                <span data-el="thread-problem"></span>
              </div>
              <div data-el="thread-resolution-row" hidden>
                <span class="kv-label">Resolution</span>
                <span data-el="thread-resolution"></span>
              </div>
            </div>
          </div>
          <div class="thread-content__header-collapsed" data-el="thread-header-collapsed" hidden>
            <span data-el="thread-subject-collapsed" class="thread-content__subject-collapsed"></span>
          </div>
        </header>
        <div data-el="thread-messages" class="thread-content__messages"></div>
      </article>
    </section>
  </main>
`;

export function mountAiAnalysis(root, { apiFetch, initialFilters, onResetGlobalFilters }) {
  root.classList.add('numera-app');
  root.innerHTML = TEMPLATE;

  const $ = (name) => root.querySelector(`[data-el="${name}"]`);
  const els = {
    header: $('app-header'),
    search: $('filter-search'),
    signal: $('filter-signal'),
    status: $('filter-status'),
    churnLevel: $('filter-churn-level'),
    teamMember: $('filter-team-member'),
    clear: $('filter-clear'),

    inbox: $('inbox-view'),
    list: $('email-list'),
    empty: $('list-empty'),
    error: $('list-error'),
    count: $('list-count'),
    pageLabel: $('list-page'),
    prev: $('page-prev'),
    next: $('page-next'),

    thread: $('thread-view'),
    threadBack: $('thread-back'),
    threadResolve: $('thread-resolve'),
    threadError: $('thread-error'),
    threadContent: $('thread-content'),
    threadHeader: $('thread-header'),
    threadHeaderToggle: $('thread-header-toggle'),
    threadHeaderToggleLabel: $('thread-header-toggle-label'),
    threadHeaderDetails: $('thread-header-details'),
    threadHeaderCollapsed: $('thread-header-collapsed'),
    threadSubjectCollapsed: $('thread-subject-collapsed'),
    threadSignals: $('thread-signals'),
    threadSubject: $('thread-subject'),
    threadCustomer: $('thread-customer'),
    threadMsgCountRow: $('thread-msg-count-row'),
    threadMsgCount: $('thread-msg-count'),
    threadTask: $('thread-task'),
    threadTaskStatus: $('thread-task-status'),
    threadAssignee: $('thread-assignee'),
    threadProblemRow: $('thread-problem-row'),
    threadProblem: $('thread-problem'),
    threadResolutionRow: $('thread-resolution-row'),
    threadResolution: $('thread-resolution'),
    threadMessages: $('thread-messages'),
  };

  const state = {
    filters: {
      ...DEFAULT_FILTERS,
      dateFrom: initialFilters?.dateRange?.from || '',
      dateTo: initialFilters?.dateRange?.to || '',
      customerId: initialFilters?.customerId || '',
    },
    // Team member: section-local override wins over the global topbar value,
    // matching the Customers tab pattern. The effective value (what we send
    // to the server) is `localTeamMemberId || globalTeamMemberId`.
    globalTeamMemberId: initialFilters?.teamMemberId || '',
    localTeamMemberId: '',
    page: 0,
    total: 0,
    items: [],
    selectedId: null,
    inflight: null,
    // The full AnalyzedEmail currently shown in the thread view. Used by
    // the topbar's "Mark Resolved" button so it knows which task to PATCH
    // and which status to flip to.
    currentEmail: null,
  };

  function effectiveTeamMemberId() {
    return state.localTeamMemberId || state.globalTeamMemberId || '';
  }

  // --- API ---

  async function searchEmails(filters, page) {
    const body = {
      sortBy: 'receivedAt',
      sortOrder: 'desc',
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
      groupByThread: true,
    };
    if (filters.search) body.search = filters.search;
    if (filters.signal && filters.signal !== 'all') body.signal = filters.signal;
    if (filters.status && filters.status !== 'all') body.status = filters.status;
    if (filters.churnLevel && filters.churnLevel !== 'all') body.churnLevel = filters.churnLevel;
    if (filters.customerId) body.customerId = filters.customerId;
    const tmId = effectiveTeamMemberId();
    if (tmId) body.teamMemberId = tmId;
    if (filters.dateFrom) {
      const d = new Date(filters.dateFrom);
      d.setUTCHours(0, 0, 0, 0);
      body.dateFrom = d.toISOString();
    }
    if (filters.dateTo) {
      const d = new Date(filters.dateTo);
      d.setUTCHours(23, 59, 59, 999);
      body.dateTo = d.toISOString();
    }

    const res = await apiFetch('/api/emails/analyzed/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    return res.json;
  }

  async function fetchEmail(id) {
    const res = await apiFetch(`/api/emails/analyzed/${id}`, { method: 'GET' });
    if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
    return res.json;
  }

  async function fetchThreadMessages(threadId) {
    const res = await apiFetch(`/api/emails/threads/${threadId}`, { method: 'GET' });
    if (!res.ok) throw new Error(`Thread fetch failed: ${res.status}`);
    return res.json?.messages || [];
  }

  // --- Formatting ---

  function formatTimestamp(value) {
    const d = new Date(value);
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    });
  }

  function formatRelative(value) {
    const d = new Date(value);
    const diffMs = Date.now() - d.getTime();
    const day = 86_400_000;
    if (diffMs < 60_000) return 'just now';
    if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m`;
    if (diffMs < day) return `${Math.floor(diffMs / 3_600_000)}h`;
    if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d`;
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function senderLabel(item) {
    return item.fromName || item.fromEmail || '(unknown sender)';
  }

  // A recipient entry is a jsonb `{ name?, email }` (occasionally just a bare
  // string). We show the name AND the address together; the full "Name <email>"
  // also goes in the title for the truncation/hover case.
  function contactName(c) {
    if (!c) return '';
    if (typeof c === 'string') return '';
    return c.name || '';
  }
  function contactEmail(c) {
    if (!c) return '';
    if (typeof c === 'string') return c;
    return c.email || '';
  }
  function contactTitle(c) {
    if (!c) return '';
    if (typeof c === 'string') return c;
    if (c.name && c.email) return `${c.name} <${c.email}>`;
    return c.email || c.name || '';
  }

  // Build the To / Cc / Bcc strip for a message. Returns null when the message
  // carries no recipients at all, so callers can skip appending anything.
  function renderRecipients(msg) {
    const rows = [
      ['To', msg.tos],
      ['Cc', msg.ccs],
      ['Bcc', msg.bccs],
    ].filter(([, list]) => Array.isArray(list) && list.length > 0);
    if (rows.length === 0) return null;

    const wrap = document.createElement('div');
    wrap.className = 'thread-message__recipients';
    for (const [label, list] of rows) {
      const row = document.createElement('div');
      row.className = 'thread-message__recipients-row';

      const lab = document.createElement('span');
      lab.className = 'thread-message__recipients-label';
      lab.textContent = label;

      const val = document.createElement('span');
      val.className = 'thread-message__recipients-value';
      list.forEach((c, i) => {
        const chip = document.createElement('span');
        chip.className = 'thread-message__recipient';
        chip.title = contactTitle(c);

        const name = contactName(c);
        const email = contactEmail(c);
        // Show the name and the address together. When both exist we render the
        // address as a muted "<email>" after the name; with only one, that one
        // stands alone (so bare-email recipients still read cleanly).
        if (name && email && name !== email) {
          const nameEl = document.createElement('span');
          nameEl.className = 'thread-message__recipient-name';
          nameEl.textContent = name;
          const emailEl = document.createElement('span');
          emailEl.className = 'thread-message__recipient-email';
          emailEl.textContent = `<${email}>`;
          chip.append(nameEl, document.createTextNode(' '), emailEl);
        } else {
          chip.textContent = name || email || '';
        }

        val.appendChild(chip);
        if (i < list.length - 1) val.appendChild(document.createTextNode(', '));
      });

      row.append(lab, val);
      wrap.appendChild(row);
    }
    return wrap;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  // --- Rendering ---

  function renderSignals(target, signals) {
    target.replaceChildren();
    if (!signals || signals.length === 0) return;
    for (const code of signals) {
      const label = SIGNAL_LABELS[code];
      if (!label) continue;
      const span = document.createElement('span');
      span.className = 'signal-badge';
      span.dataset.kind = signalKind(code);
      span.textContent = label;
      target.appendChild(span);
    }
  }

  function renderList() {
    els.list.replaceChildren();
    els.empty.hidden = state.items.length > 0;
    els.error.hidden = true;

    for (const item of state.items) {
      const li = document.createElement('li');
      li.className = 'email-list__item';
      li.dataset.id = item.id;
      if (item.id === state.selectedId) li.setAttribute('aria-selected', 'true');

      const avatar = document.createElement('div');
      avatar.className = 'email-list__avatar';
      avatar.dataset.color = String(avatarColor(item));
      avatar.textContent = senderInitials(item);

      const body = document.createElement('div');
      body.className = 'email-list__body';

      const row = document.createElement('div');
      row.className = 'email-list__row';
      const from = document.createElement('span');
      from.className = 'email-list__from';
      from.textContent = senderLabel(item);
      const time = document.createElement('span');
      time.className = 'email-list__time';
      time.textContent = formatRelative(item.receivedAt);
      row.append(from, time);

      const subj = document.createElement('div');
      subj.className = 'email-list__subject';
      subj.textContent = item.subject || '(no subject)';

      const snippet = document.createElement('div');
      snippet.className = 'email-list__snippet';
      snippet.textContent = makeSnippet(item.body);

      const cust = document.createElement('div');
      cust.className = 'email-list__customer';
      cust.textContent = item.customerName || item.customerId || '';

      const signals = document.createElement('div');
      signals.className = 'email-list__signals signal-badges';
      renderSignals(signals, item.signals);

      body.append(row, subj, snippet, cust, signals);
      li.append(avatar, body);
      li.addEventListener('click', () => goToThread(item.id));
      els.list.appendChild(li);
    }

    const start = state.items.length === 0 ? 0 : state.page * PAGE_SIZE + 1;
    const end = state.page * PAGE_SIZE + state.items.length;
    els.count.textContent = state.total === 0
      ? 'No results'
      : `${state.total.toLocaleString()} thread${state.total === 1 ? '' : 's'}`;
    els.pageLabel.textContent = state.total === 0 ? '' : `${start}–${end}`;
    els.prev.disabled = state.page === 0;
    els.next.disabled = end >= state.total;
  }

  function updateResolveButton(email) {
    if (!email?.taskId) {
      els.threadResolve.hidden = true;
      return;
    }
    els.threadResolve.hidden = false;
    els.threadResolve.disabled = false;
    if (email.taskStatus === 1) {
      els.threadResolve.textContent = 'Reopen';
      els.threadResolve.dataset.state = 'done';
    } else {
      els.threadResolve.textContent = 'Mark Resolved';
      els.threadResolve.dataset.state = 'open';
    }
  }

  function setHeaderCollapsed(collapsed) {
    els.threadHeader.classList.toggle('is-collapsed', collapsed);
    els.threadHeaderDetails.hidden = collapsed;
    els.threadHeaderCollapsed.hidden = !collapsed;
    els.threadHeaderToggle.setAttribute('aria-expanded', String(!collapsed));
    els.threadHeaderToggleLabel.textContent = collapsed ? 'Show details' : 'Hide details';
  }

  function renderThread(email, threadMessages) {
    els.threadError.hidden = true;
    els.threadContent.hidden = false;
    state.currentEmail = email;
    updateResolveButton(email);

    // Header: subject, signals, customer, message count, optional task block.
    renderSignals(els.threadSignals, email.signals);
    els.threadSubject.textContent = email.subject || '(no subject)';
    els.threadSubjectCollapsed.textContent = email.subject || '(no subject)';
    els.threadCustomer.textContent = email.customerName || email.customerId || '—';

    const count = threadMessages?.length || 1;
    els.threadMsgCountRow.hidden = count <= 1;
    els.threadMsgCount.textContent = `${count} message${count === 1 ? '' : 's'}`;

    if (email.taskId) {
      els.threadTask.hidden = false;
      els.threadTaskStatus.textContent = email.taskStatus === 1 ? 'Done' : 'Open';
      els.threadAssignee.textContent = email.assignedToName || email.assignedToEmail || 'Unassigned';
      els.threadProblemRow.hidden = !email.problem;
      els.threadProblem.textContent = email.problem || '';
      els.threadResolutionRow.hidden = !email.resolution;
      els.threadResolution.textContent = email.resolution || '';
    } else {
      els.threadTask.hidden = true;
    }

    // Always reset to expanded view when a new thread loads.
    setHeaderCollapsed(false);

    // Render the conversation. If the thread fetch failed or this email is
    // standalone, fall back to a one-message render of `email` itself.
    const list = (threadMessages && threadMessages.length > 0)
      ? threadMessages
      : [{
          id: email.id,
          fromName: email.fromName,
          fromEmail: email.fromEmail,
          tos: email.tos,
          ccs: email.ccs,
          bccs: email.bccs,
          receivedAt: email.receivedAt,
          signals: email.signals,
          body: email.body,
          subject: email.subject,
        }];

    els.threadMessages.replaceChildren();

    if (list.length <= 1) {
      // Standalone email (or a thread fetch that returned nothing): keep the
      // single "fills the container" render, quoted chain collapsed behind a
      // pill. There's no prior chain to strip when there's only one message.
      els.threadMessages.classList.add('is-single-message');
      els.threadMessages.appendChild(
        renderMessageBlock(list[0], true, /* fillsContainer */ true, /* stripQuotes */ false),
      );
      return;
    }

    // Multi-email thread: render each message as its own Gmail-style block.
    // Every block carries its OWN sentiment badges in its header — keyed to the
    // email's DB `id`, so the mapping is exact (no attribution parsing, no
    // sender/timestamp guessing). Each body embeds the quoted chain of every
    // prior reply, so we strip that chain and show only the message's new
    // content; otherwise the same text repeats down the thread.
    els.threadMessages.classList.remove('is-single-message');
    // Newest first: reverse the oldest→newest thread list so the most recent
    // email — the one whose sentiment the thread header reflects — sits at the
    // top and is the one expanded by default. Older replies stack below,
    // collapsed.
    const newestFirst = [...list].reverse();
    newestFirst.forEach((msg, i) => {
      const isNewest = i === 0;
      els.threadMessages.appendChild(
        renderMessageBlock(msg, isNewest, /* fillsContainer */ false, /* stripQuotes */ true),
      );
    });
  }

  function renderMessageBlock(msg, expanded, fillsContainer = false, stripQuotes = false) {
    // Gmail-style collapsed view: avatar + bold name + inline snippet on one
    // line; click anywhere on the header to expand. When expanded, the body
    // appears below with the sender's email on a second line under the name.
    // `fillsContainer` makes the block grow to fill the remaining height
    // of `.thread-content__messages` — used when only one message is shown
    // so the body iframe stretches into the empty space below.
    const block = document.createElement('section');
    block.className = 'thread-message';
    if (fillsContainer) block.classList.add('thread-message--fills');
    block.dataset.id = msg.id;

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'thread-message__header';
    header.setAttribute('aria-expanded', String(expanded));

    const avatar = document.createElement('div');
    avatar.className = 'thread-message__avatar';
    avatar.dataset.color = String(avatarColor(msg));
    avatar.textContent = senderInitials(msg);

    const sender = document.createElement('div');
    sender.className = 'thread-message__sender';

    // Per-message subject, shown as its own line above the sender in both the
    // collapsed and expanded states — only when the message actually carries
    // one. Individual emails in a thread often differ by prefix ("Re:" vs
    // "Fwd:"), which is the fastest way to tell a reply from a forward at a
    // glance; the thread header's single subject can't convey that.
    if (msg.subject) {
      const subjectEl = document.createElement('div');
      subjectEl.className = 'thread-message__subject';
      subjectEl.textContent = msg.subject;
      subjectEl.title = msg.subject;
      sender.appendChild(subjectEl);
    }

    // Collapsed line: "Name<space>snippet…" on one row.
    const collapsedLine = document.createElement('div');
    collapsedLine.className = 'thread-message__collapsed-line';
    const collapsedName = document.createElement('span');
    collapsedName.className = 'thread-message__name';
    collapsedName.textContent = msg.fromName || msg.fromEmail || '(unknown sender)';
    const collapsedSnippet = document.createElement('span');
    collapsedSnippet.className = 'thread-message__snippet';
    collapsedSnippet.textContent = makeSnippet(msg.body, 140);
    collapsedLine.append(collapsedName, collapsedSnippet);

    // Expanded lines: name on one row, email address on the row below.
    const expandedName = document.createElement('div');
    expandedName.className = 'thread-message__name thread-message__name--full';
    expandedName.textContent = msg.fromName || msg.fromEmail || '(unknown sender)';
    const expandedAddr = document.createElement('div');
    expandedAddr.className = 'thread-message__addr';
    expandedAddr.textContent = msg.fromName ? msg.fromEmail || '' : '';

    sender.append(collapsedLine, expandedName, expandedAddr);

    const date = document.createElement('div');
    date.className = 'thread-message__date';
    date.textContent = formatTimestamp(msg.receivedAt);

    const badges = document.createElement('div');
    badges.className = 'thread-message__badges signal-badges';
    renderSignals(badges, msg.signals);

    const caret = document.createElement('span');
    caret.className = 'thread-message__caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.textContent = '▾';

    // Two rows, not one: identity + time on top, signal badges beneath.
    //
    // Badges used to be a flex item between the sender and the date. At rail
    // width there is no room for three chips on that line, so they stacked into
    // a tall column that squeezed the sender to almost nothing — and since the
    // name doesn't clip, it spilled under chips that paint after it, which read
    // as the badges sitting on top of the sender's name. Giving them their own
    // full-width row at the foot of the header removes the competition for
    // horizontal space entirely. They stay inside the header (so a collapsed
    // message still shows its signals) and above the To/Cc strip, which lives
    // in the collapsible wrap below.
    const headerMain = document.createElement('div');
    headerMain.className = 'thread-message__header-main';
    headerMain.append(avatar, sender, date, caret);

    header.append(headerMain, badges);

    const bodyWrap = document.createElement('div');
    bodyWrap.className = 'thread-message__body-wrap';
    bodyWrap.hidden = !expanded;

    // Recipients (To / Cc / Bcc) sit above the body, inside the collapsible
    // wrap, so they only surface once the message is expanded.
    const recipients = renderRecipients(msg);
    if (recipients) bodyWrap.appendChild(recipients);

    const iframe = document.createElement('iframe');
    iframe.className = 'thread-message__body';
    iframe.setAttribute('sandbox', '');
    iframe.title = 'Email body';
    // Multi-message mode: size the iframe to its content so the outer
    // scroll handles the whole conversation. Fills mode: set minHeight to
    // content size but let CSS flex grow the iframe into the remaining
    // space below the (possibly collapsed) details header.
    iframe.addEventListener('load', () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        const h = doc.body?.scrollHeight ?? doc.documentElement?.scrollHeight ?? 200;
        const natural = Math.max(h + 24, 80);
        if (fillsContainer) {
          iframe.style.minHeight = `${natural}px`;
        } else {
          iframe.style.height = `${natural}px`;
        }
      } catch {
        // Cross-origin shouldn't happen with sandbox + srcdoc, but if it
        // does we fall back to a sensible default height.
        if (fillsContainer) iframe.style.minHeight = '400px';
        else iframe.style.height = '400px';
      }
    });
    iframe.srcdoc = buildBodyHtml(msg.body, stripQuotes);

    bodyWrap.appendChild(iframe);

    header.addEventListener('click', () => {
      const isOpen = header.getAttribute('aria-expanded') === 'true';
      header.setAttribute('aria-expanded', String(!isOpen));
      bodyWrap.hidden = isOpen;
    });

    block.append(header, bodyWrap);
    return block;
  }

  // Wrap each top-level <blockquote> in a <details>/<summary> toggle so the
  // quoted reply chain collapses the way Gmail does. Used for the single-
  // message view (nothing to strip when there's only one email). Native HTML
  // only — works inside the sandboxed iframe even though scripts are disabled.
  function wrapTopLevelBlockquotes(html) {
    let doc;
    try {
      doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    } catch {
      return html;
    }
    for (const bq of Array.from(doc.body.querySelectorAll('blockquote'))) {
      let nested = false;
      for (let p = bq.parentElement; p && p !== doc.body; p = p.parentElement) {
        if (p.tagName === 'BLOCKQUOTE') { nested = true; break; }
      }
      if (nested) continue;

      const details = doc.createElement('details');
      details.className = 'ip-quote';
      const summary = doc.createElement('summary');
      summary.className = 'ip-quote__toggle';
      summary.textContent = '⋯';
      summary.title = 'Show / hide quoted text';
      details.appendChild(summary);
      bq.parentNode.insertBefore(details, bq);
      details.appendChild(bq);
    }
    return doc.body.innerHTML;
  }

  // Remove the quoted reply chain from a message body so a per-message block
  // shows only that email's own new content. Each block already displays its
  // own sentiment in its header (keyed by DB id), so we don't need — and don't
  // want — the repeated quoted chain from every prior reply.
  //
  // Covers the common clients: Gmail nests the attribution line + quote in a
  // `.gmail_quote` container; Outlook/Apple/others leave a bare top-level
  // <blockquote>, usually preceded by an "On <date> <name> wrote:" line we
  // also drop when we can spot it. Plain-text quoting (leading ">") has no
  // element to target, so those lines fall through unchanged.
  function stripQuotedChain(html) {
    let doc;
    try {
      doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
    } catch {
      return html;
    }
    doc.body.querySelectorAll('.gmail_quote_container, .gmail_quote').forEach((el) => {
      // A message's OWN body sometimes sits in a `.gmail_quote` too; only strip
      // containers that actually wrap a <blockquote> (i.e. the quoted chain).
      if (el.querySelector('blockquote')) el.remove();
    });
    for (const bq of Array.from(doc.body.querySelectorAll('blockquote'))) {
      if (!bq.isConnected) continue; // already removed with a gmail_quote container
      let nested = false;
      for (let p = bq.parentElement; p && p !== doc.body; p = p.parentElement) {
        if (p.tagName === 'BLOCKQUOTE') { nested = true; break; }
      }
      if (nested) continue;
      const prev = bq.previousElementSibling;
      if (prev && /\bwrote:\s*$/i.test((prev.textContent || '').trim())) prev.remove();
      bq.remove();
    }
    const out = doc.body.innerHTML.trim();
    return out || '<em style="color:#888">(no new content in this reply)</em>';
  }

  function buildBodyHtml(rawBody, stripQuotes = false) {
    const body = rawBody || '<em style="color:#888">(empty body)</em>';
    const isHtml = /<\/?[a-z][\s\S]*>/i.test(body);
    const inner = isHtml
      ? (stripQuotes ? stripQuotedChain(body) : wrapTopLevelBlockquotes(body))
      : `<pre style="white-space:pre-wrap;font-family:inherit;margin:0;">${escapeHtml(body)}</pre>`;
    // Real emails almost always carry inline `style="margin-left:N"` on
    // each <blockquote>, so a plain CSS reset gets out-specificity'd.
    // We override with !important from depth 4 onward — that's where the
    // compounding indent starts dropping the readable column to a single
    // character per line. Top-level quotes are hidden behind a <summary>
    // "..." toggle by `wrapTopLevelBlockquotes` above.
    return `
      <!doctype html>
      <html><head><meta charset="utf-8"><base target="_blank"><style>
        body {
          margin: 14px 20px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
          font-size: 14px;
          color: #1f2328;
          line-height: 1.5;
          word-wrap: break-word;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        img, table { max-width: 100%; }
        blockquote {
          margin: 8px 0 8px 12px;
          padding-left: 12px;
          border-left: 2px solid #e3e5e8;
          color: #5f6368;
          max-width: 100%;
          box-sizing: border-box;
          overflow-wrap: anywhere;
          word-wrap: break-word;
        }
        /* Past depth 3, collapse all further indent so deep reply chains
           stay readable instead of compressing to one character per line. */
        blockquote blockquote blockquote blockquote {
          margin-left: 0 !important;
          padding-left: 0 !important;
          border-left: 0 !important;
        }
        /* Gmail-style quoted-text toggle. The <summary> is the small pill
           the user clicks; the <blockquote> inside the <details> is
           hidden until they expand. */
        details.ip-quote { margin: 6px 0; }
        details.ip-quote > summary.ip-quote__toggle {
          cursor: pointer;
          display: inline-block;
          padding: 2px 10px;
          background: #f1f3f5;
          border: 1px solid #e3e5e8;
          border-radius: 12px;
          font-size: 13px;
          font-weight: 700;
          color: #5f6368;
          user-select: none;
          list-style: none;
          line-height: 1;
        }
        details.ip-quote > summary.ip-quote__toggle::-webkit-details-marker { display: none; }
        details.ip-quote > summary.ip-quote__toggle::marker { content: ''; }
        details.ip-quote > summary.ip-quote__toggle:hover { background: #e8eaed; color: #1f2328; }
        details.ip-quote[open] > summary.ip-quote__toggle { margin-bottom: 6px; }
      </style></head><body>${inner}</body></html>`;
  }

  function showThreadError(message) {
    els.threadContent.hidden = true;
    els.threadError.hidden = false;
    els.threadError.textContent = message;
  }

  // --- Navigation ---

  function goToList() {
    state.selectedId = null;
    state.currentEmail = null;
    els.thread.hidden = true;
    els.inbox.hidden = false;
    els.header.hidden = false;
    els.threadMessages.classList.remove('is-single-message');
    els.threadResolve.hidden = true;
  }

  async function goToThread(id) {
    state.selectedId = id;
    els.inbox.hidden = true;
    els.thread.hidden = false;
    els.header.hidden = true;
    els.threadContent.hidden = true;
    els.threadError.hidden = true;
    try {
      const email = await fetchEmail(id);
      if (state.selectedId !== id) return;
      // Fetch the full thread in parallel; tolerate failure (we fall back to
      // a single-message render inside renderThread).
      let messages = [];
      if (email.threadId) {
        messages = await fetchThreadMessages(email.threadId).catch(() => []);
        if (state.selectedId !== id) return;
      }
      renderThread(email, messages);
    } catch (err) {
      showThreadError(`Failed to load email: ${err.message}`);
    }
  }

  // --- Controllers ---

  async function loadPage() {
    if (state.inflight) state.inflight.abort?.();
    const controller = { aborted: false, abort() { this.aborted = true; } };
    state.inflight = controller;
    try {
      const result = await searchEmails(state.filters, state.page);
      if (controller.aborted) return;
      state.items = result.items;
      state.total = result.total;
      renderList();
    } catch (err) {
      els.error.hidden = false;
      els.error.textContent = err.message;
      state.items = [];
      state.total = 0;
      renderList();
    }
  }

  function applyFiltersFromInputs() {
    state.filters = {
      ...state.filters,
      search: els.search.value.trim(),
      signal: els.signal.value,
      status: els.status.value,
      churnLevel: els.churnLevel.value,
    };
    state.page = 0;
    loadPage();
  }

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function resetSectionFilters() {
    els.search.value = DEFAULT_FILTERS.search;
    els.signal.value = DEFAULT_FILTERS.signal;
    els.status.value = DEFAULT_FILTERS.status;
    els.churnLevel.value = DEFAULT_FILTERS.churnLevel;
    els.teamMember.value = '';
    state.filters = {
      ...state.filters,
      ...DEFAULT_FILTERS,
    };
    state.localTeamMemberId = '';
  }

  // Paginate through /api/users/search until we have every active user.
  // The single-page fetch we used previously stopped at MAX_PAGE_SIZE on
  // the server, which left dropdowns truncated mid-alphabet for tenants
  // with more than 200 users.
  async function fetchAllUsers() {
    const all = [];
    let offset = 0;
    const limit = 200;
    while (true) {
      const res = await apiFetch('/api/users/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'active',
          sortBy: 'name',
          sortOrder: 'asc',
          limit,
          offset,
        }),
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

  // Add an <option> for a team member if one isn't already present. Used to
  // seed a drill-in selection before (or instead of) the async user list, so
  // the dropdown can show — and let the user clear — the active filter.
  function ensureTeamMemberOption(id, label) {
    if (!id) return;
    const exists = Array.from(els.teamMember.options).some((o) => o.value === id);
    if (exists) return;
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = label || '(team member)';
    els.teamMember.appendChild(opt);
  }

  async function populateTeamMembers() {
    try {
      const users = await fetchAllUsers();
      const present = new Set(Array.from(els.teamMember.options).map((o) => o.value));
      for (const u of users) {
        // A drill-in may have already seeded this member's option; skip it so
        // we don't duplicate the entry.
        if (present.has(u.id)) continue;
        const opt = document.createElement('option');
        opt.value = u.id;
        const name = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || '(no name)';
        opt.textContent = name;
        els.teamMember.appendChild(opt);
      }
      // Re-assert any drill-in selection that was applied before the list
      // finished loading (setting .value before the option existed was a no-op).
      if (state.localTeamMemberId) els.teamMember.value = state.localTeamMemberId;
    } catch (err) {
      console.error('[ip] AI Analysis team member list load failed', err);
    }
  }

  // --- Wire up ---

  els.search.addEventListener('input', debounce(applyFiltersFromInputs, 250));
  els.signal.addEventListener('change', applyFiltersFromInputs);
  els.status.addEventListener('change', applyFiltersFromInputs);
  els.churnLevel.addEventListener('change', applyFiltersFromInputs);
  els.teamMember.addEventListener('change', () => {
    state.localTeamMemberId = els.teamMember.value || '';
    state.page = 0;
    loadPage();
  });
  // The Reset button resets section-local filters AND the global filters in
  // the topbar (date range, customer, team member). The shell broadcasts the
  // new global filters back to us through setFilters(), so we don't need to
  // call loadPage() ourselves — but we do reset the local inputs first so the
  // dropdown values match.
  els.clear.addEventListener('click', () => {
    resetSectionFilters();
    if (typeof onResetGlobalFilters === 'function') {
      onResetGlobalFilters();
    } else {
      state.page = 0;
      loadPage();
    }
  });
  els.prev.addEventListener('click', () => {
    if (state.page > 0) { state.page -= 1; loadPage(); }
  });
  els.next.addEventListener('click', () => {
    if ((state.page + 1) * PAGE_SIZE < state.total) { state.page += 1; loadPage(); }
  });
  els.threadBack.addEventListener('click', () => goToList());

  els.threadResolve.addEventListener('click', async () => {
    const email = state.currentEmail;
    if (!email?.taskId) return;
    const nextStatus = email.taskStatus === 1 ? 0 : 1;
    els.threadResolve.disabled = true;
    const originalLabel = els.threadResolve.textContent;
    els.threadResolve.textContent = 'Saving…';
    try {
      const res = await apiFetch(`/api/tasks/${email.taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (!res.ok) throw new Error(`Status update failed: ${res.status}`);
      email.taskStatus = nextStatus;
      // Keep the header's "Status" row in sync with the new state.
      els.threadTaskStatus.textContent = nextStatus === 1 ? 'Done' : 'Open';
      updateResolveButton(email);
    } catch (err) {
      els.threadResolve.textContent = originalLabel;
      els.threadResolve.disabled = false;
      els.threadError.hidden = false;
      els.threadError.textContent = err.message;
    }
  });

  // Collapsible thread header — both the button and the collapsed strip can
  // toggle, so clicks on the strip re-expand it.
  els.threadHeaderToggle.addEventListener('click', () => {
    const expanded = els.threadHeaderToggle.getAttribute('aria-expanded') === 'true';
    setHeaderCollapsed(expanded);
  });
  els.threadHeaderCollapsed.addEventListener('click', () => {
    setHeaderCollapsed(false);
  });

  applyFiltersFromInputs();
  populateTeamMembers();

  return {
    setFilters({ dateRange, customerId, teamMemberId }) {
      state.filters = {
        ...state.filters,
        dateFrom: dateRange?.from || '',
        dateTo: dateRange?.to || '',
        customerId: customerId || '',
      };
      state.globalTeamMemberId = teamMemberId || '';
      state.page = 0;
      loadPage();
    },
    // Called from other sections (e.g. a Critical Escalation tile click) to
    // jump straight into a thread without going through the email list.
    openEmail(emailId) {
      if (!emailId) return;
      goToThread(emailId);
    },
    // Drill-in from a dashboard KPI: preset the section's signal / status /
    // churn-level filters (and optionally search) and show the list view.
    // When a churn level is passed in we also clear the sentiment filter
    // so the user actually sees the churn-tagged threads rather than the
    // negative-only default narrowing them out.
    openInbox({ signal, status, search, churnLevel, teamMemberId, teamMemberName } = {}) {
      goToList();
      if (typeof teamMemberId === 'string') {
        // Section-local override so it behaves like a manual dropdown pick
        // (and survives a global filter change without being clobbered).
        state.localTeamMemberId = teamMemberId;
        // The user list loads asynchronously, so on a first-visit drill-in the
        // <option> may not exist yet — seed it (with its label) so the dropdown
        // reflects the selection immediately and stays resettable.
        ensureTeamMemberOption(teamMemberId, teamMemberName);
        els.teamMember.value = teamMemberId;
      }
      if (typeof churnLevel === 'string') {
        state.filters.churnLevel = churnLevel;
        els.churnLevel.value = churnLevel;
        if (typeof signal !== 'string') {
          state.filters.signal = 'all';
          els.signal.value = 'all';
        }
      }
      if (typeof signal === 'string') {
        state.filters.signal = signal;
        els.signal.value = signal;
      }
      if (typeof status === 'string') {
        state.filters.status = status;
        els.status.value = status;
      }
      if (typeof search === 'string') {
        state.filters.search = search;
        els.search.value = search;
      }
      state.page = 0;
      loadPage();
    },
  };
}
