/**
 * Dashboard section of InboxPulse.
 *
 * Tile layout (top to bottom):
 *   - KPI row : Customers, Emails Analyzed, Active Escalations, Upsell Opportunities
 *   - Attention row : Important Escalations | Most Dissatisfied Customers | Churn Level
 *   - Sentiment row : Positive / Negative Sentiment Share Trend (6 months, full width)
 *   - TAT row : Email Response TAT (SLA Breaches) (full width)
 *   - Recent Escalations (full width)
 *
 * The shell drives the date range through `setDateRange`; every tile,
 * including the attention row, refreshes when the date filter changes.
 */

import { Chart, registerables } from 'chart.js';
Chart.register(...registerables);

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

const DASHBOARD_TEMPLATE = `
  <div class="ip-dashboard">
    <div class="ip-tile-row ip-tile-row--kpi">
      <div class="ip-kpi" data-tile="customers">
        <div class="ip-kpi__label">Customers</div>
        <div class="ip-kpi__value" data-el="kpi-customers">—</div>
        <div class="ip-kpi__sub">active in range</div>
      </div>
      <div class="ip-kpi" data-tile="emails">
        <div class="ip-kpi__label">Emails Analyzed</div>
        <div class="ip-kpi__value" data-el="kpi-emails">—</div>
        <div class="ip-kpi__sub">in selected date range</div>
      </div>
      <button type="button" class="ip-kpi ip-kpi--link" data-tile="escalations" data-el="kpi-card-escalations">
        <div class="ip-kpi__label">Active Escalations</div>
        <div class="ip-kpi__value" data-el="kpi-escalations">—</div>
        <div class="ip-kpi__sub">open + negative sentiment</div>
      </button>
      <button type="button" class="ip-kpi ip-kpi--link" data-tile="opportunities" data-el="kpi-card-opportunities">
        <div class="ip-kpi__label">Upsell Opportunities</div>
        <div class="ip-kpi__value" data-el="kpi-opportunities">—</div>
        <div class="ip-kpi__sub">open upsell tasks</div>
      </button>
    </div>

    <div class="ip-tile-row ip-tile-row--attention">
      <div class="ip-tile ip-tile--critical">
        <header>
          <h3>Important Escalations</h3>
          <p class="ip-tile__sub">
            Threads whose most recent email is a negative, still-open
            escalation, ranked by the longest reply chain (most messages).
          </p>
        </header>
        <div class="ip-critical" data-el="critical-body"></div>
      </div>
      <div class="ip-tile ip-tile--most-escalated">
        <header>
          <h3>Most Dissatisfied Customers</h3>
          <p class="ip-tile__sub">Customers (&gt;10 emails) with the highest share of negatives.</p>
        </header>
        <ol class="ip-most-escalated" data-el="most-escalated-body"></ol>
      </div>
      <div class="ip-tile ip-tile--examine">
        <header>
          <h3>Churn Level</h3>
          <p class="ip-tile__sub">Threads in the date range carrying each churn signal &mdash; click a level to drill in.</p>
        </header>
        <div class="ip-churn" data-el="churn-body"></div>
      </div>
    </div>

    <div class="ip-tile-row">
      <div class="ip-tile ip-hist-tile">
        <header>
          <h3>Team Response Time &middot; Distribution</h3>
          <p class="ip-tile__sub">
            Gap from a customer email to the team member email that immediately
            follows it, across all threads (forwards count). Log-scaled buckets so
            the right-skew stays readable; median resists the multi-week outliers
            that inflate the mean.
          </p>
        </header>
        <div class="ip-hist__headline" data-el="agg-hist-headline"></div>
        <div class="ip-hist" data-el="agg-hist-body"></div>
      </div>
    </div>

    <div class="ip-tile-row">
      <div class="ip-tile ip-memberhist-tile">
        <header>
          <h3>Team Members &middot; Response Delay Distribution</h3>
          <p class="ip-tile__sub">
            The five team members (&gt;10 responses in range) with the highest
            <em>median</em> customer&rarr;team reply gap, each on the same
            log-scaled buckets. Click a member to open their threads.
          </p>
        </header>
        <div class="ip-memberhist" data-el="member-hists-body"></div>
      </div>
    </div>

    <div class="ip-tile-row">
      <div class="ip-tile">
        <header>
          <h3>Sentiment Share Trend (6 months)</h3>
          <p class="ip-tile__sub">
            Share of all emails carrying positive or negative sentiment, by month.
            Neutral (the large majority) is excluded so the trend stays legible &mdash;
            click a line or its key to drill into that sentiment in AI Analysis.
            Always the trailing 6 months, independent of the date filter.
          </p>
        </header>
        <div class="ip-chart-wrap">
          <canvas data-el="chart-sentiment-share"></canvas>
        </div>
      </div>
    </div>

    <div class="ip-tile-row">
      <div class="ip-tile">
        <header>
          <h3>Email Response TAT (SLA Breaches)</h3>
          <p class="ip-tile__sub">Calendar-day breach counts per customer.</p>
        </header>
        <div class="ip-tat" data-el="tat-body"></div>
      </div>
    </div>

    <div class="ip-tile ip-tile--wide">
      <header><h3>Recent Escalations</h3></header>
      <div class="ip-recent" data-el="recent-body"></div>
    </div>
  </div>
`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

