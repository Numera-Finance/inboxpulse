# InboxPulse Add-on — security

## Trust boundaries

```
user's mailbox ──► Gmail ──► [Google] ──► crm-addon ──► Gemini (paid tier)
                                            │
                                            ├──► crm-api ──► CRM database
                                            └──► Cloud Logging
```

Each arrow is a place data can leak. Taken in turn.

## 1. Is the caller really Google?

Cloud Run is `--allow-unauthenticated` at the network layer — anyone can POST to
it. Authentication happens **in the application**: `ADDON_VERIFY_ID_TOKEN=true`
requires a Google-signed ID token, verified against Google's public certs with
issuer `accounts.google.com`. Only Google can mint one, so verifying any of them
proves origin.

Without it the panel renders *"Could not verify this request came from Google, so
no data is shown."* — not an error page, a refusal to show data.

`ADDON_AUDIENCE` tightens this to an exact `aud` claim. It is currently **blank
on purpose**: a guessed value rejected every legitimate request, and the honest
default is signature + issuer until the real claim has been observed in logs.

## 2. What can the add-on reach in the user's mailbox?

| scope | tier |
|---|---|
| `gmail.addons.execute` | non-sensitive |
| `gmail.addons.current.message.readonly` | non-sensitive, per-message |
| `gmail.modify` | **RESTRICTED** |
| `userinfo.email` | non-sensitive |

`gmail.modify` is the one that matters and is paid deliberately: applying a label
to a thread requires it (`gmail.labels` covers label *definitions* only, not
attaching them). Consent reads *"Read, compose, and send emails from your Gmail
account."*

Internal distribution from an org-owned GCP project is **CASA-exempt**, so the
cost is the consent sentence rather than a security review. That exemption ends
the moment this goes to an external customer.

## 3. Can one user see another's data?

**Account history is entitlement-scoped.** `AccountContextService` resolves the
sender's domain to a customer, then decides scope:

- `tenant` — everything the organisation has, only for a viewer entitled to that
  customer (admin, or a row in `user_accessible_customers`)
- `viewer` — only mail the viewer was personally on

A customer the viewer cannot access returns `found:false`, **identical to an
unknown domain**, so the response does not disclose that the customer exists.

Admin status is resolved **server-side** from the user's actual permissions, not
taken from the client — a role asserted by the caller is a decorative access
check.

The write path enforces the same rule: `createTaskForViewer` refuses unless the
viewer is entitled to that customer.

**The analysis cache is keyed by viewer.** Two people opening the same thread do
not share an entry, because the enrichment differs by entitlement.

**Fixed here:** the instant-label working set was a process-global map with no
notion of who marked what. With one user that is invisible; with two it is a
leak, because the homepage lists marked threads *with their subjects*. Now
namespaced per viewer.

## 4. What leaves the machine?

**Thread text goes to Gemini** on the paid tier (`billingEnabled: true`,
`project-y-email-sentiment`). Google's paid Gemini API does not use submitted
data to improve their products; the free tier does. That distinction is the whole
basis for this being acceptable.

**Nothing goes to the tenant database.** The analysis lives in process memory and
dies with it.

**Nothing is stored in the browser.** A CardService add-on has no client — the
panel is JSON rendered by Cloud Run. There is no localStorage to inspect.

## 5. Logs — including from project owners

This is the sharpest question, because **Cloud Logging is readable by every
project owner**, and this project has four:

```
grastogi@   owner, editor        mbalsara@   owner
npradhan@   owner                vmohan@     owner
```

A log of which mailbox opened which panel is a record of behaviour the user never
agreed to share with colleagues.

### What was done

**Identifiers are no longer written.** The user's email is dropped from the
verification log entirely, and mailbox addresses and customer domains are
**namespaced, salted and hashed**:

```
user: 3f9a1c2e4b70     account: b71d40aa9c12
```

All three properties are load-bearing:

- **Salted**, because a bare hash of a work email is not anonymous. The space is
  `firstname@mystartupcfo.com` — a few hundred candidates — so anyone with the
  staff list can hash them all and match. An unsalted digest is a lookup table
  with extra steps. The salt is in Secret Manager (`ADDON_LOG_SALT`), so
  reversing a log line needs **both the logs and the secret**, which are
  different grants.
- **Namespaced**, so the same string hashed as a mailbox and as a customer
  domain yields different digests. Without it the two are cross-correlatable —
  you could tell a viewer's address matches a customer's domain, which is
  exactly the relationship the redaction hides.
- **Fails closed.** With no salt configured it logs `redacted` rather than a weak
  digest. A hash that looks anonymous and is not is worse than an omitted value.

The principle is that **you cannot leak what was never written** — no future IAM
mistake can expose a value that does not exist in the log.

Message bodies, subjects and quotes have never been logged.

### To go further

Pseudonymisation is the strongest control here because it removes the data. If
stricter separation is wanted for what remains:

1. **Log Router exclusion** — drop add-on request logs before they reach storage.
   Cheapest, and irreversible by anyone.
2. **A restricted log bucket + log views.** Route `crm-addon` logs to a bucket
   whose access is granted through `roles/logging.viewAccessor` on a *view*
   rather than through project-level roles. **Note:** project `owner` can grant
   itself access, so this deters rather than prevents — an owner is a
   super-user by definition.
3. **Reduce the owner count.** Four owners on a project holding customer email is
   the largest single exposure on this list, and no amount of log configuration
   compensates for it. `roles/editor` or `roles/run.admin` covers what most of
   them actually need.
4. **CMEK on the log bucket** with keys in a separate project, where key access
   is held by a different set of people. This is the only arrangement that
   genuinely stops a project owner reading logs, and it is real operational
   overhead.

Honest summary: **1 and 3 are worth doing; 2 alone is theatre.** The redaction
already shipped is what makes the rest optional rather than urgent.

## 6. Secrets

`GOOGLE_GENERATIVE_AI_API_KEY` and `SERVICE_API_KEY` come from Secret Manager,
injected at deploy. The add-on's service account was granted
`secretmanager.secretAccessor` **on the single secret**, not project-wide.

No key is in the repository. `.env.local` is gitignored and every commit is
scanned for the key, the DB password and OAuth tokens before pushing.

## 7. Known gaps

- **`ADDON_DEMO_MODE=true` is live in production.** Correct while one person is
  demoing; it must be false before anyone else installs.
- **`ADDON_AUDIENCE` is blank** — signature + issuer only. Tighten once the real
  `aud` has been read from a successful request.
- **Label expiry is not durable.** A deploy orphans live marks. "Clear all my
  marks" is the escape hatch.
- **The eval harness (`apps/addon/eval/`) reads the production database** and
  sends redacted thread text to an external API. Fine as a local tool; it should
  be a deliberate decision that it lives in a shared branch. Its README documents
  residual leaks — a customer name survived redaction because both its words are
  dictionary words.
