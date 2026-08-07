# Architecture Decision Records

Append-only. Never delete an entry — mark superseded ones as such.

Format:

```markdown
### ADR-NNN: Title (YYYY-MM-DD)
**Status:** Accepted | Superseded by ADR-XXX
**Context:** What problem or question came up
**Decision:** What we decided
**Consequences:** What this means for the codebase
```

---

### ADR-001: First-reply attribution uses the originator rule (2026-08-06)

**Status:** Accepted

**Context:** `emails.first_reply_at` counted any countable outbound reply that
arrived after a customer email in the same thread, as long as it had at least one
external recipient. On threads carrying several contacts that overstated
responsiveness: a reply to contact B stopped the clock on contact A's email, and a
reply that merely cc'd some outsider counted as an answer to everyone. We also had
no record of *who* responded, which TAT reporting needs.

**Decision:**

1. A reply counts for a customer email only when it is addressed — To or Cc — to
   that email's own sender (the originator). Comparison is lowercased on both sides.
   Because this is a per-row relationship rather than a property of the reply, it is
   enforced as a join predicate in the first-reply UPDATE, not in the TypeScript
   classifiers. `isCountableReply` remains the message-level prefilter.
2. New nullable column `emails.first_reply_by_id` (FK → `users`, `ON DELETE SET NULL`)
   records who sent the winning reply, resolved case-insensitively against
   `users(tenant_id, email)`. A reply from an address with no matching user still
   sets `first_reply_at` — a human did respond — with a null replier.
3. The UPDATE switched from `MIN(reply_at)` + `GROUP BY` to
   `DISTINCT ON (email_id) ORDER BY email_id, reply_at`, so the timestamp and the
   replier are guaranteed to come from the same message.
4. No backfill. Reply messages are never stored as rows, so historical values cannot
   be recomputed under the new rule and no user can be resolved for them. Existing
   `first_reply_at` values keep their old semantics; `first_reply_by_id` stays null.

Considered and rejected: matching against any customer participant on the email
(looser, tolerates reply-to-alias but reintroduces the cross-contact overstatement);
matching only the thread's first sender (wrong granularity — `first_reply_at` is
stored per email row); skipping replies whose sender isn't a user (would make
shared-mailbox teams look permanently unresponsive).

**Consequences:**

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
