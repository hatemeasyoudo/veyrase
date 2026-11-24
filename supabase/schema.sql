BEGIN;

CREATE SCHEMA IF NOT EXISTS veyrase;
REVOKE ALL ON SCHEMA veyrase FROM PUBLIC;

CREATE TABLE IF NOT EXISTS veyrase.visitors (
  id text PRIMARY KEY,
  source text NOT NULL,
  medium text NOT NULL DEFAULT '',
  campaign text NOT NULL DEFAULT '',
  country text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS veyrase.visitor_days (
  visitor_id text NOT NULL REFERENCES veyrase.visitors(id),
  day date NOT NULL,
  added smallint NOT NULL DEFAULT 0 CHECK (added IN (0, 1)),
  PRIMARY KEY (visitor_id, day)
);
CREATE INDEX IF NOT EXISTS visitor_days_range ON veyrase.visitor_days(day, visitor_id, added);

CREATE TABLE IF NOT EXISTS veyrase.orders (
  id text PRIMARY KEY,
  request_id text NOT NULL UNIQUE,
  visitor_id text REFERENCES veyrase.visitors(id),
  name text NOT NULL,
  email text NOT NULL,
  sku text NOT NULL,
  size_id text NOT NULL,
  qty integer NOT NULL CHECK (qty BETWEEN 1 AND 9),
  subtotal integer NOT NULL CHECK (subtotal > 0),
  currency text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled')),
  created_at timestamptz NOT NULL,
  paid_at timestamptz
);
CREATE INDEX IF NOT EXISTS orders_recent ON veyrase.orders(created_at DESC, id);
CREATE INDEX IF NOT EXISTS orders_purchases ON veyrase.orders(paid_at, visitor_id);

CREATE TABLE IF NOT EXISTS veyrase.returns (
  id text PRIMARY KEY,
  request_id text NOT NULL UNIQUE,
  order_ref text NOT NULL,
  email text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'approved', 'declined')),
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS returns_recent ON veyrase.returns(created_at DESC, id);

COMMIT;
