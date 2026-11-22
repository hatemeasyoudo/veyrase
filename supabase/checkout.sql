BEGIN;

ALTER TABLE veyrase.orders
  ADD COLUMN IF NOT EXISTS shipping jsonb,
  ADD COLUMN IF NOT EXISTS payment_reported_at timestamptz,
  ADD COLUMN IF NOT EXISTS payment_payer text,
  ADD COLUMN IF NOT EXISTS payment_payer_reference text,
  ADD COLUMN IF NOT EXISTS payment_transaction_id text;

CREATE UNIQUE INDEX IF NOT EXISTS orders_payment_transaction
  ON veyrase.orders (lower(payment_transaction_id))
  WHERE payment_transaction_id IS NOT NULL;

COMMIT;
