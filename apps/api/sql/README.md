# CRM Database Schema

This directory contains the SQL schema files for the CRM database, split into individual files for easier management.

## Connection String

```
postgresql://neondb_owner:npg_1gHnfsaiR8Fz@ep-odd-thunder-a88b2g71-pooler.eastus2.azure.neon.tech/neondb?sslmode=require&channel_binding=require
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

## File Structure

- `tenants.sql` - Tenants table
- `users.sql` - Users table
- `integrations.sql` - Integrations table + integration enums (integration_source, integration_auth_type)
- `customers.sql` - Customers table (references tenants, domain info stored in customer_domains table)
- `customer_domains.sql` - Customer domains table (references customers and tenants, unique constraint on tenant_id + domain)
- `contacts.sql` - Contacts table (references tenants and customers, unique constraint on tenant_id + email)
- `email_threads.sql` - Email threads table (provider-agnostic, references tenants and integrations)
- `thread_analyses.sql` - Thread analyses table (thread-level summaries for each analysis type, references email_threads)
- `emails.sql` - Emails table (provider-agnostic, references email_threads, with unique constraint on tenant_id + provider + message_id)
- `email_analyses.sql` - Email analyses table (stores analysis results for emails, references emails and tenants, unique constraint on email_id + analysis_type)
- `runs.sql` - Runs table + run enums (run_status, run_type) with foreign key to integrations
- `better_auth_tables.sql` - Better-auth tables for authentication

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
```

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
