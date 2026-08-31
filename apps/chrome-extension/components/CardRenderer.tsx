/**
 * Renders Google Cards-v2 JSON from the Workspace add-on as React.
 *
 * Scope is deliberately the vocabulary the add-on actually emits, measured
 * against both live endpoints rather than guessed from Google's spec:
 *
 *   widget types  : image, textParagraph, decoratedText, buttonList, divider
 *   decoratedText : startIcon, topLabel, text, bottomLabel, wrapText, button,
 *                   onClick
 *   section keys  : header, widgets
 *
 * Anything outside that renders as nothing rather than throwing — a card that
 * grows a new widget type should lose one row, not blank the panel.
 *
 * NOTE ON HEADERS. Most section titles do NOT arrive as `section.header`.
 * `fold()` in apps/addon/src/cards/widgets.ts collapses related sections into
 * one so Gmail draws a single hairline instead of six, and the folded titles
 * survive as `textParagraph` widgets containing only `<b>…</b>`. Measured
 * against /homepage: 2 sections, 1 real header, 5 folded ones. So a bold-only
 * paragraph must read as a heading, which it does — bold at body size is exactly
 * what Cards v2 renders, there being no font-size control anywhere in the format.
 */

import { useMemo } from 'react';
import {
  Bookmark, Clock, FileText, Mail, Star, User, Ticket, Circle,
  type LucideIcon,
} from 'lucide-react';
import {
  openQaNotice,
  type CardButton,
  type CardSection,
  type CardWidget,
  type ChartSpec,
} from '../lib/addon-client';
import { SEVERITY_RAMP, boundaries, arcPath } from '../lib/donut-arc';

/**
 * Google's knownIcon names mapped to the Lucide set the sidebar already uses.
 * Unmapped names fall back to a dot, which keeps the row's left gutter aligned
 * with its neighbours instead of collapsing it.
 */
const KNOWN_ICONS: Record<string, LucideIcon> = {
  CLOCK: Clock,
  DESCRIPTION: FileText,
  EMAIL: Mail,
  PERSON: User,
  STAR: Star,
  BOOKMARK: Bookmark,
  TICKET: Ticket,
};

/**
 * Where a card link is allowed to actually go.
 *
 * This build reads a CLONE, so every link out to the web console is redirected
 * to the "This app is QA only." page. Gmail's own deep links are exempt: they
 * open the reader's own conversation, which is what makes the panel behave like
 * the add-on and touches no system of record.
 *
 * FAILS CLOSED. An unparseable URL is treated as a console link, because the
 * question being answered is "may this navigate somewhere real", and "I could
 * not tell" is not a yes.
 *
 * Done here rather than by pointing the add-on's WEB_URL at a stub, because
 * WEB_URL does not govern every link: homepage.ts:880 hardcodes
 * https://emailsentiment.mystartupcfo.com for "Open web dashboard", and that
 * host is not even the current production web app. Intercepting at the render
 * boundary catches every link regardless of how the card built it.
 */
export function isGmailLink(url: string): boolean {
  try {
    return new URL(url).hostname === 'mail.google.com';
  } catch {
    return false;
  }
}

/**
 * The add-on's one and only image widget is a solid-colour band —
 * `/bar.png?c=<hex>&h=<px>` from apps/addon/src/assets/bar.ts, a PNG of a
 * rectangle because Cards v2 gives an image widget and no other way to paint.
 *
 * Rendered as CSS instead of an <img> for two reasons: Gmail's page CSP governs
 * the content script and would very likely refuse an http://localhost image, and
 * a div is exactly as faithful — every pixel of the source is the same colour.
 */
export function bandFrom(imageUrl: string): { color: string; height: number } | null {
  try {
    const u = new URL(imageUrl);
    if (!u.pathname.endsWith('/bar.png')) return null;
    const hex = (u.searchParams.get('c') ?? '').replace(/[^0-9a-fA-F]/g, '').slice(0, 6);
    if (hex.length !== 3 && hex.length !== 6) return null;
    const h = Number(u.searchParams.get('h') ?? 6);
    return { color: `#${hex}`, height: Math.min(24, Math.max(2, h || 6)) };
  } catch {
    return null;
  }
}

