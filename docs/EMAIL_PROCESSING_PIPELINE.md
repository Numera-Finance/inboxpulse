# Email Processing Pipeline & Cost Strategy

## Executive Summary

Our CRM processes customer emails through an intelligent multi-stage pipeline that extracts business intelligence (sentiment, escalation signals, upsell opportunities, churn risk, competitor mentions) from synced Gmail conversations. The system is designed with cost containment as a core principle — using free heuristics, open-source models, content stripping, caching, and batching to minimize paid LLM usage while maintaining high-quality analysis.

---

## 1. Pipeline Overview

```
Gmail Inbox
    │
    ▼
┌──────────────────────────┐
│  1. GMAIL SYNC SERVICE   │  (apps/gmail)
│  Pub/Sub webhook trigger │
│  Fetch via Gmail API     │
│  Blacklist filtering     │
│  Draft/spam exclusion    │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────┐
│  2. INGESTION & DEDUP    │  (apps/api)
│  RFC Message-ID dedup    │
│  Content hash dedup      │
│  Single-copy storage     │
│  Thread grouping         │
└───────────┬──────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────┐
│  3. CONTENT EXTRACTION                               │  (apps/api)
│  HTML → plain text conversion                        │
│  Quoted reply stripping (talonjs + email-reply-parser)│
│  Signature separation                                │
│  Token savings: typically 30–70% reduction           │
└───────────┬──────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────┐
│  4. EMAIL CLASSIFICATION (5-Stage Cascade)           │  (apps/analysis)
│  Stage 1: Pattern matching          [FREE - instant] │
│  Stage 2: Sender/domain matching    [FREE - instant] │
│  Stage 3: HuggingFace spam model    [FREE - API]    │
│  Stage 4: HuggingFace zero-shot     [FREE - API]    │
│  Stage 5: LLM classification        [PAID - fallback]│
│                                                      │
│  Only business emails proceed to analysis ───────────┤
│  Spam/marketing/transactional/automated → skip       │
└───────────┬──────────────────────────────────────────┘
            │ (business emails only)
            ▼
┌──────────────────────────────────────────────────────┐
│  5. KEYWORD PRE-SCREENING                            │  (apps/api)
│  Tenant-configurable keyword rules                   │
│  Matches keywords → skips LLM for that category     │
│  Cached per tenant (5-min TTL)                       │
│  Categories: sentiment, escalation, upsell,          │
│              churn, kudos, competitor                 │
└───────────┬──────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────┐
│  6. AI ANALYSIS (Batch + Fallback)                   │  (apps/analysis)
│  Cache check (7-day TTL) → skip if cached           │
│  Batch call: all analyses in single LLM request     │
│  Fallback: parallel individual calls if batch fails │
│  Thread context summaries for conversation awareness │
│                                                      │
│  Analyses: sentiment, escalation, upsell, churn,    │
│            kudos, competitor, signature extraction   │
│  Non-LLM: domain extraction, contact extraction     │
└───────────┬──────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────┐
│  7. POST-PROCESSING                                  │  (apps/api)
│  Store analysis results (email_analyses table)       │
│  Update email signals[] array for fast querying     │
│  Update thread summaries (thread_analyses table)    │
│  Create/update contacts from signatures             │
│  Create/update customers from domains               │
│  Link email participants for access control         │
│  Generate tasks from escalations                    │
└──────────────────────────────────────────────────────┘
```

---

## 2. Stage-by-Stage Detail

### 2.1 Gmail Sync (apps/gmail)

Emails arrive via Google Pub/Sub webhooks when new messages land in connected Gmail accounts.

**Processing steps:**
1. Receive Pub/Sub notification with Gmail `historyId`
2. Fetch message list from Gmail API (headers first if blacklist is configured)
3. Filter out blacklisted senders/domains before fetching full content — avoids unnecessary API calls
4. Filter out drafts and spam using Gmail labels
5. Fetch full message content for non-blacklisted messages (batched in chunks of 50)
6. Parse headers: Subject, From, To, CC, BCC, Priority, RFC Message-ID, References
7. Extract body: prefer HTML, fall back to plain text, base64-decode
8. Send parsed emails to API service via `bulkInsertWithThreads`

