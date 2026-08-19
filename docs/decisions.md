# Architecture Decision Records

Lightweight, append-only. Never delete an entry — mark superseded ones as such.

```markdown
### ADR-NNN: Title (YYYY-MM-DD)
**Status:** Accepted | Superseded by ADR-XXX
**Context:** What problem or question came up
**Decision:** What we decided
**Consequences:** What this means for the codebase
```

---

### ADR-001: Gmail add-on sidebar shows the message, not its id (2026-07-28)

**Status:** Accepted

**Context:** The contextual card's first section, "Open message", showed the raw
Gmail message id — an internal identifier with no value to the person reading the
sidebar. Meanwhile the same card repeated subject/sender in a trailing "Message"
section, and never showed recipients at all.

**Decision:** "Open message" now shows title, From, To, Cc, Bcc and Received, and
the redundant trailing "Message" section is gone. Values are read from the open
message's own Gmail headers via a single `format=metadata` call
(`fetchMessageHeaders`), which also returns the RFC `Message-ID` the thread
resolution path already needed — so this costs no extra Gmail request. When the
headers can't be read, the card falls back to the InboxPulse-side subject/sender.

**Consequences:** No new OAuth scope (`gmail.addons.current.message.readonly`
already covers metadata). `fetchRfcMessageId` is replaced by `fetchMessageHeaders`.
A received message carries no `Bcc` header (the sender's MTA strips it), so Bcc
only appears on the sender's own copy in Sent; absent fields are omitted rather
than rendered blank. Section headers accept simple HTML, so the header is bolded
with `<b>`.

---

### ADR-002: Sentiment trend is a line chart whose y axis is the sentiment class (2026-07-28)

**Status:** Superseded by ADR-004

**Context:** The trend chart was a bar chart of 0–100 sentiment scores. Those
scores are synthetic — the DB stores a sentiment *class*, and the API maps it
positive→75 / neutral→50 / negative→25 — so the bar heights implied a precision
we don't have. What the reader actually wants is the shape of the conversation
over time.

**Decision:** Render a line chart over time with exactly three y positions:
positive = +1 (top), neutral = 0 (middle), negative = -1 (bottom), plotted oldest
→ newest. Dots are coloured by class and a legend (🟩 Positive · 🟧 Neutral ·
🟥 Negative) accompanies the chart. The chart endpoint takes `?v=1,0,-1` instead
of `?s=<scores>`; the param was renamed because the old URLs are served
`immutable`.

**Consequences:** `renderTrendPng(scores)` → `renderSentimentTrendPng(sentiments)`
in `apps/addon/src/chart/png.ts`. Colour now keys off the sentiment class rather
than score thresholds, so the legend is exact rather than approximate. Chart
height is fixed (three levels), width scales with message count. The emoji-square
fallback used when `ADDON_BASE_URL` is unset follows the same colour key.

---

### ADR-003: Flagged messages read chronologically and deep-link into Gmail (2026-07-28)

**Status:** Accepted (ADR-009 briefly replaced the deep-link with an in-panel
detail view; ADR-010 reverted that, so this stands as written)

**Context:** The flagged list was severity-ordered and inert — you could see that
a message was flagged but not get to it.

**Decision:** Rows render oldest → newest so the list reads as the thread's
timeline, and each row is clickable (`decoratedText.onClick.openLink`) to
`https://mail.google.com/mail/u/<viewer-email>/#all/<messageId>`. The API still
returns severity-sorted, and the display cap still keeps the most severe N — only
the rendering order changed, so capping never drops a severe message in favour of
a recent one.

**Consequences:** `buildFlaggedSection(messages, viewerEmail?, max?)` — the viewer
email comes from the verified add-on event and targets the right account for
multi-login users (falling back to `u/0`). Known limitation: `messageId` is the
provider id of the mailbox that *ingested* the thread, so a thread ingested from a
teammate's mailbox produces a link that won't resolve in the viewer's Gmail. The
cross-mailbox-stable RFC `Message-ID` would fix it, but the flagged endpoint
doesn't return it today.

---

### ADR-004: Sentiment trend uses native card widgets, not a rendered image (2026-07-29)

**Status:** Accepted — supersedes ADR-002

**Context:** ADR-002's line chart was served as a PNG the add-on rasterized itself
(`apps/addon/src/chart/png.ts` — a hand-written RGBA buffer, CRC-32 and
`deflateSync` PNG encoder) because CardService can't draw charts and its card
images must be hosted raster URLs. It rendered at 334×100px for ten messages with
11px dots and no antialiasing, so it upscaled to a blur on HiDPI screens.

Reworking it meant choosing between: supersampling the rasterizer; server-rendering
a real chart library (Recharts + `@resvg/resvg-js` — React plus a native binary in
a service whose deps are hono/zod/pino); or a hosted chart service (QuickChart —
which would send per-customer sentiment sequences to a third party over an
unauthenticated URL).

None were warranted. Ten points on a three-level ordinal axis in a ~300px panel
fails the "is this even a chart" test: the line only ever visits three heights,
and the panel has no room to label the y axis, so the reader had to learn
"top = positive" from the legend anyway.

**Decision:** Drop the image entirely. The Trend section is a row of equal-width
coloured blocks (🟩 positive, 🟧 neutral, 🟥 negative), one per message, oldest →
newest — the same colour key, rendered by CardService's own `textParagraph`. The
legend and the `Latest / ↑ improving · last N of M messages` summary row are
unchanged; the summary is what carries most of the signal.

**Consequences:**
- `apps/addon/src/chart/` deleted (rasterizer + tests), along with the public,
  unauthenticated `GET /chart/trend.png` route in `apps/addon/src/index.ts`.
- `buildTrendSection(points, windowSize?)` — the `chartBaseUrl` parameter is gone.
  `ThreadCardInput.baseUrl` is still needed, but now only for flagged-row action
  callbacks.
- `Sentiment` and `SENTIMENT_LEVEL` moved from `chart/png.ts` to `cards/trend.ts`.
  `SENTIMENT_RGB` is gone; `SENTIMENT_LEVEL` survives only to compute the
  improving/declining direction.
- Renders at device resolution in any Gmail theme, with no image proxy in the
  path. Sentiment is no longer encoded by colour alone (the legend names each
  colour and the summary states the latest class in words), which matters because
  green/red is the worst colour-vision-deficiency pair.
- Known trade-off: run length is now read by counting blocks rather than seen as a
  slope. Acceptable at ten points; if the window ever grows past ~15, revisit.

### ADR-005: Add-on card typography is bold + whitespace, because Cards v2 has no font sizing (2026-07-29)

**Status:** Accepted

**Context:** A review of the Gmail add-on sidebar asked for a stronger visual
hierarchy: drop the duplicated "InboxPulse" title, make "Open message", "Trend,
this thread" and "Flagged messages" larger, make the section rules bolder and
wider, and open up the spacing inside the trend block.

Cards v2 is a fixed schema rendered by Google, not HTML we control. Its text
fields accept only `<b> <i> <u> <s> <font color> <a href> <time> <br>` — there is
**no** font-size tag (`<h1>`, `<big>`, `<font size>` are all ignored), no
divider styling (weight, colour and inset are fixed), and no padding, margin or
spacing property on any widget or section.

**Decision:** Express hierarchy with the three levers the schema does give us:

1. **Bold every section heading** (`heading()` in `cards/widgets.ts`) so headings
   share one weight and read heavier than body text. This is the ceiling on
   emphasis — headings cannot be made larger.
2. **Drop the card `header`** from the thread, flagged-detail and homepage cards.
   Gmail's add-on toolbar already prints "InboxPulse" directly above the card, so
   a header title only repeated the product name (the homepage repeated it a
   third time in a section header).
3. **Separate with whitespace.** `spacer()` emits a `textParagraph` holding a
   non-breaking space — an empty string is collapsed by the renderer. `spaced()` /
   `separated()` put a blank line above the hairline Gmail draws between sections,
   and `buildTrendSection` puts one between its heading, blocks, legend and
   summary.

**Consequences:**
- "Larger text" is not deliverable on this surface. The only escape hatch would be
  rendering headings as hosted PNGs, which we rejected for the trend chart in
  ADR-004 (image proxy, HiDPI blur, no accessible text) and reject again here.
- Layout tests must not index widgets positionally — spacers shift the indices.
  `cards.test.ts` and `trend.test.ts` filter blank-line widgets out first.
- Any new section should use `heading()` for its header and be added to the array
  passed through `separated()`, not push a raw string header.

### ADR-006: User tag suggestions go to parallel columns, never over the AI's verdict (2026-07-29)

**Status:** Accepted

**Context:** Readers in Gmail are often better judges of a message's churn risk
and sentiment than the model is, but there was no way to say so — the analysis
tags were write-only output of the pipeline. We wanted an in-Gmail correction
path without the correction silently becoming "the truth" everywhere the tags
are consumed (chips, dashboards, digests, exports, escalation rules).

**Decision:** Add two nullable columns to `email_analyses` —
`user_submitted_risk_level` and `user_submitted_sentiment_value` — written only
by `POST /api/emails/tag-suggestion`, and never by the analysis pipeline. They
sit alongside the extracted model columns using the same layout: risk level on
the row whose `analysis_type = 'churn'`, sentiment on the `'sentiment'` row.

Rejected alternatives:
- *Overwrite `risk_level` / `sentiment_value` directly.* Loses the model's call,
  so agreement rate and correction volume become unmeasurable, and one user's
  opinion silently changes what everyone else sees.
- *A separate `analysis_feedback` table.* Cleaner in the abstract, but every
  consumer that wants "what did the human say" would need a join, and the whole
  value here is comparing the two verdicts side by side on one row.

Supporting choices:
- Each column holds a single scalar, so the Gmail drop-down renders checkboxes
  but allows one checked value per group; checking a second clears the first.
  Across the two groups both can be submitted at once.
- When no analysis row exists for the type being suggested, a suggestion-only
  row is inserted with `result = '{}'`, `model_used = 'user-suggestion'` and
  every extracted column NULL. All existing readers key off
  `detected` / `risk_level` / `sentiment_value`, so such a row is inert.
- `EmailAnalysisRepository.upsertAnalysis`'s conflict-update set deliberately
  omits both new columns, so a later re-analysis refreshes the AI verdict
  without discarding a human suggestion.
- Writes resolve the message through `findByMessageIdsScoped`, the same
  access-controlled lookup the chip read uses, so a user can only re-tag
  messages for customers they can already see. An unresolvable id is a 404.

**Consequences:**
- Nothing downstream changes behaviour until a consumer explicitly reads the new
  columns — the feature is additive and reversible.
- Migration `apps/api/sql/migrations/012_email_analyses_user_submitted.sql` adds
  the columns plus partial indexes (`WHERE ... IS NOT NULL`), since only a small
  minority of the ~100k analysis rows will ever carry a suggestion.
- The extension posts through the internal-key path in the service worker, which
  bundles a secret — the same DEMO-only caveat that already applies to the chip
  read. The blast radius is bounded (the endpoint can only write the
  `user_submitted_*` columns), but the route is mounted on the session path too
  and production should switch to it before any public distribution.
- Open follow-up: the columns record *what* was suggested, not *who* suggested
  it or when (beyond `updated_at`). Add `user_submitted_by` / `_at` if the
  suggestions are ever used for per-reviewer scoring.

---

### ADR-007: The sidebar is grouped by scope, and the envelope comes from the CRM (2026-08-04)

**Status:** Accepted

**Context:** The extension's Thread tab rendered eight sections in one flat
column with one rhythm — customer, trend, flagged, message analysis, stats,
contacts, activity, details. Nothing marked where message-scoped content ended
and thread-scoped content began, and the panel read as cramped. The requested
layout also asked for something the panel had never shown: the open message's
own envelope (from / to / cc / date / subject).

**Decision:**
- Sections are grouped into four named groups, ordered narrowest scope first:
  **SELECTED** (the open message's envelope) → **ANALYSIS** (its churn risk and
  sentiment) → **USER** (the external contact, then the stats, activity and
  contacts for their account) → **THREAD** (customer, trend, flagged messages,
  details). `components/Section.tsx` owns the two-level heading and divider
  rhythm; individual sections no longer style their own headings.
- The envelope is served by the CRM, not read off Gmail. `resolve-by-messages`
  (already called once per thread) now also returns `fromEmail`, `fromName`,
  `tos` and `ccs` per row.
- InboxSDK's per-message envelope is kept as a fallback and published through
  `lib/active-message-store`, which now carries an object rather than a bare id.
- `getThreadFlaggedMessages` additionally returns `level` on churn flags.

**Consequences:**
- The to/cc split is only expressible server-side: InboxSDK's `MessageView`
  offers a single flat `getRecipientEmailAddresses()`. The DOM fallback
  therefore populates `to` only when there is no stored row at all, and never
  merges with one — presenting cc'd people as direct recipients would be worse
  than showing nothing.
- The fallback exists because messages the CRM never ingested (most often the
  reader's own sent replies) are real messages in the thread. Without it the
  SELECTED block goes blank exactly when the reader clicks their own email.
- Sentiment for the open message is read from the **trend** endpoint, not the
  flagged set: the flagged set carries sentiment only when it is negative, so
  reading it there would report every neutral and positive message as
  unanalysed.
- `level` is carried alongside the existing `label` so consumers can style by
  risk without parsing `"Churn risk · Low"` back apart.
- Both API changes are purely additive; every existing consumer (the add-on's
  `api-client.ts`, the extension's background worker) reads these responses
  field-by-field and is unaffected. No schema change, so no migration.

---

### ADR-008: The USER group shows the sender's own contact record, not their employer's roster (2026-08-06)

**Status:** Accepted

**Context:** The USER group carried a "Contacts" block listing everyone at the
customer the thread resolved to, with the thread's sender sorted first. Read as
"contacts for the person who sent this email", which it wasn't — the sender's
colleagues answer a question nobody reading a single message is asking, and the
sender's own phone, title and profiles were nowhere in the panel despite being
stored on the contact record.

**Decision:** Drop the roster. `ThreadContact` — already the block identifying
the sender, and already fetching the customer's contacts to get the CRM's
spelling of their name — now renders the matched record's own fields: title
under the name, then `phone`, `mobile`, `address`, `website`, `linkedin`, `x`
and `linktree` as label/value rows, present ones only. Phones link `tel:`; web
fields link when the value is a location and stay plain text when it's a handle
like `@jane`, since guessing which site a handle belongs to is not safe.

**Consequences:**
- `components/ContactList.tsx` is unreferenced. Left on disk (this working copy
  is not under version control) rather than deleted.
- No API change: the query and its cache key are the ones `ThreadContact` was
  already issuing, so the block costs nothing extra.
- When the thread resolves to a customer but the sender matches no contact, the
  block says so. Without that line the block looks identical whether or not the
  person is in the CRM, which is the confusion that prompted this.
- With no customer resolved there is nothing to look the record up against, so
  the block still shows name and address alone.

---

### ADR-009: A flagged message opens in the panel; jumping Gmail becomes a choice (2026-08-06)

**Status:** Superseded by ADR-010 (same day). It was built on a mistaken premise
— that the extension could not move Gmail's thread pane, which is the add-on's
limitation, not this one's. The `?includeBody` API work below survives and is
what ADR-010's search is built on; the detail view does not.

**Context:** ADR-003 made flagged rows deep-link into Gmail, which was the only
drill-down the extension had. A row shows the first flag's label, its reason
truncated to one line, and provenance; a message with three flags shows one.
Getting the rest meant clicking, which navigated the thread pane away from the
panel that had just said the message mattered. The Gmail add-on had solved this
differently — it pushed a detail card onto its own stack, because a Workspace
Add-on cannot move Gmail's thread pane at all — and that view is the one the
reader wanted back.

**Decision:** Port the add-on's `flagged-detail` card to the extension as
`components/FlaggedMessageDetail.tsx`. Clicking a row replaces the panel with
every flag in full, the message's envelope, and its text; "Open in Gmail" is
still there as an explicit action, doing the same `#all/<messageId>` hash jump
the row used to do implicitly. Gmail draws the back arrow for a pushed add-on
card and nothing does that for us, so the view renders its own, and the open
message is held as state in `SidebarApp`.

`GET /api/emails/thread/:threadId/flagged` gains `?includeBody=true|1`, which
adds `bodyPreview` and `bodyTruncated` per message. The extension's
`useThreadFlagged` sets it, so one query serves both the list and the detail
view and navigating between them costs no request.

**Consequences:**
- The preview is plain text produced server-side by the existing
  `extraction/extractor.ts` (`extractLatestReply`, falling back to
  `htmlToText`): the stored `emails.body` is the message's raw HTML source, and
  rendering that in the panel would mean injecting a sender's markup into
  Gmail's page. Reusing the analysis pipeline's extractor also strips quoted
  history and signatures rather than growing a second, differently-wrong parser.
- Two caps: 20k characters of stored body are parsed, 4k of text are returned
  (`bodyTruncated` says when that bit). The parse cap is safe because the reply
  Gmail-style clients put at the top comes first.
- Opt-in because the add-on fetches this same endpoint on every contextual
  trigger and needs only the flags. Both fields are additive, so the add-on is
  unaffected. No schema change, no migration.
- Until an API carrying `includeBody` is deployed, the Content block degrades to
  "No stored content for this message. Open it in Gmail…" — the same fallback
  the add-on used when Gmail wouldn't return a body.
- `FlaggedMessages` now requires an `onOpen` prop; it no longer navigates.
- ADR-003's chronological ordering and its severity-capping rationale stand
  unchanged, as does its known limitation: `messageId` is the ingesting
  mailbox's provider id, so the Gmail jump can fail for a thread ingested from a
  teammate's mailbox.

---

### ADR-010: In-thread search at the top of the panel; every row jumps Gmail (2026-08-06)

**Status:** Accepted — supersedes ADR-009, restores ADR-003's deep-link

**Context:** Two things landed together. The panel had no way to find a specific
message inside a long conversation. And ADR-009 had just replaced the flagged
rows' Gmail jump with an in-panel detail view, on the belief that jumping wasn't
available — a belief carried over from the Gmail add-on, which genuinely cannot
move Gmail's thread pane. The extension is a content script running *in* the
Gmail page, so `location.hash` navigates the conversation in place; the original
ADR-003 behaviour had been right all along.

**Decision:**
- Flagged rows jump to their message again. `FlaggedMessageDetail` is deleted
  rather than left reachable from somewhere else: it existed only to work around
  a constraint that does not apply here.
- The jump itself moves to `lib/gmail-nav.ts`, since two callers now share it,
  and its one real caveat (the ingesting mailbox's provider id may not resolve in
  this reader's Gmail) is documented once there instead of in each row component.
- A search box sits at the top of the Thread tab — above every group, because it
  navigates the thread rather than reporting on it. Results jump the same way.
- New `GET /api/emails/thread/:threadId/messages?includeBody=true`, returning the
  thread's stored messages oldest-first with their text. Capped at 200 messages,
  with `truncated` in the response.

**Consequences:**
- Search matches sender, subject **and message text**. Within one conversation
  every message shares a subject, so text is the only field that distinguishes
  them; matching without it would just filter by sender.
- The whole thread is fetched once and filtered in the browser, rather than
  querying per keystroke. A thread is tens of messages, so this makes typing
  instant and costs one request — but it is why the endpoint returns messages
  rather than taking a search term, and why the 200 cap exists.
- The fetch is lazy: nothing loads until the reader focuses the box. The thread's
  full text is the largest payload the sidebar can ask for and most readers never
  search.
- The corpus is what the CRM **ingested**, not what Gmail displays — the sync
  drops most outbound mail, so a reader's own replies generally cannot be found.
  The panel says so when a thread has no stored messages, and says when the 200
  cap bit; neither is silently absent.
- `previewBody` (ADR-009) is now shared by both thread endpoints. The flagged
  endpoint keeps its `includeBody` parameter — deployed, harmless, and nothing
  requests it today.
- Highlighting splits on a regex built from the reader's own terms and renders
  the parts as elements; no HTML is assembled from input, which matters when the
  output goes into Gmail's page.

---

### ADR-011: Jumping to a message expands it in the page, not through a URL (2026-08-06)

**Status:** Accepted — supersedes the jump mechanism in ADR-003 and ADR-010

**Context:** Every panel row that names a message — flagged rows since ADR-003,
search results since ADR-010 — jumped by setting `location.hash` to
`#all/<messageId>`. Reported from real use: clicking a result for an older
message in the open thread put Gmail back on the *newest* message in that same
thread. Gmail resolves the id as a conversation, re-opens it in its default
state, and the reader loses their place. The behaviour was inherited from the
add-on, where a URL is the only lever available, and was never right here.

**Decision:** Reveal the message in the page. `lib/message-registry.ts` keeps the
open thread's `MessageView`s by message id — fed by the same
`registerMessageViewHandler` that already feeds the thread's id set — and
`revealMessage(id)` expands the view and scrolls it into place.
`lib/gmail-nav.ts` tries that first and keeps the hash as a fallback for a
message that isn't on screen to act on.

**Consequences:**
- Expanding goes through a synthetic click on the message row. `MessageView` has
  `getElement()`, `getViewState()` and no `expand()`, so Gmail's own click
  handler is the only way in.
- The scroll is deferred past the expand: expanding changes the height of
  everything below it, so a scroll computed first lands in the wrong place.
- The revealed message is briefly outlined. When it was already expanded nothing
  else on screen changes, and after a smooth scroll several messages are in view
  — without the outline the reader can't tell which one was meant.
- The registry is cleared when the reader changes conversation and per message on
  `destroy`, so it never holds views belonging to a thread that has gone.
- The fallback still carries the per-mailbox id caveat from ADR-003: an id from
  the mailbox that ingested the thread may not resolve in this reader's Gmail.
  The registry path sidesteps it whenever the message is actually on screen,
  because it matches the id InboxSDK reports for the reader's own mailbox.

**Amendment (2026-08-06, same day, after testing in real Gmail):** the first
implementation of this ADR did not work, in three ways worth recording because
each looked like the others from the outside.

1. `element.click()` fires a lone click event. Gmail's row handlers are on
   mousedown/mouseup, so it was ignored outright. A full pointer sequence
   (`pointerdown → mousedown → pointerup → mouseup → click`) is dispatched now.
2. `getElement()` returns the message container, not the region Gmail treats as
   "open this". Candidate targets are tried in order — `td.gF` first, the sender
   cell InboxSDK's own source confirms — checking `getViewState()` after each.
3. Gmail has a third state, `kQ`/`kx` = HIDDEN: messages inside a super-collapsed
   "N more messages" run, for which InboxSDK never builds a view. Those were
   never in the registry, the lookup failed, and **the URL fallback fired** — so
   the thread opened and then snapped back to the newest message, which read as
   the whole feature failing.

The URL fallback is therefore deleted, not fixed. It is not a degraded version
of revealing a message; it does something else (opens the *conversation*), and
as a fallback it actively undid the thing that had just worked. Every caller
names a message in the conversation already on screen, so failing loudly in the
console is the correct outcome.

Two waits also had to become real: after opening a super-collapsed run the
registry is polled for up to 6s, because Gmail *fetches* those messages before
InboxSDK can build and register views (300ms was not close), and the scroll is
re-asserted twice after landing, because Gmail scrolls the thread to the newest
message as it finishes loading and would otherwise undo it.

---

### ADR-012: The panel finds a message by sender, text and time — not by id (2026-08-06)

**Status:** Accepted

**Context:** Opening a flagged message from the panel failed with `could not find
message 19f7efbb0d6aedec in the open conversation`, on a thread whose messages
were plainly on screen. The clicking worked; the identity did not.

This is the per-mailbox Message-ID problem from the 2026-07 add-on work, showing
up on a new surface. Gmail message ids are per-mailbox: the same email carries a
different id in every participant's mailbox, and the CRM stores one row per
message bearing the id of whichever mailbox ingested it first. A thread that
reached the CRM through several colleagues' mailboxes therefore has rows this
reader's Gmail has never heard of — the panel lists them correctly and then
cannot point at them. Thread resolution survives this because
`findByMessageIdsScoped` also matches the stable RFC `Message-ID`; nothing
downstream did.

The add-on's fix — read each message's RFC `Message-ID` from the Gmail API — is
not available here. A content script has no Gmail API access, and InboxSDK does
not expose the header.

**Decision:** Identify the message by what both sides can see without the Gmail
API. `MessageDescriptor` carries the id plus sender, received time and how the
text begins; callers pass what they have. The id is tried first and is right
whenever the row came from this mailbox. Otherwise `matchDescriptor` narrows by
sender (exact), then by opening text, then by time within five minutes.

**Consequences:**
- Sender alone is not enough — people send several messages to one thread. The
  reported case had two from the same person, and text separates them cleanly
  (1.00 against 0.04 on the real rows).
- Text compares like with like: Gmail's row preview and our stored preview are
  both the start of the same body. They are not identical — ours has quoted
  history and signatures stripped — so containment is tried first and a shared
  prefix is the fallback, rather than requiring equality.
- Time is last and bounded, because Gmail renders localized dates of varying
  precision. It settles a tie; it never decides one.
- Everything is read from the row's DOM, not through InboxSDK: a collapsed
  message may not be "loaded" and `getSender()` throws on those, while the
  sender address and preview are in the markup either way.
- `useThreadFlagged` requests `includeBody=1` again. The text isn't rendered
  anywhere — it exists so a click can find its message. This is what ADR-009's
  API work turned out to be for.
- No API or schema change: the descriptor is built from fields these endpoints
  already return.
- Not a full fix for the underlying problem. Returning the RFC `Message-ID` from
  these endpoints, and matching on it, would identify messages exactly rather
  than by resemblance — but reading it off an open message still needs Gmail API
  access the extension doesn't have.

---

### ADR-013: Thread-scoped sections resolve from the conversation, not the open message (2026-08-06)

**Status:** Accepted

**Context:** Trend and flagged messages appeared only when one of the few
AI-analyzed, ingested messages was the one selected, and vanished on clicking a
neighbouring email in the same conversation — a thread the panel had just
described correctly.

The cause is upstream of the panel. The thread was resolved by sending the open
thread's Gmail message ids to `resolve-by-messages`, and those ids come from
InboxSDK's message views. InboxSDK builds a view only for messages Gmail has
actually loaded — in a real thread, two of them — and the loaded one is often the
reader's own reply, which the sync deliberately drops. So the id list was both
partial and biased towards messages that are not in the CRM, and everything
thread-scoped inherited that.

**Decision:** Publish Gmail's own conversation id (`getThreadIDAsync()`) through
`lib/thread-store`, and resolve the CRM thread from it via the existing
`GET /api/emails/thread/by-provider/:providerThreadId` — the endpoint the add-on
already had for this exact reason. The message-id resolution stays as a fallback
and still supplies the customer, envelopes and sender.

**Consequences:**
- `ThreadTab` keys `SidebarApp` on the conversation id rather than the message-id
  list. That list grows as Gmail builds views, so it was remounting the panel
  mid-read — discarding UI state and re-running every query.
- `publishThread` no longer requires message ids before publishing; the
  conversation id alone is enough for the thread-scoped sections.
- Provider *thread* ids are per-mailbox exactly as message ids are (ADR-012), so
  a conversation ingested from a colleague's mailbox still won't resolve by this
  reader's id. This resolves strictly more cases than before, not all of them.
- No API or schema change: the endpoint and its repository method already
  existed and are in production use by the add-on.

---

### ADR-014: The sidebar no longer names a customer for a conversation (2026-08-06)

**Status:** Accepted

**Context:** The THREAD group led with a "Customer" block naming a company, and
that name moved with whoever was on the email. The question behind it: does
anything in the database assign a customer to a *thread*?

It does not. `email_threads` has `tenant_id`, `integration_id`,
`provider_thread_id`, `subject` and timestamps — no customer column. The link is
per-message, through `email_participants`, and the customers it points at are
largely domain-derived auto-created records (the "(Auto)" names). The panel then
picked whichever customer owned the most messages in the thread. So the block
asserted something the data does not hold: that a conversation belongs to an
account.

**Decision:** Remove the "Customer" block, and with it the "No customer linked"
block and its resolution diagnostics. Nothing replaces them — an inferred answer
presented as a fact is worse than no answer.

**Consequences:**
- `CustomerHeader.tsx` and `NoCustomer.tsx` are unreferenced, as is
  `ContactList.tsx` from ADR-008. Left on disk (this working copy is not under
  version control) rather than deleted.
- Customer resolution itself is unchanged and still drives the stats, activity
  and details blocks. Those show what they show rather than claiming whose
  account the conversation is — but they rest on the same inference, and if that
  inference isn't trusted they should go too.
- The resolution diagnostics ("N sent · N matched · N with a customer") went with
  the block that hosted them. They were a debugging aid for a customer lookup
  that is no longer displayed; ADR-013 removed the failure mode that made them
  necessary day to day.

### ADR-015: Triangulating against other systems — one fact per connector (2026-08-13)

**Status:** Accepted

**Context:** The panel reads one email thread. Gemini sits three inches to the
left reading the same thread, so anything derived from the open messages is a
point it already makes for free. The differentiated signal has to come from
systems Gemini cannot reach.

None of those systems are connected. `integrations.source` is an enum of exactly
four values — gmail, outlook, slack, other — and only gmail has rows (15, of
which 2 active). Every connector below needs that enum extended before it can
even be stored, which is a migration.

**Decision:** Specify the connectors before building them, in code
(`apps/addon/src/services/connectors.ts`) rather than prose, so the shape of what
we ask for is reviewable.

The list is the stack MyStartupCFO actually runs — Streak and Canopy for CRM and
practice management, Google Chat rather than Slack, QuickBooks Online for client
books, no Jira. A first version listed Jira, Stripe, HubSpot and Slack, which
made it a catalogue of a generic SaaS company rather than a spec for this one. A
roadmap aimed at systems nobody here uses is worse than no roadmap: it looks
researched.

Each connector pulls exactly ONE fact, and the bar for that fact is *would
knowing this change the reply* — not "is it interesting", not "is it available".

| System | The one fact | Why it changes the reply |
|---|---|---|
| Canopy | open client requests and how long outstanding | whether the ball is with us or with them |
| QuickBooks Online | how far the books are closed for this client | whether you can promise a date, and which one |
| Streak | pipeline and stage this contact sits in | what stage the relationship is at, so the tone matches |
| Google Chat | discussed internally in the last 7 days? | whether to reply at all, or check with whoever is on it |
| Google Calendar | next meeting already booked with anyone on the thread | whether to write a long reply at all, or just say "Thursday" |

Suggestions are mode-gated (close status on a scheduling thread is noise),
require a resolved customer, and render ONE at a time.

Until a connector exists, the card shows the QUESTION it would answer and the
words "not connected" — never a sample value.

**Consequences:**
- A connector that grows past one fact should be challenged, not extended. The
  panel is a decision, not a dashboard; a panel you scroll has already lost to
  the reply box six inches away.
- A sample figure on the card would be indistinguishable from a real one three
  seconds later. A panel that has shown one invented number has spent the
  credibility of every real number on it — so the rule is absolute.
- Every connector inherits the entitlement rule in `account-context.ts`.
  Cross-system data makes leakage worse, not better: a client's close status or
  AR position is more sensitive than an email subject, and pulling it through a
  panel keyed on a sender domain is exactly how someone reads a company's
  finances because they received one email from them.
- **Canopy is the highest-value.** For outsourced finance the dominant friction
  is "whose turn is it", the thread almost never says, and the two answers
  produce opposite emails.
- **Streak is the cheapest** — Gmail-native, so the box is already attached to
  the thread being read. Build it first because it is easy, not because it is
  most valuable; its data is arguably already on screen, which caps what it adds.
- **Google Chat is the least awkward OAuth ask** — the same Google identity the
  add-on already holds. **Calendar is the most expensive**: `calendar.readonly`
  is RESTRICTED tier and needs security review.
- All five need `integrations.source` enum values added before anything can be
  persisted. That migration is a prerequisite, not part of this decision.

### ADR-016: tasks.status has no value 2 (2026-08-13)

**Status:** Accepted

**Context:** `AccountContextService.openTasks` counted open tasks with
`status <> 2`. `TaskStatus` in `apps/api/src/tasks/schema.ts` is `OPEN: 0,
DONE: 1`. There is no 2, so the filter matched both states and counted every
task ever created as open.

On the clone that is 1004 rows against 185 genuinely open. Across the 348
customers with any completed task, the card would have shown 964 open tasks
where 145 are open — a 6.6x overstatement, rendered as a flat number with
nothing to indicate it was wrong.

**Decision:** Filter `status = 0`. Verified against the data rather than the
enum name alone: all 819 `status = 1` rows carry `completed_at` and a
`resolution`; no `status = 0` row does.

**Consequences:** This is the failure mode CLAUDE.md already warns about for
ported endpoints — a number that renders plausibly instead of failing. A count
with no upper bound in the UI cannot be sanity-checked by eye, so filters
against enum values should be written from the enum definition, and confirmed
against a column that independently records the same state.

### ADR-017: gemma3:12b is the local extraction model — bigger is worse (2026-08-13)

**Status:** Accepted

**Context:** The deep read takes ~7s, which is the largest single cost in
time-to-respond. The obvious lever is a different model, and the obvious
intuition is that a larger one would be more accurate.

**Decision:** Stay on gemma3:12b for structured extraction. Measured on the real
deep-read prompt, three runs each, M5 Pro / 48GB:

| model | latency | commitment found | `when` populated |
|---|---|---|---|
| gemma3:12b | 6.2–7.3s | 3/3 | **3/3** |
| gemma3:27b | 20.3–29.7s | 3/3 | **0/3** |
| qwen2.5:32b | 23.5–31.8s | 3/3 | 3/3 |

`when` is the field the calendar reminder is built on, so losing it silently
removes the "Remind me" button — the panel gets quieter, not visibly wrong.

Llama 4 was evaluated and does not fit: Scout is 67.4GB against 48GB of RAM
(~36GB addressable by the GPU); Maverick is 244.8GB.

Separately, prose generation routes to `LIVE_ANALYSIS_FAST_MODEL`
(nemotron-3.5-lightning:30b-mlx, 81.3 tok/s against gemma3's 31.9) because a
reply has no schema to get wrong. See ADR notes in `env.ts`.

**Consequences:**
- Bigger is not better for constrained JSON extraction. gemma3:27b is 3x slower
  *and* strictly worse on the field that matters; qwen2.5:32b buys nothing for
  3.5x the wait.
- Do not re-litigate model choice by intuition — this table is cheap to
  regenerate and the intuition was wrong.
- Llama 4's MoE shape (109B total, ~17B active) is precisely what this workload
  wants: big-model accuracy at small-model generation speed. Worth revisiting on
  a machine that can hold it. That is a hardware decision, not a code one.

### ADR-018: Labels are precision-only, budgeted, and one per message (2026-08-13)

**Status:** Accepted

**Context:** Applying analysis flags as native Gmail labels is the one sanctioned
mailbox write (ADR-005). A script existed (`apps/api/scripts/apply-gmail-labels.ts`)
but had never run, and reading it against the corpus showed it would have written
**129,607 labels across 125,685 analysed emails** — more labels than messages.

Measured share of analysed mail per label:

| label | share |
|---|---|
| Automated | 51.7% |
| Churn (incl. low) | 25.7% |
| Transactional | 8.2% |
| Marketing | 5.2% |
| Spam | 4.9% |
| Upsell | 3.6% |
| Churn (medium+) | 3.2% |
| Competitor | 2.9% |
| Negative | 0.8% |
| Positive | 0.2% |
| Kudos / Escalation | 0.0% |

**Decision:** Four rules, in `apps/api/src/labels/policy.ts`:

1. **Over 5% of mail = no information.** Enforced at run time against the actual
   mailbox (`withinBudget`), not merely asserted — the corpus that set the
   thresholds is one tenant's mail, and the failure mode is thousands of labels
   in a real inbox.
2. **Never duplicate Gmail.** Automated / Marketing / Transactional / Spam are
   Gmail's own categories. A second, worse copy spends credibility for nothing.
3. **A label that has never fired is not a label.** Kudos and Escalation are 0
   rows in 125,685.
4. **One label per message.** 1,893 emails would have taken two or more.

Surviving set: `Churn risk` (medium+ only), `Upsell`, `Negative`.

Competitor is excluded: it is keyword-matched and 1,947 of 3,595 hits matched a
stopword — mostly `"and"` — while the remainder includes `"&"`, `"Accounting"`
and `"Global"`. A parser fix landed later but the historical rows remain, and a
label sweep reads history.

**Observed live.** The old rules were run against a colleague's mailbox and the
result was demoed: three labels in the Gmail sidebar — `InboxPulse/Automated`,
`InboxPulse/Churn risk`, `InboxPulse/Spam` — being the three worst by volume
(51.7%, 25.7%, 4.9%), and a message reading *"Good morning Tom, Works for me as
well. Thank you"* carrying a **Churn risk · Low** chip. That is the 87% noise,
on real mail, in front of an audience.

A prior claim in this repo that the sweep "had never run" was wrong. It was
inferred from `emails.labels` containing no `InboxPulse` entries — but that
column is our ingested copy of Gmail's labels, written at sync time and holding
only system values (`INBOX`, `UNREAD`, `CATEGORY_*`). The script writes to Gmail
through `users.messages.modify` and never updates it. Absence there is not
evidence of absence in the mailbox.

**Consequences:**
- Dry run against the real corpus: **8,118 labels instead of 129,607** — 3.19%
  churn, 3.18% upsell, 0.09% negative.
- Teardown now exists (`apps/api/scripts/remove-gmail-labels.ts`). It did not:
  both existing scripts only ever called `addLabelIds`, so ~103,000 labels were
  applied with nothing in the repository able to take them off. Deleting the
  LABEL detaches it from every message, so teardown is one call per label — the
  actual payoff of namespacing, and what makes experimenting with labels
  survivable.
- A refused label is not an error. The run logs why and continues.
- All names are namespaced under `InboxPulse/` so the entire set is removable in
  one operation. A labeller that cannot be fully undone should not run.
- CHURN_LOW stays excluded everywhere: the panel, the sweep script, and here.

### ADR-019: Instant labels — user-chosen, self-expiring working sets (2026-08-13)

**Status:** Accepted (design + core; Gmail write path not built — needs `gmail.modify`)

**Context:** Every label in ADR-018 is a *claim about the message* — this is churn
risk, this is an upsell. Claims can be wrong, and the audit found 32,241 "Churn
risk" labels where 4,015 qualified. The entire policy exists to stop a classifier
writing noise into someone's inbox.

Researched how Superhuman handles this. Their answer is **Split Inbox** (sections
grouping mail by type, default Important/Other), **Auto Labels** (AI categories
defined by short user prompts), and **snooze**. All three classify the *message*.
Their own guidance notes users create temporary splits they "intend to keep for a
week or two" — which is the accretion problem admitted in the product's own docs.

**Decision:** A second, structurally different kind of label. Instant labels
describe the **user's session**, not the email:

| label | means |
|---|---|
| ⚡ Focus | Working these next |
| ⚡ Research | Needs digging, not now |
| ⚡ Block time | Needs a calendar slot |
| ⚡ Waiting on | Blocked on someone else |

Two properties do the work:

1. **A label the user chose cannot be a false positive.** This removes the
   precision problem rather than managing it — no budget, no volume cap, no
   measurement of what share of the mailbox it covers. The user asserted it.
2. **They expire in 30 minutes** unless turned off sooner. The failure mode of
   every manual labelling system is accretion; expiry inverts the default so
   nothing persists long enough to accumulate. Thirty minutes is a working
   block — long enough to clear a batch, short enough that a forgotten label is
   gone before it misleads.

Namespaced `InboxPulse ⚡/` — deliberately distinct from the analysis set's
`InboxPulse/`, so a sweep of either can never touch the other. Asserted in tests.

**Consequences:**
- State is in memory on purpose. Persisting it would recreate accretion in a
  database instead of a mailbox. The honest cost: a process restart loses track
  of a live label and it stays in Gmail until removed by hand.
- Expiry is swept lazily on panel open, because there is no cron. A label
  expires on schedule only if the user opens the panel again — which is the
  least bad version, since a user not looking at their mail is not being
  misled by a stale working-set label.
- **Not shippable yet**: applying any label needs `gmail.modify`, a RESTRICTED
  scope. The decision logic is built and tested; the Gmail write path is not.
- Four labels, not a taxonomy. A longer list becomes something you maintain
  rather than use, at which point it is the filing system this replaces.

### ADR-020: Management metrics require a firm participant on the thread (2026-08-14)

**Status:** Accepted

**Context:** The add-on's management sections (`WaitingClientsService`,
`OwnerLoadService`, `DangerPulseService`) scored "unhappy client, nobody
replied" over every ingested thread. Investigating one customer's implausible
volume — Blue Ocean Pool Service, 45 flagged threads — showed the corpus was not
what the metric assumed.

We watch our own mailboxes, not clients'. In practice one:
`emailsentiment@mystartupcfo.com` (128,050 messages; `npradhan@` has 16). It is
a member of the per-client group ids the firm creates so a whole team can listen
on one client — `callrevu@mystartupcfo.com` and the like. Client mail sent to
one of those groups arrives carrying **our** address in `To:`. That is the
corpus these metrics are meant to measure.

Mail also arrives a second way. Clients auto-forward their own mail into the
address we gave them so their bookkeeper sees the traffic, and **a forwarded
message keeps its original `To:`** — no address of ours appears on it. Some
clients forward selectively; some forward everything. Blue Ocean contributed 925
threads of which **786 name no `mystartupcfo.com` or `mytaxfiler.com` address
anywhere**: homeowners writing about pool routes, Facebook lead alerts,
QuickBooks receipts. Real business mail, correctly ingested, never addressed to
us. Corpus-wide the second kind is 6,210 of 61,621 threads.

The two are separated by exactly one property — whether anyone of ours is on the
thread — which is what the predicate tests.

Corpus-wide this is **6,210 of 61,621 threads (10%)**, carrying 15,054 messages
of which **9,328 have been through LLM analysis** — still running, 1,376 in
August 2026 alone.

Nothing in the pipeline tested for it. The only gate before analysis is the
category classifier (`spam` / `marketing` / `transactional` / `automated`);
genuine business mail passes, so a homeowner's "Re: Your pool has been cleaned -
thank you!" received a full sentiment, churn and escalation pass.

**Decision:** Every management metric requires a participant resolved to a row
in `users` somewhere on the thread — `weAreOnTheThread()` in
`apps/api/src/addon/account-context.ts`.

`participant_type = 'user'` over a domain check: it agrees almost exactly
(Cognition IP 25/25, MerQube 138/138, Blitzz 53/53) while staying on an index
rather than unpacking address JSON per row — 83ms on the waiting-clients shape.
It also survives the fact that `mytaxfiler.com` is absent from the tenant's
configured domains. Applied at THREAD level; the flagged message is inbound from
the client by construction, so a message-level test would exclude every thread
it is meant to keep.

**Consequences:**
- Unanswered-angry threads, 90d: **380 → 297**. Two named account managers
  (3 threads and 2 threads) leave the list entirely — every thread attributed to
  them was forwarded mail they were never on.
- Reply-time medians are unchanged (negative 12.9h, other 15.1h). Expected:
  `first_reply_at IS NOT NULL` already self-selects threads we were on. The
  distortion lives wherever ABSENCE of a reply is the signal.
- Safe against group inboxes, the failure that would matter most — a group id is
  where a client's real mail lands. Group ids are registered as `users` rows
  (`callrevu@mystartupcfo.com` is one), so they pass the predicate like any
  staff address. Verified on the case: **all 43 callrevu threads are kept**, and
  no `@mystartupcfo.com` recipient in the corpus lacks a `users` row.
  **If group addresses are ever created outside `users` — a bare Google Group
  with no matching row — this predicate begins hiding real client threads, and
  silently, because the section renders empty rather than wrong.** First thing
  to re-check if a section goes quiet.
- **Fixed 2026-08-17.** The gate is now in
  `apps/api/src/emails/analysis-service.ts`, before the call to apps/analysis
  rather than after it. The category filter that already discarded these results
  ran *after* the model had answered, so the tokens were spent and the rows
  stored regardless; `isCustomerTraffic()` skips the call outright. See
  `prefilter/third-party.ts` for why the cut is the notification platform
  (poolbrain.com) and not the client (Blue Ocean Pool Service, whose books we
  keep and whose own mail must still be read).

### ADR-021: Non-client customers are recorded, not derived or hardcoded (2026-08-14)

**Status:** Accepted

**Context:** A customer record is not the same thing as a client, and the
management sections rank "unhappy client, nobody replied" over customer records.
Three kinds of counterparty sit in that table and none belongs in a client
review: vendors we buy from (SVB, Rippling, Bill), our own entities too small to
trip the staff-domain rule, and outsourced firms doing OUR delivery work.

The last kind is the one that cannot be detected. `chitrabatchuca.com` is a CA
practice in India working for MyTaxFiler — padmashree, pavithra, vaishali, payal
and chitra all send from it, and Chitra also holds `cbatchu@mystartupcfo.com`.
Their mail is our own back office. From the mail alone it is indistinguishable
from a client, and the allocation grid cannot separate it either: **grid
role-holders are 100% `mystartupcfo.com`**, so a partner firm has no
representation there at all.

**Decision:** A `customer_relationships` table records the verdict, one row per
customer, with a `note` saying who said so. `isAClient()` in
`apps/api/src/addon/account-context.ts` excludes them from `WaitingClientsService`
and `OwnerLoadService`.

**Not a constant in code.** That was tried: `blueoceanps` went into a hardcoded
NOT_CLIENTS list on the assumption it was one of our own domains. Blue Ocean
Pool Service is a real customer, and it was silently dropped from the management
review along with 45 threads. A constant is invisible to the people who would
catch the error immediately, needs a deploy to correct, and records no reason. A
row can be read, questioned and fixed by whoever owns the client list.

**Consequences:**
- **Absence means client.** Only non-clients are inserted, so the filter is a
  `NOT EXISTS`. A customer added tomorrow is a client by default — the safe
  direction, because a missing row shows up as a vendor in a review (visible)
  rather than a client vanishing from one (not). A test pins the polarity;
  inverting it would empty every section at once and look like good news.
- Seeded conservatively: **Chitrabatchuca only**, the one case confirmed.
  Rippling, Svb, Bill, Bank, Countsy and White Summers look like vendors and are
  deliberately NOT seeded — looking like one is not knowing. They stay visible in
  the named unallocated row (ADR-020) so someone who knows can triage them.
- The seed is separate from the table definition, so the mechanism can be applied
  anywhere while the judgements stay reviewable.
- `customer_allocations` and `customer_relationships` are raw-SQL tables with no
  Drizzle definitions, following the precedent set by the former. If either grows
  a write path beyond these migrations, that should be revisited.

### ADR-022: Management sections name clients and people, not counts (2026-08-14)

**Status:** Accepted — retires the card section from ADR-020's follow-up

**Context:** The panel could say the firm's median reply to angry mail was 12.9h
and that N threads were unanswered. Neither tells a manager where to spend an
afternoon or who to call. "Account managers carrying it" counted unanswered
angry threads per person and, once the corpus was scoped correctly (ADR-020,
ADR-021), its top real manager carried **two** — a section occupying prime panel
space to report noise.

**Decision:** Two sections replace it.

**Where the fires are** — by CLIENT: negative threads in 90 days, how many are
unanswered, age of the oldest, and the account manager to call.
`Deserve, Inc. — 18 unhappy, 8 unanswered, oldest 74d, Sukrati Gupta`.

Ranked by unanswered first, then total. Unanswered is the part the firm
controls: eighteen complaints all answered is a difficult client; eight
unanswered is our failure, and only the second is a reason to call someone
today.

One angry email is noise. Measured over 90 days: **135 clients have exactly one
negative thread, 40 have two, 51 have three or more.** Ranking that tail beside
a client with nine open complaints is what makes a review unreadable.

**Slowest to answer angry mail** — median hours to first reply per account
manager, against the firm's own median. The spread is the finding: **79.3h over
10 threads and 50.1h over 22, against 12.9h firm-wide** — six and four times.
Attributed by ALLOCATION, not by who replied: `first_reply_by_id` is 7%
populated, and the question is accountability rather than authorship.

**Consequences:**
- Every fact the retired section carried survives in a better shape. The owner
  is named per row, and an unallocated client shows as "no account manager"
  against its actual damage instead of pooled into one bucket. The customer
  naming added to `OwnerLoadService` is no longer read by the panel; the service
  and `/owner-load` remain as a role-parameterised API surface.
- `OwnerLoadView`, the `ownerLoad` card parameter and `getOwnerLoad` were
  deleted rather than left as a type with no renderer.
- **The two sections are only correct read together.** Only ANSWERED threads have
  a duration, so someone who ignores angry mail entirely cannot appear in the
  slow list and looks better than someone who answers slowly. That limitation is
  printed on the card, not just recorded here.
- Minimum sample of 5 threads, and the count is shown beside every median. A
  person named as slowest cannot argue with a number whose basis is hidden.
- The fires deep link uses `customer=`, **not** `customerId=` — the param
  `apps/web/app/escalations/page.tsx` actually reads. A wrong name does not
  error; the page loads unfiltered, so the link looks like it works while
  showing everything. Caught by `deeplink.test.ts`, which exists for this.

### ADR-023: Training labels come from a panel with opposed priors (2026-08-16)

**Status:** Accepted

**Context:** The embedding gate is trained on 1,058 positives that
`gemini-2.5-flash` produced under sentiment prompt v1.5 — the version that scored
a request as neutral even when the request implied we had failed. v1.7 fixed the
prompt, but the training labels still carry the old reading, in both directions:
complaints filed as neutral, and neutral mail filed as complaints. A single
judge's errors are systematic rather than random, so they arrive in the training
set as a consistent, learnable, wrong pattern, and more rows of it do not help.

Voting across several judges corrects less than it appears to. Three cloud models
given identical instructions agreed unanimously on three non-complaints in a
49-email hand-coded sample. Two local models turned out to be nested rather than
independent — `qwen2.5:32b`'s YES set was a strict subset of `gemma3:27b`'s, so
their agreement carried nothing their disagreement didn't.

Asking each judge a different question is worse, and the failure is worth
recording. A panel judging stance, consequence, and repetition separately scored
**33% precision** where all three agreed — below every individual judge. Votes
combine only when they are votes on one proposition; three answers to three
questions are three facts, and unanimity across them is an accident.

**Decision:** Hold the question fixed and oppose the **prior**. The same model,
asked the same thing, told once that missing a quiet grievance is the
unforgivable error and once that crying wolf is, moves across the whole operating
range:

| judge | recall | precision |
|---|---|---|
| `gemma3:27b` as advocate | 100% | 43% |
| `gemma3:27b` as defender | 70% | 88% |
| `qwen2.5:32b` as advocate | 90% | 69% |
| `qwen2.5:32b` as defender | 60% | 92% |

One model spans 43–88% precision on identical inputs, which makes the prior a
stronger lever than the choice of model. Labelling rule, in
`apps/api/scripts/label-panel.py`:

- both **defenders** say yes → positive label (92% clean)
- both **advocates** say no → negative label (0 complaints lost)
- anything else → **discarded, unlabelled**

**Consequences:**
- About a third of mail comes back unlabelled at high prevalence, and that is the
  product rather than a shortfall. The discarded band is where the judges
  disagree, and a label there would be a guess written into the training set as a
  fact.
- Two ends, two uses: the defender end builds positives that are clean enough to
  train on, the advocate end builds negatives that are safe to assume contain
  nothing. A single threshold cannot be both.
- The panel is local (`ollama`) and runs once per corpus, not per message. The
  same text is judged four times, tens of thousands of times over, and nothing
  leaves the machine.
- `nemotron-3.5-lightning:30b-mlx` is excluded. It returns its answer only inside
  a thinking block, and scored 15% recall even when that block was read. A judge
  that will not answer the question counts as NO, which is safe but useless.
- Calibrate before trusting any run: `label-panel.py calibrate` scores the panel
  against the hand-coded set. The 92%/0% figures are measured on 49 emails at 41%
  prevalence and will move on a corpus at 3%.

### ADR-024: The gate ratchets, and the encoder stays frozen (2026-08-16)

**Status:** Accepted

**Context:** The pre-filter is meant to improve as it runs — every message the LLM
judges becomes another training row. The obvious objection is that the loop is
closed: the gate picks what gets labelled, so it learns from its own choices,
gets better at what it already ranks highly, and goes blind to what it buries.
Worse, its measured recall would climb while true recall fell, because the only
mail available to measure is mail the gate chose. This is the standard failure of
a deployed ranker trained on its own logs.

Simulated over the corpus: 1,500 seed labels, then 12 rounds of new mail where
anything the gate dropped is recorded as "not a complaint" — the poison this
objection predicts. True recall measured on held-out mail the loop never touched.

| gate sends | start | after 12 closed rounds | with 10% random exploration |
|---|---|---|---|
| 40% | 79% | **88%** | 90% |
| 20% | 58% | **66%** | 69% |
| 10% | 42% | **47%** | 47% |
| 2% | 14% | **17%** | 16% |

It does not rot. It improves at every operating point, and exploration adds
nothing beyond noise.

**Decision:** Ratchet the classifier, never the encoder. `nomic-embed-text` stays
frozen; retraining fits only the logistic layer over vectors that never move.
Keep a small random exploration slice regardless of the result above.

**Consequences:**
- **The frozen encoder is what makes the loop safe, and is therefore
  load-bearing rather than a convenience.** A buried complaint sits near the
  caught ones in a space that does not shift, so learning from what was caught
  drags the boundary toward what was missed. Fine-tuning the embedder would let
  the map itself drift toward whatever the gate kept feeding it, and the loop
  would close for real.
- Fine-tuning is ruled out twice over: it would also invalidate every vector in
  `emails.embedding`, and `berne-whiskers.ts` would correctly fail open on the
  model-name mismatch until 135k rows were recomputed.
- **The random slice is a thermometer, not a corrective.** It is the only mail
  not selected by the thing being measured, so it is the only way to notice rot
  if it ever starts. Measuring the gate solely on mail the gate chose is the
  exact error made against the shipped coefficients this same day.
- No cost argument survives for a tight gate: full LLM coverage of every client
  email is roughly $7/month at current volume. The gate earns its place on
  latency and on ordering the queue, not on the bill.
- The simulation grades against v1.5 LLM labels, so it demonstrates the loop
  recovering *that judge's* opinions. A blind spot shared by the judge and the
  gate is invisible to it, which is a further argument for the random slice.

### ADR-025: Synthetic mail is a cold start, not a supplement (2026-08-16)

**Status:** Accepted

**Context:** LLM-generated client/firm correspondence is free and unlimited, so it
is a standing temptation for enlarging the training set. Tested properly: 3,000
messages from `gemini-3.1-flash-lite` across 30 scenarios and 8 registers, in two
shapes — standalone emails, and the final client message of a generated
three-turn thread — embedded with the same `nomic-embed-text` and added to the
real training half.

| synthetic rows added | catch@20% | gain | 90% CI |
|---|---|---|---|
| 500 | 71% | +1.7 | [-1.7, +5.1] |
| 1,000 | 70% | +1.9 | [-1.5, +5.4] |
| 2,000 | 71% | +1.3 | [-2.8, +5.3] |
| 3,000 | 70% | **+0.6** | [-3.5, +4.8] |

**Decision:** Do not add synthetic mail to a model that has real labels. Keep it
for cold start only — trained on synthetic alone, with no real emails at all, the
gate reaches 54% catch@20%, which is a working day-one filter for a new tenant.

**Consequences:**
- **The gain shrinking with volume is the finding**, not the small numbers. A
  real effect narrows toward a stable value as rows are added; this decayed
  toward zero with an interval as wide as it started. An early +3.3 from 480 rows
  was noise, and six times the data disproved it. Any future synthetic
  experiment should be judged on whether the interval tightens, never on a point
  estimate from a small batch.
- **Thread-generated messages were the worst, at -1.3 points and winning 27% of
  resamples.** Instructing a generator to write understated complaints makes them
  resemble its neutral mail, and the class separation the model needs disappears.
  Realism and learnability pull in opposite directions here.
- **Reading the samples predicts nothing.** The thread messages were judged
  markedly more realistic by eye and sit at 0.725 cosine from real mail —
  identical to the crude standalone emails, to three decimals, with both 100%
  separable from real mail by a trivial classifier. Do not accept "it reads like
  real email" as evidence for any synthetic corpus.
- The 100% separability is the ceiling. Whatever the generator leaves on the
  text, the embedding sees it, so past some volume the model learns
  synthetic-ness rather than complaint-ness. That is consistent with the decay
  above.

### ADR-026: Worked examples retrieved per mailbox, instead of a written rulebook (2026-08-17)

**Status:** Superseded by the measurement below — shipped, disabled, and it stays
disabled. The code and the reasoning are kept because the design is sound and the
result is not obvious; anyone proposing this again should read what happened.

**OUTCOME (2026-08-17, full pool).** Against 35,653 vectors — every judged email
embedded — retrieval made the classifier worse:

| | catches | false alarms |
|---|---|---|
| as production runs now | **19/20** | **8** |
| with retrieved examples | 18/20 | 10 |

Verdicts flipped on 5 of 50 emails; net one complaint lost and two false alarms
gained. Three measurements in total:

| test | pool | result |
|---|---|---|
| offline, simple nearest-10 | 35,507 | parity (18/20 vs 19/20, 9 vs 9) |
| live, sparse | 4,040 | −0 caught, +1 false alarm |
| live, full density | 35,653 | −1 caught, +2 false alarms |

**The sparse-pool explanation was wrong.** It was the stated reason for re-running
after the backfill, and density did not rescue it. On 50 emails a gap of one or
two is inside noise, so the claim is not "retrieval harms" — it is *no evidence of
benefit across three attempts, with the excuse now removed*.

A plausible reading: the hand-written rules encode judgements no set of ten
neighbours conveys, and worked examples of a 3%-prevalence class mostly teach the
model what ordinary mail looks like — which it already knew.

**Context:** The sentiment prompt is 11,546 characters of hand-written rules
describing what a complaint looks like. Adding one rule about chased timelines
(v1.8) contradicted two existing clauses stating the same emails were neutral,
and both had to be found and rewritten by hand. That is the maintenance cost of
a rulebook, and it grows.

Measured on the 49 human-judged emails, three ways of telling the model what a
complaint is are indistinguishable:

| approach | caught | false alarms |
|---|---|---|
| 11,546 chars of hand-written rules | 19/20 | 9 |
| 28 fixed real examples | 18/20 | 9 |
| 10 examples retrieved per email | 18/20 | 9 |

Equal scores are the argument, not a tie. The rules cost ongoing effort and buy
nothing over examples the system already holds. The identical nine false alarms
across all three say the remaining errors are not a wording problem.

**Decision:** Retrieve the ten nearest already-judged emails from the SAME tenant
by vector similarity and place them between the instructions and the email.
Shipped behind `SENTIMENT_EXAMPLES_ENABLED`, off unless exactly `'true'`.
Examples are ADDED to the instructions rather than replacing them — there is no
evidence for dropping the rules, and doing both at once would make a regression
impossible to attribute.

**Consequences:**
- **Three design flaws were found by querying real mail, none visible to 234
  passing tests**, because those mock the database:
  1. The three nearest neighbours were the same THREAD. Replies quoting each
     other are near-identical in embedding space, and some carry the verdict for
     the very exchange being judged — the model would be shown the answer and
     score well for the wrong reason. The whole thread is now excluded.
  2. All ten neighbours came back neutral. At 3% prevalence that is the normal
     case, and a model shown ten neutral examples learns the mailbox is neutral —
     the exact bias the product exists to correct. Retrieval now ranks within
     each class and takes the closest of each.
  3. The pool still contained `poolbrain.com` homeowner complaints, correctly
     labelled negative and wrong to teach from (ADR-025 territory). Filtered
     until the labels themselves are corrected.
- **Per-tenant is the real prize.** A client who writes tersely and one who
  buries the ask in pleasantries are each judged against their own history, and
  nobody tunes a prompt per customer. The tenant filter is in the SQL rather than
  applied to results, because these rows are pasted verbatim into a prompt.
- The flag is read from `process.env`, not `getEnv()` — `getEnv()` validates the
  whole environment and calls `process.exit(1)` on a miss, so routing an optional
  feature through it would let an unrelated missing variable kill the service on
  a cold path, uncatchable.
- **Not yet demonstrated.** A pre-flight over the same 49 emails against the live
  pool showed no complaints gained and one extra false alarm, with verdicts
  changing on 7 of 49. The live pool was 4,040 rows against the 35,507 the
  offline test used, so the most likely explanation is a sparse pool rather than
  a failed idea. Re-run after the full backfill before enabling.

### ADR-027: Escalation risk is a posterior, and engagement is the evidence that moves it (2026-08-17)

**Status:** Accepted.

**Context:** The panel ranks clients by risk, and two candidate signals were
available: how much a client is writing, and whether we are in a live exchange
with them. Ranking them requires asking what a panel row actually has to answer —
given what is visible this week, what is the chance this client complains next
week — over a population of all clients rather than clients already known to have
complained. At a 5.7% base rate the two framings differ by an order of magnitude.

**Decision:** Treat every panel signal as a posterior — P(complains next week |
what we can see) — and measure it as the alert it will be: fire on every
client-week, then count what followed. Report lift against the 5.7% prior, never
a rate conditioned on the outcome.

Measured that way, the evidence ranks:

| what we know this week | client-weeks | P(complains next week) | vs prior |
|---|---|---|---|
| volume doubled, nobody replying | 1,131 | 4.4% | 0.8× |
| volume doubled | 2,658 | 7.2% | 1.3× |
| accelerating three weeks running | 995 | 7.5% | 1.3× |
| in a real back-and-forth with us | 1,032 | 16.1% | 2.8× |
| complained in the last four weeks | 1,181 | 16.9% | 3.0× |
| **both** | 384 | **24.7%** | **4.4×** |
| both, complaints still unanswered | 215 | 27.0% | 4.7× |

Engagement and a recent complaint carry independent evidence and compound.
Volume and acceleration do not: bolted onto the pair they move 24.7% to 25.0% and
23.7% respectively while discarding most of the coverage. They look predictive
alone only because loud weeks are mostly engaged weeks.

**Consequences:**

- `FiresService` orders by `engaged DESC, unanswered DESC, negative DESC`.
  Engagement separates 24.7% from 13.0%; unanswered separates 18.3% from 14.5%.
  An engaged client with every complaint answered (21.9%) outranks an unengaged
  one with complaints still open (14.7%). Unanswered sorts second and stays
  visible because it is the part the firm controls and the reason to reply today;
  it is simply not what says the client is still working themselves up.
- `Fire` carries `engaged`; the card shows "In conversation" and only when true.
  It leads the grey line, because it decides the sort and a reader who cannot see
  why the order changed reads the order as arbitrary. Optional on both sides of
  the seam: the addon and crm-api deploy independently and absent must render as
  no marker, never a wrong one.
- The "Talking more than usual" section is worth 2.4×, and keeps its slot for
  what it uniquely does: among clients with no complaint on file, engaged plus
  above twice usual volume reaches 13.7% against 11.0% for engaged alone. It is
  the only signal in the panel that fires before anything is on file.
- The `we_replied >= 3` filter is load-bearing, not hygiene. Volume without
  replies runs 4.4%, BELOW the base rate: an unattended spike is a notification
  stream, not a person getting angrier.
- Run-up statistics — anything measured over clients already known to have
  complained — are footnoted in `docs/EXPERIMENTS.md` rather than quoted as
  alert rates. The two differ by roughly an order of magnitude at this prior.
- TAT coverage will fall. Teams that answer from an address the customer is not on,
  or that reply to a thread's To list rather than its sender, now leave those emails
  permanently unanswered — they move from the TAT average into the pending bucket
  and never come back, since the replies are gone. This is the first thing to check
  if coverage drops after this ships.
- Metrics are inconsistent across the cutover date by design (no backfill).
- `first_reply_by_id` is written but not yet read: no API, export, or UI surface.
  Reporting on first responders is follow-up work.
- Alias and plus-addressed senders resolve to a null replier; normalizing them was
  explicitly left out of scope.

---

### ADR-002: Affected-row counts go through `affectedRows()` (2026-08-06)

**Status:** Accepted

**Context:** While rewriting `runFirstReplyUpdate` (ADR-001), the first-reply
integration suite — which had never actually been runnable — showed
`applyFirstReplyMarkers` returning `updatedCount: 0` even though rows were being
updated correctly.

A codebase sweep found the same bug at five more `db.execute(...)` call sites, all
of them the customer-merge reassign helpers: `emails.reassignParticipantCustomer`,
`customers.reassignDomains`, `contacts.reassignCustomer`, `tasks.reassignCustomer`,
and `users.reassignCustomer`. Every one returned 0 regardless of how many rows it
moved, so `CustomerService.merge` reported `movedDomains: 0, movedContacts: 0,
movedTasks: 0, movedEmailParticipants: 0, movedUserAssignments: 0` on every
successful merge.

**Decision:** Add `affectedRows(result)` to `@crm/database` — the package that
already owns driver setup, and so the right place for driver-shape knowledge — and
use it at all six call sites. It prefers `count` (postgres.js, taken from the
command tag), falls back to `rowCount` (node-postgres), and returns 0 only when
neither is a number. Reaching into the result directly is now the thing to flag in
review.

The type guard matters: `?? 0` on a non-numeric field would let a string `count`
through and propagate nonsense. Verified against a real postgres.js connection —
an UPDATE touching 17 rows returns 17, and a genuine no-op still returns 0.

**Consequences:** `POST /api/internal/emails/first-reply-markers` now reports a
truthful `updatedCount` to the Gmail sync, the "Updated firstReplyAt" info log —
the operational signal that TAT capture is working at all — fires for the first
time, and customer merges report real counts instead of zeros. Callers could not
previously distinguish a successful merge from a no-op.

Note this counts rows *written*, not rows *returned*: for statements with a
RETURNING clause, use the length of the returned rows instead.

---

### ADR-003: Integration suites mock the logger (2026-08-06)

**Status:** Accepted

**Context:** `first-reply.integration.test.ts` failed at import time with
`Cannot find module '../env'` — `utils/logger.ts` lazily `require()`s `../env`,
which doesn't resolve under vitest's transform. The suite is `describe.skipIf`'d
without `TEST_DATABASE_URL`, so this was invisible in CI and the tests had never
run anywhere.

**Decision:** Mock `../utils/logger` in the suite, alongside the existing
`../inngest/client` mock. Running it also needs the env vars `getEnv()` validates:

```bash
TEST_DATABASE_URL=postgres://... GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=x \
  SERVICE_GMAIL_URL=http://localhost:4002 SERVICE_ANALYSIS_URL=http://localhost:4003 \
  pnpm --filter @crm/api exec vitest run first-reply.integration
```

**Consequences:** The suite runs. A skipped integration suite is not evidence of
anything — new DB-backed tests should be executed against a real Postgres before
being trusted, and any future integration suite needs the same two mocks.

---

### ADR-004: Escalations are assignable to any user in the tenant (2026-08-06)

**Status:** Accepted

**Context:** Escalation assignment was bounded by the reporting hierarchy. The
assignable-users dropdown returned every active user for admins but only the
caller's subordinates for everyone else — a non-admin with no reports saw an
empty list and could not hand off an escalation at all. Auto-assignment
(`TaskService.autoAssignTask`) drew from a different source again: the
customer's team (`user_customers`, Controller then Account Manager).

In practice the person who can resolve an escalation is often neither a
subordinate nor on that customer's team. Three things blocked assigning to them:

1. The dropdown did not offer them.
2. `TaskService.reassign` re-read the task through a scoped query *after* the
   update, so handing a task outside the caller's hierarchy made the caller lose
   access to it and the re-read return nothing — dropping both the API response
   and the assignment email. `create()` had the same flaw.
3. Even if assigned, the escalation list and detail queries were scoped by
   `user_accessible_customers`, so the assignee saw nothing on login.

**Decision:** Assignment is tenant-wide, and being assigned grants visibility of
that one item.

- `TaskRepository.getAssignableUsers` returns all active users in the tenant
  (excluding self) for every caller. Authority to assign stays where it belongs:
  the `TASK_EDIT` permission on `PUT /api/tasks/:id/assign`.
- Post-write reads in `TaskService.create`/`reassign` use the new
  `findByIdWithRelations` (tenant-scoped, no per-user access check) rather than
  `findByIdScoped`. The caller was already authorized against the pre-update row;
  re-checking after the write is what broke the hand-off.
- Direct assignment became a second access path alongside customer access, in
  `TaskRepository.buildTaskFilters`, `getRecentEscalationsScoped`, and the new
  `EmailRepository.analyzedEmailAccessFilter` (shared by the analyzed-email
  search, export, and single-item queries).
- `TaskRepository.hasTaskAccess` — the gate on reassign/resolve/reopen/comment —
  is now `customer access OR assigned to me`, the union of what the two list
  surfaces show, instead of a hierarchy-only rule. Without this, widening
  assignment created two dead ends: an off-team assignee could not hand an
  escalation back, and a user with customer access lost control of any task they
  assigned outside their own hierarchy while still seeing it listed. Reporting
  hierarchy is not an arm here — neither surface grants visibility on hierarchy
  alone, so admitting it would allow writes to invisible tasks.
- `getAssignableUsers` includes the caller, so taking an escalation back is just
  picking your own name. A "Me" label was tried and dropped: the web app's
  `useAuth().user.id` is the better-auth session id, not `users.id` (the two
  tables have independent keys; the server maps between them by email in
  `user-context.ts`), so nothing could reliably identify the caller's own row
  client-side. Listing everyone by name needs no such mapping.
- `TaskMetaInfo` gained a pinned "Remove assignment" footer below the user list.
  The API already accepted `assignedToId: null`, but no control ever sent it, so
  an assignment could be handed on and never undone. It is pinned rather than
  listed because the roster is tenant-sized — a last row would need scrolling to
  reach and would vanish whenever a search filtered the list.
- A `task.unassigned` notification accompanies that action. Removal is not a
  neutral event under the narrow-grant model: for an assignee outside the
  customer's team, being assigned *was* their access, so clearing it makes the
  escalation vanish from every list they can see. Without the email they would
  never learn it happened. `reassign()` therefore captures the outgoing assignee
  before the write, since the updated row no longer carries it.

  The email deliberately has **no deep link** — the recipient may have just lost
  the only path they had to that escalation, so a link would 404 for exactly the
  people who most need telling. It names the customer and subject instead. It
  also has no opt-out toggle in settings, unlike `task.assigned`: losing work
  assigned to you is not notification noise.

  Both ends of a move are notified independently: handing an escalation from A
  to B tells B it arrived and tells A it left. A loses access on a hand-off
  exactly as they would on removal, so the two cases are the same event from
  A's side. The template covers both — on a hand-off it names who holds it now,
  so A knows where to send their notes; on a removal it does not, because
  nobody does.

  Neither notification fires when the actor is also the subject (taking an
  escalation, or dropping one you hold, are things you just did on screen), nor
  when the assignee did not actually change.
- The outgoing assignee is returned by the UPDATE itself (a CTE reading the
  pre-write snapshot in `TaskRepository.reassign`) rather than by a preceding
  SELECT. A separate read leaves a window in which a concurrent reassignment
  changes the assignee in between, which would mail the unassignment notice to
  someone who no longer held the task while the person who actually lost it
  heard nothing — the exact failure the notification exists to prevent.
- `create()` and `reassign()` now validate the assignment target
  (`assertAssignableUser`): it must resolve to an active user in the caller's
  tenant. The route only checked that the id parses as a UUID, and the
  repository authorizes the *caller* against the task, never the *assignee* —
  while `tasks.assigned_to_id` references `users.id`, which is not
  tenant-scoped. Without the check the FK accepts a deactivated account,
  stranding the escalation with an assignee who cannot log in, or an id from
  another tenant, whose address would then receive an assignment email naming
  this tenant's customer and email subject. `autoAssignTask` filters to active
  members for the same reason, so an offboarded Controller falls through to the
  Account Manager instead of blocking auto-assignment for that customer.
- The `task.assigned` email is unchanged and now actually reaches off-team
  assignees. Its only remaining gate is the existing "is this escalation
  openable" check (the link must resolve) plus the user's own notification
  preference — neither is about team membership.

Rejected alternative: filtering the dropdown to the customer's team (which would
have made manual and auto assignment consistent). It fails the actual
requirement — escalations frequently need someone outside that team.

**Consequences:**
- Any user can be handed any escalation. The grant is narrow: the assigned item
  only. `user_accessible_customers` is untouched, so the customer's other emails,
  contacts, and records stay invisible to them.
- Aggregate customer metrics (TAT, upsell counts, dashboard rollups) keep the
  customer-only filter deliberately — holding one escalation must not pull a
  customer's numbers into someone's dashboard.
- Manual and automatic assignment now use different sources by design:
  auto-assign still prefers the customer's Controller/Account Manager, manual
  assignment is unrestricted.
- `TaskRepository.getSubordinates` is no longer used by assignment; it remains a
  general-purpose hierarchy accessor.
- Mutating an *unassigned* task now requires customer access, where previously
  any user in the tenant could. No list ever surfaced those tasks to users
  without customer access, so this closes a gap rather than removing a path.
- Documented in [ACCESS_CONTROL_DESIGN.md](./ACCESS_CONTROL_DESIGN.md) under
  "Direct Assignment"; covered by `apps/api/src/tasks/repository.test.ts` and
  `apps/api/src/emails/__tests__/analyzed-email-access.test.ts`.

### ADR-005: First-reply markers match threads by tenant, not integration (2026-08-12)

**Status:** Accepted

**Context:** `first_reply_at` was populating for only a fraction of customer
emails — 11.5% overall — and production logs showed the reply-marker path
rejecting 65% of the replies it was handed (1,160 of 1,786 over two days), with
`updatedCount: 0` the only trace.

The cause was in `setFirstReplyForProviderThreads`, which resolved a reply's
thread with:

```sql
JOIN email_threads et ON et.id = e2.thread_id
 AND et.tenant_id = $tenantId
 AND et.integration_id = $integrationId
```

Scoping by integration mirrors the `email_threads` uniqueness of
`(tenant_id, integration_id, provider_thread_id)`, so it reads as correct. But
reconnecting a Gmail mailbox creates a **new `integrations` row**, and the same
Gmail threads then acquire a second set of `email_threads` rows under the new id.
Reply markers are submitted under whichever integration is current, so every
reply to a thread first seen under an earlier connection matched nothing.

One mailbox (`emailsentiment@mystartupcfo.com`) had been reconnected three times,
fragmenting 66,527 thread rows across three integrations — only 30,300 (46%)
under the active one. That 46% is exactly the observed marker match rate, and the
answered rate fell off by integration age: 16.1% (active), 10.1%, 1.1% (oldest).
62,562 unanswered customer emails sat on superseded threads, 9,008 of them on
Gmail threads still receiving mail.

Ruled out on the way: `is_customer_email` eligibility (no NULL rows), the
originator rule (93% of threads carry a single sender, so it can rarely reject),
recipient normalization, missing threads, and timestamp/timezone handling.

**Decision:** Match a reply's thread on `(tenant_id, provider_thread_id)` across
every integration of the tenant. `integrationId` remains a parameter but is used
only for log context, never for matching.

A provider thread id is unique per mailbox and the originator rule still gates
which email a reply may answer, so widening to the tenant cannot attach a reply
to an unrelated conversation. Where a Gmail thread has rows under several
integrations, all of them match; `DISTINCT ON (e2.id)` still yields one winning
reply per email.

Adds `idx_threads_tenant_provider_thread (tenant_id, provider_thread_id)`
(migration 014). Every other index on `email_threads` leads with `integration_id`,
which leaves the widened lookup to a PostgreSQL 18 skip scan — one index search
per distinct integration — or a sequential scan before PG18.

**Consequences:**
- Replies now attach to customer emails regardless of which connection first
  stored the thread. Verified read-only against production: a real reply replayed
  against one orphaned thread matched **0 emails under the old join and 5 under
  the new**.
- Historical TAT is **not** recoverable. Reply messages are never stored, so the
  62,562 orphaned emails can only be populated by replies arriving from now on.
- **Average TAT will jump on deploy.** All 62,562 orphaned emails become
  matchable — the widened join no longer requires a thread row under the active
  integration, so a reply arriving for a Gmail thread whose only rows sit under
  superseded integrations now matches too. (9,008 of them are on threads already
  known to be live under the active integration; that is a floor on how many will
  actually be reached, not a ceiling.) A reply landing today on an email received
  in April yields a delta of ~3,000 hours. `getTatMetrics`
  (`apps/api/src/emails/repository.ts:1263-1285`) averages
  `first_reply_at - received_at` with no upper bound; `dateFrom`/`dateTo` are
  optional and constrain `received_at`, not `first_reply_at`, so any all-time or
  wide-window view averages these recovered outliers in. The numbers are
  genuine — the emails really did go unanswered that long — but the shift is an
  artifact of this deploy, not of changed team behavior. Operators should expect
  it; capping or winsorizing the average is a separate decision.
- The root cause is untouched: reconnecting a mailbox still creates a new
  `integrations` row rather than updating the existing one (14 rows exist for this
  one mailbox). This ADR makes first-reply immune to that fragmentation; it does
  not stop the fragmentation, which also splits any other per-integration query.
- The sync path is **only partly** immune, and is NOT fixed here.
  `setFirstReplyForThreads` itself is keyed by internal `thread_id`, so its UPDATE
  never had the defect — but its caller does. The reply-only branch of
  `saveThreadWithEmailsTransactionally`
  (`apps/api/src/emails/service.ts:614-627`) resolves the thread with
  `UPDATE email_threads ... WHERE tenant_id = ? AND integration_id = ? AND
  provider_thread_id = ?`. For a thread first stored under a previous
  integration, that matches no row, so the batch returns `noopResult`,
  `setFirstReplyForThreads` is never called, and it logs "Reply received before
  its thread exists" — which misattributes the cause, since the thread does exist
  under the prior integration. That path is not exercised in production today
  (Gmail's domain blacklist drops tenant-domain senders before storage, so every
  reply arrives through the marker path), which is why it is left for a follow-up
  rather than fixed here — but narrowing the blacklist, or onboarding a tenant
  with no blacklisted domains, would reintroduce the exact bug this ADR fixes.
- `updatedCount` still cannot distinguish "already answered" from "no candidate
  matched"; the 65% figure conflated both. Logging a rejection reason remains
  worthwhile follow-up.

### ADR-006: An integration is identified by its mailbox, connected or not (2026-08-12)

**Status:** Accepted

**Context:** Production tenant `9f34e10b-…` held 14 `integrations` rows, all
`source='gmail'`, and 13 of them were the *same* mailbox
(`emailsentiment@mystartupcfo.com`). Three of those own `email_threads`:

| integration | created | threads | emails | is_active |
|---|---|---|---|---|
| `019d5fae-…` | 2026-04-05 | 12,344 | 22,940 | false |
| `019e733d-…` | 2026-05-29 | 23,883 | 46,989 | false |
| `019f1c7a-…` | 2026-07-01 | 30,311 | 60,189 | true |

`IntegrationService.createOrUpdate` was already written to be idempotent — it
looked the mailbox up and only inserted on a miss. The lookup was the problem:
`findIdByEmail` filtered `is_active = true`. Disconnecting a mailbox flips
`is_active` to false (and `deactivate` does it for *every* row of that
tenant+source), so on the next OAuth reconnect the lookup matched nothing and the
service took the insert branch. Every disconnect/reconnect cycle minted another
row.

Everything else about the lookup was sound, and was checked against production
before changing it: `parameters` is a JSONB array of `{key, value}` and the `@>`
containment predicate matches all 13 rows; the stored address is byte-identical
across every row, so case sensitivity was not a factor; the OAuth callback does
call `createOrUpdate` rather than inserting directly. Removing one `AND` is the
entire root cause.

The damage came from `email_threads` being unique on
`(tenant_id, integration_id, provider_thread_id)`: a new integration id makes the
same Gmail thread eligible for a second row, so one conversation now exists as 2
or 3 partial thread rows. Measured: 5,515 `provider_thread_id`s are duplicated
(5,302 across two integrations, 213 across three), accounting for 5,728 redundant
thread rows and 16,849 emails sitting under a non-surviving thread.

**Decision:**

1. **Identity ignores connection state.** `findIdByEmail` is replaced by
   `findByTenantAndEmail`, which drops the `is_active` filter and returns
   `{ id, isActive }`. A mailbox this tenant has ever connected resolves to its
   existing row, so a reconnect updates instead of inserting.
2. **Ordering prefers the live row, then the newest.** The old lookup ordered by
   `created_at ASC`. For a tenant already carrying duplicates that would revive
   the *oldest* row — for this tenant a 2026-03-24 row with zero threads — and
   send all future ingest there. `is_active DESC, created_at DESC, id` picks the
   connected row, or failing that the one holding the most recent threads.
3. **Reconnect resets stale sync state.** Reviving a row is not the same as
   creating one, and the difference is `last_run_token` — a Gmail historyId.
   Gmail rejects historyIds older than about a week, and `incrementalSync` only
   degrades to a full sync when the cursor is *absent*, so a revived row would
   throw where a fresh row used to just backfill. `updateKeysById(..., {
   reactivate: true })` therefore clears `last_run_token`, `last_run_at`, the
   watch timestamps (the watch was stopped at disconnect; a stale future expiry
   suppresses renewal) and the access token.
4. **Merges read from the row being written.** `updateKeysByEmail` resolved the
   right integration id and then pulled the current parameters from
   `getCredentials(tenantId, source)`, which returns an arbitrary *active* row for
   the tenant. With two mailboxes connected — this tenant also has
   `npradhan@mystartupcfo.com` — that copied one mailbox's parameters onto the
   other. `updateKeysById` reads by id. It also writes both `refresh_token` and
   the legacy `token`, because `getCredentials` prefers the former: writing only
   the legacy column left a previously rotated refresh token winning over the one
   the reconnect had just issued.
5. **Identity is case-insensitive on both sides.** Addresses are
   case-insensitive, so `Ops@acme.com` and `ops@acme.com` are one mailbox.
   Writes lowercase every mailbox-bearing key, and the lookup compares
   lowercased rather than by byte-exact JSONB containment. The two halves are
   required together: with a lowercasing unique index in place, a lookup that
   missed on case would fall through to INSERT and violate the index, turning
   what used to be a silent duplicate into a failed OAuth callback.
6. **One key set everywhere.** A mailbox can be stored under `email`,
   `impersonatedUserEmail` or `userEmail` — `getIntegration` and `listByTenant`
   already fall back across all three. The identity lookup and the unique index
   now cover the same set (`EMAIL_PARAMETER_KEYS`), so a row keyed under a later
   spelling can no longer resolve for Gmail webhooks but not for reconnects.
7. **Auth strategy follows the credentials.** The update branch writes
   `auth_type`, and re-authorizing over OAuth deletes any `serviceAccountEmail` /
   `serviceAccountKey` the row carried. `GmailClientFactory.getClient` tests
   those *before* the OAuth branch, so merging them forward would keep the row
   authenticating as a service account and never exercise the new grant.
8. **A partial unique index as the backstop** (migration 015):
   `uniq_integrations_active_tenant_source_email` over
   `(tenant_id, source, lower(COALESCE(<the three mailbox keys>))) WHERE
   is_active`. It is an expression index because the mailbox lives inside a JSONB
   *array*, and it COALESCEs in the same precedence the API uses to derive
   `connectedEmail`. Only the Gmail webhook lookup (`findByEmail`) still uses
   byte-exact containment — it runs on every notification and depends on
   `idx_integrations_parameters_gin` to avoid the full table scans migration 012
   exists to prevent. Gmail delivers lowercase addresses and writes are
   normalized, so the two agree in practice.

**Why the index is partial.** The invariant worth having is one row per mailbox
regardless of `is_active`, but that index cannot be built: the 13 legacy rows
violate it and `CREATE UNIQUE INDEX` would fail on production. The partial form
builds cleanly today (verified: zero collisions across all tenants) and covers
the state every read path actually filters on. It does not by itself stop the
original bug — inserting a new active row while the old ones are inactive
satisfies it — so the code fix, not the index, is the primary guard here. The
strict index ships with the merge below.

**The existing split data — recommended, NOT yet run.** Nothing here has been
applied to production; it needs sign-off first. Collapsing the three integrations
onto `019f1c7a-…` cannot be a plain `UPDATE email_threads SET integration_id`,
because the 5,515 duplicated `provider_thread_id`s would violate
`uniq_thread_tenant_integration`. The merge is:

1. For each duplicated `provider_thread_id`, elect a winner (the surviving
   integration's row where one exists, newest otherwise).
2. Repoint the 16,849 emails under loser threads to the winner thread and to the
   surviving integration. No unique constraint blocks this: `emails` is unique on
   `(tenant_id, provider, message_id)`, and a given Gmail message already exists
   exactly once — the duplicate threads hold *disjoint* slices of a conversation,
   which is precisely the damage being repaired. `thread_analyses` needs no
   conflict handling either — zero rows hang off loser threads, so
   `uniq_thread_analysis_type` cannot collide.
3. Delete the 5,728 loser thread rows, repoint the remaining threads, then
   delete the 12 redundant integration rows (or leave them inactive).
4. Only then add the strict unique index.
5. `runs` is left alone: 209,811 rows reference the dead integrations and it is
   append-only history, not something any read path joins for correctness.

Doing nothing is a tenable fallback — ADR-005 already made first-reply/TAT match
threads by `(tenant_id, provider_thread_id)`, so the metric that motivated this
investigation is immune to the fragmentation. What stays broken without the merge
is thread-level completeness for pre-July conversations: any view that reads one
thread row sees part of the conversation. The merge is deliberately *not* filed
as a numbered migration, so that `sql/migrations/` stays safe to replay in bulk.

**Consequences:**

- Reconnecting a mailbox is now an update. `email_threads` stops forking, and the
  `(tenant_id, integration_id, provider_thread_id)` uniqueness starts working as
  intended instead of being defeated by a changing integration id.
- A reconnect triggers a full initial sync rather than an incremental one, by
  design (point 3). Re-ingest is idempotent — threads upsert on conflict, emails
  are unique per `(tenant_id, provider, message_id)`.
- `createOrUpdate` returns `reactivated: boolean` on the update branch so callers
  and logs can distinguish a reconnect from a routine credential refresh.
- A row carrying no mailbox under any of the three keys indexes as NULL and is
  unconstrained. NULLs are distinct in a unique index, which is the right
  outcome: such a row has no identity to collide on. Every production row today
  stores `email`.
- Re-authorizing now invalidates the cached access token, so a user repairing a
  revoked grant stops seeing 401s immediately instead of waiting out the stored
  expiry. A settings-only update still leaves it alone — the trigger is a
  caller-supplied refresh token, not the merged value, which always carries the
  row's existing token forward.
- Two connects racing for the same never-before-seen mailbox both miss the lookup
  and both insert; the index rejects the loser. `createOrUpdate` catches that
  23505, re-reads the winner and applies to it, so the loser still returns a
  connected integration. Without it the OAuth callback's catch-all would forward
  the raw Postgres message — constraint name and all — into its error redirect,
  which the error-handling rules in CLAUDE.md forbid. This mirrors the
  insert-race recovery `CustomerService.ensureCustomerForEmail` already uses.
  Violations that cannot be attributed to a winner are rethrown rather than
  swallowed.
- `deactivate(tenantId, source)` still deactivates *every* mailbox for the
  tenant+source, and `updateKeys`/`updateTokenExpiration`/`updateRefreshToken`
  still write to every row for a tenant+source. Those are the same
  one-integration-per-tenant assumption showing up elsewhere and are left as
  found; they are now the only remaining instances.
- Covered by `apps/api/src/integrations/repository.test.ts` and
  `apps/api/src/integrations/service.test.ts`.

### ADR-007: Escalation detail shows the message's own To/Cc (2026-08-13)

**Status:** Accepted

**Context:** The escalation detail panel rendered a `To:` line with nothing after
it, and never rendered `Cc:` at all. The cause was in the frontend adapter, not
the data: `analyzedEmailToInboxContent` set `to` to the *escalation assignee*
(`[{ name: assignedToName, id: assignedToId }]`) — a participant with a name but
no `email`, so the panel's `to.map(r => r.email).join(", ")` produced an empty
string. `cc` was never populated.

The underlying recipients were never missing. Gmail sync parses the `To`/`Cc`/
`Bcc` headers (`apps/gmail/src/services/email-parser.ts`) and the API persists
them to `emails.tos` / `emails.ccs` / `emails.bccs`. A production count confirms
full coverage: all 132,205 emails have a non-empty `tos`, and 37,351 carry a
`ccs`. No capture work or backfill was required.

**Decision:** Expose the stored recipients on the analyzed-email API contract and
render them from there.

- `analyzedEmailSchema` (`packages/clients/src/email/types.ts`) gains `tos` and
  `ccs`, both `z.array(emailAddressSchema).default([])` — empty arrays rather
  than optional, so the UI can map unconditionally. `emailAddressSchema` is
  extracted and shared with `firstReplyMarkerSchema`, which already declared the
  same shape inline. `bccs` is deliberately left out: it is stored, but showing
  blind-copy recipients in a customer-facing escalation view is a disclosure
  decision, not a display one.
- All three analyzed-email queries in `apps/api/src/emails/repository.ts`
  (`searchAnalyzedEmails`, `exportAnalyzedEmails`, `getAnalyzedEmailById`) select
  `e.tos` / `e.ccs` and map them with `?? []`.
- The adapter maps `to`/`cc` from the message's own recipients. The assignee is
  unaffected — it was already shown in the meta grid above the message, so the
  old `to` was both wrong and redundant.

Recipients are **disclosed on demand rather than given permanent rows**. Two
fixed rows (`To:` and `Cc:`) pushed the message body down on every escalation,
and on a reply chain the addresses are the least-read part of the header. The
summary instead shares the sender's line and costs no vertical space:

- The sender's address moved up beside their name, freeing that row for a
  recipient summary of up to `SUMMARY_RECIPIENT_LIMIT` (3) addresses, To first.
  Three or more To addresses fill it and Cc stays hidden; a shorter To list
  spills into Cc. See `summarizeRecipients` in
  `apps/web/components/inbox/recipients.ts`.
- The toggle appears only when something is actually hidden. At three or fewer
  recipients everything is already visible, so there is nothing to expand into
  and no chevron is drawn. Expanding shows the full `To`/`Cc` lists as
  `Name <address>`, keeping the addresses verifiable — seeing the ids is the
  point of expanding.
- A display name is shown **only when the message actually carried one**
  (87,288 of 156,971 stored To entries, ~56%); otherwise the address itself is
  shown. Both adapters previously derived a name from the address via
  `extractNameFromEmail`, rendering `pjain@example.com` as "Pjain" — something
  that reads like a real person's name while being invented. That fallback is
  removed for recipients in both `analyzedEmailToInboxContent` and
  `apiEmailToInboxContent`, since both feed this same panel.

**Consequences:**
- Only the **detail** endpoint carries recipients. `getAnalyzedEmailById` selects
  them; the list and export paths deliberately do not, because neither renders
  them and both would pay for the JSONB on every row:
  - `AnalyzedEmailListItem` (`Omit<AnalyzedEmail, 'tos' | 'ccs'>`) is the row type
    for `AnalyzedEmailSearchResponse`. The list shows sender/subject/status via
    `analyzedEmailToInboxItem`, and the detail view fetches its own row.
  - `analyzedEmailExportItemSchema` omits the same two fields, and
    `exportAnalyzedEmails` does not select them: the XLSX builder in
    `apps/web/app/escalations/page.tsx` maps a fixed column list with no To/Cc
    columns, and that query is unpaginated.

  Adding To/Cc export columns is a separate, deliberate change that must restore
  the fields in the schema, the query, and the repository return type.
- The clients package is not runtime-validated on read (`getAnalyzedById` casts
  rather than `parse`s), so `.default([])` protects the *server*'s response
  shape, not the client's: a web build reaching production ahead of the API
  would see `undefined`. `analyzedEmailToInboxContent` therefore guards with
  `(email.tos ?? [])` rather than trusting the declared type — `deploy-api` and
  `deploy-web` are parallel jobs with no ordering guarantee.
- The inbox page needed no change to *reach* the recipients —
  `apiEmailToInboxContent` already mapped `tos`/`ccs`/`bccs`. Only the
  escalations path was wrong. It did share the invented-name fallback, which is
  why that fix touches both adapters.
- Display names are passed through verbatim, including odd ones. This tenant's
  per-customer Workspace aliases are registered as
  `"ThatsTheOne Team @ myStartUpCFO" <thatstheone@mystartupcfo.com>`, so the
  summary renders a spaced `@` inside the name. That is the header's content,
  not a formatting defect; changing it means renaming the Workspace groups.
- `summarizeRecipients`, `participantLabel`, and `participantDetail` live in
  `recipients.ts` rather than inside the panel so the rules are unit-tested
  (`recipients.test.ts`), following the `format-timestamp.ts` precedent in the
  same folder.

### ADR-028: Session auth is better-auth over Postgres, and the JWT comparison is void (2026-08-18)
**Status:** Accepted
**Context:** `docs/JWT_VS_REDIS_SESSIONS.md` scored JWT-plus-refresh-tokens against
Redis sessions across six axes and split them three-to-two. The comparison never
decided anything, because the option that shipped was on neither side of it:
better-auth with sessions in Postgres. No Redis was ever provisioned and
`jsonwebtoken` appears in no `package.json`. Six further `JWT_*` documents
describe a token lifecycle — refresh, expiration, invalidation — that no code
implements.
**Decision:** Sessions live in `better_auth_session`, validated per request by
`betterAuthRequestHeaderMiddleware`. The JWT documents are deleted rather than
kept as archaeology; this entry is the surviving record that the question was
asked and answered by adopting a third option.
**Consequences:** Revocation is a row delete, which is what the JWT branch was
willing to add Redis to buy. The cost the JWT branch was avoiding — a database
read per request — is real and is paid on every protected route. If that read
ever becomes the bottleneck, the answer is to cache the session lookup, not to
reopen stateless tokens: `tenant_id` and the permission set are resolved in the
same middleware and would have to ride inside any token, which is precisely the
staleness problem that made revocation hard in the first place.

### ADR-029: The consent gate is tested on ordering, not on presence (2026-08-18)
**Status:** Accepted
**Context:** `hasConsent` existed, was correct, and was called — and mail was
still read without consent. `/gmail/analyse` bound `mayRead` and guarded the deep
read with it, but `classifyThreadMode` sent the same thread text to the same
model twenty-two lines earlier. Three other paths — `/gmail/stance`,
`/gmail/triage`, and the contextual live analysis — never checked at all. The
comment above the gate claimed it was "the last point at which 'we have not read
your mail' is still true", which was false when it was written.

Nothing could have caught this. Every test passed, every card rendered, and the
only trace was a model call in a log. A test asserting that the handler *calls*
`hasConsent` would have passed against the bug.
**Decision:** The property under test is order: within a request handler, no call
to a model may appear at a lower source offset than the consent check. The list
of model functions is derived from the async exports of `live-analysis.ts` rather
than enumerated, so one added tomorrow is policed tomorrow. `consent-gate.test.ts`
was confirmed to fail against the pre-fix source, naming all four sites
separately.

Where reading is declined, the card says so and offers the switch, rather than
rendering as though the message had nothing to report — an absent analysis and a
declined one otherwise look identical, and only one is fixed by pressing a
button.
**Consequences:** `/gmail/triage` and `/gmail/stance` now refuse outright with
reading off, and gate before fetching from Gmail rather than before the model
call, so the thread is not pulled into the process either. Cached readings are
withheld once consent is revoked: the switch governs what is shown, not only what
is fetched. The cost is one `labels.list` call on paths that previously made
none.

This is a structural test on source text, and it cannot see whether the consent
value is used or merely computed early. It buys ordering, which is what broke.

### ADR-009: Sentiment gets participant roles and a committed target (2026-08-14)

**Status:** Accepted

**Context:**
Users reported sentiment marking interactions negative when the dissatisfaction
was aimed at someone other than us: a vendor pressing our client for an overdue
balance while we sat on Cc; a client flagging an error in a *prior* provider's
tax return; a client mentioning they would consult another vendor about an SSN
workaround. Every one of these auto-created an escalation task, because
`maybeCreateTaskForNegativeEmail` fires on `sentiment.value === 'negative'`
alone.

The prompt was written entirely in terms of "US" and "our firm" — including a
carve-out for "frustration aimed at a third party" — but the model was never
told who any of that referred to. `buildEmailContext` sent only From, Subject,
Body and Signature; `tos`/`ccs` were on the wire but dropped at prompt-build
time, and thread context was `From`-only as well. The third-party rule was
therefore unenforceable, and "who is this about" was left to inference over
domain names.

A second problem blocked the obvious fix. Deciding "is this address the
customer?" from `customer_domains` does not work: the ingestion pipeline
auto-creates a customer row for *every* participant domain it sees, so the
vendor in the first example is already a customer record.

**Decision:**
1. **Participant roster, computed in apps/api, scoped to the thread.** Every
   address on the analysed email and the thread messages sent with it is
   labelled `us` (tenant domain), `customer` (maps to a customer with
   `is_auto_created = false`), or `unknown_external` (everything else). The
   roster covers only addresses appearing on those messages — never a dump of
   tenant contacts or the customer list. Roles are resolved deterministically
   from tenant domains and curated customer records; the LLM never infers them.
2. **`unknown_external` is a distinct tier, not a synonym for "third party".**
   Auto-created customer rows prove an address appeared on an email, nothing
   more. The prompt treats `unknown_external` senders as possible customers —
   an explicit complaint about us still counts — so patchy curation costs
   sensitivity rather than silently zeroing it.
3. **`sentiment.target` is required.** The model must commit to `us` /
   `third_party` / `none` before it may return a value, and `negative` and
   `positive` both require `target: us`. Attribution becomes an auditable field
   instead of an assumption folded into `value`.
4. **Thread fidelity raised to 8 messages with no character cap**, with bodies
   run through `htmlToText` and dequoted per message. The old 5×300-char window
   truncated raw Gmail HTML, so thread context was mostly markup.

**Consequences:**
- New column `email_analyses.sentiment_target` (migration 016) plus a
  `(sentiment_value, sentiment_target)` index. NULL means *not attributed* —
  historical rows and keyword-matched sentiment — and must never be read as
  "aimed at us". Any consumer gating on it decides explicitly how it treats
  NULL.
- `analyze` requests carry an optional `participants` array. Optional so a
  caller predating the roster still works; analyses then reason without roles.
- `executeAnalysis` now accepts raw `threadEmails` and builds both the roster
  and the thread context itself, instead of each caller pre-building a context
  string. This removed a verbatim duplicate of `buildThreadContext` that lived
  in the Inngest function — the ingestion path had been using the copy, not the
  shared helper.
- Dequoting thread bodies is load-bearing, not a nicety: without it, 8 messages
  means 8 copies of the chain, since every turn embeds the prior one.
- Sentiment prompt bumped to v1.6. Existing analyses are not re-run; the change
  applies to newly analysed email.
- **Not addressed here.** The escalation gate still keys on
  `value === 'negative'` alone and does not yet consult `target`; the keyword
  path (`analysis_keywords`) still short-circuits the LLM entirely and sets
  `negative` at confidence 1.0 from a word-boundary match on subject + body,
  leaving `target` NULL. Both are follow-ups.
