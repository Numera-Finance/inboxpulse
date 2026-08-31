---
name: gmail-access
description: Reach the user's mailbox from the sidebar — pick the right Gmail id for the job, get a credential that can actually read it, and resolve it to a stored row. Use when building anything that reads a message, writes a label, identifies the open thread, or stores an email the sidebar just fetched, and when someone says "connect to Gmail", "get the message id", "analyse this email", "is this already in the database". Never measures the corpus and never designs the card.
---

# Reaching the user's mailbox

**Everything below already exists.** Not one helper here needs writing again —
`apps/addon/src/gmail/gmail-api.ts` is the whole Gmail client, 291 lines, and it
already normalises the ids, tries the three auth shapes and strips the quoted
chain. This skill says which one to reach for and what goes wrong when you reach
for the other.

**Do not design the card here.** If the answer changes what a section says, stop
and use `panel-section`. If you need a number, stop and run `metric-analyst`.

## 0. Decide which surface you are on, because it changes what you can reach

The same card renders in three places and they do **not** have the same access.
A helper written for the first is wrong in the second.

| | Gmail add-on runtime | Extension Panel tab | Local curl |
|---|---|---|---|
| Who calls | Google | `invokeCardAction` → `ADDON_FETCH` | you |
| Gmail credential | `userOAuthToken` + `accessToken` | **none** | none |
| Viewer identity | signed `userIdToken` | `devViewerEmail` — a claim, not a proof | `ADDON_DEV_VIEWER_EMAIL` |
| Ids on a **trigger** | in `event.gmail` | in `event.gmail` | you pass them |
| Ids on an **action** | in `event.gmail` | **none at all** | you pass them |
| Action `parameters` | delivered | **dropped** | you pass them |
| `hasConsent()` | asks Gmail | **always `false`** | `false` |
| `notify()` visible? | yes, a toast | **no** | in the JSON |

The last three rows compound, and §7 is about what that does.

## 1. The four names for "the message id"

All four get called "the message id" somewhere in this repo.

1. **Event id** — `msg-f:187…`, also `msg-a:` / `msg-r:` / `thread-f:`. Gmail's
   URL form, decimal. Sent to the Gmail API unnormalised it **400s**; compared
   against `emails.message_id` it silently **misses** and the thread renders
   "untracked". `normalizeGmailMessageId()` first, always.
2. **Provider id** — bare hex, `19f7fc0a4fd52871`. What the Gmail API takes, what
   InboxSDK's `getMessageIDAsync()` already returns (no normalising needed — the
   `msg-f:` form is an *add-on event* problem only), and what is stored in
   `emails.message_id`. **Per-mailbox**: the same email carries a different id in
   every participant's mailbox.
3. **RFC 2822 `Message-ID`** — the header. Identical in every mailbox, so this is
   the id that travels. Obtainable only by *reading the message from Gmail*.
   Stored in `emails.rfc_message_id`.
4. **`historyId`** — not a message id at all. A per-mailbox sync cursor, stored
   once per integration in `integrations.last_run_token`. Never on an email row.

**A content script cannot get #3.** `lib/message-registry.ts` explains what it
does instead — describes the message by sender, opening text and time, and
matches on resemblance when the id does not land. Do not "fix" that by adding an
RFC lookup to the extension; see §7.

## 2. `apps/addon/src/gmail/event.ts` — the credential

`getGmail(event)` returns four things, and the two tokens are different objects:

- **`oauthToken`** = `authorizationEventObject.userOAuthToken`. The user's grant.
  The bearer.
- **`accessToken`** = `gmail.accessToken`. A **per-message** token, scoped to the
  message the user has open. Sent as `X-Goog-Gmail-Access-Token`.

Only Google ever sends either. `getActionParameters(event)` reads
`commonEventObject.parameters` and returns `{}` when absent — it never throws,
so a missing parameter looks exactly like an empty one.

## 3. `apps/addon/src/gmail/gmail-api.ts` — the read

