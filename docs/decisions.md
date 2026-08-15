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
- Not fixed here: the analysis pipeline still analyses these threads. The
  metric no longer reports them, but the tokens are still spent and the data is
  still stored. A gate belongs in `apps/api/src/emails/analysis-service.ts`
  alongside the category filter — shared ingestion, so it is a decision for
  whoever owns that pipeline, not a side effect of this change.

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
