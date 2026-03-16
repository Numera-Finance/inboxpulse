# Email Processing Pipeline & Cost Strategy

## Executive Summary

Our CRM processes customer emails through an intelligent multi-stage pipeline that extracts business intelligence (sentiment, escalation signals, upsell opportunities, churn risk, competitor mentions) from synced Gmail conversations. The system is designed with cost containment as a core principle — using free heuristics, open-source models, content stripping, caching, and batching to minimize paid LLM usage while maintaining high-quality analysis.

---

## 1. Pipeline Overview

```
Gmail Inbox
    │
    ▼
┌──────────────────────────────────────────────────────┐
│  1. GMAIL SYNC + PRE-FILTERING                       │  (apps/gmail)
│  Pub/Sub webhook trigger                             │
│                                                      │
│  ★ FILTER GATE 1: Blacklist (sender + domain)        │
│    Headers-only fetch → check blacklist → skip       │
│    Avoids fetching full content for blocked senders  │
│                                                      │
│  ★ FILTER GATE 2: Gmail labels                       │
│    Discard drafts (DRAFT label)                      │
│    Discard spam (SPAM label)                         │
│    Discard emails with no recipients                 │
│                                                      │
│  Only non-blacklisted, non-spam emails fetched fully │
└───────────┬──────────────────────────────────────────┘
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
│  ★ FILTER GATE 3: Content-based classification       │
│                                                      │
│  Stage 1: Body pattern matching     [FREE - instant] │
│    Regex scan for unsubscribe links, marketing       │
│    phrases, transactional keywords, auto-generated   │
│    messages (see detailed patterns below)            │
│                                                      │
│  Stage 2: Sender/domain matching    [FREE - instant] │
│    Known marketing platforms (Mailchimp, SendGrid…)  │
│    Social notifications (LinkedIn, GitHub, Slack…)   │
│    Calendar services (Google Calendar, Calendly…)    │
│    Chat notifications (Teams, Discord, Zoom…)        │
│    Noreply/automated sender patterns                 │
│                                                      │
│  Stage 3: HuggingFace spam model    [FREE - API]    │
│    mshenoda/roberta-spam — ML spam detection         │
│                                                      │
│  Stage 4: HuggingFace zero-shot     [FREE - API]    │
│    facebook/bart-large-mnli — multi-class classify   │
│    Labels: business, marketing, spam, transactional, │
│            automated                                 │
│                                                      │
│  Stage 5: LLM classification        [PAID - fallback]│
│    gemini-2.0-flash — only for ambiguous emails      │
│                                                      │
│  RESULT → category assigned to every email:          │
│    business | spam | marketing | transactional |     │
│    automated                                         │
│                                                      │
│  ✗ Non-business emails: analysis results DISCARDED   │
│  ✓ Business emails: proceed to AI analysis           │
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

### 2.1 Gmail Sync + Pre-Filtering (apps/gmail)

Emails arrive via Google Pub/Sub webhooks when new messages land in connected Gmail accounts. Before we even fetch email content, we apply two filter gates that prevent unwanted emails from entering the system at all.

**Filter Gate 1 — Blacklist (sender + domain):**

Tenants can configure a blacklist of email addresses and domains. When a blacklist is configured, we use a **two-phase fetch strategy** to avoid wasting Gmail API quota on blocked senders:

1. **Phase 1: Headers only** — Fetch just the `From` header and `historyId` for each message (lightweight metadata call)
2. **Check blacklist** — Compare sender against email blacklist (`noreply@vendor.com`) and domain blacklist (`vendor.com`)
3. **Skip blocked** — Blacklisted messages are never fetched in full. We still checkpoint the `historyId` so future syncs don't re-process them
4. **Phase 2: Full content** — Only non-blacklisted messages proceed to full content fetch

This means a tenant who blacklists 10 noisy automated senders pays zero processing cost for those emails — no content fetch, no storage, no analysis.

**Filter Gate 2 — Gmail label filtering:**

During parsing, emails are further filtered out if they match any of:
- **DRAFT label** — Gmail drafts are excluded
- **SPAM label** — Gmail's own spam detection is respected
- **No recipients** — Malformed emails with empty To/CC/BCC are discarded
- **Blacklisted senders** (second check at parse level for additional coverage)

**Remaining processing:**
1. Fetch full message content for surviving messages (batched in chunks of 50)
2. Parse headers: Subject, From, To, CC, BCC, Priority, RFC Message-ID, References
3. Extract body: prefer HTML, fall back to plain text, base64-decode
4. Group by Gmail `threadId` and sort chronologically
5. Send parsed emails to API service via `bulkInsertWithThreads`

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

This is **Filter Gate 3** and our most sophisticated cost-saving mechanism. The cascade is designed so that most non-business emails never reach a paid LLM. Each stage acts as a progressively more expensive filter. An email exits the cascade as soon as any stage reaches the confidence threshold.

| Stage | Method | Cost | Confidence Threshold | What It Catches |
|-------|--------|------|---------------------|-----------------|
| 1. Pattern matching | Regex on subject/body | Free, instant | 0.85 | Unsubscribe links, marketing phrases, transactional keywords, automated messages |
| 2. Sender analysis | Known domains/senders | Free, instant | 0.85 | noreply@, Mailchimp, SendGrid, social notifications, calendar invites |
| 3. HuggingFace spam | `mshenoda/roberta-spam` | Free API | 0.70 | Spam emails missed by patterns |
| 4. HuggingFace zero-shot | `facebook/bart-large-mnli` | Free API | 0.70 | Marketing, transactional, automated categories |
| 5. LLM classification | `gemini-2.0-flash` | Paid | N/A (final) | Ambiguous emails only |

**Stage 1 — Body pattern matching (FREE):**

We scan the email subject and body against curated regex patterns for each non-business category:

- **Spam patterns**: `unsubscribe`, `opt out`, `click here to stop`, `manage preferences/subscriptions`, `no longer wish to receive`, `remove from`
- **Marketing patterns**: `limited time offer`, `act now`, `exclusive deal`, `free trial`, `newsletter`, `% off`, `discount/promo code`, `upcoming events/webinars`, `don't miss`, `register now`, `join us for`, `save your spot`, `RSVP`
- **Transactional patterns**: `order confirmed/receipt/shipped`, `invoice #`, `payment confirmed/received/processed`, `tracking number`, `delivery update/status`, `receipt for`, `your order/purchase`
- **Automated patterns**: `auto-generated`, `do not reply`, `noreply`, `automated message/notification`, `system notification/alert`
- **Calendar invites**: `BEGIN:VCALENDAR` (ICS format detection)

