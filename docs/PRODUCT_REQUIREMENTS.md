# InboxPulse — Product Requirements Document

> **What this is:** The required behavior of InboxPulse, stated as one requirement per line. Reverse-engineered from the current implementation so we can confirm the intended business rules are correct.
> **Product:** A multi-tenant customer-communications intelligence platform for MyStartupCFO (a finance & accounting services firm). It syncs client email from Gmail, classifies and analyzes it with AI, matches it to customer companies, measures response time against SLAs, and drives escalation tasks and manager digests.
> **Convention:** "Shall" = required behavior. Each requirement has a stable ID for traceability. Items marked ⚠️ are behaviors the current system exhibits that may not be intended — flagged for product confirmation (see §14).
> **Verification:** Every requirement was cross-checked against the source code by an independent verification pass. Corrections applied from that pass include SLA-7 (next-business-day replies count as 1 day, not 0), KW-3 (confidence scoring is sentiment-only), and NOT-3 (only the 8am send-hour is fixed; timezone is per-manager). Implementation citations live in [BUSINESS_RULES_TECHNICAL.md](BUSINESS_RULES_TECHNICAL.md).

---

## 1. Email ingestion

- **ING-1** The system shall sync email from a tenant's connected Gmail account(s).
- **ING-2** The system shall receive Gmail changes in near-real-time via push notification and begin syncing without the user taking any action.
- **ING-3** The system shall support an on-demand initial backfill covering the **last 30 days** of email.
- **ING-4** The system shall support on-demand incremental sync of new email since the last sync.
- **ING-5** The system shall ingest email only from a user's **Inbox** and **Sent** folders (and no others). Sent (outbound) messages are read specifically to capture tenant reply attribution for response-time/TAT tracking; per DIR-5 they are not stored as email records, and only the reply's timestamp and its sender's user id are retained.
- **ING-6** The system shall resume an interrupted sync from its last checkpoint without re-importing already-processed email.
- **ING-7** The system shall process email oldest-first so a customer message is always recorded before the reply that answers it.
- **ING-8** The system shall keep the Gmail connection alive automatically and re-authorize before it lapses, with no user action.
- **ING-9** The system shall never ingest deleted, trashed, draft, or Gmail-flagged-spam messages.
- **ING-10** The system shall allow a tenant to blacklist specific sender addresses or domains whose email is excluded from ingestion.
- **ING-11** The system shall exclude the tenant's own internal email from ingestion by default.
- **ING-12** The system shall discard any message that has no recipients.
- **ING-13** The system shall preserve a message's subject, sender, recipients (to/cc/bcc), body, timestamp, and priority.
- **ING-14** The system shall use the email's HTML body when available and fall back to plain text otherwise.
- **ING-15** The system shall record a "(No Subject)" placeholder when a message has no subject.
- **ING-16** The system shall never store the same message twice, including forwarded copies of identical content that arrive in different threads.

## 2. Threads

- **THR-1** The system shall group emails into conversation threads as defined by the email provider.
- **THR-2** The system shall track each thread's first-activity time, last-activity time, and subject.
- **THR-3** The system shall advance a thread's last-activity time for **any** new message including replies, and never move it backwards.
- **THR-4** The system shall anchor a thread's subject and first-activity time to the first *customer-visible* message, not to internal replies.
- **THR-5** The system shall record thread activity from a reply even when the reply message itself is not stored.

## 3. Message direction (inbound vs outbound)

- **DIR-1** The system shall classify every message as inbound (from a customer) or outbound (from the tenant).
- **DIR-2** The system shall treat a message as outbound if it is a Sent message **or** its sender is on one of the tenant's configured domains.
- **DIR-3** The system shall match tenant domains on the full domain only, so a look-alike domain (e.g. `nottenant.com` vs `tenant.com`) is never mistaken for the tenant.
- **DIR-4** The system shall match tenant domains case-insensitively.
- **DIR-5** The system shall store inbound customer emails as first-class records and shall **not** store outbound replies as records. Two fields derived from a reply are retained on the customer email it answers: **when** it was sent and **who** sent it (resolved to a user in the tenant, null when the sender matches no user). No subject, body, or recipient list of an outbound reply is stored — recipients are read only to decide which customer email the reply answers, and are discarded.
- **DIR-6** The system shall require a tenant to configure its email domains for direction detection to work; when unconfigured, all messages are stored and response-time tracking is disabled. ⚠️

