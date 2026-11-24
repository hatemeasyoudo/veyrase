-- Run before deploying the analytics update. Safe to rerun; existing records are preserved.
BEGIN;
ALTER TABLE veyrase.visitors ADD COLUMN IF NOT EXISTS country text;
COMMIT;
