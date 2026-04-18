# Email Analysis & Signature Extraction — Architecture

How an inbound email gets analyzed and how its derived data (customers, contacts,
signature, signals) gets persisted.

## Service contract

`apps/analysis` is a **pure analyzer**. Given an email, it returns structured
data. It does **not** write to the business database. It uses its own
`analysis_cache` table for LLM-result memoization, but nothing else.

`apps/api` owns all business persistence. It calls `apps/analysis` once per
email, receives JSON, and writes the email's data to the database inside a
single transaction. The customer + contact + email-participant + signal +
analysis-result + signature-enrichment writes all participate in the same tx
— if any of them fails, all roll back.

Two write paths run **outside** that transaction (with their own connections):

1. `userService.ensureUsersFromEmails` — runs **before** the email tx as Step 0.
   User rows for tenant-domain participants are created idempotently. If the
   email tx later fails, those user rows persist; that's deliberate (users
   are tenant-domain employees, not email-scoped).
2. `threadAnalysisService.updateThreadSummaries` — runs **inside** the email
   tx (Step 8) but its inner repo opens its own transactions. It's currently
   gated off (`useThreadSummaries: false` at both call sites) and must not be
   enabled until that service is refactored to accept and use the email tx.

Everything else — customer ensure, contact ensure, email participants,
signals, analysis-result rows, signature-enrichment of contacts, and the
sender's customer-name refinement from `signature.company` — is inside the
single email transaction.

There is now exactly **one** HTTP endpoint exposed by `apps/analysis` for the
email pipeline:

```
POST /api/analysis/analyze
  → { extracted: { domains: [{ domain, inferredName }],
                   contacts: [{ email, name?, customerDomain }] },
      results:   { sentiment, escalation, …, signature-extraction },
      filtered?: bool, filterResult?: ClassificationResult,
      cached?:   bool }
```

**Shape is typed end-to-end.** The extraction schema lives in
`packages/clients/src/analysis/client.ts` as a Zod schema
(`extractedPayloadSchema`). The analysis client parses the response through
this schema, so a shape regression on either side fails at the boundary
instead of silently breaking customer attribution downstream.

Every extracted contact carries a `customerDomain` field — the lookup key
the api uses to find the customer row ensured in Step 1. Analysis is the
only place that decides what `customerDomain` is:

- **Corporate address** → top-level domain (e.g. `mail.acme.com` → `acme.com`).
- **Personal address** (gmail / yahoo / outlook / etc., from `PERSONAL_DOMAINS`)
  → a per-address **pseudo-domain** formed by replacing `@` with `-`
  (`uzi.dutta@gmail.com` → `uzi.dutta-gmail.com`). Each personal-email
  sender gets its own auto-created customer so that the row can be merged
  later into a real one if needed.

The api never inspects an email's domain, never branches on personal vs
corporate, and never calls the personal-domain list. It just does
`customersByDomain[contact.customerDomain]`.

The previously-separate `/domain-extract`, `/contact-extract`, and
`/extract-signature` routes have been removed; their data is now part of
`/analyze`'s response. `/filter` and `/summarize` remain for debugging and
thread-summary helpers respectively.

## Customer attribution for analyzed emails

The "Customer" column on the AI Analysis list, the detail pane, the export,
and the customer-dropdown filter **all use the sender's customer only** —
no tie-breaker, no fallback to other participants. The three queries in
`apps/api/src/emails/repository.ts` (`searchAnalyzedEmails`,
`exportAnalyzedEmails`, `getAnalyzedEmailById`) join
`email_participants` with `direction = 'from'` directly, not as a
tie-breaker inside `DISTINCT ON`.

Rationale: a thread often has mixed-domain participants (e.g. an end
customer on gmail.com writing to someone on mytaxfiler.com). Using the
first-available customer would mis-attribute the email to whichever
recipient happened to sort first. The sender-only rule gives a single,
unambiguous answer and aligns with the per-sender pseudo-customer above
(so the displayed customer is never blank).

## End-to-end flow

