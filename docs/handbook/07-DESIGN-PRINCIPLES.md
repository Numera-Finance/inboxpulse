# Design principles

*Rules with a cost attached. Each one is here because breaking it broke
something, and the incident is named so you can judge whether the rule still
applies to your situation.*

## 1. A silent failure is worse than a loud one

This codebase's characteristic bug is **a broken thing that looks like good
news**. It has happened at least five times:

| what broke | what the user saw |
|---|---|
| entitlement clause named a dropped table alias, 500 for every non-admin | "no fires" — a calm panel |
| owner lookup took 26–48s against a 2s client deadline | "no fires" — a calm panel |
| a JS array bound as one SQL parameter, query failed | owners silently blank |
| `ADDON_AUDIENCE` pinned to the wrong value, every token rejected | "Preview mode. Set SERVICE_API_KEY" — naming a problem that did not exist |
| a page filtered by participant link where the panel used sender domain | "No analyzed emails found" — the panel appearing to invent a client |

**The rule:** an empty section must be able to explain itself. If a fetch fails,
say so on the card. If the viewer cannot be resolved, name the address that could
not be resolved. Never render "nothing is wrong" when the truth is "we do not
know".

**When you are debugging:** curl the endpoint. Do not trust the card. A card
renders a failed fetch and an empty result identically unless someone made it
distinguish them.

## 2. Nothing between the keyboard and production reads your SQL

`tsc` cannot see inside a template literal. The unit tests mock the database.
Both will pass on SQL that Postgres rejects outright.

Three separate outages came from this: a reference to a table alias the query no
longer had; `MIN(uuid)`, which does not exist in Postgres; and `\s+` inside a
template literal collapsing to `s+`, so a whitespace cleanup silently deleted the
letter **s** from people's names.

**The rule:** before deploying a query change, extract the template literal from
source, apply JavaScript escape processing, substitute the parameters, and run it
against the corpus.

