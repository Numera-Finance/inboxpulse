# InboxPulse Add-on — architecture

## What it is

A **Google Workspace Add-on** on the HTTP (alternate) runtime — not Apps Script,
not a Chrome extension. Gmail asks our service what to draw; the service returns
JSON describing a card; Gmail renders it.

```
┌─────────┐   signed request    ┌──────────────────┐   OpenAI-compat  ┌──────────┐
│  Gmail  │ ──────────────────► │  crm-addon       │ ───────────────► │  Gemini  │
│  panel  │ ◄────────────────── │  (Cloud Run)     │ ◄─────────────── │flash-lite│
└─────────┘   card JSON         └──────┬───────────┘                  └──────────┘
                                       │
                        ┌──────────────┼──────────────┐
                        ▼              ▼              ▼
                  ┌──────────┐  ┌────────────┐  ┌──────────┐
                  │ Gmail API│  │  crm-api   │  │ in-proc  │
                  │ read +   │  │ account    │  │ analysis │
                  │ labels   │  │ history    │  │  cache   │
                  └──────────┘  └────────────┘  └──────────┘
```

**Consequence that matters:** the UI is not code on the user's machine. Shipping
a change is a deploy — every installed user updates at once, no reinstall, no
version skew. This is what makes "trivial install" achievable, and it is the
main argument for the add-on over the Chrome extension.

## Request flow

1. **Trigger.** Gmail calls `/gmail/contextual` when a message is open, or
   `/homepage` when the panel is opened with no message.
2. **Verify.** `auth/verify.ts` checks the request carries a Google-signed ID
   token. Only Google can mint one, so verifying any of them proves origin.
3. **First paint** at ~0.26s: envelope, participants, stored trend. No model.
4. **Analyse** on demand:
   - `classifyThreadMode()` — one focused call, ~0.6s
   - `fyi` → short-circuit, one line, done
   - otherwise `readThreadLive()` **and** `writeReplyOptions()` **concurrently**
5. **Render** a card and return it.

## Why the analysis is split across calls

A model given six instructions does the sixth badly. Mode asked as instruction 0
of 7 returned the fallback on every thread; asked alone it is right in 0.6s. The
same failure produced empty `historyPoints`.

So: **one job per call.**

| call | model | why |
|---|---|---|
| classify mode | flash-lite | one word; 1 output token |
| deep read | flash-lite | structured extraction, JSON-schema constrained |
| reply options | flash-lite | prose; no schema to get wrong |

Extraction and prose run **concurrently** — they are independent, and the wait is
`max()` rather than `sum()`.

## Models

Runtime is **`gemini-3.1-flash-lite`** via Gemini's OpenAI-compatible endpoint.
`reasoning_effort: none` — 2.5-class Flash thinks by default, which is billed as
output tokens *and*, with a tight `max_tokens`, returns a response with no
`content` field at all.

Local Ollama (`gemma3:12b` + `nemotron`) exists as a **demo path only**, so a
mailbox deliberately excluded from ingestion can still show a real panel. Every
latency figure measured against it describes an M5 Pro, not production.

## Caching

In-process, keyed on **thread id + viewer + message count + latest message id +
mode**.

- A new reply changes the key → re-analysed. A stale reading is worse than a slow
  one: *"3 questions unanswered"* is a claim about a conversation that has moved on.
- The message count catches deletions, where the latest id would not change.
- The viewer is in the key because account history is entitlement-scoped.

**Nothing is written to the tenant database.** The card says "Analysed live. Not
stored" and that is literally true — the analysis lives in one process's memory
and dies with it.

## State, and its limits

| state | lives | survives a deploy? |
|---|---|---|
| analysis cache | process memory | no |
| instant-label expiry | process memory | **no** |
| labels themselves | Gmail | yes |

`min-instances=1` keeps the process alive through normal use, so expiry works. It
does **not** survive a deploy, a crash or a region restart — marks made before
one are orphaned, which is why "Clear all my marks" exists and asks *Gmail* what
is labelled rather than trusting memory.

Making expiry a guarantee needs durable storage: a row per mark and a sweeper
holding its own credential. Neither exists.

## Timeouts

Every outbound call in a render path is bounded, because the failure that hurts
is a dependency that never answers rather than one that errors.

| call | budget |
|---|---|
| crm-api (enrichment) | 2s |
| Gmail label ops | 4s |
| model calls | 20s |

`crm-api` is enrichment only — history, stats, the customer name. A slow API
costs the user a smaller card, never the whole panel.

## Deployment

Cloud Run `crm-addon`, `--ingress all` (Google calls from outside the VPC),
`--allow-unauthenticated` at the network layer with **ID-token verification in
the application**. The Marketplace deployment holds only URLs and scopes, so a
rollback is a Cloud Run revision swap with no user action.