/**
 * Card text carries a little inline HTML — `<b>`, `<i>`, `<br>` and
 * `<font color="#rrggbb">` are all emitted by apps/addon/src/cards. The colours
 * are semantic (red for a breach, green for an improvement), so dropping them
 * would change what the card communicates, not just how it looks.
 *
 * Card text also interpolates database values — customer and employee names —
 * so it is not trustworthy input. Escape the string completely, then restore
 * only that exact tag list. Anything else, including a `<script>` smuggled in
 * via a customer name, stays inert escaped text.
 *
 * ESCAPE THE QUOTE. It is not optional and its absence is not cosmetic: the
 * restore pattern below matches `&quot;`, so leaving `"` unescaped meant
 * `<font color="#c5221f">` escaped to `&lt;font color="#c5221f"&gt;` — with a
 * literal quote — and no longer matched anything. Every colour tag then rendered
 * as visible text, on 21 of the 63 strings the homepage card emits, while `</font>`
 * (which carries no attribute) WAS restored and left a stray closing tag behind.
 * Escaping `"` is also simply correct on its own: a customer named
 * `Acme "Quoted" Ltd` otherwise puts a bare quote into the output.
 */
export function sanitizeCardHtml(raw: string): string {
  const escaped = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Only these become real elements. An attribute the pattern does not describe
  // — `onmouseover`, a `javascript:` colour — simply fails to match and stays
  // escaped, so the whitelist is enforced by the shape of the tag, not by
  // scrubbing bad values out of it.
  //
  // No single-quote branch: the add-on emits double quotes (measured across the
  // live card), and after the escape above a `'` is untouched while `"` is not,
  // so a single-quoted attribute could never round-trip anyway.
  return escaped
    .replace(/&lt;(\/?)(b|i|u|br)&gt;/g, '<$1$2>')
    .replace(/&lt;font color=&quot;(#[0-9a-fA-F]{3,6})&quot;&gt;/g, '<font color="$1">')
    .replace(/&lt;\/font&gt;/g, '</font>');
}

function CardText({ html, className }: { html: string; className?: string }): React.ReactElement {
  const __html = useMemo(() => sanitizeCardHtml(html), [html]);
  return <span className={className} dangerouslySetInnerHTML={{ __html }} />;
}

/** True when a paragraph is nothing but a bold run — i.e. a folded section title. */
export function isHeadingParagraph(t: string): boolean {
  return /^\s*<b>[\s\S]*<\/b>\s*$/.test(t) && !/<\/b>[\s\S]*<b>/.test(t);
}

/**
 * Cards-v2 delivers action parameters as a [{key, value}] list; the add-on reads
 * them as a flat map (`commonEventObject.parameters`). Convert once, here, so
 * the two callers of onAction cannot disagree about the shape.
 */
function paramsOf(
  list: Array<{ key?: string; value?: string }> | undefined,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of list ?? []) {
    if (typeof p?.key === 'string' && typeof p.value === 'string') out[p.key] = p.value;
  }
  return out;
}

function ActionButton({
  button,
  onAction,
}: {
  button: CardButton;
  onAction?: (fnUrl: string, parameters?: Record<string, string>) => void;
}): React.ReactElement | null {
  const label = button.text;
  if (!label) return null;

  const url = button.onClick?.openLink?.url;
  const fn = button.onClick?.action?.function;

  if (url) {
    return isGmailLink(url) ? (
      <a href={url} target="_blank" rel="noopener noreferrer" className="ipc__btn">
        {label}
      </a>
    ) : (
      <button type="button" className="ipc__btn" onClick={openQaNotice}>
        {label}
      </button>
    );
  }
  if (fn && onAction) {
    return (
      <button
        type="button"
        className="ipc__btn"
        onClick={() => onAction(fn, paramsOf(button.onClick?.action?.parameters))}
      >
        {label}
      </button>
    );
  }
  // A button with neither a link nor a handler is dead; render it disabled
  // rather than as something that looks clickable and silently does nothing.
  return (
    <span className="ipc__btn ipc__btn--dead" aria-disabled>
      {label}
    </span>
  );
}

function Widget({
  widget,
  onAction,
}: {
  widget: CardWidget;
  onAction?: (fnUrl: string, parameters?: Record<string, string>) => void;
}): React.ReactElement | null {
  if (widget.divider) {
    return <div className="ipc__divider" />;
  }

  if (widget.textParagraph?.text !== undefined) {
    const t = widget.textParagraph.text;
    // The add-on uses a non-breaking space as a vertical spacer between blocks
    // (see spacer() in widgets.ts — Cards v2 has no margin or padding of any
    // kind). Rendered as text it collapses; render it as the gap it means.
    if (t.trim() === '') return <div className="ipc__spacer" />;
    return isHeadingParagraph(t) ? (
      <h2 className="ipc__header">
        <CardText html={t} />
      </h2>
    ) : (
      <p className="ipc__para">
        <CardText html={t} />
      </p>
    );
  }

  if (widget.image?.imageUrl) {
    const band = bandFrom(widget.image.imageUrl);
    if (band) {
      return (
        <div
          className="ipc__band"
          style={{ background: band.color, height: band.height }}
          role="presentation"
        />
      );
    }
    return (
      <img
        src={widget.image.imageUrl}
        alt={widget.image.altText ?? ''}
        className="ipc__image"
      />
    );
  }

  if (widget.buttonList?.buttons?.length) {
    return (
      <div className="ipc__btnrow">
        {widget.buttonList.buttons.map((b, i) => (
          <ActionButton key={i} button={b} onAction={onAction} />
        ))}
      </div>
    );
  }

  const d = widget.decoratedText;
  if (d) {
    const Icon = d.startIcon?.knownIcon
      ? (KNOWN_ICONS[d.startIcon.knownIcon] ?? Circle)
      : null;

    // The whole row is the link. Every "Where the fires are" row uses this
    // rather than an accessory button — six identical "Open" pills in a 400px
    // column is decoration, and decoratedText.onClick reaches the same place.
    const rowUrl = d.onClick?.openLink?.url;
    const rowFn = d.onClick?.action?.function;
    const clickable = Boolean(rowUrl || (rowFn && onAction));
    const onRowClick = rowUrl
      ? isGmailLink(rowUrl)
        ? () => window.open(rowUrl, '_blank', 'noopener,noreferrer')
        : openQaNotice
      : rowFn && onAction
        ? () => onAction(rowFn, paramsOf(d.onClick?.action?.parameters))
        : undefined;

    const body = (
      <>
        {Icon && <Icon size={18} className="ipc__icon" aria-hidden />}
        <div className="ipc__body">
          {d.topLabel && (
            <div className="ipc__top">
              <CardText html={d.topLabel} />
            </div>
          )}
          {d.text && (
            <div className={`ipc__text${d.wrapText ? '' : ' ipc__text--truncate'}`}>
              <CardText html={d.text} />
            </div>
          )}
          {d.bottomLabel && (
            <div className="ipc__bot">
              <CardText html={d.bottomLabel} />
            </div>
          )}
        </div>
        {d.button && (
          <div className="ipc__accessory">
            <ActionButton button={d.button} onAction={onAction} />
          </div>
        )}
      </>
    );

    // A clickable row is a button, not a div with a handler: it has to be
    // reachable by keyboard, and the accessory inside it must not be nested in
    // another button. Hence the wrapper stays a div and only the text column
    // carries the interaction.
    return clickable ? (
      <div
        className="ipc__row ipc__row--click"
        role="button"
        tabIndex={0}
        onClick={onRowClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onRowClick?.();
          }
        }}
      >
        {body}
      </div>
    ) : (
      <div className="ipc__row">{body}</div>
    );
  }

  return null;
}

