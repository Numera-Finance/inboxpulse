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

### ADR-001: First-reply attribution uses the originator rule (2026-08-05)

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

### ADR-002: Affected-row counts read `count` before `rowCount` (2026-08-05)

**Status:** Accepted

**Context:** While rewriting `runFirstReplyUpdate` (ADR-001), the first-reply
integration suite — which had never actually been runnable — showed
`applyFirstReplyMarkers` returning `updatedCount: 0` even though rows were being
updated correctly.

**Decision:** Read the affected-row count as `result.count ?? result.rowCount ?? 0`.
The postgres.js driver returns an array whose affected-row count is `count`;
`rowCount` is the node-postgres spelling and is always `undefined` here.

**Consequences:** `POST /api/internal/emails/first-reply-markers` now reports a
truthful `updatedCount` to the Gmail sync, and the "Updated firstReplyAt" info log —
the operational signal that TAT capture is working at all — fires for the first
time. Any other `db.execute(...)` call in the codebase reading `.rowCount` is
suspect and has the same latent bug.

---

### ADR-003: Integration suites mock the logger (2026-08-05)

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