## 4. Response time capture (first reply)

- **TAT-1** The system shall record, for each customer email, the time of the first tenant reply that answers it.
- **TAT-2** The system shall only count a reply that is sent **after** the customer email it answers.
- **TAT-3** The system shall attribute each reply to the earliest preceding unanswered customer email in the thread.
- **TAT-4** The system shall never overwrite a customer email's first-reply time once set.
- **TAT-5** The system shall **not** count automated messages (auto-replies, out-of-office, bulk mail, `noreply@`-style senders) as a first reply.
- **TAT-6** The system shall **not** count an internal-only message (no external/customer recipient) as a first reply.
- **TAT-7** The system shall still record thread activity for automated and internal messages even though they don't count as a reply.
- **TAT-8** The system shall attribute a first reply even when the reply itself was excluded from ingestion (e.g. blacklisted internal domain), using its header timestamp.

## 5. Turnaround time (TAT) & SLA

- **SLA-1** The system shall measure turnaround time only for customer (inbound) emails.
- **SLA-2** The system shall report an average turnaround time per customer, based on answered emails.
- **SLA-3** The system shall measure SLA compliance in **elapsed business days** (Monday–Friday), excluding weekends.
- **SLA-4** The system shall exclude tenant-configured holidays from the business-day count.
- **SLA-5** The system shall support holidays that differ by region/timezone for tenants with distributed teams.
- **SLA-6** The system shall count business days in the timezone of the customer's assigned account manager.
- **SLA-7** The system shall count a reply on the **same business day** as zero business days elapsed, and each additional elapsed business day as +1 — so a next-business-day reply counts as **1 business day** and appears in the "1+ day" breach bucket. (Only ranges spanning purely weekend/holiday days also collapse to 0, e.g. Friday→Saturday.)
- **SLA-8** The system shall count an unanswered customer email's elapsed time as still accruing (measured to "now") so overdue emails surface.
- **SLA-9** The system shall categorize SLA breaches into buckets of 1+, 2+, 3+, 5+, and 6+ business days overdue.
- **SLA-10** The system shall present the most-overdue customers first.
- **SLA-11** The system shall exclude spam, marketing, transactional, and automated emails from SLA/TAT measurement.
- **SLA-12** The system shall let a tenant influence SLA/TAT only via its holiday calendar and its account managers' timezones (no per-customer SLA target today). ⚠️

## 6. Company (customer) matching

- **CO-1** The system shall associate every email with a customer company where one can be determined.
- **CO-2** The system shall match a customer by the sender's email domain.
- **CO-3** The system shall treat each personal-email sender (Gmail, Outlook, Yahoo, iCloud, etc.) as its own distinct customer rather than lumping all personal senders together.
- **CO-4** The system shall collapse corporate sub-domains to the primary company domain when matching.
- **CO-5** The system shall auto-create a customer company for a sender whose company is not yet known.
- **CO-6** The system shall fall back to a manually-set contact→customer link when no domain match exists.
- **CO-7** The system shall support multiple domains per customer company.
- **CO-8** The system shall keep each domain assigned to at most one customer within a tenant.
- **CO-9** The system shall mark auto-created customers distinctly from manually-created ones.
- **CO-10** The system shall name an auto-created customer from the email signature's company name when available, otherwise from the domain, and shall tag such names as auto-generated ("(Auto)").
- **CO-11** The system shall never rename or overwrite a manually-created customer's name via automated processing.
- **CO-12** The system shall allow users to merge two customer companies, reassigning all their email, contacts, tasks, and assignments to the surviving record and archiving the other.
- **CO-13** The system shall correctly handle concurrent email from the same new company without creating duplicate customer records.
- **CO-14** The system shall support importing/exporting customers, matching import rows by external ID first, then by domain, and rejecting a row whose domain already belongs to a different customer.
- **CO-15** The system shall allow free-form labels and an external reference ID on a customer.