/* ---- charts -------------------------------------------------------------- */

/**
 * The add-on's chart, drawn properly.
 *
 * The card already contains this chart as a run of block characters, because
 * that is the only thing Cards v2 can draw (ADR-005: no chart widget, no
 * sizing, no positioning). Here we have real pixels, so the same spec is drawn
 * as SVG — and the one thing that buys, which block characters genuinely
 * cannot, is a BASELINE THAT CROSSES THE BARS. Lift against a reference is the
 * whole point of a rate chart, and in the card the baseline can only be another
 * left-anchored run the reader compares by eye.
 *
 * This decides nothing. `chartable`, the baseline value and per-row
 * `belowFloor` are the add-on's verdicts and are obeyed, not recomputed —
 * ADR-031, and the reason a second implementation of a decision is the bug this
 * codebase keeps rediscovering. Nothing here divides two numbers.
 *
 * NOT AN <img> AND NOT A FETCH. ADR-004 deleted a server-side rasterizer whose
 * real failure was an unauthenticated URL carrying per-customer sentiment in its
 * query string. Inline SVG from data already in the response has neither
 * property, and Gmail's page CSP governs this content script besides.
 */

/** Gmail's palette, matching assets/card.css. Red means one thing on this card. */
const CHART_FIRE = '#d93025';
const CHART_MUTED = '#5f6368';

