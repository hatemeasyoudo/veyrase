BEGIN;
CREATE TABLE IF NOT EXISTS veyrase.pricing (
  id smallint PRIMARY KEY CHECK (id = 1),
  unit_price integer NOT NULL CHECK (unit_price BETWEEN 1 AND 1000000),
  delivery_fee integer NOT NULL CHECK (delivery_fee BETWEEN 0 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO veyrase.pricing (id, unit_price, delivery_fee) VALUES (1, 4000, 2000)
ON CONFLICT (id) DO NOTHING;
REVOKE ALL ON veyrase.pricing FROM PUBLIC;
COMMIT;