```
ingestion (Gmail/Pub/Sub)
  ↓
emails table + Inngest job
  ↓
EmailAnalysisService.analyze(email)                    [apps/api/src/emails/analysis-service.ts]

  Phase 1 — gather (no DB writes):
  ├── ensureUsersFromEmails(...)                      (idempotent; outside transaction)
  ├── collectEmailParticipantsForContacts(email)
  ├── extractEmailContent(ctx)                        (talon quote-strip + signature-attached input)
  ├── runKeywordAnalysis(ctx)                         (cheap regex)
  └── callMainAnalyses(ctx) → POST /api/analysis/analyze
        ↓
        apps/analysis (pure):
          ├── DomainExtractionService.extractDomains(email)   → ExtractedDomain[]
          ├── ContactExtractionService.extractContacts(email) → ExtractedContact[]
          ├── EmailFilterService.classify(email)               → ClassificationResult
          └── AnalysisExecutor.executeBatch(types, …)         → ONE LLM call
                                                                  combined Zod schema
                                                                  returns sentiment, escalation,
                                                                  …, signature-extraction
        ↑
      response: { extracted, results, filterResult, cached }

  Phase 2 — commit (writes inside one db.transaction unless marked):
  ├── ensureCustomersFromExtractedDomains(tx)         CustomerService.ensureCustomerForEmail
  │                                                    advisory-lock per (tenant, domain)
  │                                                    name = withAutoCustomerSuffix(inferredName)
  ├── ensureContactsInTransaction(tx, …)              one row per participant; uses tx
  │                                                    for customer lookup so it sees Step 1
  ├── createEmailParticipantsInTransaction(tx, …)     links email ↔ contact ↔ customer
  ├── updateEmailSignalsInTransaction(tx, …)
  ├── persistAnalysisResultsInTransaction(tx, …)
  ├── enrichContactsFromSignatureInTransaction(tx, …) sender-email guard then enrich;
  │                                                    contactRepository.enrichFromSignature
  │                                                    now accepts and uses tx
  ├── refineCustomerNameFromSignature(tx, …)          CustomerService.ensureCustomerForEmail
  │                                                    same single entry point as Step 1,
  │                                                    now with signatureCompany set
  ├── updateThreadSummariesInTransaction(tx, …)       ⚠ NOT tx-aware (own connection);
  │                                                    gated off — useThreadSummaries=false
  └── updateAnalysisStatus(emailId, Completed, tx)
```

## Customer creation/refinement (single entry point)

```
customerService.ensureCustomerForEmail(tx, tenantId, domain, options)
```

Both call sites use this:

| Caller | When | Options passed |
|---|---|---|
| Phase-2 step "ensure customers" | every email, for every extracted `domain` (corporate top-level + per-address personal pseudo-domain) | `{ defaultName: <analysis-supplied inferredName> }` |
| Phase-2 step "refine from signature" | every email where `signature.company` is non-empty; sender's `customerDomain` is looked up from `extracted.contacts` | `{ signatureCompany: <signature.company> }` |

Behavior (idempotent):
- No customer for `domain` → create with `withAutoCustomerSuffix(name)`, `isAutoCreated=true`.
- Exists & auto-created & current name ≠ proposed name → update.
- Exists & auto-created & names match → no-op.
- Exists & manually created → leave alone, return as-is.

Race safety: each call acquires a `pg_advisory_xact_lock` keyed on
`(tenantId, domain)` at the start of the function. Concurrent calls for the
same domain serialize on the lock; the lock auto-releases at end of transaction.

The `(Auto)` suffix is applied via `withAutoCustomerSuffix` from `@crm/shared`.
Single source of truth — no other place builds the suffix inline.

## Personal-domain handling

`@crm/shared.PERSONAL_DOMAINS` is the canonical list of consumer-grade
webmail providers (gmail, yahoo, outlook, icloud, protonmail, etc.). It is
used **only inside `@crm/shared.resolveCustomerKeyForEmail`**, which is the
single helper that turns an email address into the `(customerDomain,
defaultName)` pair the pipeline keys customers on.

Personal-address behaviour:

- `personalEmailToPseudoDomain(email)` builds the per-address pseudo-domain
  (`uzi.dutta@gmail.com` → `uzi.dutta-gmail.com`).
- `inferNameFromEmailLocalPart(email)` builds a human-readable default name
  from the local part when the email header carries none — otherwise the
  header's display name wins (e.g. `"Uzi Dutta" <…>` → `"Uzi Dutta"`).
- No gmail-style normalization (`uzi.dutta@gmail.com` and
  `uzidutta+anything@gmail.com` stay distinct). Users can merge customers
  later if that matters.

`apps/api` never imports `PERSONAL_DOMAINS` or the pseudo-domain helpers —
it just consumes `customerDomain` from the /analyze response. This keeps
the personal-vs-corporate branching in exactly one place.

## Caching status (informational)

`PromptBuilder` (`apps/analysis/src/framework/prompt-builder.ts`) defines
cache-aware sections; not currently used by `executeBatchCall`. The Vercel AI
SDK for Google does surface `cachedContentTokenCount` from Gemini's
`usageMetadata` as `usage.cachedInputTokens`. `AnalysisExecutor` strips it
before logging, so cache activity is invisible in our own logs.

To check today: query Langfuse traces for any analysis call; look for
`cachedInputTokens` in the `usage` block. To make this visible in our own
logs, expand the usage mapping in `executor.ts`. To enable explicit caching:
switch `executeBatchCall` to use `PromptBuilder.buildPromptMessages` and pass
cache hints through `AIService` to the provider.

Implicit Gemini-2.5-pro caching requires ≥4,096 input tokens. Production
prompts (~7 analyses + body + thread context) are likely above this — but
since we don't log `cachedInputTokens` we can't tell.

## Diagnostic scripts

- `scripts/diagnostic/check-gemini-cache.ts` — sends the same prompt prefix
  multiple times to verify Gemini implicit cache behaviour (today: not firing
  on test prompts because they're below the 4096-token threshold).
- `packages/database/debug-escalation-customer.ts` — explains why a specific
  email was attributed to the customer it was attributed to.
