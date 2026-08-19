# InboxPulse API and panel standard

**Status:** proposed, v1. Binding for any new endpoint or panel producer.
Existing endpoints are non-conforming in the places named below; each has a
migration note rather than a promise.

This exists because InboxPulse is becoming a host surface. Other internal
systems will post into the sidebar and pull from it, and the conventions that
were adequate between two surfaces owned by one team become contracts the moment
a second team holds a key.

Two audiences: **consumers**, systems calling crm-api, and **producers**, systems
rendering into the panel. The rules differ and are separated below.

---

# Part 1 — The HTTP contract

## 1.1 The envelope

Every response, success or failure, is `ApiResponse<T>`:

```ts
interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: ErrorCode; message: string; statusCode: number; details?; fields? };
}
```

`error` is an **object**, never a string. This was violated at the auth boundary
until August 2026: `requireServiceAuth` and `requireInternalAuth` returned
`error: 'Missing internal API key'`, so a client reading `error.message` got
`undefined` on every 401, and the add-on's `safeErrorDetail` — which reads
`error.code` — logged `json body, no error object`. The reason for the refusal
was in the response and discarded by the one caller that needed it.

**Rule.** Build refusals through a helper typed `ApiResponse<never>` so the
compiler rejects the next bare string. See `packages/shared/src/middleware/
service-auth.ts`, and `service-auth.test.ts`, which asserts the shape rather than
the wording.

**Rule.** Never return a stack trace or an internal identifier. `message` is for
a human operator; `code` is what a client branches on.

## 1.2 Identity — the part that must change first

Today `/api/internal/addon/account-context` reads:

```ts
const tenantId  = c.req.query('tenantId');
const userId    = c.req.query('userId');
const isAdmin   = c.req.query('isAdmin') === 'true';
```

**The caller asserts its own admin status in a query parameter,** and a valid
service key grants `ALL_PERMISSIONS`. Any holder of the key can pass
`isAdmin=true` and read every customer in the tenant. This is workable for a
first-party add-on written by the same team and is not a model to hand to
another team.

**Rule.** Authorization inputs are never request inputs. A caller may state *who
it is*; it may never state *what it may see*.

- The service key authenticates the **system**, not the user, and confers no
  visibility of its own.
- The viewer is supplied as a **verified** identity, not a claim. The add-on
  already does the honest version of this: Google signs the user's identity, the
  add-on sends the address, and `/api/internal/addon/viewer` resolves it
  server-side to a user id and an admin flag. That is the pattern; generalize it.
- `userId`, `isAdmin`, and any permission set are **resolved server-side** from
  that identity, per request, and never accepted from the wire.
- `tenantId` is derived from the resolved identity. A tenant id in a query
  parameter is a cross-tenant read waiting to be typed.

**Migration.** The eight `/api/internal/addon/*` routes keep their current shape
until a second consumer exists. Before that key is issued: move viewer identity
to a header, resolve permissions server-side, and delete the `isAdmin` query
parameter. Until then, **the service key is a tenant-wide admin credential and
must be treated as one** — one holder, rotated on staff change.

## 1.3 Versioning

There is none today. The add-on and crm-api deploy independently and the code
compensates with optional fields and defensive fallbacks. That works between two
surfaces owned by one team and does not scale.

**Rule — additive only.** Within a major version a field is never removed,
renamed, or repurposed. New fields are optional and every consumer must tolerate
fields it does not know.

**Rule — a breaking change is a new path.** `/api/internal/v2/...`. Both run
until the old one has no callers, and "no callers" means measured, not assumed.

**Rule — never repurpose a name.** Changing what `sentiment_target` *means*
while keeping the name is a breaking change that no version number catches and
no test fails on.

## 1.4 Endpoint conventions

| Rule | Today |
|---|---|
| Validate the request with a Zod schema at the boundary | `addon/routes.ts` has none; hand-rolled `if (!x) throw` |
| Use the `handleApiRequest` / `handleGetRequest` helpers | 0 of 8 addon routes; 23 uses in `emails/routes.ts` |
| Shared types live in `packages/clients/src/{module}/types.ts` as Zod schemas | followed |
| Scope every query by the resolved `tenantId` | followed |

New endpoints conform. Existing ones are corrected when touched for another
reason, not in a sweep — a rewrite of eight working handlers to satisfy a table
is how a working panel breaks.

## 1.5 What a 200 means

**Rule.** A 200 with `data` means the question was answered. A section that
could not be answered returns a failure, not an empty array.

This is the most expensive failure mode in this codebase and it has recurred at
least five times: a section renders empty, reads as calm, and nobody looks. An
empty list must mean *"I looked and there is nothing"* and nothing else.

---

# Part 2 — The panel contract

## 2.1 The constraint

Cards v2 gives three fixed text sizes, a small HTML subset, no CSS, no padding,
no background, no border, and roughly 250 usable pixels. Every visual decision in
`apps/addon/src/cards/` is a response to that:

- **Whitespace** is a widget emitting a non-breaking space (`spacer()`), because
  the renderer collapses an empty paragraph.
- **Structure** is carried by colored bands, which are *images* — a 600x8 PNG
  generated in-process by `assets/bar.ts` — because the image widget is the only
  surface that accepts an arbitrary appearance. Gmail's hairline between sections
  is fixed weight, fixed color, fixed inset, so it cannot say which boundary
  matters.
- **Charts do not exist.** The trend is emoji squares. Its predecessor, a
  rasterized PNG, blurred on HiDPI and leaked per-customer sentiment sequences
  through an unauthenticated URL query string (ADR-004).

A producer does not get to escape these. It gets a vocabulary.

## 2.2 What a section may claim

**Rule.** A row states a countable fact and lets the reader conclude.

> `3 unanswered questions, oldest 6 days` — a fact.
> `This client is unhappy` — a conclusion, and not yours to draw.

The panel is trusted because it does not editorialize. One producer asserting a
mood spends credibility earned by every producer that reported a number.

**Rule.** A row earns its space by changing what someone does. "Would seeing
this make the reader open a message sooner, or not at all?" If the honest answer
is no, the row is decoration and belongs in the web app.

## 2.3 The layout budget

Someone must own vertical space or the first producer to ship takes the fold from
everyone after it. The allocation:

| | budget |
|---|---|
| A producer's default section | 1 header + **up to 3 rows** |
| Above the fold | at most **2** producer sections |
| A producer may request more rows | host may truncate |
| Truncation | **must be visible** — `+4 more` — never silent |

**Ordering is the host's, not the producer's.** Producers declare an urgency
(`act-now` / `worth-knowing` / `background`); the host sorts by urgency, then by
a fixed registration order, and breaks ties deterministically so the panel does
not reshuffle between renders. A producer cannot buy position.

**Rule.** A producer with nothing to say renders **nothing** — no empty header,
no "no items". An empty section is worse than an absent one: it costs the same
vertical space and teaches the reader to skip that region.

## 2.4 Saying you are broken

**Rule.** Every producer must be able to say *"I could not answer"*, and the host
renders that rather than silence.

Three states, and they are not the same:

| state | renders as |
|---|---|
| answered, nothing found | nothing at all |
| answered, items found | the section |
| could not answer | one line naming the producer and that it failed |

Collapsing the third into the first is exactly the bug that has cost this project
most. A producer that times out, 500s, or lacks a scope reports the third.

## 2.5 The image contract

`bar.ts` is the precedent and its properties are the rule:

- **Generated in-process or served by the host.** No external hosts: the CSP
  blocks them and Gmail's image proxy is unreliable with SVG.
- **No data in the URL.** Not an identifier, not a customer name, not a
  sequence. The deleted chart encoder leaked sentiment histories in a query
  string on an unauthenticated endpoint.
- **Carries no information.** An image is structure — a band, a rule, a block of
  color. Information goes in text, which is selectable, translatable, and
  legible to a screen reader.
- **Scales at any density.** A solid rectangle has no artifacts because every
  pixel is identical. Anything drawn will blur on HiDPI.

**Rule.** Producers do not supply image URLs. They name a host-rendered glyph
from a fixed vocabulary, and the host renders it. This keeps the privacy
properties above from depending on every producer team getting them right.

## 2.6 Consent and mailbox writes are inherited, not negotiable

- **Reading thread content sits behind the consent gate.** Consent is a Gmail
  label whose existence is the record — visible to the user, deletable by them,
  not stored by us. A producer that reads thread text checks `hasConsent` **above**
  its first model call, not merely somewhere in the same handler. Four call sites
  violated this until August 2026; `consent-gate.test.ts` now asserts the ordering.
- **Writes to the mailbox are labels only,** namespaced `InboxPulse/`, with the
  remover shipped alongside the writer. A producer wanting any other write argues
  it down explicitly, in an ADR, before building.

---

# Part 3 — Checklist for a new producer

1. What countable fact does this state, and what does the reader do differently?
   If there is no answer, stop.
2. Does it need thread content? Then it is behind the consent gate, checked
   before the first read.
3. What does it render when it cannot answer?
4. What is its urgency class, and does it accept the host's ordering?
5. Does it render nothing when it has nothing?
6. Does it stay inside 3 rows, and is its truncation visible?
7. Does it ship a Zod schema for its payload and use the envelope for failures?
8. Does it write to the mailbox? Then it has an ADR and a remover.

---

## Order of work

1. ~~Close the consent gap so the rule is real before it is inherited.~~ Done,
   August 2026 — see ADR-029.
2. Fix identity: viewer in a header, permissions resolved server-side, delete
   the `isAdmin` query parameter. **This blocks issuing a second service key.**
3. Prototype **one** producer against a deliberately awkward case — a system with
   something to say only occasionally — and let it test the layout budget rather
   than designing the budget around an easy case.
4. Generalize only then.