/** Viewport width in SVG units. 1:1 with CSS pixels in a 400px panel at 16px padding. */
const VW = 368;
const ROW_H = 34;
const BAR_H = 8;

/** Mirrors `plottedRole` in the add-on's chart.ts, including the order. */
function plottedRole(spec: ChartSpec): 'share' | 'rate' | 'count' | null {
  const roles = new Set(spec.columns.map((c) => c.role));
  if (roles.has('share')) return 'share';
  if (roles.has('rate')) return 'rate';
  if (roles.has('count')) return 'count';
  return null;
}

/** Thousands separators without a locale — the add-on formats identically. */
function thousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function ChartFigure({ spec }: { spec: ChartSpec }): React.ReactElement {
  const role = plottedRole(spec);

  const rows = spec.rows.map((r) => {
    const v = role === 'share' ? r.share : role === 'rate' ? r.rate : role === 'count' ? r.count : null;
    return {
      label: r.label,
      value: typeof v === 'number' && Number.isFinite(v) ? v : null,
      sampleN: r.sampleN,
      note: r.note,
      muted: r.belowFloor === true,
    };
  });

  const format = (v: number): string => {
    if (role === 'count') return thousands(v);
    // A non-zero slice must never print as 0.0% — same rule as the add-on's.
    if (v > 0 && v < 0.05) return '<0.1%';
    return `${v.toFixed(1)}%`;
  };

  // Scale includes the baseline: a reference above every bar would otherwise sit
  // off the right edge and the reader would see bars with no reference at all.
  const max = Math.max(
    ...rows.map((r) => r.value ?? 0),
    role === 'rate' ? (spec.baseRate?.value ?? 0) : 0,
    0,
  );

  const caveats = [
    ...(spec.window?.blindTail ? [spec.window.blindTail] : []),
    ...(spec.caveats ?? []),
  ];

  // NOT CHARTABLE MEANS NO BARS, and the same refusal the add-on renders. A
  // ranking somebody was told not to act on must not acquire a length the eye
  // can compare — least of all here, where we have the pixels to make it look
  // authoritative.
  if (!spec.chartable) {
    return (
      <figure className="ipc__chart">
        <h2 className="ipc__header">{spec.title}</h2>
        <p className="ipc__chart-refusal">
          <strong>Not charted.</strong>{' '}
          {spec.verdict ?? 'The measurement does not support a chart.'}
        </p>
        {rows.map((r, i) => (
          <div key={i} className="ipc__chart-plainrow">
            <span>{r.label}</span>
            <span className="ipc__chart-num">
              {r.value === null ? '—' : format(r.value)}
              {typeof r.sampleN === 'number' ? ` · n=${r.sampleN}` : ''}
              {r.note ? ` · ${r.note}` : ''}
            </span>
          </div>
        ))}
        <ChartNotes lines={caveats} />
      </figure>
    );
  }

  if (role === null || rows.length === 0) {
    // An empty result is a finding. An empty frame with axes would claim we
    // looked and found nothing, which is a different sentence.
    return (
      <figure className="ipc__chart">
        <h2 className="ipc__header">{spec.title}</h2>
        <p className="ipc__chart-empty">No rows to chart for this question.</p>
        <ChartNotes lines={caveats} />
      </figure>
    );
  }

  // THE SHAPE DISPATCH SITS EXACTLY WHERE IT SITS IN buildChart — after the
  // refusal and after the empty gate, before anything that ranks. Same order in
  // both files, or the two renderings print different sentences for the same
  // spec, which is the drift this pair of modules exists to prevent.
  if (spec.kind === 'donut') return <DonutFigure spec={spec} caveats={caveats} />;

  // A row grows a line when it carries a second figure. Right-aligning the note
  // onto the value line instead would run it into the client name — names here
  // reach "Ctruh Technologies Private Limited" — and a collided label is worse
  // than a taller row.
  const hasNotes = rows.some((r) => Boolean(r.note));
  const rowH = hasNotes ? ROW_H + 12 : ROW_H;
  const height = rows.length * rowH;
  const baselineX =
    role === 'rate' && spec.baseRate && max > 0 ? (spec.baseRate.value / max) * VW : null;

  return (
    <figure className="ipc__chart">
      <h2 className="ipc__header">{spec.title}</h2>

      {/* chart-metric §3: a count with no rate ranks how much mail a client
          sends. The busiest client tops it whether or not anything is wrong,
          which is the commonest way a true number becomes a false picture. */}
      {role === 'count' && (
        <p className="ipc__chart-note">
          Ranked by volume — no rate was supplied, so a busy client outranks a
          troubled one.
        </p>
      )}

      <svg
        className="ipc__chart-svg"
        viewBox={`0 0 ${VW} ${height}`}
        width="100%"
        height={height}
        preserveAspectRatio="xMinYMin meet"
        role="img"
        aria-label={`${spec.title}. ${rows
          .filter((r) => r.value !== null)
          .map((r) => `${r.label} ${format(r.value as number)}`)
          .join(', ')}.`}
      >
        {rows.map((r, i) => {
          const y = i * rowH;
          const w = r.value === null || max <= 0 ? 0 : Math.max(1, (r.value / max) * VW);
          return (
            <g key={i}>
              <text x={0} y={y + 11} className="ipc__chart-label">
                {r.label}
                {r.muted ? ' · below floor' : ''}
              </text>
              <text x={VW} y={y + 11} textAnchor="end" className="ipc__chart-value">
                {r.value === null ? 'not measured' : format(r.value)}
                {typeof r.sampleN === 'number' ? ` · n=${r.sampleN}` : ''}
              </text>
              {r.note && (
                <text x={0} y={y + 34} className="ipc__chart-value">
                  {r.note}
                </text>
              )}
              {/* A below-floor row is present and visibly not a peer: a median
                  over two threads is an anecdote with a decimal point, and at
                  bar length alone it is identical to one over two hundred. */}
              <rect
                x={0}
                y={y + 16}
                width={w}
                height={BAR_H}
                rx={1}
                fill={r.muted ? CHART_MUTED : CHART_FIRE}
                fillOpacity={r.muted ? 0.35 : 1}
              />
            </g>
          );
        })}

        {/* THE REASON THIS RENDERER EXISTS. A reference the bars actually cross,
            which the card's block-character version can only approximate with a
            fourth left-anchored run. */}
        {baselineX !== null && (
          <line
            x1={baselineX}
            x2={baselineX}
            y1={0}
            y2={height}
            stroke={CHART_MUTED}
            strokeWidth={1}
            strokeDasharray="3 2"
          />
        )}
      </svg>

      {baselineX !== null && spec.baseRate && (
        <p className="ipc__chart-note">
          Dashed line: {spec.baseRate.label} ({spec.baseRate.value.toFixed(1)}%)
        </p>
      )}

      <ChartNotes lines={caveats} />
    </figure>
  );
}

