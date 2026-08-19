-- Second matching pass: the grid names clients more fully than we do.
--
-- The first pass matches a customer to the allocation sheet on an exact
-- normalised name — lowercase, non-alphanumerics stripped. That misses every
-- client the sheet records under a longer legal name:
--
--   customers.name              "Falconx"                  -> falconx
--   customer_allocations        "FalconX (Warp Drive, Inc)" -> falconxwarpdriveinc
--
-- Falconx has a complete role set on the sheet, Account manager included
-- (Ganesh Shankar). The panel nonetheless showed "Falconx — 5 unanswered — no
-- account manager", which is not a missing owner but a failed join, and it
-- reads as an accusation that nobody is looking after the account.
--
-- This pass matches where the sheet's key STARTS WITH the customer's key, and
-- only then. Prefix rather than substring: "Warp Drive" inside "FalconX (Warp
-- Drive, Inc)" would match an unrelated customer called Warp Drive, whereas a
-- sheet entry that begins with the customer's whole name is the same company
-- written at greater length.
--
-- Three guards, because a wrong owner is worse than no owner:
--
--   * ONLY UNMATCHED CUSTOMERS. A customer the exact pass already resolved is
--     never touched.
--   * ONLY UNAMBIGUOUS ONES. If two distinct client_keys prefix-match the same
--     customer, it is skipped rather than guessed. Measured: 0 such cases.
--   * MINIMUM KEY LENGTH 5. Short names prefix-match far too much — "bank"
--     would swallow every sheet entry beginning with those letters.
--
-- Measured on production: 15 customers newly matched, 0 ambiguous.
--
-- Idempotent: it only writes rows where customer_id IS NULL, so a second run
-- finds nothing to do.

\set ON_ERROR_STOP on
BEGIN;

WITH ck AS (
  SELECT c.id, c.tenant_id,
         lower(regexp_replace(c.name, '[^a-zA-Z0-9]', '', 'g')) AS key
  FROM customers c
  WHERE NOT c.is_auto_created
    AND length(lower(regexp_replace(c.name, '[^a-zA-Z0-9]', '', 'g'))) >= 5
    -- Untouched if the exact pass already found them.
    AND NOT EXISTS (SELECT 1 FROM customer_allocations a WHERE a.customer_id = c.id)
),
matched AS (
  SELECT ck.id AS customer_id, ck.tenant_id, min(al.client_key) AS client_key
  FROM ck
  JOIN (SELECT DISTINCT client_key FROM customer_allocations WHERE customer_id IS NULL) al
    ON al.client_key LIKE ck.key || '%'
  GROUP BY ck.id, ck.tenant_id
  HAVING count(DISTINCT al.client_key) = 1   -- unambiguous only
)
UPDATE customer_allocations a
SET customer_id = m.customer_id
FROM matched m
WHERE a.customer_id IS NULL
  AND a.tenant_id = m.tenant_id
  AND a.client_key = m.client_key;

-- Re-resolve the person for any row that just gained a customer.
UPDATE customer_allocations al
SET user_id = u.id
FROM users u
WHERE al.user_id IS NULL
  AND al.tenant_id = u.tenant_id
  AND lower(u.email) = lower(al.email);

COMMIT;

SELECT count(*) AS rows,
       count(customer_id) AS matched_customer,
       count(DISTINCT client_key) FILTER (WHERE customer_id IS NOT NULL) AS matched_clients
FROM customer_allocations;
