# CRM Database Schema

This directory contains the SQL schema files for the CRM database, split into individual files for easier management.

## Connection String

Every command below reads `$DATABASE_URL`. Take it from `apps/api/.env.local` (or
GCP Secret Manager for deployed environments) — never commit a connection string
that carries a password.

```bash
export DATABASE_URL=$(grep -m1 '^DATABASE_URL=' apps/api/.env.local | cut -d= -f2-)
```

## Execution Order

Execute files in the following order to set up the database from scratch:

1. **tenants.sql** - Create tenants table
2. **users.sql** - Create users table
3. **integrations.sql** - Create integrations table (includes integration_source and integration_auth_type enums)
4. **customers.sql** - Create customers table (references tenants)
5. **customer_domains.sql** - Create customer_domains table (references customers and tenants, supports multiple domains per customer)
6. **contacts.sql** - Create contacts table (references tenants and customers, unique constraint on tenant_id + email)
7. **email_threads.sql** - Create email_threads table (provider-agnostic threads)
8. **emails.sql** - Create emails table with indexes (provider-agnostic, references email_threads)
9. **thread_analyses.sql** - Create thread_analyses table (thread-level summaries for analysis context, references email_threads)
10. **email_analyses.sql** - Create email_analyses table (stores analysis results for emails, references emails and tenants)
11. **runs.sql** - Create runs table with foreign keys and indexes (includes run_status and run_type enums)
12. **better_auth_tables.sql** - Create better-auth tables for Google SSO (better_auth_user, better_auth_session, better_auth_account, better_auth_verification)
13. **login_history.sql** - Create login_history append-only audit table (references users and tenants)

## File Structure

- `tenants.sql` - Tenants table (includes domains TEXT[] for multi-domain SSO, account_manager_role_id for TAT metrics)
- `users.sql` - Users table
- `integrations.sql` - Integrations table + integration enums (integration_source, integration_auth_type)
- `customers.sql` - Customers table (references tenants, domain info stored in customer_domains table)
- `customer_domains.sql` - Customer domains table (references customers and tenants, unique constraint on tenant_id + domain)
- `contacts.sql` - Contacts table (references tenants and customers, unique constraint on tenant_id + email)
- `email_threads.sql` - Email threads table (provider-agnostic, references tenants and integrations)
- `thread_analyses.sql` - Thread analyses table (thread-level summaries for each analysis type, references email_threads)
- `emails.sql` - Emails table (provider-agnostic, references email_threads, with TAT tracking columns and unique constraint on tenant_id + provider + message_id)
- `email_analyses.sql` - Email analyses table (stores analysis results for emails, references emails and tenants, unique constraint on email_id + analysis_type)
- `runs.sql` - Runs table + run enums (run_status, run_type) with foreign key to integrations
- `better_auth_tables.sql` - Better-auth tables for authentication
- `holiday_calendars.sql` - Holiday calendars for TAT business days calculation (references tenants)
- `analysis_keywords.sql` - Analysis keyword rules for keyword-based email analysis (references tenants)
- `login_history.sql` - Login history append-only audit table (references users and tenants)
- `migrations/` - Directory containing incremental migration scripts for existing databases

## Migrations

For existing databases, use the migration scripts in the `migrations/` directory:

```bash
# Apply TAT metrics migration (adds TAT tracking columns, holiday_calendars table)
psql $DATABASE_URL -f apps/api/sql/migrations/001_tat_metrics.sql

# Apply email dedup migration (adds rfc_message_id, content_hash columns + indexes)
psql $DATABASE_URL -f apps/api/sql/migrations/003_email_dedup.sql

# Apply analysis keywords migration (adds analysis_keywords table)
psql $DATABASE_URL -f apps/api/sql/migrations/004_analysis_keywords.sql

# Apply task problem/resolution migration (adds problem and resolution columns to tasks)
psql $DATABASE_URL -f apps/api/sql/migrations/005_task_problem_resolution.sql

# Apply tenant domains array migration (migrates domain VARCHAR to domains TEXT[])
psql $DATABASE_URL -f apps/api/sql/migrations/006_tenant_domains_array.sql

# Add GIN index on emails.signals for efficient signal filtering queries
psql $DATABASE_URL -f apps/api/sql/migrations/007_emails_signals_gin_index.sql

# Bake "(Auto)" suffix into auto-created customer names so it's searchable / exportable
psql $DATABASE_URL -f apps/api/sql/migrations/009_auto_customer_name_suffix.sql

# Create analysis_cache table (LLM analysis result cache used by crm-analysis;
# the Drizzle schema existed but the table was never created in production)
psql $DATABASE_URL -f apps/api/sql/migrations/011_analysis_cache.sql

# Add user_submitted_risk_level / user_submitted_sentiment_value to email_analyses
# (human tag suggestions from the Gmail extension; never overwrite the AI columns)
psql $DATABASE_URL -f apps/api/sql/migrations/012_email_analyses_user_submitted.sql

# pg_trgm GIN indexes on emails.subject/body and email_participants.email/name.
# Required by the AI Analysis search, which now matches message bodies —
# an unanchored ILIKE that no B-tree can serve. Reads the whole emails table and
# holds a table lock while building; see the file for the CONCURRENTLY variant.
psql $DATABASE_URL -f apps/api/sql/migrations/016_emails_search_trgm_index.sql

# Register the context-search-string analysis type. Comment-only: analysis_type
# has no CHECK constraint, so the new type needs no DDL to start writing rows.
psql $DATABASE_URL -f apps/api/sql/migrations/017_email_analyses_context_search_string.sql
# Add emails.first_reply_by_id (who sent the first reply) + FK to users and index.
# Ships with the originator matching rule: a reply only counts for a customer
# email when it is addressed to that email's own sender. No backfill.
psql $DATABASE_URL -f apps/api/sql/migrations/013_email_first_reply_by.sql

# Add email_threads (tenant_id, provider_thread_id) index. First-reply markers now
# match a thread across every integration of the tenant rather than only the
# submitting one — reconnecting a mailbox mints a new integration id and used to
# orphan every thread stored under the previous one (ADR-005).
psql $DATABASE_URL -f apps/api/sql/migrations/014_threads_tenant_provider_thread_index.sql

# Add a partial UNIQUE index enforcing one CONNECTED integration per
# (tenant, source, mailbox). Reconnecting a mailbox must revive the existing row,
# never insert a second one — duplicates fragment email_threads (ADR-006).
psql $DATABASE_URL -f apps/api/sql/migrations/015_integrations_unique_connected_mailbox.sql

# Add emails.signals_overridden lock flag + email_signal_overrides audit/learning
# log for manual sentiment/tag corrections
psql $DATABASE_URL -f apps/api/sql/migrations/018_email_signal_overrides.sql
```

Migration files are idempotent (safe to run multiple times).

## Notes

- Each file includes `DROP TABLE IF EXISTS` and `DROP TYPE IF EXISTS` statements for idempotency
- Enums are defined in the same file as the tables that use them:
  - `integrations.sql`: `integration_source`, `integration_auth_type`
  - `runs.sql`: `run_status`, `run_type`
- The `customer_domains` table has a unique constraint: `CONSTRAINT uniq_customer_domains_tenant_domain UNIQUE (tenant_id, domain)` - ensures each domain is unique per tenant across all customers
- Domains are automatically lowercased in the API layer (repository methods)
- The `contacts` table has a unique constraint: `CONSTRAINT uniq_contacts_tenant_email UNIQUE (tenant_id, email)`
- The `emails` table has a unique constraint: `CONSTRAINT uniq_emails_tenant_provider_message UNIQUE (tenant_id, provider, message_id)`
- The `email_threads` table has a unique constraint: `CONSTRAINT uniq_thread_tenant_integration UNIQUE (tenant_id, integration_id, provider_thread_id)`
- The `integrations` table has a partial unique index: `uniq_integrations_active_tenant_source_email` over `(tenant_id, source, lower(COALESCE(<the "email", "impersonatedUserEmail" and "userEmail" entries in parameters>))) WHERE is_active` - at most one *connected* integration per mailbox. Mailbox addresses are stored lowercased by the API layer to match. It is partial because pre-existing disconnected duplicates would block a full unique index; see ADR-006 for the historical merge that has to precede the strict version. Expression indexes over JSONB cannot be expressed in Drizzle, so this lives only in SQL (migration 015)
- The `email_analyses` table has a unique constraint: `CONSTRAINT uniq_email_analysis_type UNIQUE (email_id, analysis_type)` - ensures one analysis result per email per analysis type
- The `thread_analyses` table has a unique constraint: `CONSTRAINT uniq_thread_analysis_type UNIQUE (thread_id, analysis_type)` - ensures one thread summary per thread per analysis type
- The `contacts` table has a foreign key reference to `customers(id)` with SET NULL on delete
- The `emails` table has a foreign key reference to `email_threads(id)` with CASCADE delete
- The `email_analyses` table has a foreign key reference to `emails(id)` with CASCADE delete
- The `thread_analyses` table has a foreign key reference to `email_threads(id)` with CASCADE delete
- The `runs` table has a foreign key reference to `integrations(id)`
- Dependencies: `customers` → `tenants`, `contacts` → `tenants` and `customers`, `email_threads` → `integrations`, `emails` → `email_threads`, `thread_analyses` → `email_threads`, `email_analyses` → `emails` and `tenants`, `runs` → `integrations`

## Command Line Execution