| Need | Use | Note |
|---|---|---|
| id → hex | `normalizeGmailMessageId(raw)` | first, before anything |
| envelope + RFC id | `fetchMessageHeaders(id, oauth, access)` | one `format=metadata` call |
| body text | `fetchMessageBody(id, oauth, access)` | quotes already stripped |
| whole thread, oldest first | `fetchThreadMessages(threadId, oauth, access)` | |
| parse a payload you already hold | `extractBodyText(payload)` | plain → html → raw |

Two things about the private `gmailGet()` that decide how you write the caller:

- **It tries three header shapes in order** — `oauth`+`access` together first
  (the documented form for per-message scopes), then each alone. That is why the
  helpers take both tokens and why you pass both even when one is undefined.
- **It returns `undefined` and never throws.** So a refused read, a 403 for
  insufficient scope, a 404 for "not in this mailbox" and a genuinely empty
  message are *the same value* at the call site. It logs the status and Google's
  own error text; you must decide what `undefined` means before you render it.
  `/gmail/contextual` gets this right — `!headers && !live` becomes status
  `'unreadable'`, deliberately not `'untracked'`, because "not a tracked client
  thread" is a confident answer to a question that was never asked.

**A thread read can fail where a message read succeeds.** The per-message token
is scoped to the open message, so `fetchThreadMessages` returns `undefined` and
the caller must degrade to the single message rather than treat it as empty.

## 4. Resolving a message to a stored row

```ts
resolveThreadByMessage(messageId, rfcMessageId, tenantId)   // api-client.ts:160
resolveThreadIdByProvider(providerThreadId, tenantId)       // api-client.ts:204
```

Both sides of the OR matter: `findByMessageIdsScoped` matches
`emails.message_id` **or** `emails.rfc_message_id`, which is the only reason a
thread ingested from a colleague's mailbox resolves at all.

**The extension resolves worse, on purpose.** `background.ts` posts to
`/api/internal/emails/resolve-by-messages` with `messageIds` only and no
`rfcMessageIds` — it has none to send. Cross-mailbox rows do not match there.
That is a known gap, not a bug to fix locally.

## 5. Writing an email or an analysis back

**Do not add a third insert path.** There are two `emails` insert sites and three
`email_analyses` insert sites in the entire repo, all Drizzle, all idempotent
upserts on natural keys, and no raw SQL inserts anywhere. Use a door:

| Door | What it does |
|---|---|
| `POST /api/emails/bulk-with-threads` | Upserts the thread, then the email. `apps/gmail/src/services/sync.ts` is the reference caller. |
| `POST /api/emails/:emailId/analyze?persist=true` | The canonical on-demand analyse. **`persist` defaults to `false`** — that is already the "analyse without writing" affordance. `true` runs the nine-step transaction ending in `email_analyses`. |

Three facts a writer must not get wrong:

- `uniq_emails_tenant_provider_message (tenant_id, provider, message_id)` is the
  real key, and it is **per-mailbox**. The same email ingested from two mailboxes
  is two rows by design.
- `rfc_message_id` is **nullable and NOT unique** — `idx_emails_rfc_message_id`
  is a lookup index, nothing more. Ingest dedup prefers it and falls back to
  `content_hash`. Code that treats it as a key is wrong on both counts.
- `uniq_email_analysis_type (email_id, analysis_type)` — one row per type per
  email, upserted.

**The live path and the stored path share nothing.** Different providers,
different prompts, different schemas. A `ThreadReading` from `live-analysis.ts`
has no route into `email_analyses` today, and building one crosses the boundary
§6 exists to draw. Map it deliberately or not at all.

## 6. The gate comes before the fetch

`hasConsent(oauthToken)` — consent is a label in the user's own mailbox
(`⚡/Reading on`), so any instance can ask and the user can revoke it without us.
It needs `gmail.modify`; without that scope it returns `false` forever, which is
the safe direction.

Re-read *A Gate Is Only a Gate If Nothing It Governs Runs Above It* in CLAUDE.md
before adding any model call. The short form: gate **before the fetch**, not
before the use; a cache is downstream of the gate, not around it; and say the
thing was declined, because a withheld analysis and a missing one render
identically and only one is fixed by pressing a button.

