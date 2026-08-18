-- Known non-clients, one row at a time, each with the reason.
--
-- Kept SEPARATE from the table definition on purpose. The schema is a mechanism
-- and is safe to apply anywhere; these rows are judgements about one firm's
-- counterparties, and they should be reviewable — and rejectable — on their own.
--
-- Only entries someone has actually confirmed go in here. The unallocated row in
-- the add-on names its customers precisely so the rest can be triaged by people
-- who know, rather than guessed at. Candidates seen in the data but NOT seeded,
-- because nobody has confirmed them: Rippling, Svb, Bill, Bank, Countsy,
-- White Summers. They look like vendors. Looking like one is not knowing.

INSERT INTO customer_relationships (tenant_id, customer_id, kind, note)
SELECT c.tenant_id, c.id, 'partner',
       'CA practice in India doing MyTaxFiler delivery work — padmashree, pavithra, vaishali, payal, chitra all send from chitrabatchuca.com, and Chitra also holds cbatchu@mystartupcfo.com. Confirmed by Gaurav, 2026-08-14.'
FROM customers c
WHERE lower(c.name) = 'chitrabatchuca'
ON CONFLICT (tenant_id, customer_id) DO NOTHING;
