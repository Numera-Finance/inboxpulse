-- Customers that are not clients.
--
-- The management sections rank "unhappy client, nobody replied" over customer
-- records, and a customer record is not the same thing as a client. Three kinds
-- of counterparty end up in that table and none of them belongs in a client
-- review:
--
--   vendor    software and services we buy — SVB, Rippling, Bill
--   partner   an outsourced team doing OUR delivery work. chitrabatchuca.com is
--             a CA practice in India working for MyTaxFiler: padmashree,
--             pavithra, vaishali, payal and chitra all send from it, and Chitra
--             also holds cbatchu@mystartupcfo.com. Their mail is our own back
--             office, not a client relationship.
--   internal  our own entities that are not caught by the staff-domain rule
--
-- WHY A TABLE RATHER THAN A LIST IN CODE.
--
-- This exact knowledge was once written as a constant, and `blueoceanps` went
-- into it on the assumption that it was our own domain. Blue Ocean Pool Service
-- is a real customer, and it was silently dropped from the management review
-- along with 45 threads. A code constant is invisible to the people who would
-- have caught the error in a second, cannot be corrected without a deploy, and
-- gives no reason for the entry. A row can be read, questioned and fixed by
-- whoever owns the client list.
--
-- The exclusion cannot be derived. Grid role-holders are 100% mystartupcfo.com,
-- so the allocation sheet does not identify a delivery partner; a partner firm
-- looks exactly like a client from the mail alone. That is precisely why it is
-- recorded deliberately, one row at a time, with a note saying who said so.
--
-- ONLY non-clients are ever inserted. Absence means client, so a customer added
-- tomorrow is treated as a client by default — the safe direction, since the
-- failure mode of a missing row is a customer appearing in a review that should
-- not be there, which is visible, rather than a client vanishing from it, which
-- is not.

CREATE TABLE IF NOT EXISTS customer_relationships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL,
  customer_id  uuid NOT NULL,
  -- 'vendor' | 'partner' | 'internal'. Deliberately text, not an enum: a new
  -- kind should not need a migration, and nothing branches on the value — the
  -- metrics only ask whether a row exists.
  kind         text NOT NULL,
  -- Why this row is here and who said so. Not decoration: the constant this
  -- replaces was wrong precisely because nobody could see the reasoning.
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- One verdict per customer.
CREATE UNIQUE INDEX IF NOT EXISTS customer_relationships_unique
  ON customer_relationships (tenant_id, customer_id);

CREATE INDEX IF NOT EXISTS customer_relationships_kind
  ON customer_relationships (tenant_id, kind);