**Nothing currently enforces the ORDER.** That section cites a
`consent-gate.test.ts` comparing source offsets; it does not exist in the repo.
`consent.test.ts` tests only that `hasConsent` answers correctly — which is
exactly the shape of test the section warns "passes against this bug". So the
ordering is held by reading alone. Check it by eye on every path you touch, and
if you add a model call, write the offset test the section describes.

**`hasConsent` returns `false` with no token.** In the Panel tab there is never a
token, so every consent-gated path is already off there. See §7.

## 7. Wiring an action button the Panel tab can actually invoke

Read this before adding any button. Verified at source:

```ts
// lib/addon-client.ts:260 — the contextual TRIGGER
post('/gmail/contextual', withViewer({ gmail: { messageId, threadId } }, viewerEmail))

// lib/addon-client.ts:271 — an ACTION button
post(fnUrl, withViewer({}, viewerEmail))     // body is { devViewerEmail }. That is all.
```

**The trigger carries the ids. The action carries nothing.** So in the handler
`getActionParameters(event)` returns `{}` **and** `getGmail(event)` returns
all-undefined: a button pressed in the panel knows neither which message it was
pressed for nor any credential to go and look. The `parameters` that
`actionButton()` wrote into `onClick.action.parameters` are never sent.

Then three failures stack, and none of them prints anything:

1. The handler takes its "could not do that" branch, because the id is missing.
2. That branch answers with `notify()`.
3. `cardSections()` reads only `navigations`, and `notify()` has none — so it
   returns `[]` and `CardView` silently re-fetches both cards.

**The button looks like it did nothing at all.** This is why "Read this thread"
is already a dead control in the Panel tab: no `oauthToken` → `hasConsent` false
→ `notify('Reading is off…')` → invisible.

So, in order:

- **Answer with `pushCard(...)`, never `notify(...)`,** if the panel must show
  it. `notify()` is a Gmail-only affordance.
- **Do not rely on action parameters** until `invokeCardAction` forwards an event
  envelope. Carry state in the URL path, or re-derive it server-side from the
  viewer and the thread. Teaching that one function to send the open thread's ids
  and the card's parameters is small, contained, and unblocks every future
  button — do that first rather than working around it a second time.
- **Anything needing the mailbox from the extension needs a manifest change
  first.** `wxt.config.ts` declares `permissions: ['activeTab','storage',
  'scripting']` — no `identity`, no `oauth2` block, and `gmail.googleapis.com` is
  not in `host_permissions`. The extension cannot call Gmail today, and giving it
  that is an OAuth consent-screen change, not a code change.

## 8. Look at it

```bash
pnpm --filter @crm/addon test && pnpm --filter @crm/api test
pnpm --filter @crm/addon lint
pnpm --filter @crm/chrome-extension check      # `check`, not `lint`

pnpm --filter @crm/api dev      # :4001
pnpm --filter @crm/addon dev    # :4005
cd apps/chrome-extension && npx vite --port 5177
#  http://localhost:5177/harness/card.html    ?w=1200 for a width check
bun lib/card-links.domtest.ts   # must stay PASS  (needs :4001 + :4005)
```

The panel renders without a Gmail session, so **press the button rather than
reasoning about it**. A control that answers with a toast will look identical to
one that crashed. `ADDON_DEV_VIEWER_EMAIL` decides who the panel is scoped to
when there is no token — pick that address by allocation count, never by
convenience, or the two entitlement-scoped sections vanish with no error.

Gmail itself cannot be automated here; it needs a live Google login. Everything
below InboxSDK can.

## Refuse to

- **Re-implement anything in §3.** If a helper seems not to fit, say which one
  and why, rather than writing a fourth Gmail client.
- **Treat `undefined` from a Gmail read as an empty mailbox.** It is four
  different failures wearing one value.
- **Use `rfc_message_id` as a key**, or assume it is present.
- **Add a `notify()`-only control to a card the extension renders.**
- **Send an unnormalised event id anywhere** — to Gmail, or to a comparison.
- **Put a model call above a consent check**, in any order, on any path.