## 7. Contacts

- **CON-1** The system shall maintain a contact record per unique email address per tenant.
- **CON-2** The system shall link each contact to its customer company where determinable.
- **CON-3** The system shall back-fill a contact's customer link when it later becomes known, without overwriting an existing link.
- **CON-4** The system shall enrich a contact (name, title, phone, address, website, social handles) from the sender's email signature.
- **CON-5** The system shall only fill empty contact fields from a signature and never overwrite existing values.
- **CON-6** The system shall only apply signature details when the signature belongs to the message's sender.

## 8. Keyword rules

- **KW-1** The system shall let a tenant define keyword lists that deterministically tag emails for sentiment, escalation, upsell, churn, kudos, and competitor.
- **KW-2** The system shall match keywords on whole words, case-insensitively, in the subject and body.
- **KW-3** The system shall treat a keyword match as authoritative (tagged as a keyword match) and skip the corresponding AI analysis for that email. (Sentiment keyword hits are recorded at full confidence; upsell/churn/kudos/competitor keyword hits are recorded as detected without a confidence score.)
- **KW-4** The system shall ignore keyword matches on emails classified as spam, marketing, transactional, or automated.

## 9. Email classification

- **CLS-1** The system shall classify every email as one of: spam, marketing, transactional, automated, or business.
- **CLS-2** The system shall classify using progressively richer methods (content patterns, sender reputation, ML models, then AI) and stop as soon as it is confident.
- **CLS-3** The system shall default an unclassifiable email to "business".
- **CLS-4** The system shall skip AI insight analysis for emails classified as spam, marketing, transactional, or automated.
- **CLS-5** The system shall still extract participants (customers/contacts) from filtered emails so relationships are captured even when insights are skipped.

## 10. AI analysis & insights

- **AI-1** The system shall analyze each business email and produce insight signals.
- **AI-2** The system shall detect **sentiment** (positive / negative / neutral) with a supporting reason.
- **AI-3** The system shall default sentiment to neutral and only mark negative when the customer asserts that the tenant failed, not merely because a message is urgent.
- **AI-4** The system shall detect **churn risk** (low / medium / high / critical) with indicators.
- **AI-5** The system shall detect **upsell opportunities**, mapped to a defined MyStartupCFO service line, only when that service is not already being delivered to the client.
- **AI-6** The system shall detect **escalations** with an urgency level.
- **AI-7** The system shall detect **kudos** (praise) with a category.
- **AI-8** The system shall detect **competitor mentions** with the named competitors.
- **AI-9** The system shall extract the sender's signature details (name, title, company, contact info) only when the signature belongs to the sender.
- **AI-10** The system shall let each tenant enable/disable each analysis type and configure its AI model and confidence thresholds.
- **AI-11** The system shall, by default, enable sentiment, churn, upsell, and signature extraction, and disable escalation, kudos, and competitor.
- **AI-12** The system shall retry with a fallback AI model when the primary model fails.
- **AI-13** The system shall consider recent prior messages in the thread when analyzing an email.
- **AI-14** The system shall record which AI model and prompt version produced each insight.
- **AI-15** The system shall cache analysis results to avoid re-analyzing unchanged email.
- **AI-16** The system shall re-analyze an email only when it is new or its body has meaningfully changed.
- **AI-17** The system shall process analysis asynchronously so ingestion is never blocked, and shall mark each email's analysis status (pending/processing/completed/failed).

## 11. Tasks & escalations

