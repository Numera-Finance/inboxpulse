# Email Analysis & Signature Extraction — Architecture

How an inbound email gets analyzed and how its derived data (customers, contacts,
signature, signals) gets persisted.

## Service contract

`apps/analysis` is a **pure analyzer**. Given an email, it returns structured
data. It does **not** write to the business database. It uses its own
`analysis_cache` table for LLM-result memoization, but nothing else.

`apps/api` owns all business persistence. It calls `apps/analysis` once per
email, receives JSON, and writes everything to the database inside a single
transaction. If anything in the write path fails, the whole transaction rolls
back — no partial state.

There is now exactly **one** HTTP endpoint exposed by `apps/analysis` for the
email pipeline:

```
POST /api/analysis/analyze
  → { extracted: { domains, contacts },
      results:   { sentiment, escalation, …, signature-extraction },
      filtered?: bool, filterResult?: ClassificationResult,
      cached?:   bool }
```

The previously-separate `/domain-extract`, `/contact-extract`, and
`/extract-signature` routes have been removed; their data is now part of
`/analyze`'s response. `/filter` and `/summarize` remain for debugging and
thread-summary helpers respectively.

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

  Phase 2 — commit (all writes inside one db.transaction):
  ├── ensureCustomersFromExtractedDomains(tx)         CustomerService.ensureCustomerForEmail
  │                                                    advisory-lock per (tenant, domain)
  │                                                    name = withAutoCustomerSuffix(inferredName)
  ├── ensureContactsInTransaction(tx, …)              one row per participant
  ├── createEmailParticipantsInTransaction(tx, …)     links email ↔ contact ↔ customer
  ├── updateEmailSignalsInTransaction(tx, …)
  ├── persistAnalysisResultsInTransaction(tx, …)
  ├── enrichContactsFromSignatureInTransaction(tx, …) sender-email guard then enrich
  ├── refineCustomerNameFromSignature(tx, …)          CustomerService.ensureCustomerForEmail
  │                                                    same single entry point as step 1,
  │                                                    now with signatureCompany set
  ├── updateThreadSummariesInTransaction(tx, …)       (when useThreadSummaries)
  └── updateAnalysisStatus(emailId, Completed, tx)
```

## Customer creation/refinement (single entry point)

```
customerService.ensureCustomerForEmail(tx, tenantId, domain, options)
```

Both call sites use this:

| Caller | When | Options passed |
|---|---|---|
| Phase-2 step "ensure customers" | every email, for every non-personal participant domain | `{ defaultName: <inferred from domain> }` |
| Phase-2 step "refine from signature" | every email where `signature.company` is non-empty, for the sender's domain | `{ defaultName: <inferred>, signatureCompany: <signature.company> }` |

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

`@crm/shared.PERSONAL_DOMAINS` is the canonical list of consumer-grade webmail
providers (gmail, yahoo, outlook, icloud, protonmail, etc.). Used by:

- `apps/analysis` `domain-extraction` to skip those domains during extraction
  (they don't get a customer auto-created).
- `apps/api` `analysis-service.ensureContactsInTransaction` to decide that
  participants on those domains shouldn't be linked to a customer by their
  email's domain.

Single import, no drift.

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

- `apps/analysis/check-gemini-cache.ts` — sends the same prompt prefix multiple
  times to verify Gemini implicit cache behaviour (today: not firing on test
  prompts because they're below the 4096-token threshold).
- `apps/api/debug-extractor-vs-llm.ts` — compares talon's signature slice to
  what the LLM extracts on a sample of emails.
- `apps/api/debug-signature-proposal.ts` — dumps proposed signature inputs to a
  file for manual review.
- `packages/database/debug-escalation-customer.ts` — explains why a specific
  email was attributed to the customer it was attributed to.