```python
# The shape that works. Note the .encode().decode('unicode_escape') — without it
# you are testing a different string than the one the service will send.
s = open('apps/api/src/addon/account-context.ts').read()
i = s.index('const rows = await this.db.execute(sql`')
q = s[i + len('const rows = await this.db.execute(sql`') : s.index('`);', i)]
q = q.encode().decode('unicode_escape')
q = q.replace('${tenantId}', "'...'").replace('${days}', '90')
```

## 3. The same screen name exists on three surfaces

**"AI Analysis" is three different things**, and one bug had to be fixed in all
three before it went away.

| where | what it really is | what it calls |
|---|---|---|
| web app, branded *Email Intelligence / Customer Insights* | route `/escalations`, `apps/web/app/escalations/page.tsx` | crm-api `/api/emails/analyzed/search` |
| Chrome extension tab | `apps/chrome-extension/manager/inbox-ui.js` | source says `/api/emails/analyzed/search`, **rewritten on the wire** to `/api/manager/emails/analyzed/search` |
| customer detail view | `findByCustomerScoped` | crm-api, customer-scoped route |

The rewrite is the trap. `apps/chrome-extension/lib/manager-client.ts:105`:

```js
const url = `${API_BASE_URL}/api/manager${path.replace(/^\/api/, '')}`;
```

Any path matching `PORTED_PREFIXES` (`manager-client.ts:60`) goes to the manager
routes instead. **So the string in the extension's source is not the endpoint it
hits**, and every manager-tab request in DevTools reads `/api/manager/...`.

When the attribution bug was fixed, all three paths needed the same change and
each was found separately — which felt like fixing the wrong thing twice, and was
actually three surfaces of one defect.

**The rule:** grep the caller, then check whether a client layer rewrites it.
Branding, directory names and file layout are all weaker evidence than the URL
that leaves the browser.

## 4. A predictor must not be the primary key of a short list

Engagement predicts escalation better than unanswered complaints do — 24.7%
against 13.0%, versus 18.3% against 14.5%. On that basis it was made the primary
sort key of the six-row fires list.

It deleted the worst client on the list. Berolzheimer had three unanswered
complaints, sat one message under the engagement threshold, and fell off the end.

**The rule:** being wrong about a predictor does not reorder an item, it removes
it. Sort by the obligation, break ties with the prediction.

## 5. The number and the noun beside it must agree

"55 clients waited more than 5 days" was counting **messages** — 57 of them, from
27 clients. A reader deciding how many companies to call was handed a message
count wearing the word "clients", wrong by more than 2x.

Related: "Slowest to answer angry mail" selected on
`sentiment_value = 'negative'`. Negative is not anger; only 5 of 20 complaints
use explicit failure wording. It now reads "unhappy clients", matching the
section above it.

**The rule:** every aggregate on a query is per-something. Write down what that
something is, and make the label say it.

## 6. Two attributions exist and they disagree

An email is linked to a customer by **two** independent paths:

- `email_participants.customer_id` — a per-participant link
- the **sender's domain** matched against `customer_domains`

They disagree often. Of six negative Berolzheimer emails, **one** carries a
participant row naming Berolzheimer; the rest name our own company or an
unrelated auto-created record.

The add-on panel attributes by **who wrote the mail** (sender domain), because a
fire should be about what a client said, not what they were cc'd on. List pages
historically attributed by participant link. That mismatch made the panel look
like it was inventing clients.

**The rule:** queries that feed a panel row and queries behind the link that row
opens must attribute the same way. Both paths are kept — participant links are
often wrong but not always absent — so the predicate is `link OR domain`.

## 7. Never measure a signal backwards

Covered in full in `06-SIGNALS.md`. Short form: measure a signal as the alert it
will be. Fire it on every client-week, then count what followed. A rate computed
over clients already known to have complained runs two to three times higher and
cannot be acted on.

## 8. Deriving beats listing

Our own domains are derived from staff email addresses — any domain where three
or more users have accounts — rather than hard-coded. A hand-maintained exclusion
list once contained a real paying customer, and hid them from every report.

The same applies to "is this address one of ours": defined as *belongs to a user
row in this tenant*, so it cannot drift from the staff list.

## 9. Ship the remover with the writer

`remove-gmail-labels.ts` did not exist until roughly **103,000 labels** had been
applied to a live mailbox.

**The rule:** any code that writes to a user's mailbox ships alongside the code
that undoes it, in the same change. Namespace everything (`InboxPulse/`) so the
whole set is removable in one operation. `DRY_RUN` first, always, and print whose
mailbox is about to change. No default target — `INTEGRATION_ID` must be
explicit, because it once defaulted to a colleague's live inbox.

## 10. Absence of evidence, in three specific traps

- **`emails.labels` is not proof a label was never applied.** That column is our
  ingested copy of Gmail's labels, written at sync time. Writes via
  `users.messages.modify` never touch it. Check Gmail, not the mirror.
- **`NOT IN (subquery)` returns nothing when the subquery contains a NULL.** This
  produced "0 customers have no owner", which was false.
- **Secret Manager returns `NOT_FOUND` for secrets you cannot see.** A 404 from
  `gcloud secrets describe` does not mean the secret was never created.

## 11. Code conventions

These are the mechanical rules. They are enforced by review, not by tooling.

- **Explicit types.** Never `any`. Use `unknown` when the type is genuinely
  unknown.
- **Zod at every boundary.** Define external-facing types as Zod schemas in
  `packages/clients/src/{module}/types.ts` and derive TypeScript types with
  `z.infer`. Export both.
- **`ApiResponse<T>` everywhere.** `{ success, data?, error? }`. Never return a
  stack trace or an internal detail in production.
- **Clients, never `fetch`.** Web code calls a class from `@crm/clients`. Add a
  new client class per API domain.
- **Idempotent SQL.** Every migration uses `IF NOT EXISTS` / `IF EXISTS` so it
  can be re-run. New file per change; never edit a migration that has run.
- **Never modify `packages/ui/src/components/`.** Those are shadcn primitives.
  Wrap them.
- **Comments explain WHY.** This codebase's comments are unusually long and that
  is deliberate: most of them record a measurement or an incident. A comment
  saying what the code does is noise; one saying what happened when it did
  something else is the only durable form of institutional memory here.