- **TSK-1** The system shall allow users to create tasks manually, tied to a customer and optionally an email.
- **TSK-2** The system shall automatically create an escalation task when an email from an external customer contact has negative sentiment.
- **TSK-3** The system shall not create a task for an email classified as spam, marketing, transactional, or automated.
- **TSK-4** The system shall not create a task from an internal email.
- **TSK-5** The system shall create at most one auto-task per email.
- **TSK-6** The system shall auto-assign a system-created task to the customer's Controller, or the Account Manager if no Controller exists.
- **TSK-7** The system shall support task states of Open and Done, with reopen.
- **TSK-8** The system shall capture a problem statement and resolution when a task is completed, recording who completed it and when.
- **TSK-9** The system shall support comments on tasks.
- **TSK-10** The system shall allow reassigning a task, and shall notify the new assignee.
- **TSK-11** The system shall restrict a user to assigning tasks only to themselves or their subordinates (admins may assign to anyone).
- **TSK-12** The system shall reassign a user's open tasks to another user when that user is transferred out.

## 12. Access, roles & tenancy

- **ACC-1** The system shall isolate all data by tenant, and no user (including admins) shall access another tenant's data.
- **ACC-2** The system shall authenticate users via Google single sign-on only.
- **ACC-3** The system shall only allow login from an email domain registered to a tenant, and reject others with a clear message.
- **ACC-4** The system shall make the first user of a tenant an Administrator and all subsequent users a basic User by default.
- **ACC-5** The system shall provide roles: User (task edit only), Manager (manage users/customers/tasks), and Administrator (full access).
- **ACC-6** The system shall allow tenants to define custom roles from the available permissions.
- **ACC-7** The system shall prevent renaming or deleting the built-in system roles.
- **ACC-8** The system shall support a matrix org hierarchy in which a user can have multiple managers.
- **ACC-9** The system shall restrict a non-admin user's view of customers and email to the customers they and their subordinates are assigned to.
- **ACC-10** The system shall restrict a non-admin user's view of tasks to those assigned to them or their subordinates (or unassigned).
- **ACC-11** The system shall grant admins full visibility within their tenant.
- **ACC-12** The system shall recompute access automatically whenever the org hierarchy or customer assignments change.
- **ACC-13** The system shall record each login (time, IP, device) for audit.

## 13. Notifications

- **NOT-1** The system shall notify a user by email when a task is assigned to them.
- **NOT-2** The system shall send managers a digest of pending escalations.
- **NOT-3** The system shall send the escalation digest once daily at 8am in the manager's local timezone, and only when there are pending escalations. (The send hour is fixed at 8am; the timezone is per-manager, falling back to `Asia/Kolkata` when a manager has none set.)
- **NOT-4** The system shall let users enable/disable and set the frequency of each notification type.
- **NOT-5** The system shall provide one-click unsubscribe from a notification type.
- **NOT-6** The system shall not send a notification whose linked escalation cannot be opened.

## 14. Open questions for product confirmation

- **Q-1** ⚠️ When a tenant hasn't configured its email domains, response-time tracking and inbound/outbound detection are silently off, and all mail (including Sent) is stored — is silent degradation acceptable, or should onboarding require domains?
- **Q-2** ⚠️ Average TAT is reported in wall-clock hours (answered only) while SLA breaches are counted in business days (including unanswered) — should these two numbers be reconciled or clearly distinguished in the UI?
- **Q-3** ⚠️ SLA thresholds (1/2/3/5/6 business days) are fixed for all tenants and customers — is a per-customer or per-tenant configurable SLA target required?
- **Q-4** ⚠️ Emails are only associated with a customer (and thus become visible to non-admins) after AI analysis completes — is a delay in visibility for un-analyzed email acceptable?
- **Q-5** ⚠️ Company matching uses the last two labels of a domain, which misgroups multi-part domains like `co.uk`/`com.au` — is correct handling of these required?
- **Q-6** ⚠️ The default AI fallback model is the same as the primary — is a genuinely different fallback model desired?
- **Q-7** Historical (beyond 30-day) backfill, thread-level conversation summaries, and third-party company enrichment are designed but not active — are these on the roadmap?
- **Q-8** The manager digest send-hour is hardcoded to 8am (timezone is per-manager with an `Asia/Kolkata` fallback) rather than a per-user preference — should the send time be configurable?

---

*Reverse-engineered from the codebase. This PRD describes behavior the system exhibits today; ⚠️ items and §14 are candidates for correction rather than confirmed intent.*
