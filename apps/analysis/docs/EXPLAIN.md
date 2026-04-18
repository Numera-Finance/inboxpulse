# Email Analysis & Signature Extraction — Architecture

How an inbound email gets analyzed, how its signature gets extracted, and how the sender's
customer record is created/refined. Covers the path across `crm-api` and `crm-analysis`.

## End-to-end flow

```
ingestion (Gmail/Pub/Sub)
  ↓
emails table + Inngest job
  ↓
EmailAnalysisService.analyze(email)                    [apps/api/src/emails/analysis-service.ts]
  ↓
  ├── extractEmailContent(ctx)
  │     extractLatestReply(body, isHtml) — talon + email-reply-parser
  │     ctx.email.body      = dequoted reply (signature stripped, what other analyses see)
  │     ctx.email.signature = dequoted reply WITH signature attached
  │                            (LLM finds the signature inside it)
  │
  ├── runKeywordAnalysis(ctx)                          (cheap regex; resolves some signals)
  │
  └── callMainAnalyses(ctx, excludeTypes)              (HTTP → analysis service /analyze)
            ↓
            POST /analyze                              [apps/analysis/src/routes/analysis.ts]
              ├── classifier filter (spam/marketing)   [emailFilterService]
              ├── if non-business → skip               (returns filtered=true)
              └── analysisExecutor.executeBatch(types) [apps/analysis/src/framework/executor.ts]
                    ├── try executeBatchCall          (ONE LLM call; combined Zod schema)
                    │     buildBatchedSchema  → z.object({sentiment, escalation, …, signature-extraction})
                    │     buildBatchedPrompt  → instructions ‖ "From: …" ‖ Email Body ‖ Email Signature
                    │     aiService.generateStructuredOutput(...)  → Gemini-2.5-pro
                    └── on failure → executeIndividualCalls (parallel per analysis)
            ↑
        results (Map<AnalysisType, AnalysisResult>)
  ↑
  ├── update emails.signals from analyses
  │
  ├── enrichContactsFromSignatureInTransaction         (writes title/phone/etc. to contacts)
  │     contactRepository.enrichFromSignature          (only fills empty fields)
  │     pre-step: sender-email guard rejects extraction if signature.email's
  │               domain ≠ sender's domain (defense vs. embedded forwards)
  │
  └── refineCustomerNameFromSignature                  (sender's customer name from signature.company)
        customerService.ensureCustomerForEmail(...)    (single entry point)
```

## Customer creation/refinement (the one-method rule)

There is **one** path for creating or refining auto-created customers from email
context: `CustomerService.ensureCustomerForEmail(tenantId, domain, options)`.

| Caller | When | What it passes |
|---|---|---|
| `apps/analysis/src/services/domain-extraction.ts` | During domain extraction (early) | `defaultName: inferFromDomain(domain)` |
| `apps/api/src/emails/analysis-service.ts:refineCustomerNameFromSignature` | After signature analysis (later) | `signatureCompany: signature.company` (and same `defaultName` for completeness, unused since signature wins) |

`ensureCustomerForEmail` is idempotent:
- Doesn't exist → create with `withAutoCustomerSuffix(signatureCompany ?? defaultName)`, `isAutoCreated=true`.
- Exists & `isAutoCreated=true` & current name ≠ proposed name → update.
- Exists & `isAutoCreated=false` (manually created or already refined) → leave alone.
- Exists & names match → no-op.

The "(Auto)" suffix is applied via `withAutoCustomerSuffix` in `@crm/shared`. Single
source of truth — neither caller assembles the suffix inline.

`upsertCustomer` (used by the UI's Add Customer flow) is a separate code path; it
stays as-is. The two methods serve different use cases — UI manual create vs.
email-pipeline auto-create.

## Key invariants

- **One LLM call per email is the happy path.** `executeBatchCall` packs all enabled
  analyses (including `signature-extraction`) into a single call with a combined
  Zod schema. Per-analysis parallel calls only happen as a fallback when the
  batch call's structured output fails to parse.

- **Signature-extraction always runs** (no `hasAnalyzableSignatureContent` gate).
  The LLM is given the dequoted reply with signature attached and asked to find
  the signature inside.

- **Quote stripping is the only reliable mechanical part.**
  `talon.quotations.extractFromPlain` removes quoted history well. Talon's separate
  signature-detection step is unreliable and we no longer use it; the LLM finds
  the signature within the reply.

- **Sender-ownership rule.** Both the prompt and a post-LLM guard ensure that an
  embedded forwarded signature isn't attributed to the sender.

- **Contact enrichment is fill-the-empties.** `enrichFromSignature` only updates
  contact fields that are currently null/empty — preserves user-edited values.

- **Customer name precedence.** Signature `company` ≻ domain-derived inference,
  but only for `isAutoCreated=true` customers (manually-set names are untouched).

## Schemas

- Per-analysis: `apps/analysis/src/analyses/schemas.ts`
- Combined batch schema: built dynamically in `AnalysisExecutor.buildBatchedSchema()` —
  `z.object({sentiment: …, escalation: …, …, signature-extraction: …})`.
- Persisted shape: `apps/api/src/emails/analysis-schema.ts` (`email_analyses` table).

## Prompt structure

`buildBatchedPrompt()` produces a single string:

```
## Sentiment Analysis
<sentiment instructions>

## Escalation Detection
<escalation instructions>

…

## Signature Extraction
<signature instructions, including sender-ownership rule>

From: <from name> <<from email>>
Email Subject: …
Email Body: <dequoted reply, signature stripped>

Email Signature: <dequoted reply with signature attached>     ← LLM finds the sig in here
Thread Context: <…>                                           ← when threadContext is provided
```

The `From:` line is sender identity and is referenced by the signature module's
sender-ownership rule. Other modules can use it too; it's harmless.

## Caching status

`PromptBuilder` (`apps/analysis/src/framework/prompt-builder.ts`) defines cache-aware
sections; it's not used by `executeBatchCall`. The Vercel AI SDK for Google
(`@ai-sdk/google`) does surface `cachedContentTokenCount` from Gemini's
`usageMetadata` as `usage.cachedInputTokens`. `AnalysisExecutor` strips it from
logged usage today, so cache activity is invisible in our own logs. Langfuse
traces should still capture it.

To verify in your own logs: extend the usage mapping in `executor.ts` to include
`cachedInputTokens`. To force explicit caching: switch `executeBatchCall` to
build messages via `PromptBuilder.buildPromptMessages` and pass cache hints
through `AIService` to the provider.

## Standalone signature service (deprecated path)

`apps/analysis/src/services/signature-extraction.ts` exists as its own endpoint
(`POST /extract-signature`) called from `routes/analysis.ts:203`. The API service
does **not** hit this in the standard analyze flow; the production path goes
through the unified `/analyze` endpoint and the batch call. Confirm no other
caller before deletion.

## Diagnostic scripts

- `apps/analysis/check-gemini-cache.ts` — tests Gemini implicit caching by sending
  the same prompt prefix multiple times and inspecting `usage.cachedInputTokens`.
- `apps/api/debug-extractor-vs-llm.ts` — compares talon's signature slice to the
  LLM's output for a sample of emails.
- `apps/api/debug-signature-proposal.ts` — dumps proposed signature inputs to
  a file for manual eyeball review.
- `packages/database/debug-escalation-customer.ts` — explains why a specific
  email's customer attribution is what it is.
