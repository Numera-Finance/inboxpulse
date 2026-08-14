# InboxPulse Add-on — documentation

Read in order.

| | |
|---|---|
| [01 — Design](01-DESIGN.md) | what it does and why; the product argument |
| [02 — Architecture](02-ARCHITECTURE.md) | how it is built; request flow, models, caching, state |
| [03 — Decisions](03-DECISIONS.md) | the choices, the alternatives, and what each cost |
| [04 — Data and schema](04-DATA-AND-SCHEMA.md) | what it reads and writes; schema impact; data-quality traps |
| [05 — Security](05-SECURITY.md) | trust boundaries, scopes, entitlement, logging |

Also relevant:

- [`ADDON_SCOPES.md`](../ADDON_SCOPES.md) — why labels need `gmail.modify`
- [`ADDON_DISTRIBUTION.md`](../ADDON_DISTRIBUTION.md) — getting it to users
- [`decisions.md`](../decisions.md) — ADRs, including 015–019 from this work
- [`apps/addon/eval/`](../../apps/addon/eval/) — the classifier gauntlet
