-- Demo data exercising what the app renders: big integers, exact numerics, JSON with
-- numbers beyond 2^53, arrays, bytea, timestamps, NULLs, a custom enum (shown as
-- Unknown in M1), a view, a table without primary key and a large table for streaming.

CREATE SCHEMA shop;

CREATE TYPE shop.order_status AS ENUM ('pending', 'paid', 'shipped', 'cancelled');

CREATE TABLE shop.customers (
  id          bigserial PRIMARY KEY,
  name        text NOT NULL,
  email       text NOT NULL UNIQUE,
  balance     numeric(20, 4) NOT NULL DEFAULT 0,
  tags        text[] NOT NULL DEFAULT '{}',
  profile     jsonb,
  avatar      bytea,
  external_id int8,
  birth_date  date,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE shop.products (
  id       serial PRIMARY KEY,
  sku      text NOT NULL UNIQUE,
  title    text NOT NULL,
  price    numeric(12, 2) NOT NULL,
  ratings  float8[],
  in_stock boolean NOT NULL DEFAULT true
);

CREATE TABLE shop.orders (
  id          bigserial PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES shop.customers (id),
  product_id  int NOT NULL REFERENCES shop.products (id),
  quantity    int NOT NULL CHECK (quantity > 0),
  status      shop.order_status NOT NULL DEFAULT 'pending',
  placed_at   timestamp NOT NULL DEFAULT now()
);
CREATE INDEX orders_customer_idx ON shop.orders (customer_id);
CREATE INDEX orders_status_idx ON shop.orders (status) WHERE status <> 'shipped';

CREATE VIEW shop.order_totals AS
SELECT o.id, c.name AS customer, p.title AS product, o.quantity * p.price AS total, o.status
FROM shop.orders o
JOIN shop.customers c ON c.id = o.customer_id
JOIN shop.products p ON p.id = o.product_id;

-- no primary key: browsable, but M2 will keep it read-only
CREATE TABLE shop.audit_log (
  happened_at timestamptz NOT NULL DEFAULT now(),
  actor       text,
  action      text NOT NULL,
  payload     json
);

INSERT INTO shop.customers (name, email, balance, tags, profile, avatar, external_id, birth_date, created_at) VALUES
  ('Ana Souza', 'ana@example.com', 1234.5678, '{vip,early-adopter}',
   '{"twitter_id": 9007199254740993, "newsletter": true, "address": {"city": "São Paulo", "zip": "01310-100"}}',
   '\x89504e470d0a1a0a0000000d49484452', 9223372036854775807, '1990-05-17', '2024-01-15 10:30:00-03'),
  ('Bruno Lima', 'bruno@example.com', 0, '{}', NULL, NULL, NULL, NULL, '2024-02-01 08:00:00-03'),
  ('Carla Mendes', 'carla@example.com', 99999999999999.9999, '{"with,comma","with \"quote\""}',
   '{"notes": "texto com vírgula, aspas \" e acentuação"}', '\x00ff', -42, '1985-12-31', '2024-03-10 22:15:00+00'),
  ('Diego O''Brien', 'diego@example.com', -10.5, '{late-payer}', '[]', NULL, 0, '2000-02-29', '2024-04-01 00:00:00+00');

INSERT INTO shop.customers (name, email, balance, profile, created_at)
SELECT 'Cliente ' || g, 'cliente' || g || '@example.com', round((random() * 5000)::numeric, 4),
       jsonb_build_object('score', g, 'segment', (ARRAY['a', 'b', 'c'])[1 + g % 3]),
       now() - (g || ' hours')::interval
FROM generate_series(1, 300) g;

INSERT INTO shop.products (sku, title, price, ratings, in_stock) VALUES
  ('SKU-001', 'Teclado mecânico', 459.90, '{4.5,5,3.5}', true),
  ('SKU-002', 'Mouse sem fio', 129.00, '{4,4.5}', true),
  ('SKU-003', 'Monitor 27"', 1899.99, NULL, false),
  ('SKU-004', 'Cabo USB-C', 39.90, '{}', true);

INSERT INTO shop.orders (customer_id, product_id, quantity, status, placed_at)
SELECT 1 + g % 304, 1 + g % 4, 1 + g % 5,
       (ARRAY['pending', 'paid', 'shipped', 'cancelled']::shop.order_status[])[1 + g % 4],
       now() - (g || ' minutes')::interval
FROM generate_series(1, 2000) g;

INSERT INTO shop.audit_log (actor, action, payload) VALUES
  ('ana@example.com', 'login', '{"ip": "10.0.0.1"}'),
  (NULL, 'cron.cleanup', NULL),
  ('carla@example.com', 'order.cancel', '{"order_id": 7, "reason": "duplicated"}');

-- large table to try streaming (1000-row batches) and cancel
CREATE TABLE public.events (
  id         bigint PRIMARY KEY,
  kind       text NOT NULL,
  value      float8,
  created_at timestamptz NOT NULL
);
INSERT INTO public.events
SELECT g, (ARRAY['click', 'view', 'purchase'])[1 + g % 3], CASE WHEN g % 10 = 0 THEN NULL ELSE g * 0.5 END,
       '2024-01-01'::timestamptz + (g || ' seconds')::interval
FROM generate_series(1, 200000) g;
ANALYZE;
