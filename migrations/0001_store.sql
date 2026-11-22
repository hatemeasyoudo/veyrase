CREATE TABLE visitors (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  medium TEXT NOT NULL DEFAULT '',
  campaign TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE visitor_days (
  visitor_id TEXT NOT NULL REFERENCES visitors(id),
  day TEXT NOT NULL,
  added INTEGER NOT NULL DEFAULT 0 CHECK (added IN (0, 1)),
  PRIMARY KEY (visitor_id, day)
);
CREATE INDEX visitor_days_range ON visitor_days(day, visitor_id, added);

CREATE TABLE orders (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  visitor_id TEXT REFERENCES visitors(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  sku TEXT NOT NULL,
  size_id TEXT NOT NULL,
  qty INTEGER NOT NULL CHECK (qty BETWEEN 1 AND 9),
  subtotal INTEGER NOT NULL CHECK (subtotal > 0),
  currency TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled')),
  created_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX orders_recent ON orders(created_at DESC, id);
CREATE INDEX orders_purchases ON orders(paid_at, visitor_id);

CREATE TABLE returns (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  order_ref TEXT NOT NULL,
  email TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'approved', 'declined')),
  created_at TEXT NOT NULL
);
CREATE INDEX returns_recent ON returns(created_at DESC, id);
