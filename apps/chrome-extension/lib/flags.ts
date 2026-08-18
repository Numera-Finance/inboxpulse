/**
 * Per-message flag chips injected into the Gmail thread body, plus the
 * "Suggest tags" drop-down that lets the reader propose different tags.
 *
 * Framework-free DOM (the chips live in Gmail's own light DOM, not the Shadow
 * DOM sidebar), styled inline to match Gmail's label chips. Maps the analysis
 * `signals` (see @crm/shared Signal) to the design's flag labels/colours.
 *
 * A suggestion never edits the AI's verdict: the API writes it to the parallel
 * `user_submitted_risk_level` / `user_submitted_sentiment_value` columns, so the
 * chips shown here keep reflecting what the model said.
 */

export interface FlagChip {
  label: string;
  bg: string;
  fg: string;
  border: string;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type SentimentValue = 'positive' | 'neutral' | 'negative';

/** What the user checked and submitted. Absent key = "leave as is". */
export interface TagSuggestion {
  riskLevel?: RiskLevel;
  sentimentValue?: SentimentValue;
}

const RED = { bg: '#fce8e6', fg: '#c5221f', border: '#f3b7b2' };
const AMBER = { bg: '#fef7e0', fg: '#a15c00', border: '#fde0a3' };
const GREEN = { bg: '#e6f4ea', fg: '#137333', border: '#b7e1c1' };
const VIOLET = { bg: '#f3e8fd', fg: '#8430ce', border: '#e5cbfb' };
const GREY = { bg: '#f1f3f4', fg: '#3c4043', border: '#dadce0' };

const RISK_OPTIONS: ReadonlyArray<{ value: RiskLevel; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const SENTIMENT_OPTIONS: ReadonlyArray<{ value: SentimentValue; label: string }> = [
  { value: 'positive', label: 'Positive' },
  { value: 'neutral', label: 'Neutral' },
  { value: 'negative', label: 'Negative' },
];

/** Signal codes → chips, ordered by urgency. Skips Neutral/Business (defaults). */
export function flagChipsForSignals(signals: number[]): FlagChip[] {
  const s = new Set(signals);
  const chips: FlagChip[] = [];

  if (s.has(10)) chips.push({ label: 'At risk', ...RED });

  const churn = [33, 32, 31, 30].find((c) => s.has(c));
  if (churn !== undefined) {
    const level = churn === 33 ? 'Critical' : churn === 32 ? 'High' : churn === 31 ? 'Medium' : 'Low';
    chips.push({ label: `Churn risk · ${level}`, ...(churn >= 32 ? RED : AMBER) });
  }

  if (s.has(50)) chips.push({ label: 'Competitor', ...VIOLET });
  if (s.has(20)) chips.push({ label: 'Upsell signal', ...GREEN });
  if (s.has(40)) chips.push({ label: 'Kudos', ...GREEN });

  if (s.has(2)) chips.push({ label: 'Negative', ...RED });
  else if (s.has(1)) chips.push({ label: 'Positive', ...GREEN });

  return chips;
}

/**
 * One-line summary of a message's flags, e.g. "Churn risk · Low · Negative".
 * Used for the collapsed-message marker's tooltip, where there's no room for chips.
 */
export function flagSummary(signals: number[]): string {
  return flagChipsForSignals(signals)
    .map((c) => c.label)
    .join(' · ');
}

/** The churn level currently on the message, if the model scored one. */
export function currentRiskLevel(signals: number[]): RiskLevel | null {
  const s = new Set(signals);
  if (s.has(33)) return 'critical';
  if (s.has(32)) return 'high';
  if (s.has(31)) return 'medium';
  if (s.has(30)) return 'low';
  return null;
}

/** The sentiment currently on the message. Neither signal set = neutral default. */
export function currentSentiment(signals: number[]): SentimentValue | null {
  const s = new Set(signals);
  if (s.has(2)) return 'negative';
  if (s.has(1)) return 'positive';
  return null;
}

function chipEl(c: FlagChip): HTMLElement {
  const el = document.createElement('span');
  el.textContent = c.label;
  el.style.cssText =
    "display:inline-flex;align-items:center;font:600 11px/1.5 'Google Sans',Roboto,Arial,sans-serif;" +
    `padding:1px 8px;border-radius:4px;white-space:nowrap;background:${c.bg};color:${c.fg};border:1px solid ${c.border};`;
  return el;
}

/**
 * One checkbox group ("Churn risk" / "Sentiment").
 *
 * Rendered as checkboxes, but only one value per group can be stored — the
 * columns hold a single scalar each — so checking a second option in the same
 * group clears the first. Across groups you can submit both at once.
 */
function buildGroup<T extends string>(
  title: string,
  options: ReadonlyArray<{ value: T; label: string }>,
  current: T | null,
  onChange: (value: T | null) => void,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom:10px;';

  const heading = document.createElement('div');
  heading.textContent = current ? `${title} — currently ${current}` : title;
  heading.style.cssText =
    "font:600 11px/1.6 'Google Sans',Roboto,Arial,sans-serif;color:#5f6368;margin-bottom:4px;";
  wrap.appendChild(heading);

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:12px;flex-wrap:wrap;';

  const boxes: HTMLInputElement[] = [];
  for (const opt of options) {
    const label = document.createElement('label');
    label.style.cssText =
      "display:inline-flex;align-items:center;gap:4px;cursor:pointer;" +
      "font:400 12px/1.5 'Google Sans',Roboto,Arial,sans-serif;color:#3c4043;";

    const box = document.createElement('input');
    box.type = 'checkbox';
    box.value = opt.value;
    box.style.cssText = 'margin:0;cursor:pointer;';
    box.addEventListener('change', () => {
      // Single-value column: checking one clears the others in this group.
      if (box.checked) for (const other of boxes) if (other !== box) other.checked = false;
      const picked = boxes.find((b) => b.checked);
      onChange((picked?.value as T) ?? null);
    });
    boxes.push(box);

    const text = document.createElement('span');
    text.textContent = opt.label;
    // The model's current value is greyed as a hint, but still selectable
    // (re-affirming the AI's call is a legitimate piece of feedback).
    if (opt.value === current) text.style.color = '#80868b';

    label.append(box, text);
    row.appendChild(label);
  }

  wrap.appendChild(row);
  return wrap;
}

/** The expandable suggestion panel. Hidden until the "Suggest tags" chip is clicked. */
function buildSuggestPanel(
  signals: number[],
  onSubmit: (suggestion: TagSuggestion) => Promise<void>,
): HTMLElement {
  const panel = document.createElement('div');
  panel.setAttribute('data-inboxpulse-suggest', '1');
  panel.style.cssText =
    'display:none;margin:8px 0 4px;padding:10px 12px;border:1px solid #dadce0;border-radius:8px;' +
    'background:#fff;max-width:520px;';

  const selection: TagSuggestion = {};

  const status = document.createElement('div');
  status.style.cssText =
    "font:400 11px/1.5 'Google Sans',Roboto,Arial,sans-serif;color:#5f6368;min-height:16px;";

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.textContent = 'Submit suggestion';
  submit.disabled = true;

  const paintSubmit = (): void => {
    const enabled = !submit.disabled;
    submit.style.cssText =
      "font:600 12px/1 'Google Sans',Roboto,Arial,sans-serif;padding:7px 14px;border-radius:4px;" +
      `border:1px solid ${enabled ? '#1a73e8' : '#dadce0'};background:${enabled ? '#1a73e8' : '#f1f3f4'};` +
      `color:${enabled ? '#fff' : '#9aa0a6'};cursor:${enabled ? 'pointer' : 'default'};`;
  };

  const refreshSubmit = (): void => {
    submit.disabled = selection.riskLevel === undefined && selection.sentimentValue === undefined;
    paintSubmit();
  };
  paintSubmit();

  panel.appendChild(
    buildGroup('Churn risk', RISK_OPTIONS, currentRiskLevel(signals), (value) => {
      if (value === null) delete selection.riskLevel;
      else selection.riskLevel = value;
      refreshSubmit();
    }),
  );
  panel.appendChild(
    buildGroup('Sentiment', SENTIMENT_OPTIONS, currentSentiment(signals), (value) => {
      if (value === null) delete selection.sentimentValue;
      else selection.sentimentValue = value;
      refreshSubmit();
    }),
  );

  const footer = document.createElement('div');
  footer.style.cssText = 'display:flex;align-items:center;gap:10px;margin-top:2px;';

  submit.addEventListener('click', () => {
    submit.disabled = true;
    paintSubmit();
    status.textContent = 'Saving…';
    status.style.color = '#5f6368';
    void onSubmit({ ...selection })
      .then(() => {
        status.textContent = 'Suggestion saved. The AI tags above are unchanged.';
        status.style.color = '#137333';
      })
      .catch((err: Error) => {
        status.textContent = `Could not save: ${err.message}`;
        status.style.color = '#c5221f';
        refreshSubmit();
      });
  });

  footer.append(submit, status);
  panel.appendChild(footer);

  const note = document.createElement('div');
  note.textContent = 'Your suggestion is stored separately for review — it does not change the flags.';
  note.style.cssText =
    "font:400 11px/1.5 'Google Sans',Roboto,Arial,sans-serif;color:#80868b;margin-top:8px;";
  panel.appendChild(note);

  return panel;
}

/**
 * Build the chip row for a message's signals, with the suggestion drop-down
 * appended when `onSubmit` is supplied. Returns null when the message has no
 * notable flag (nothing to re-tag).
 */
export function buildFlagRow(
  signals: number[],
  onSubmit?: (suggestion: TagSuggestion) => Promise<void>,
): HTMLElement | null {
  const chips = flagChipsForSignals(signals);
  if (chips.length === 0) return null;

  const container = document.createElement('div');
  container.setAttribute('data-inboxpulse-flags', '1');
  container.style.cssText = 'margin:8px 0 4px;';

  const row = document.createElement('div');
  row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;align-items:center;';
  for (const c of chips) row.appendChild(chipEl(c));
  container.appendChild(row);

  if (!onSubmit) return container;

  // Styled as an actionable control rather than another passive chip — in
  // testing this sat unnoticed among the flag chips when it was grey.
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.textContent = 'Suggest a different tag ▾';
  toggle.style.cssText =
    "display:inline-flex;align-items:center;font:600 11px/1.5 'Google Sans',Roboto,Arial,sans-serif;" +
    'padding:2px 10px;border-radius:12px;white-space:nowrap;cursor:pointer;background:#e8f0fe;' +
    'color:#1a73e8;border:1px solid #1a73e8;';
  row.appendChild(toggle);

  const panel = buildSuggestPanel(signals, onSubmit);
  container.appendChild(panel);

  toggle.addEventListener('click', () => {
    const open = panel.style.display !== 'none';
    panel.style.display = open ? 'none' : 'block';
    toggle.textContent = open ? 'Suggest a different tag ▾' : 'Suggest a different tag ▴';
    toggle.setAttribute('aria-expanded', String(!open));
  });

  return container;
}