function fmt(n) {
  if (n == null) return '—';
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

function fmtDate(value) {
  if (!value) return '';
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

// Human-friendly duration from a fractional number of days. Small gaps read
// better in minutes/hours; anything two days or longer reads in days.
function fmtDuration(days) {
  if (days == null || Number.isNaN(days)) return '—';
  const hours = days * 24;
  if (hours < 1)  return `${Math.max(1, Math.round(hours * 60))}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${days.toFixed(1)}d`;
}

function fmtRelative(value) {
  if (!value) return '';
  const ms = Date.now() - new Date(value).getTime();
  const day = 86_400_000;
  if (ms < day)           return `${Math.max(1, Math.round(ms / 3_600_000))}h ago`;
  if (ms < 7 * day)       return `${Math.round(ms / day)}d ago`;
  if (ms < 30 * day)      return `${Math.round(ms / (7 * day))}w ago`;
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function qs({ range, customerId, teamMemberId } = {}) {
  const p = new URLSearchParams();
  if (range?.from) p.set('dateFrom', range.from);
  if (range?.to)   p.set('dateTo', range.to);
  if (customerId)   p.set('customerId', customerId);
  if (teamMemberId) p.set('teamMemberId', teamMemberId);
  const s = p.toString();
  return s ? `?${s}` : '';
}

async function getJson(apiFetch, path) {
  const res = await apiFetch(path, { method: 'GET' });
  if (!res.ok) {
    // Carry the transport's own words forward. `res.error` is where the
    // background worker puts the actionable text — "start the gcloud proxy",
    // "the extension was reloaded" — and throwing a bare status code here
    // discarded exactly the sentence that explains a blank dashboard.
    throw new Error(res.error || `Request failed: ${res.status}`);
  }
  return res.json;
}

// ---------------------------------------------------------------------------
// Tile renderers
// ---------------------------------------------------------------------------

function renderCritical(host, items, onOpen) {
  host.replaceChildren();
  if (!items || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ip-empty';
    empty.textContent = 'Nothing critical right now.';
    host.appendChild(empty);
    return;
  }

  // Each row shows a bar whose length is proportional to that thread's reply
  // count relative to the longest chain in the set, so the ranking (longest
  // reply chain first) is visible at a glance.
  const maxCount = Math.max(1, ...items.map((it) => it.messageCount || 0));

  const wrap = document.createElement('div');
  wrap.className = 'ip-critical__list';

  for (const it of items) {
    const count = it.messageCount || 0;
    const widthPct = Math.max(4, (count / maxCount) * 100);

    const row = document.createElement(it.emailId ? 'button' : 'div');
    row.className = 'ip-critical__row';
    if (it.emailId) {
      row.type = 'button';
      row.classList.add('ip-critical__row--link');
      row.title = 'Open in AI Analysis';
      row.addEventListener('click', () => onOpen?.(it.emailId));
    }

    const avatar = document.createElement('div');
    avatar.className = 'ip-avatar';
    avatar.dataset.color = String(paletteIndex(it.customerName));
    avatar.textContent = initials(it.customerName);

    const body = document.createElement('div');
    body.className = 'ip-critical__body';

    const meta = document.createElement('div');
    meta.className = 'ip-critical__meta';
    const name = document.createElement('span');
    name.className = 'ip-critical__name';
    name.textContent = it.customerName || '(unknown customer)';
    const dur  = document.createElement('span');
    dur.className = 'ip-critical__duration';
    dur.textContent = `${count} message${count === 1 ? '' : 's'}`;
    meta.append(name, dur);

    const subj = document.createElement('div');
    subj.className = 'ip-critical__subject';
    subj.textContent = it.subject || '(no subject)';
    subj.title = it.subject || '';

    const track = document.createElement('div');
    track.className = 'ip-critical__track';
    const bar = document.createElement('div');
    bar.className = 'ip-critical__bar';
    bar.style.left  = '0%';
    bar.style.width = `${widthPct}%`;
    track.appendChild(bar);

    const datesRow = document.createElement('div');
    datesRow.className = 'ip-critical__dates';
    const startSpan = document.createElement('span');
    startSpan.textContent = fmtDate(it.firstAt);
    const endSpan = document.createElement('span');
    endSpan.textContent = fmtDate(it.lastAt);
    datesRow.append(startSpan, endSpan);

    body.append(meta, subj, track, datesRow);
    row.append(avatar, body);
    wrap.appendChild(row);
  }

  host.appendChild(wrap);
}

function renderMostEscalated(host, items, onOpenCustomer) {
  host.replaceChildren();
  if (!items || items.length === 0) {
    const empty = document.createElement('li');
    empty.className = 'ip-empty';
    empty.textContent = 'No customer with >10 emails in this range.';
    host.appendChild(empty);
    return;
  }

  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'ip-most-escalated__row';
    // Whole row is clickable — opens the Customers tab on this customer's
    // detail view. We render the row as a <button> so keyboard nav works.
    const inner = document.createElement('button');
    inner.type = 'button';
    inner.className = 'ip-most-escalated__btn';
    inner.title = 'Open customer in Customers tab';

    const avatar = document.createElement('div');
    avatar.className = 'ip-avatar';
    avatar.dataset.color = String(paletteIndex(it.customerName));
    avatar.textContent = initials(it.customerName);

    const body = document.createElement('div');
    body.className = 'ip-most-escalated__body';
    const name = document.createElement('div');
    name.className = 'ip-most-escalated__name';
    name.textContent = it.customerName || '(unknown)';

    const stats = document.createElement('div');
    stats.className = 'ip-most-escalated__stats';
    stats.textContent = `${it.negative} of ${it.total} negative · ${Math.round(it.ratio * 100)}%`;

    const meter = document.createElement('div');
    meter.className = 'ip-meter';
    const bar = document.createElement('div');
    bar.className = 'ip-meter__bar';
    bar.style.width = `${Math.min(100, Math.round(it.ratio * 100))}%`;
    meter.appendChild(bar);

    body.append(name, stats, meter);
    inner.append(avatar, body);
    if (it.customerId) {
      inner.addEventListener('click', () => onOpenCustomer?.(it.customerId));
    } else {
      inner.disabled = true;
    }
    li.append(inner);
    host.appendChild(li);
  }
}

function renderChurnLevel(host, counts, onClickLevel) {
  host.replaceChildren();
  // Worst → least severe so the eye lands on the dangerous bucket first.
  const levels = [
    { key: 'critical', label: 'Critical' },
    { key: 'high',     label: 'High' },
    { key: 'medium',   label: 'Medium' },
    { key: 'low',      label: 'Low' },
  ];
  const total = levels.reduce((s, l) => s + (counts?.[l.key] || 0), 0);
  if (total === 0) {
    const empty = document.createElement('div');
    empty.className = 'ip-empty';
    empty.textContent = 'No churn signals in this date range.';
    host.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'ip-churn__list';
  const max = Math.max(...levels.map((l) => counts?.[l.key] || 0), 1);
  for (const lv of levels) {
    const n = counts?.[lv.key] || 0;
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'ip-churn__row';
    row.dataset.level = lv.key;
    row.title = `Open ${lv.label} churn threads in AI Analysis`;

    const label = document.createElement('span');
    label.className = 'ip-churn__label';
    label.dataset.level = lv.key;
    label.textContent = lv.label;

    const bar = document.createElement('span');
    bar.className = 'ip-churn__bar';
    bar.dataset.level = lv.key;
    const fill = document.createElement('span');
    fill.className = 'ip-churn__bar-fill';
    fill.style.width = `${Math.round((n / max) * 100)}%`;
    bar.appendChild(fill);

    const count = document.createElement('span');
    count.className = 'ip-churn__count';
    count.textContent = String(n);

    row.append(label, bar, count);
    row.addEventListener('click', () => onClickLevel?.(lv.key));
    list.appendChild(row);
  }
  host.appendChild(list);
}

// Aggregate histogram: yellow bars, with the longest-delay bucket (last column
// on the axis) in red so the worst-case tail stands out.
const AGG_HIST_COLORS = { main: '#eab308', highest: '#dc2626' };

// Per-member histogram palettes, applied in rank order (row 1 = highest median).
// Each member's bars use `main`; the longest-delay bucket (the bar at the end of
// the axis) switches to `highest`, so every row reads as a distinct two-tone
// identity and the worst-delay tail stands out instead of a wall of red.
const MEMBER_HIST_COLORS = [
  { main: '#9ca3af', highest: '#1f2937' }, // 1 · grey / black
  { main: '#ef4444', highest: '#7c2d12' }, // 2 · red / brown
  { main: '#eab308', highest: '#ea580c' }, // 3 · yellow / orange
  { main: '#22c55e', highest: '#38bdf8' }, // 4 · green / light blue
  { main: '#3b82f6', highest: '#7c3aed' }, // 5 · blue / violet
];

// Index of the last non-empty bucket in a count array (0 if all empty). Used to
// trim trailing empty buckets so the axis adapts to the data instead of always
// stretching to "4d+".
function lastPopulatedBucket(counts) {
  let idx = 0;
  for (let i = 0; i < counts.length; i++) if (counts[i] > 0) idx = i;
  return idx;
}

// Draw a vertical-bar histogram into `host`. Each bar's height is relative to
// the tallest bar SHOWN (so shape reads clearly even when one bucket dominates);
// hovering a bar reveals its label, count, and share. `visibleCount` clips the
// buckets to a shared range so several histograms line up column-for-column.
//
// `colors` ({ main, highest }) opts a bar set out of the default red scheme:
// bars paint `main`, and the bar at `highlightIndex` paints `highest` (used to
// mark each member's longest-delay bucket). Without `colors`, the default
// styling applies and the overflow bucket is tinted apart.
function renderHistogram(host, counts, labels, {
  showLabels = true, visibleCount = null, colors = null, highlightIndex = -1,
} = {}) {
  host.replaceChildren();
  const n = visibleCount == null ? counts.length : Math.min(visibleCount, counts.length);
  const shown = counts.slice(0, n);
  const maxCount = Math.max(1, ...shown);
  const total = counts.reduce((s, c) => s + c, 0) || 1;

  const chart = document.createElement('div');
  chart.className = 'ip-hist__chart';

  shown.forEach((c, i) => {
    const col = document.createElement('div');
    col.className = 'ip-hist__col';

    const barWrap = document.createElement('div');
    barWrap.className = 'ip-hist__barwrap';
    const pct = Math.round((c / total) * 100);
    barWrap.title = `${labels[i]}: ${c} response${c === 1 ? '' : 's'} (${pct}%)`;

    const bar = document.createElement('div');
    bar.className = 'ip-hist__bar';
    if (c === 0) {
      bar.classList.add('is-zero');
    } else if (colors) {
      // Per-member scheme: flat main color, "highest" color on the tallest bar.
      bar.style.background = i === highlightIndex ? colors.highest : colors.main;
    } else if (i === labels.length - 1) {
      // Overflow bucket (last label) reads as "everything past the axis"; tint
      // it apart so the long tail is honest rather than hidden.
      bar.classList.add('is-overflow');
    }
    bar.style.height = `${(c / maxCount) * 100}%`;
    barWrap.appendChild(bar);

    col.appendChild(barWrap);

    if (showLabels) {
      const lab = document.createElement('div');
      lab.className = 'ip-hist__label';
      lab.textContent = labels[i];
      col.appendChild(lab);
    }
    chart.appendChild(col);
  });

  host.appendChild(chart);
}

// Headline stats above the aggregate histogram: median first (the typical
// wait), mean second (skew-inflated), then the sample size.
function renderHistHeadline(el, overall) {
  if (!el) return;
  const n = overall?.count ?? 0;
  if (!n) {
    el.textContent = 'No responses in this range';
    return;
  }
  el.replaceChildren();
  const median = document.createElement('span');
  median.className = 'ip-hist__stat ip-hist__stat--primary';
  median.innerHTML = `median <strong>${fmtDuration(overall.medianDays)}</strong>`;
  const avg = document.createElement('span');
  avg.className = 'ip-hist__stat';
  avg.innerHTML = `mean <strong>${fmtDuration(overall.avgDays)}</strong>`;
  const count = document.createElement('span');
  count.className = 'ip-hist__stat ip-hist__stat--muted';
  count.textContent = `${n.toLocaleString()} response${n === 1 ? '' : 's'}`;
  el.append(median, avg, count);
}

// Up to five per-member histograms, ranked by median delay (server order),
// sharing one x-axis at the bottom so their shapes are directly comparable.
// Each row is clickable, jumping to AI Analysis filtered to that member's
// threads (any signal / status, matching what the delay metric measures).
function renderMemberHistograms(host, members, labels, visibleCount, onDrill) {
  host.replaceChildren();
  if (!members || members.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ip-empty';
    empty.textContent = 'No team member with >10 responses in this range.';
    host.appendChild(empty);
    return;
  }

  members.forEach((m, memberIndex) => {
    const colors = MEMBER_HIST_COLORS[memberIndex % MEMBER_HIST_COLORS.length];
    // The "highest" color marks the longest-delay bucket — the last column on
    // the shared axis. Empty there just stays transparent (no false tail).
    const highlightIndex = visibleCount - 1;

    const row = document.createElement(m.userId ? 'button' : 'div');
    row.className = 'ip-memberhist__row';
    if (m.userId) {
      row.type = 'button';
      row.classList.add('ip-memberhist__row--link');
      row.title = 'Open this member’s threads in AI Analysis';
      row.addEventListener('click', () => onDrill?.({
        signal: 'all',
        status: 'all',
        teamMemberId: String(m.userId),
        teamMemberName: m.name || '',
      }));
    }

    const avatar = document.createElement('div');
    avatar.className = 'ip-avatar';
    avatar.dataset.color = String(paletteIndex(m.name));
    avatar.textContent = initials(m.name);

    const meta = document.createElement('div');
    meta.className = 'ip-memberhist__meta';
    const name = document.createElement('span');
    name.className = 'ip-memberhist__name';
    name.textContent = m.name || '(unknown)';
    meta.append(name);

    // Email and the customer-team roles they served in (within scope) sit
    // directly under the name so each row is identifiable beyond first name.
    if (m.email) {
      const email = document.createElement('span');
      email.className = 'ip-memberhist__email';
      email.textContent = m.email;
      email.title = m.email;
      meta.append(email);
    }
    if (m.roles && m.roles.length) {
      const roles = document.createElement('span');
      roles.className = 'ip-memberhist__role';
      const text = m.roles.join(' · ');
      roles.textContent = text;
      roles.title = text;
      meta.append(roles);
    }

    const stat = document.createElement('span');
    stat.className = 'ip-memberhist__stat';
    stat.textContent = `median ${fmtDuration(m.medianDays)} · ${m.count} response${m.count === 1 ? '' : 's'} · max ${fmtDuration(m.maxDays)}`;
    meta.append(stat);

    const chartHost = document.createElement('div');
    chartHost.className = 'ip-memberhist__chart';
    renderHistogram(chartHost, m.histogram, labels, {
      showLabels: false, visibleCount, colors, highlightIndex,
    });

    row.append(avatar, meta, chartHost);
    host.appendChild(row);
  });

  // One shared x-axis under all the mini histograms. A leading spacer keeps the
  // labels aligned to the chart column (past the avatar + meta gutter).
  const axis = document.createElement('div');
  axis.className = 'ip-memberhist__axis';
  const spacer = document.createElement('div');
  spacer.className = 'ip-memberhist__axis-spacer';
  const labelRow = document.createElement('div');
  labelRow.className = 'ip-hist__chart ip-hist__chart--labels-only';
  for (let i = 0; i < visibleCount; i++) {
    const col = document.createElement('div');
    col.className = 'ip-hist__col';
    const lab = document.createElement('div');
    lab.className = 'ip-hist__label';
    lab.textContent = labels[i];
    col.appendChild(lab);
    labelRow.appendChild(col);
  }
  axis.append(spacer, labelRow);
  host.appendChild(axis);
}

function renderTat(host, rows) {
  host.replaceChildren();
  if (!rows || rows.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ip-empty';
    empty.textContent = 'No SLA breaches in this range.';
    host.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'ip-table ip-tat__table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Customer</th>
        <th class="num">1d+</th>
        <th class="num">2d+</th>
        <th class="num">3d+</th>
        <th class="num">5d+</th>
        <th class="num breach">6d+</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');
  for (const r of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="ip-tat__cust">${escapeHtml(r.customerName || '—')}</td>
      <td class="num">${r.onePlus || ''}</td>
      <td class="num">${r.twoPlus || ''}</td>
      <td class="num">${r.threePlus || ''}</td>
      <td class="num">${r.fivePlus || ''}</td>
      <td class="num breach">${r.sixPlus || ''}</td>
    `;
    tbody.appendChild(tr);
  }
  host.appendChild(table);
}

function renderRecent(host, items) {
  host.replaceChildren();
  if (!items || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'ip-empty';
    empty.textContent = 'No recent escalations in this range.';
    host.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'ip-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th>Customer</th>
        <th>Subject</th>
        <th>Created</th>
        <th>Assigned To</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');
  for (const it of items) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(it.customerName || '—')}</td>
      <td class="ellipsis" title="${escapeHtml(it.subject || '')}">${escapeHtml(it.subject || '')}</td>
      <td class="muted">${fmtRelative(it.createdAt)}</td>
      <td>${escapeHtml(it.assignedToName || 'Unassigned')}</td>
    `;
    tbody.appendChild(tr);
  }
  host.appendChild(table);
}

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// ---------------------------------------------------------------------------
// Chart builders
// ---------------------------------------------------------------------------

// Positive = green, Negative = red. Each dataset carries a `signal` value so a
// click on the line or its legend key knows which AI Analysis filter to open.
const SENTIMENT_SHARE_SERIES = [
  { label: 'Positive', key: 'positive', signal: 'positive', color: '#22c55e' },
  { label: 'Negative', key: 'negative', signal: 'negative', color: '#ef4444' },
];

// Single line chart of the positive/negative share of all emails over the last
// six months. Neutral is deliberately excluded (it swamps everything), so the
// values live in the low single-digit percents and we keep one decimal.
// Clicking a line point or a legend key drills into AI Analysis, filtered to
// that sentiment. `onDrill` receives `{ signal }`.
function buildSentimentShareChart(canvas, rows, onDrill) {
  const labels = rows.map((r) => {
    const [y, m] = r.month.split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleString(undefined, { month: 'short' });
  });
  const datasets = SENTIMENT_SHARE_SERIES.map((s) => ({
    label: s.label,
    signal: s.signal,
    data: rows.map((r) => r[s.key]),
    borderColor: s.color,
    backgroundColor: s.color,
    pointRadius: 2.5,
    pointHoverRadius: 5,
    borderWidth: 2,
    fill: false,
    tension: 0.3,
  }));

  const drill = (datasetIndex) => {
    const signal = datasets[datasetIndex]?.signal;
    if (signal) onDrill?.({ signal });
  };

  return new Chart(canvas, {
    type: 'line',
    data: { labels, datasets },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false },
      // Click a point/line to drill into that sentiment in AI Analysis.
      onClick: (evt, _els, chart) => {
        const hits = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: false }, true);
        if (hits && hits.length) drill(hits[0].datasetIndex);
      },
      onHover: (evt, _els, chart) => {
        const hits = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: false }, true);
        chart.canvas.style.cursor = hits && hits.length ? 'pointer' : 'default';
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#5f6368' } },
        y: {
          beginAtZero: true,
          grid: { color: '#eef0f3' },
          ticks: { color: '#5f6368', callback: (v) => `${v}%` },
          title: { display: true, text: '% of all emails', color: '#5f6368' },
        },
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, padding: 18 },
          // Override the default show/hide toggle: the key is a drill-in control.
          onClick: (_e, item) => drill(item.datasetIndex),
        },
        tooltip: {
          callbacks: { label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%` },
        },
      },
    },
  });
}

// ---------------------------------------------------------------------------
// Mount
// ---------------------------------------------------------------------------

export function mountDashboard(root, { apiFetch, initialFilters, onOpenInAiAnalysis, onDrillIntoAiAnalysis, onOpenCustomer, onResetGlobalFilters }) {
  root.classList.add('ip-dashboard-host');
  root.innerHTML = DASHBOARD_TEMPLATE;

  const $ = (name) => root.querySelector(`[data-el="${name}"]`);
  const els = {
    kpiCustomers:        $('kpi-customers'),
    kpiEmails:           $('kpi-emails'),
    kpiEscalations:      $('kpi-escalations'),
    kpiOpportunities:    $('kpi-opportunities'),
    kpiEscalationsCard:  $('kpi-card-escalations'),
    kpiOpportunitiesCard:$('kpi-card-opportunities'),

    criticalBody:        $('critical-body'),
    mostEscalatedBody:   $('most-escalated-body'),
    churnBody:           $('churn-body'),

    aggHistHeadline:       $('agg-hist-headline'),
    aggHistBody:           $('agg-hist-body'),
    memberHistsBody:       $('member-hists-body'),

    sentimentShareCanvas: $('chart-sentiment-share'),

    tatBody:    $('tat-body'),
    recentBody: $('recent-body'),
  };

  let range = { ...(initialFilters?.dateRange || {}) };
  let customerId   = initialFilters?.customerId   || '';
  let teamMemberId = initialFilters?.teamMemberId || '';
  const charts = {};

  function scope() {
    return { range, customerId, teamMemberId };
  }

  function destroyChart(key) {
    if (charts[key]) {
      charts[key].destroy();
      charts[key] = null;
    }
  }

  /**
   * Surface a load failure in the panel instead of only in the console.
   *
   * Every loader below catches and logs, which meant a dashboard that could not
   * reach its API rendered as empty tiles with no explanation — indistinguishable
   * from a tenant that genuinely has no data. The overwhelmingly common cause is
   * the local `gcloud run services proxy` not running, and the transport already
   * says so; it just had nowhere to say it.
   */
  function showLoadError(message) {
    let banner = root.querySelector('[data-el="load-error"]');
    if (!banner) {
      banner = document.createElement('div');
      banner.className = 'ip-load-error';
      banner.setAttribute('data-el', 'load-error');
      root.prepend(banner);
    }
    banner.textContent = message;
    banner.hidden = false;
  }

  function clearLoadError() {
    const banner = root.querySelector('[data-el="load-error"]');
    if (banner) banner.hidden = true;
  }

  async function loadKpis() {
    try {
      const data = await getJson(apiFetch, `/api/dashboard/summary${qs(scope())}`);
      els.kpiCustomers.textContent     = fmt(data.customers);
      els.kpiEmails.textContent        = fmt(data.emails);
      els.kpiEscalations.textContent   = fmt(data.activeEscalations);
      els.kpiOpportunities.textContent = fmt(data.upsellOpportunities);
      clearLoadError();
    } catch (err) {
      console.error('[ip] kpi load failed', err);
      // The KPI row is the first thing to load and depends on nothing else, so
      // its failure is the reliable signal that the whole dashboard is blind.
      showLoadError(err instanceof Error ? err.message : 'Failed to load dashboard data.');
    }
  }

  // Positive/negative sentiment share over the trailing 6 months. The endpoint
  // ignores the date/customer/team filters by design, so this loads once and
  // isn't part of the filter-driven refresh set.
  async function loadSentimentShare() {
    try {
      const rows = await getJson(apiFetch, '/api/dashboard/sentiment-trend');
      destroyChart('sentimentShare');
      charts.sentimentShare = buildSentimentShareChart(
        els.sentimentShareCanvas, rows,
        (f) => onDrillIntoAiAnalysis?.(f),
      );
    } catch (err) { console.error('[ip] sentiment share load failed', err); }
  }

  async function loadTat() {
    try {
      const rows = await getJson(apiFetch, `/api/dashboard/tat-metrics${qs(scope())}`);
      renderTat(els.tatBody, rows);
    } catch (err) { console.error('[ip] tat load failed', err); }
  }

  async function loadRecent() {
    try {
      const rows = await getJson(apiFetch, `/api/dashboard/recent-escalations${qs(scope())}`);
      renderRecent(els.recentBody, rows);
    } catch (err) { console.error('[ip] recent escalations load failed', err); }
  }

  async function loadMostEscalated() {
    try {
      const rows = await getJson(apiFetch, `/api/dashboard/most-escalated-customers${qs(scope())}`);
      renderMostEscalated(els.mostEscalatedBody, rows, onOpenCustomer);
    } catch (err) { console.error('[ip] most-escalated load failed', err); }
  }

  async function loadImportant() {
    try {
      const rows = await getJson(apiFetch, `/api/dashboard/important-escalations${qs(scope())}`);
      renderCritical(els.criticalBody, rows, onOpenInAiAnalysis);
    } catch (err) { console.error('[ip] important escalations load failed', err); }
  }

  async function loadChurnLevels() {
    try {
      const counts = await getJson(apiFetch, `/api/dashboard/churn-levels${qs(scope())}`);
      renderChurnLevel(els.churnBody, counts, (level) => {
        onDrillIntoAiAnalysis?.({ churnLevel: level });
      });
    } catch (err) { console.error('[ip] churn levels load failed', err); }
  }

  // Both reply-time tiles (the aggregate distribution and the per-member
  // breakdown) come from one endpoint / one DB scan, so a single fetch fills
  // both. The two histograms share one visible bucket range — the widest span
  // any of them actually populates — so their shapes line up column-for-column.
  async function loadTeamResponsiveness() {
    try {
      const data = await getJson(apiFetch, `/api/dashboard/team-responsiveness${qs(scope())}`);
      const labels = data.histogram?.labels || [];
      const aggCounts = data.histogram?.counts || [];
      const members = data.members || [];

      let maxBucket = lastPopulatedBucket(aggCounts);
      for (const m of members) maxBucket = Math.max(maxBucket, lastPopulatedBucket(m.histogram || []));
      // Always show a recognizable axis (at least through "8h–1d"), capped at
      // the real bucket count, even when the data clusters into a few buckets.
      const visibleCount = Math.min(labels.length, Math.max(maxBucket + 1, 7));

      renderHistHeadline(els.aggHistHeadline, data.overall);
      renderHistogram(els.aggHistBody, aggCounts, labels, {
        showLabels: true, visibleCount,
        colors: AGG_HIST_COLORS, highlightIndex: visibleCount - 1,
      });
      renderMemberHistograms(els.memberHistsBody, members, labels, visibleCount, onDrillIntoAiAnalysis);
    } catch (err) { console.error('[ip] team responsiveness load failed', err); }
  }

  function loadAll() {
    loadKpis();
    loadSentimentShare();
    loadTat();
    loadRecent();
    loadMostEscalated();
    loadImportant();
    loadChurnLevels();
    loadTeamResponsiveness();
  }

  // KPI drill-ins: clicking the escalations / opportunities tiles jumps to
  // the AI Analysis list with the right signal+status pre-applied. The
  // global date range stays as-is (set by the shell topbar).
  els.kpiEscalationsCard.addEventListener('click', () => {
    onDrillIntoAiAnalysis?.({ signal: 'negative', status: 'open' });
  });
  els.kpiOpportunitiesCard.addEventListener('click', () => {
    onDrillIntoAiAnalysis?.({ signal: 'upsell', status: 'open' });
  });

  loadAll();

  return {
    setFilters({ dateRange, customerId: cid, teamMemberId: tid }) {
      range = { ...(dateRange || {}) };
      customerId   = cid || '';
      teamMemberId = tid || '';
      // Important escalations and churn levels now respect the global
      // filter too, so reload them along with everything else. The sentiment
      // share trend is filter-independent (always trailing 6 months), so it
      // isn't reloaded here.
      loadKpis();
      loadTat();
      loadRecent();
      loadMostEscalated();
      loadImportant();
      loadChurnLevels();
      loadTeamResponsiveness();
    },
  };
}