A single high-confidence pattern match (>0.85) immediately classifies the email. Multiple weaker matches combine for a boosted confidence score (up to 0.90).

**Stage 2 — Sender/domain matching (FREE):**

We maintain curated lists of known non-business senders:

- **Automated senders**: `noreply@`, `no-reply@`, `notifications@`, `alerts@`, `mailer-daemon@`, `postmaster@`
- **Marketing platforms**: Mailchimp, SendGrid, Constant Contact, HubSpot, Marketo, Pardot, Klaviyo, Mailgun, Amazon SES, Sendinblue
- **Social/dev tool notifications**: Facebook, LinkedIn, Twitter/X, GitHub, GitLab, Slack, Notion, Figma, Asana, Trello, Jira, Monday, ClickUp, Linear, Discord, Reddit, Medium, Substack
- **Chat platform notifications**: Google Chat, Microsoft Teams, Slack, Discord, Zoom, WebEx, RingCentral
- **Calendar services**: Google Calendar, Outlook/Office 365, Calendly, Zoom

**Stage 3 — HuggingFace spam detection (FREE API):**

Calls the `mshenoda/roberta-spam` model via HuggingFace Inference API. This is a RoBERTa model specifically trained for email spam detection. Includes retry logic (3 retries with exponential backoff) to handle model cold-start delays.

**Stage 4 — HuggingFace zero-shot classification (FREE API):**

Calls `facebook/bart-large-mnli` for zero-shot classification with candidate labels: `business email`, `marketing email`, `spam`, `transactional notification`, `automated system message`. This catches emails that have the "feel" of marketing or automation but don't match explicit patterns.

**Stage 5 — LLM classification (PAID, last resort):**

Only reached when Stages 1–4 all return below-threshold confidence. Uses `gemini-2.0-flash` with structured output (temperature: 0.3, maxTokens: 500) for a definitive classification. In practice, <10% of emails reach this stage.

**What happens after classification:**

The classification result (`business`, `spam`, `marketing`, `transactional`, or `automated`) is stored as a signal on the email record. Critically, **all analysis results for non-business emails are discarded** — even if keyword pre-screening had flagged something. This prevents false business signals from marketing and automated emails polluting the CRM data.

