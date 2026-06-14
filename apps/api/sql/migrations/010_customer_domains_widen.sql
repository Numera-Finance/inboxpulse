-- Migration: Widen customer_domains.domain to fit personal-email pseudo-domains.
--
-- Personal-email senders now get a per-address pseudo-domain
-- (`<local>-<provider>.tld`). Per RFC 5321 the local part can be up to 64 chars
-- and the domain up to 253 chars, so the combined pseudo-domain can be up to
-- 64 + 1 + 253 = 318 chars — larger than the original VARCHAR(255) limit.
--
-- Widen to VARCHAR(320) so no valid email address can fail to insert. Idempotent.

ALTER TABLE IF EXISTS customer_domains
  ALTER COLUMN domain TYPE VARCHAR(320);
