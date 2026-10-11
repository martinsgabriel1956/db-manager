-- MySQL demo: unsigned BIGINT, DECIMAL, JSON with numbers beyond 2^53, ENUM,
-- DATETIME vs TIMESTAMP, binary, a view, a table without primary key and a large
-- table for streaming.

CREATE TABLE customers (
  id          BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  name        VARCHAR(100) NOT NULL,
  email       VARCHAR(150) NOT NULL UNIQUE,
  balance     DECIMAL(20, 4) NOT NULL DEFAULT 0,
  vip         BOOLEAN NOT NULL DEFAULT FALSE,
  profile     JSON,
  avatar      VARBINARY(64),
  birth_date  DATE,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP NULL
);

CREATE TABLE products (
  id       INT PRIMARY KEY AUTO_INCREMENT,
  sku      VARCHAR(20) NOT NULL UNIQUE,
  title    VARCHAR(100) NOT NULL,
  price    DECIMAL(12, 2) NOT NULL,
  rating   DOUBLE
);

CREATE TABLE orders (
  id          BIGINT PRIMARY KEY AUTO_INCREMENT,
  customer_id BIGINT UNSIGNED NOT NULL,
  product_id  INT NOT NULL,
  quantity    INT NOT NULL,
  status      ENUM('pending', 'paid', 'shipped', 'cancelled') NOT NULL DEFAULT 'pending',
  placed_at   DATETIME NOT NULL,
  KEY orders_status (status),
  CONSTRAINT orders_customer FOREIGN KEY (customer_id) REFERENCES customers (id),
  CONSTRAINT orders_product FOREIGN KEY (product_id) REFERENCES products (id)
);

CREATE VIEW order_totals AS
SELECT o.id, c.name AS customer, p.title AS product, o.quantity * p.price AS total, o.status
FROM orders o JOIN customers c ON c.id = o.customer_id JOIN products p ON p.id = o.product_id;

CREATE TABLE audit_log (
  happened_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actor       VARCHAR(150),
  action      VARCHAR(50) NOT NULL
);

INSERT INTO customers (id, name, email, balance, vip, profile, avatar, birth_date, created_at, updated_at) VALUES
  (18446744073709551615, 'Ana Souza', 'ana@example.com', 1234.5678, TRUE,
   '{"twitter_id": 9007199254740993, "address": {"city": "São Paulo"}}', X'89504E470D0A1A0A',
   '1990-05-17', '2024-01-15 10:30:00', '2024-01-15 13:30:00'),
  (1, 'Bruno Lima', 'bruno@example.com', 0, FALSE, NULL, NULL, NULL, '2024-02-01 08:00:00', NULL),
  (2, 'Diego O''Brien', 'diego@example.com', -10.5, FALSE, '[]', NULL, '2000-02-29', '2024-04-01 00:00:00', NULL);

INSERT INTO products (sku, title, price, rating) VALUES
  ('SKU-001', 'Teclado mecânico', 459.90, 4.5),
  ('SKU-002', 'Mouse sem fio', 129.00, 4.25),
  ('SKU-003', 'Monitor 27"', 1899.99, NULL);

SET SESSION cte_max_recursion_depth = 300000;

INSERT INTO orders (customer_id, product_id, quantity, status, placed_at)
WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 2000)
SELECT ELT(1 + n % 3, 1, 2, 18446744073709551615), 1 + n % 3, 1 + n % 5,
       ELT(1 + n % 4, 'pending', 'paid', 'shipped', 'cancelled'),
       TIMESTAMP('2024-06-01') + INTERVAL n MINUTE
FROM seq;

INSERT INTO audit_log (actor, action) VALUES ('ana@example.com', 'login'), (NULL, 'cron.cleanup');

CREATE TABLE events (
  id         BIGINT PRIMARY KEY,
  kind       VARCHAR(20) NOT NULL,
  value      DOUBLE,
  created_at DATETIME NOT NULL
);
INSERT INTO events
WITH RECURSIVE seq (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 200000)
SELECT n, ELT(1 + n % 3, 'click', 'view', 'purchase'), IF(n % 10 = 0, NULL, n * 0.5),
       TIMESTAMP('2024-01-01') + INTERVAL n SECOND
FROM seq;
