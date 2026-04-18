-- Migration: Bake "(Auto)" suffix into the stored name of auto-created customers
-- so the suffix is searchable and included in exports (previously added only at display time).
-- Idempotent: only appends the suffix to rows that don't already carry it.

UPDATE customers
SET name = name || ' (Auto)',
    updated_at = NOW()
WHERE is_auto_created = TRUE
  AND name IS NOT NULL
  AND name <> ''
  AND name NOT LIKE '% (Auto)';