```bash
# Execute all files in order
psql $DATABASE_URL -f apps/api/sql/tenants.sql
psql $DATABASE_URL -f apps/api/sql/users.sql
psql $DATABASE_URL -f apps/api/sql/integrations.sql
psql $DATABASE_URL -f apps/api/sql/customers.sql
psql $DATABASE_URL -f apps/api/sql/customer_domains.sql
psql $DATABASE_URL -f apps/api/sql/contacts.sql
psql $DATABASE_URL -f apps/api/sql/email_threads.sql
psql $DATABASE_URL -f apps/api/sql/emails.sql
psql $DATABASE_URL -f apps/api/sql/thread_analyses.sql
psql $DATABASE_URL -f apps/api/sql/email_analyses.sql
psql $DATABASE_URL -f apps/api/sql/runs.sql
psql $DATABASE_URL -f apps/api/sql/better_auth_tables.sql
psql $DATABASE_URL -f apps/api/sql/login_history.sql
```

Or in PostgreSQL interactive mode (from project root):

```sql
\i apps/api/sql/tenants.sql
\i apps/api/sql/users.sql
\i apps/api/sql/integrations.sql
\i apps/api/sql/customers.sql
\i apps/api/sql/customer_domains.sql
\i apps/api/sql/contacts.sql
\i apps/api/sql/email_threads.sql
\i apps/api/sql/emails.sql
\i apps/api/sql/thread_analyses.sql
\i apps/api/sql/email_analyses.sql
\i apps/api/sql/runs.sql
\i apps/api/sql/better_auth_tables.sql
\i apps/api/sql/login_history.sql
```

## Incremental migrations (`migrations/`)

Applied after the base schema above, in this order. All are idempotent and safe
to re-run.

```bash
\i apps/api/sql/migrations/customer_allocations.sql
\i apps/api/sql/migrations/customer_relationships.sql
\i apps/api/sql/migrations/customer_relationships_seed.sql   # optional — see below
```

| File | What it adds | Depends on |
|------|-------------|-----------|
| `customer_allocations.sql` | The firm's role-based client allocation, loaded from the operations spreadsheet. Who is accountable for which client, six roles. | `customers`, `users` |
| `customer_relationships.sql` | Marks a customer as NOT a client — vendor, delivery partner, or one of our own entities. Only non-clients are ever inserted; absence means client. | `customers` |
| `customer_relationships_seed.sql` | Known non-clients for the MyStartupCFO tenant, one row each with the reason and who confirmed it. | the two above |

The seed is **judgements about one firm's counterparties, not schema**, and is
kept separate so it can be reviewed — or rejected — on its own. Applying the
table without the seed is a valid state: every customer is then treated as a
client, which is the safe default. See ADR-020 and ADR-021.

## Verification Queries

Check all tables:
```sql
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;
```

Check all enums:
```sql
SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname;
```

Check all indexes:
```sql
SELECT indexname FROM pg_indexes WHERE schemaname = 'public' ORDER BY indexname;
```

### Applying the add-on tables to a database that lacks them

Symptom: `/api/internal/addon/fires`, `/slow-responders` and `/owner-load`
return 500 while `/waiting` and `/pulse` return 200. Every failing endpoint
joins `customer_allocations`; every working one does not. The table is missing.

That failure is invisible in the panel — the add-on client swallows a non-OK
response and returns `[]`, so the section renders empty, which reads as "nothing
to report" rather than "this is broken". Check the endpoints directly, not the
card.

```bash
psql "$DATABASE_URL" -f apps/api/sql/migrations/customer_allocations_data.sql
psql "$DATABASE_URL" -f apps/api/sql/migrations/customer_relationships.sql
psql "$DATABASE_URL" -f apps/api/sql/migrations/customer_relationships_seed.sql
```

`customer_allocations_data.sql` carries the schema AND the 4,724 grid rows, and
resolves `customer_id`/`user_id` against the target database's own `customers`
and `users` rather than copying ids from elsewhere — copied UUIDs would appear
to work and join to nothing wherever two databases diverge.

Expect `4724 rows | ~4270 matched_customer | ~4715 matched_user | 857 clients`.
A much lower `matched_customer` means the customer names differ from the grid's
normalised keys, not that the load failed.

**Blast radius: none for existing users.** These files only CREATE TABLE IF NOT
EXISTS, CREATE INDEX IF NOT EXISTS, INSERT into the two new tables, and UPDATE
`customer_allocations` itself. There is no ALTER, DROP, TRUNCATE, foreign key or
trigger touching any existing table; `customers`, `users` and `tenants` are read
only. Nothing outside the add-on references either table, so no existing query
can change behaviour. Both files are wrapped in a transaction and are safe to
re-run — verified by running them twice against a clean database.

Assumes a single-tenant deployment: the insert takes the OLDEST tenant
(`ORDER BY created_at LIMIT 1`). Revisit before running on a multi-tenant
database.
