# Architecture Decision Records

Lightweight, append-only record of key decisions and their rationale.
Never delete an entry — mark superseded ones as such.

Format:

```markdown
### ADR-NNN: Title (YYYY-MM-DD)
**Status:** Accepted | Superseded by ADR-XXX
**Context:** What problem or question came up
**Decision:** What we decided
**Consequences:** What this means for the codebase
```

---

### ADR-001: Escalations are assignable to any user in the tenant (2026-08-04)

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
- `getAssignableUsers` includes the caller, and `TaskMetaInfo` labels that row
  "Me" and hoists it, so taking an escalation back is reachable and every
  assignee name in the UI comes from one source (the `users` table) rather than
  the auth session, which carries a different name field.
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
