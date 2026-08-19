-- Role-based client allocation: who holds which role on which client.
--
-- The CRM already has user_customers, but it cannot answer "who is accountable"
-- — a client carries four to five rows there and role_id is null on all 4,111
-- of them. Counting per owner turns one complaint into five people's problem.
--
-- This table carries the firm's actual allocation: one person per role per
-- client, six roles. Loaded from the operations spreadsheet
-- ("Allocation details for email sentiment tool.xlsx", sheet "with domains"),
-- which is the system of record for it today.
--
-- Matched to customers by NORMALISED NAME (lowercased, non-alphanumerics
-- stripped) because only 116 of 857 rows carry a domain, while 774 match on
-- name. customer_id is nullable so an unmatched allocation is still stored and
-- countable rather than silently dropped.

CREATE TABLE IF NOT EXISTS customer_allocations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     uuid NOT NULL,
  client_id     text,
  client_name   text NOT NULL,
  client_key    text NOT NULL,
  customer_id   uuid,
  role          text NOT NULL,
  email         text NOT NULL,
  user_id       uuid,
  loaded_at     timestamptz NOT NULL DEFAULT now()
);

-- One person per role per client. A cell holding two addresses becomes two rows,
-- which is correct: some clients genuinely have two people in a role.
CREATE UNIQUE INDEX IF NOT EXISTS customer_allocations_unique
  ON customer_allocations (tenant_id, client_key, role, email);

CREATE INDEX IF NOT EXISTS customer_allocations_customer
  ON customer_allocations (tenant_id, customer_id) WHERE customer_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_allocations_user
  ON customer_allocations (tenant_id, user_id) WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS customer_allocations_role
  ON customer_allocations (tenant_id, role);
