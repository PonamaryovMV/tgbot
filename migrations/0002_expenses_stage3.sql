-- Migration 0002: Stage 3 support for TRANSFER operation type and split metadata
-- Existing D1 schema uses:
--   expenses.operation_type TEXT CHECK (operation_type IN ('EXPENSE', 'PREPAYMENT'))
-- We add split_meta_json to store exact/percent/weight inputs for editing operations
-- and support TRANSFER at API/service layer (stored cleanly or migrated on fresh DB).

ALTER TABLE expenses ADD COLUMN split_meta_json TEXT;
