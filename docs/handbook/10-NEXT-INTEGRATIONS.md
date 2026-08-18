# The sidebar as a surface for other systems

*A design brief, not a description. Nothing here is built. It records the
intent and the constraints so whoever builds it does not rediscover them.*

## The intent

InboxPulse becomes the sidebar for **many internal company actions**, not just
client sentiment. Other internal systems will **post into it** (surfacing their
own state on a thread) and **pull from it** (reading what InboxPulse knows about
a client or conversation).

That changes what this codebase is. Today the panel is a read-only view over one
pipeline. Tomorrow it is a **host surface with tenants of its own**, and the
things that are currently conventions become contracts.

## What has to exist before the first integration

### 1. An API standard, published

Right now the API's conventions are followed at roughly 60% and the exceptions
cluster in exactly the places an integrator would start — the `/api/internal/*`
routes have **zero** use of the `handleApiRequest` helpers, no Zod validation,
and read `tenantId` from query parameters rather than the authenticated header.

Before anyone external builds against this, settle and publish:

- **The envelope.** `ApiResponse<T>` is the stated standard, and the auth
  middlewares already violate it by returning `error` as a bare string. A client
  parsing `error.message` gets `undefined` on a 401.
- **Where identity comes from.** A valid service key currently grants
  `ALL_PERMISSIONS` and the caller asserts its own `isAdmin` in a query
  parameter. That is workable for a first-party add-on and is not a model to hand
  to another team.
- **Versioning.** There is none. The add-on and crm-api deploy independently and
  the code compensates with optional fields and defensive fallbacks, documented
  case by case. That works between two surfaces owned by one team. It does not
  scale to several.
- **What a posting system is allowed to render.** See below — this is the part
  people will get wrong.

### 2. A theory of image widgets and layout

This is the harder half, and it is a genuine design problem rather than a
documentation gap.

**The constraint** is that Cards v2 gives you three fixed text sizes, a tiny HTML
subset, no CSS, no padding, no background, no border, and about 250 usable
pixels. Every visual decision in `apps/addon/src/cards/` is a response to that.
The existing tricks:

- **Whitespace** is a widget emitting a non-breaking space, because the renderer
  collapses an empty paragraph.
- **Structure** is carried by coloured bands, which are *images* — a 600x8 PNG
  generated in-process (`apps/addon/src/assets/bar.ts`), because the image widget
  is the only surface accepting an arbitrary appearance. Gmail's own hairline
  between sections cannot be styled, so it cannot say which boundary matters.
- **Charts do not exist.** The trend is emoji squares. A hand-rasterized PNG
  blurred on HiDPI and its predecessor leaked customer sentiment sequences
  through an unauthenticated URL query string.

**The open questions** an integration surface forces:

1. **How many sections can a panel hold before it stops being read?** Today's
   answer is a two-group fold, arrived at because six equal sections meant six
   identical hairlines and "every boundary shouting equally means none of them
   says anything". That answer was tuned for one producer. With several, someone
   must own the ordering and the budget.
2. **Who owns vertical space?** A posting system that renders four rows has taken
   the fold from whoever renders below it. There is currently no allocation rule.
3. **What is the image contract?** If other systems can supply images, the
   `bar.ts` precedent matters: generated in-process, no data in the URL, no
   external host. An integration that supplies an arbitrary image URL
   reintroduces both the privacy leak and the dependency on an image proxy that
   is unreliable with SVG.
4. **How does a section say it is broken?** The single most expensive failure
   mode in this codebase is a section that renders empty and reads as calm. Any
   posting system needs a way to say "I could not answer", and the host needs to
   render that rather than silence.
5. **What can a posted section claim?** The product's standard is that a row
   states a countable fact and lets the reader conclude. A system that posts "this
   client is unhappy" rather than "three unanswered complaints" breaks the
   contract that makes the panel trustworthy.

### 3. The scope and consent questions

Two constraints an integrator will hit immediately, both currently load-bearing:

- **Writes to the mailbox are labels only**, namespaced, with the remover
  shipped alongside. Any integration wanting to write must inherit that rule or
  argue it down explicitly.
- **Consent is a Gmail label** whose existence is the record — visible,
  user-deletable, and not ours to keep. A posting system that reads thread
  content must sit behind the same gate, and today **four call sites already do
  not** (see `03-ARCHITECTURE.md`). That gap should be closed before it is
  inherited.

## Suggested order

1. Close the consent gap, so the rule is real before anyone builds on it.
2. Write the API standard against the *existing* endpoints, fixing the envelope
   violation and deciding the identity model. Publish it.
3. Prototype **one** posting integration against a deliberately awkward case — a
   system with something to say only occasionally — and let it drive the layout
   budget rather than designing the budget first.
4. Only then generalise.