Only emails classified as `business` have their AI analysis results persisted. Non-business emails are still stored (for the inbox view) but carry only their classification signal, not sentiment/escalation/upsell data.

**Key insight**: In a typical business inbox, 40–60% of emails are non-business (newsletters, notifications, automated messages). Stages 1–2 catch the majority instantly and for free. Stages 3–4 catch most remaining non-business emails using free HuggingFace inference. Only truly ambiguous emails (typically <10% of volume) reach the paid LLM.

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

| # | Strategy | Mechanism | Estimated Savings |
|---|----------|-----------|-------------------|
| 1 | **Blacklist filtering** | Headers-only fetch → check sender/domain blacklist → skip before content fetch | Eliminates all cost for blocked senders (API quota + storage + analysis) |
| 2 | **Gmail label filtering** | Discard drafts, spam, no-recipient emails at parse time | Removes Gmail-detected junk before it enters our pipeline |
| 3 | **Single-copy dedup** | RFC Message-ID + SHA-256 content hash dedup (2-layer) | ~3–5x reduction for shared mailboxes |
| 4 | **Content stripping** | HTML→text, quoted reply removal (talonjs + email-reply-parser), signature separation | 30–70% token reduction per email |
| 5 | **5-stage classification cascade** | Body pattern matching → sender/domain matching → 2x free HuggingFace models → paid LLM only as last resort | ~90% of non-business emails classified for free; analysis results discarded for spam/marketing/transactional/automated |
| 6 | **Keyword pre-screening** | Tenant-configurable keyword rules resolve analysis categories without LLM | 20–40% fewer LLM calls for well-configured tenants |
| 7 | **Batch analysis calls** | N analyses in 1 LLM request instead of N separate calls | ~40–60% fewer API calls, lower per-request overhead |
| 8 | **7-day result caching** | PostgreSQL cache (messageId + modelId key) avoids re-analyzing unchanged emails | 100% savings on cache hits |
| 9 | **Low-cost model selection** | Gemini 2.0 Flash as primary (cheapest tier with structured output) | ~10–20x cheaper than GPT-4 or Claude Opus per token |
| 10 | **Configurable analysis types** | Tenants enable only the analyses they need | Proportional savings per disabled type |
| 11 | **Non-LLM extraction** | Domain and contact extraction use regex, not LLM | Zero LLM cost for these always-on features |
| 12 | **Signature gating** | Only signatures with analyzable content (phone, title, etc.) trigger LLM extraction | Skips ~60–70% of signatures |
| 13 | **Thread summaries** | Compact thread context summaries instead of full email history | Significant token reduction for long threads |

### Cost Flow Illustration

For a hypothetical batch of **1,000 incoming Gmail notifications**:

```
1,000 emails arrive via Pub/Sub
  │
  │ ★ FILTER GATE 1: Blacklist
  ├─ 100 blocked by sender/domain blacklist   → 0 cost (headers-only fetch)
  │
  900 emails fetched in full
  │
  │ ★ FILTER GATE 2: Gmail labels
  ├─  50 discarded (drafts, spam, no-recipient) → 0 cost
  │
  850 emails parsed
  │
  ├─ 150 duplicates removed (RFC ID + hash)   → 0 analysis cost
  │
  700 unique emails stored
  │
  ├─ Content stripped: avg 50% token reduction → 50% savings on all downstream
  │
  │ ★ FILTER GATE 3: Classification cascade
  700 emails classified:
  │  ├─ 250 caught by body patterns (Stage 1)  → FREE (regex: unsubscribe, % off, invoice, noreply…)
  │  ├─  80 caught by sender matching (Stage 2) → FREE (Mailchimp, LinkedIn, Google Calendar…)
  │  ├─  50 caught by HuggingFace (Stage 3-4)  → FREE (ML spam + zero-shot classification)
  │  ├─  20 classified by LLM (Stage 5)        → ~20 LLM calls (only ambiguous emails)
  │  └─ 300 classified as business              → proceed to analysis
  │
  │  400 non-business emails: signals stored, analysis DISCARDED
  │
  300 business emails:
  │  ├─  40 resolved by keyword pre-screening  → FREE (for matched categories)
  │  ├─  25 served from cache                  → FREE
  │  └─ 235 analyzed by LLM                    → ~235 batch LLM calls
  │
  Result: ~255 paid LLM calls for 1,000 incoming emails
  Without optimizations: ~4,500+ calls (all users × all emails × all analyses × full content)
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