/** Ring geometry. Outer 56, thickness 22 → inner 34, mid 45; box 2R + padding. */
const DONUT_R = 56;
const DONUT_T = 22;
const DONUT_BOX = 128;

/**
 * A share of a whole, drawn as a ring.
 *
 * The card carries this same composition as a segmented run of block characters,
 * which is a real rendering — this one is not a rescue, it is the same numbers
 * with angles instead of glyph counts. What the ring buys over the run is that a
 * part-of-whole is legible AS a whole: the reader sees a closed circle divided,
 * rather than a line they have to be told adds up to everything.
 *
 * DIVIDES NOTHING. Shares come from `spec.rows[].share`, counts from `count`, the
 * whole from `spec.denominator` — all decided by the add-on (ADR-031). The only
 * arithmetic is `boundaries()` normalising one column into angles, and even that
 * exists because the add-on rounds shares to one decimal and four slices routinely
 * sum to 99.9.
 */
function DonutFigure({
  spec,
  caveats,
}: {
  spec: ChartSpec;
  caveats: string[];
}): React.ReactElement {
  const slices = spec.rows.map((r, i) => ({
    label: r.label,
    colour: SEVERITY_RAMP[i % SEVERITY_RAMP.length],
    share: typeof r.share === 'number' && Number.isFinite(r.share) && r.share > 0 ? r.share : 0,
    measured: typeof r.share === 'number' && Number.isFinite(r.share),
    count: typeof r.count === 'number' && Number.isFinite(r.count) ? r.count : null,
    note: r.note,
  }));

  const countLabel = spec.columns.find((c) => c.role === 'count')?.label ?? '';
  const pct = (v: number): string => (v > 0 && v < 0.05 ? '<0.1%' : `${v.toFixed(1)}%`);
  const total = slices.reduce((a, s) => a + s.share, 0);

  const denom = spec.denominator;
  const denomLine = denom
    ? `n=${thousands(denom.value)} ${denom.label}` +
      (denom.of ? ` of ${thousands(denom.of.value)} ${denom.of.label}` : '')
    : null;

  // More parts than the ramp can colour apart is a refusal in the card, and it
  // must be one here too — cycling the palette would make the legend the only way
  // to tell two slices apart, which is a table with a stripe on it.
  if (spec.rows.length > SEVERITY_RAMP.length) {
    return (
      <figure className="ipc__chart">
        <h2 className="ipc__header">{spec.title}</h2>
        <p className="ipc__chart-refusal">
          <strong>Not charted.</strong> A share of a whole with {spec.rows.length} parts does not
          read in this column; {SEVERITY_RAMP.length} is the most this card can colour apart.
        </p>
        <ChartNotes lines={caveats} />
      </figure>
    );
  }

  if (total <= 0) {
    return (
      <figure className="ipc__chart">
        <h2 className="ipc__header">{spec.title}</h2>
        {denomLine && <p className="ipc__chart-denominator">{denomLine}</p>}
        <p className="ipc__chart-empty">
          Nothing was flagged in this window, so there is no share to divide.
        </p>
        <ChartNotes lines={caveats} />
      </figure>
    );
  }

  const c = DONUT_BOX / 2;
  const rMid = DONUT_R - DONUT_T / 2;
  const edges = boundaries(slices.map((s) => s.share));

  return (
    <figure className="ipc__chart">
      <h2 className="ipc__header">{spec.title}</h2>
      {denomLine && <p className="ipc__chart-denominator">{denomLine}</p>}

      <div className="ipc__donut">
        <svg
          className="ipc__donut-svg"
          viewBox={`0 0 ${DONUT_BOX} ${DONUT_BOX}`}
          width={DONUT_BOX}
          height={DONUT_BOX}
          role="img"
          // Every slice named with its percent and count. A screen reader gets the
          // legend's content, not "chart" — and the order it hears is the severity
          // order the ring is drawn in.
          aria-label={`${spec.title}. ${slices
            .map(
              (s) =>
                `${s.label} ${s.measured ? pct(s.share) : 'not measured'}` +
                (s.count === null ? '' : ` (${thousands(s.count)})`),
            )
            .join(', ')}.`}
        >
          {slices.map((s, i) => {
            const d = arcPath(c, c, rMid, edges[i][0], edges[i][1]);
            if (d === null) return null;
            return d === 'circle' ? (
              <circle
                key={i}
                cx={c}
                cy={c}
                r={rMid}
                fill="none"
                stroke={s.colour}
                strokeWidth={DONUT_T}
              />
            ) : (
              <path
                key={i}
                d={d}
                fill="none"
                stroke={s.colour}
                strokeWidth={DONUT_T}
                strokeLinecap="butt"
              />
            );
          })}

          {/* The whole, in the hole. Same field the line above prints, so the two
              numbers on this figure cannot disagree. */}
          {denom && (
            <>
              <text x={c} y={c - 2} textAnchor="middle" className="ipc__donut-hole">
                {thousands(denom.value)}
              </text>
              <text x={c} y={c + 14} textAnchor="middle" className="ipc__donut-holelabel">
                {denom.label}
              </text>
            </>
          )}
        </svg>

        <ul className="ipc__donut-legend">
          {slices.map((s, i) => (
            <li key={i} className="ipc__donut-row">
              <span className="ipc__donut-swatch" style={{ background: s.colour }} />
              <span>{s.label}</span>
              <span className="ipc__donut-pct">{s.measured ? pct(s.share) : 'not measured'}</span>
              {s.count !== null && (
                <span className="ipc__donut-n">
                  {thousands(s.count)}
                  {countLabel ? ` ${countLabel.toLowerCase()}` : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <ChartNotes lines={caveats} />
    </figure>
  );
}

/** Caveats, below the chart and never collapsed — one the reader has to open does not exist. */
function ChartNotes({ lines }: { lines: string[] }): React.ReactElement | null {
  if (!lines.length) return null;
  return (
    <ul className="ipc__chart-notes">
      {lines.map((l, i) => (
        <li key={i}>{l}</li>
      ))}
    </ul>
  );
}

/** The widget that opens a chart's fallback run: `<b>${title}</b>`, exactly. */
function anchorOf(spec: ChartSpec): string {
  return `<b>${spec.title}</b>`;
}

/**
 * Shapes THIS build can actually draw.
 *
 * The splice finds a chart by title and then swallows `fallbackWidgets` widgets,
 * so an unrecognised kind would have its card rendering deleted and replaced by
 * whatever `ChartFigure` falls through to — which, for a composition arriving at a
 * renderer that only knows rankings, is bars under "ranked by volume". That is a
 * quantity misdrawn silently, and it is worse than no SVG at all.
 *
 * Unknown kind ⇒ leave the card's own rendering alone. The extension is built and
 * deployed separately from the add-on, so this WILL be exercised the next time a
 * shape is added; the add-on additionally declines to send kinds the caller did
 * not ask for, which covers builds already in the field that lack this check.
 */
const DRAWABLE = new Set<string>(['bars', 'donut']);

export function CardRenderer({
  sections,
  charts = [],
  onAction,
}: {
  sections: CardSection[];
  /** Specs riding beside the card. Absent (or unmatched) leaves the block bars alone. */
  charts?: ChartSpec[];
  onAction?: (fnUrl: string, parameters?: Record<string, string>) => void;
}): React.ReactElement {
  // Keyed on the exact heading string both sides hold, never on the shape of the
  // rendered text. Recognising a chart by "a paragraph containing block
  // characters" would swallow a legitimate one somebody writes next year, and
  // would fail by rendering HALF a chart rather than by failing.
  const byAnchor = useMemo(() => {
    const m = new Map<string, ChartSpec>();
    for (const c of charts) m.set(anchorOf(c), c);
    return m;
  }, [charts]);

  return (
    <div className="ipc">
      {sections.map((section, si) => (
        <div key={si} className="ipc__section">
          {section.header && (
            <h2 className="ipc__header">
              <CardText html={section.header} />
            </h2>
          )}
          {renderWidgets(section.widgets ?? [], byAnchor, onAction)}
        </div>
      ))}
    </div>
  );
}

/**
 * Render a section's widgets, swapping each chart's fallback run for its figure.
 *
 * A spec whose anchor is not found, or whose `fallbackWidgets` is missing, is
 * simply not applied — the block bars already in the card are a complete
 * rendering, so the failure costs the SVG and nothing else. That is the right
 * direction to fail in: the numbers stay on screen either way.
 */
function renderWidgets(
  widgets: CardWidget[],
  byAnchor: Map<string, ChartSpec>,
  onAction?: (fnUrl: string) => void,
): React.ReactElement[] {
  const out: React.ReactElement[] = [];
  let i = 0;
  while (i < widgets.length) {
    const t = widgets[i].textParagraph?.text;
    const spec = t ? byAnchor.get(t) : undefined;
    const span = spec?.fallbackWidgets ?? 0;
    if (spec && span > 0 && DRAWABLE.has(spec.kind)) {
      out.push(<ChartFigure key={`c${i}`} spec={spec} />);
      i += span;
      continue;
    }
    out.push(<Widget key={i} widget={widgets[i]} onAction={onAction} />);
    i += 1;
  }
  return out;
}