### 2.2 Deduplication & Single-Copy Storage (apps/api)

We store exactly one copy of each email, even when the same message is received by multiple connected accounts.

**Two-layer deduplication:**

| Layer | Method | Field | Purpose |
|-------|--------|-------|---------|
| Layer 1 (Primary) | RFC 2822 Message-ID | `rfc_message_id` | Catches identical emails, forwards, CC copies |
| Layer 2 (Fallback) | SHA-256 content hash | `content_hash` | Catches emails missing Message-ID header |

**Content hash formula:**
```
SHA-256(lowercase(from) + subject + body + sorted(tos) + sorted(ccs) + sorted(bccs))
```

**Dedup scope:**
- **Within batch**: In-memory Sets track seen IDs/hashes across collections in the same sync run
- **Across batches**: Database index lookups (`idx_emails_rfc_message_id`, `idx_emails_content_hash`)

**Cost implication**: By storing a single copy, we analyze each email exactly once — not once per recipient. For a 5-person team all CC'd on a thread, this is a **5x reduction** in analysis costs.

### 2.3 Content Extraction & Stripping (apps/api)

Before any AI analysis, we strip the email down to its essential content. This is one of our most impactful cost-saving measures.

**Extraction pipeline:**
1. **HTML to text**: Converts HTML emails to plain text, stripping tags, styles, scripts, and images (`html-to-text` library)
2. **Quoted reply removal**: Uses `talonjs` (Mailgun's open-source library) and `email-reply-parser` to strip quoted previous replies — only the latest reply is sent for analysis
3. **Signature separation**: Extracts the email signature into a separate field, analyzed only when it contains actionable contact data (phone, title, LinkedIn, etc.)

**Signature intelligence**: Not all signatures are worth analyzing. We check for "analyzable content" using pattern matching:
- Phone numbers, email addresses, URLs, job titles, LinkedIn profiles, physical addresses
- A signature with just "Thanks, John" is skipped; one with "John Doe | VP Sales | +1-555-0100 | linkedin.com/in/jdoe" is extracted

**Token savings**: The extraction tracks savings explicitly:
```typescript
interface EmailExtractionResult {
  messageBody: string;       // Reply only (no quotes, no signature)
  signature: string | null;  // Separated signature (if useful)
  originalLength: number;
  cleanedLength: number;
  tokenSavingsPercent: number;  // Typically 30–70%
}
```

**Example**: A 10-message email thread where the latest reply is 150 words but the full quoted body is 1,500 words. We send ~150 words + optional signature instead of 1,500 words — an **~90% token reduction** for that email.

### 2.4 Email Classification — 5-Stage Cascade (apps/analysis)

The classification cascade is designed so that most non-business emails never reach a paid LLM. Each stage acts as a progressively more expensive filter.

| Stage | Method | Cost | Confidence Threshold | What It Catches |
|-------|--------|------|---------------------|-----------------|
| 1. Pattern matching | Regex on subject/body | Free, instant | 0.85 | Unsubscribe links, marketing phrases, transactional keywords, automated messages |
| 2. Sender analysis | Known domains/senders | Free, instant | 0.85 | noreply@, Mailchimp, SendGrid, social notifications, calendar invites |
| 3. HuggingFace spam | `mshenoda/roberta-spam` | Free API | 0.70 | Spam emails missed by patterns |
| 4. HuggingFace zero-shot | `facebook/bart-large-mnli` | Free API | 0.70 | Marketing, transactional, automated categories |
| 5. LLM classification | `gemini-2.0-flash` | Paid | N/A (final) | Ambiguous emails only |

**Key insight**: In a typical business inbox, 40–60% of emails are non-business (newsletters, notifications, automated messages). Stages 1–2 catch the majority instantly and for free. Stages 3–4 catch most remaining non-business emails using free HuggingFace inference. Only truly ambiguous emails (typically <10% of volume) reach the paid LLM.

**Result**: Only emails classified as `business` proceed to AI analysis. Spam, marketing, transactional, and automated emails are tagged with classification signals and skipped.

### 2.5 Keyword Pre-Screening (apps/api)

Before calling the LLM for business signal analysis, we check tenant-configured keyword rules.

**How it works:**
- Tenants configure keywords per category (e.g., escalation: `"cancel subscription" urgent`, upsell: `"upgrade" "premium plan"`)
- Keywords are cached per tenant with a 5-minute TTL
- If an email matches keywords for a category, that category's analysis is resolved via keyword match — no LLM call needed

**Categories supported**: sentiment (positive/negative), escalation, upsell, churn, kudos, competitor

**Cost implication**: For tenants with well-configured keywords, this can eliminate 20–40% of LLM analysis calls for known patterns.

### 2.6 AI Analysis (apps/analysis)

For emails that pass classification and keyword screening, we run AI-powered analysis.

**Analysis types (LLM-powered):**

| Analysis | Purpose | Default Enabled |
|----------|---------|-----------------|
| Sentiment | Positive/negative/neutral tone | Yes |
| Escalation | Needs management attention? | No |
| Upsell | Buying signals or upgrade interest? | Yes |
| Churn | Risk of customer leaving? | No |
| Kudos | Praise or positive feedback? | No |
| Competitor | Competitor mentioned? | No |
| Signature Extraction | Contact info from signatures | Yes |

**Analysis types (regex-based, no LLM):**

| Analysis | Purpose | Always Enabled |
|----------|---------|---------------|
| Domain Extraction | Extract company domains from email addresses | Yes |
| Contact Extraction | Extract/create contacts from participants | Yes |

**Model selection:**
- **Primary model**: `gemini-2.0-flash` (Google) — chosen for excellent cost/performance ratio
- **Fallback model**: `gemini-1.5-flash` — used if primary fails
- **Signature extraction**: `gemini-2.0-flash` (with low temperature: 0.1 for consistency)
- Models are configurable per tenant and per analysis type

**Batch execution strategy:**
1. **Check cache first**: 7-day TTL cache keyed by `(messageId, modelId)`. Cache hit = zero LLM cost
2. **Try batch call**: Combine all enabled analyses into a single LLM request with a combined schema. One API call instead of N
3. **Fallback to parallel individual calls**: If batch fails (e.g., schema too complex), execute each analysis type in parallel

**Thread context**: For emails within a thread, the system maintains thread-level summaries (stored in `thread_analyses` table). These summaries provide conversation context to the LLM without sending all previous emails — another token optimization.

---

## 3. Cost Containment Summary

### Current Measures (Implemented)

| Strategy | Mechanism | Estimated Savings |
|----------|-----------|-------------------|
| **Single-copy dedup** | RFC Message-ID + content hash dedup | ~3–5x reduction for shared mailboxes |
| **Content stripping** | HTML removal, quoted reply stripping, signature separation | 30–70% token reduction per email |
| **5-stage classification cascade** | Free pattern/sender matching → free HuggingFace → paid LLM | ~90% of non-business emails classified for free |
| **Keyword pre-screening** | Tenant keyword rules resolve analyses without LLM | 20–40% reduction for well-configured tenants |
| **Batch analysis calls** | N analyses in 1 LLM request instead of N separate calls | ~40–60% fewer API calls, lower per-request overhead |
| **7-day result caching** | PostgreSQL cache avoids re-analyzing unchanged emails | 100% savings on cache hits |
| **Low-cost model selection** | Gemini 2.0 Flash as primary (cheapest tier) | ~10–20x cheaper than GPT-4 or Claude Opus per token |
| **Configurable analysis types** | Tenants enable only analyses they need | Proportional savings per disabled type |
| **Non-LLM extraction** | Domain and contact extraction use regex, not LLM | Zero LLM cost for these always-on features |
| **Signature gating** | Only signatures with analyzable content (phone, title, etc.) trigger LLM extraction | Skips ~60–70% of signatures |
| **Thread summaries** | Summarized thread context instead of full email history | Significant token reduction for long threads |
| **Blacklist filtering** | Skip blacklisted senders before fetching full content | Saves Gmail API quota and processing cost |

### Cost Flow Illustration

For a hypothetical batch of **1,000 incoming emails**:

```
1,000 emails synced from Gmail
  │
  ├─ 200 duplicates removed (dedup)           → 0 analysis cost
  │
  800 unique emails
  │
  ├─ Content stripped: avg 50% token reduction → 50% savings on all downstream
  │
  800 emails classified (cascade):
  │  ├─ 320 caught by patterns (Stage 1-2)    → FREE
  │  ├─ 120 caught by HuggingFace (Stage 3-4) → FREE
  │  ├─  40 classified by LLM (Stage 5)       → ~40 LLM calls
  │  └─ 320 classified as business             → proceed to analysis
  │
  320 business emails:
  │  ├─  50 resolved by keyword pre-screening  → FREE (for matched categories)
  │  ├─  30 served from cache                  → FREE
  │  └─ 240 analyzed by LLM                    → ~240 batch LLM calls
  │
  Result: ~280 paid LLM calls for 1,000 incoming emails
  Without optimizations: ~4,000+ calls (deduped users × all analyses × full content)
```

### Model Cost Comparison

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Our Usage |
|-------|----------------------|------------------------|-----------|
| Gemini 2.0 Flash | ~$0.10 | ~$0.40 | Primary for all analyses |
| Gemini 1.5 Flash | ~$0.075 | ~$0.30 | Fallback model |
| GPT-4o | ~$2.50 | ~$10.00 | Available but not default |
| Claude Sonnet | ~$3.00 | ~$15.00 | Available but not default |

By defaulting to Gemini 2.0 Flash, our per-email analysis cost is approximately **$0.0001–$0.0005** (depending on email length and enabled analyses), compared to **$0.005–$0.02** with premium models.

---

## 4. Observability

### Langfuse Integration
- Optional tracing via Vercel AI SDK integration
- Tracks: trace IDs, user/session IDs, analysis type tags, provider/model metadata
- Enables monitoring of token usage, latency, and model performance per analysis type

### Token Tracking
- Every LLM call captures `promptTokens`, `completionTokens`, `totalTokens`
- Stored in `email_analyses` table per analysis result
- Available for aggregation and cost reporting via Langfuse

### Structured Logging
- All stages log classification decisions with confidence, stage, and duration
- Email extraction logs original vs. cleaned length and token savings percentage
- Cache hits/misses are logged for monitoring cache effectiveness

---

## 5. Future Cost Containment Opportunities

### Near-Term (Low Effort)

| Opportunity | Description | Estimated Impact |
|-------------|-------------|-----------------|
| **Prompt caching** | Leverage Gemini/provider prompt caching for repeated system instructions. A `PromptBuilder` framework already exists in codebase but is not yet active | 30–50% input token reduction |
| **Aggressive signature caching** | Cache signature extraction results per contact (signatures rarely change) | Eliminate repeat extractions for known contacts |
| **Cost dashboard** | Aggregate token usage from `email_analyses` table into a per-tenant cost dashboard | Better visibility enables optimization decisions |
| **Expand keyword rules** | Auto-suggest keywords based on historical LLM results to shift more classifications to free keyword matching | 10–20% additional LLM call reduction |

### Medium-Term (Moderate Effort)

| Opportunity | Description | Estimated Impact |
|-------------|-------------|-----------------|
| **Fine-tuned classification model** | Train a small model on our labeled classification data to replace HuggingFace stages + reduce LLM fallback | Potentially eliminate Stage 5 LLM for 95%+ emails |
| **Async batch processing via Inngest** | Queue emails for batch processing during off-peak hours to leverage lower API rates | 10–30% cost reduction with batch API pricing |
| **Tiered model routing** | Use a lightweight model to triage email complexity, routing simple emails to cheaper/smaller models and complex ones to stronger models | 20–40% cost reduction |
| **Per-tenant cost budgets** | Implement rate limiting and cost caps per tenant to prevent runaway costs | Risk mitigation |
| **Incremental thread analysis** | Only re-analyze changed thread context instead of regenerating full summary | Proportional savings for active threads |

### Long-Term (Higher Effort)

| Opportunity | Description | Estimated Impact |
|-------------|-------------|-----------------|
| **Self-hosted models** | Deploy small open-source models (e.g., Llama, Mistral) for classification and simple analyses on Cloud Run | Eliminate per-token API costs for routine analyses |
| **Embedding-based similarity** | Use embeddings to find similar previously-analyzed emails and reuse results | Major reduction for repetitive communications |
| **Multi-tenant model sharing** | Shared fine-tuned models across tenants with similar industries | Amortize training costs |

---

## 6. Architecture Decisions

### Why Gemini 2.0 Flash as Default?
- Best cost/performance ratio for structured output tasks (JSON schema adherence)
- Google's pricing is significantly lower than OpenAI/Anthropic for flash-tier models
- Sufficient quality for sentiment analysis, signal detection, and signature extraction
- Gemini 1.5 Flash as fallback ensures resilience without premium model costs

### Why a 5-Stage Cascade Instead of LLM-Only Classification?
- Stages 1–2 are instant and free — regex patterns catch obvious non-business emails
- HuggingFace models (Stages 3–4) are free and provide ML-quality classification
- The LLM (Stage 5) is only a safety net for truly ambiguous cases
- This architecture means classification cost scales with ambiguity, not volume

### Why Strip Quoted Content?
- Email threads grow linearly — a 20-message thread can be 10,000+ tokens
- The latest reply (typically 100–500 tokens) contains the actionable content
- Thread context is provided separately via compact summaries, not raw email history
- Token savings compound: fewer tokens = lower cost AND faster inference

### Why Single-Copy Storage?
- In team inboxes, the same email often arrives for 3–5 users (CC, shared mailbox)
- Without dedup, we'd analyze the same content 3–5 times
- RFC Message-ID is the gold standard for email identity; content hash is the fallback
- Both are indexed for O(log n) lookup performance

---

## 7. Data Model Summary

| Table | Purpose | Key Cost Relationship |
|-------|---------|----------------------|
| `emails` | Single-copy email storage | Dedup prevents redundant analysis |
| `email_threads` | Thread grouping | Thread summaries reduce per-email context |
| `email_analyses` | Per-email, per-type analysis results | Stores token usage for cost tracking |
| `thread_analyses` | Thread-level summaries | Compact context reduces prompt tokens |
| `analysis_cache` | 7-day LLM result cache | Eliminates re-analysis cost |
| `email_participants` | Links emails to users/contacts | Enables access control without reprocessing |

---

## 8. Key File Locations

| Component | Location |
|-----------|----------|
| Gmail sync service | `apps/gmail/src/services/sync.ts` |
| Email parser | `apps/gmail/src/services/email-parser.ts` |
| Deduplication logic | `apps/api/src/emails/service.ts` |
| Content extraction/stripping | `apps/api/src/emails/extraction/extractor.ts` |
| Analysis orchestrator | `apps/api/src/emails/analysis-service.ts` |
| Email classification cascade | `apps/analysis/src/services/email-filter.ts` |
| AI analysis executor | `apps/analysis/src/framework/executor.ts` |
| Analysis modules (prompts) | `apps/analysis/src/analyses/modules.ts` |
| Analysis cache | `apps/analysis/src/services/cache-service.ts` |
| Model configuration defaults | `packages/shared/src/types/analysis.ts` |
| Keyword pre-screening | `apps/api/src/keywords/service.ts` |
| Signature extraction | `apps/analysis/src/services/signature-extraction.ts` |
| Langfuse/AI service | `apps/analysis/src/services/ai-service.ts` |
