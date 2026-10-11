-- SQLite demo: per-value storage classes (INTEGER/REAL/TEXT/BLOB), a trigger whose
-- body has its own semicolons, a view and a table without primary key.

CREATE TABLE notebooks (
  id    INTEGER PRIMARY KEY,
  title TEXT NOT NULL UNIQUE
);

CREATE TABLE notes (
  id          INTEGER PRIMARY KEY,
  notebook_id INTEGER NOT NULL REFERENCES notebooks(id),
  title       TEXT NOT NULL,
  body        TEXT,
  stars       REAL,
  attachment  BLOB,
  tags        TEXT,            -- JSON stored as text
  created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX notes_title ON notes (title);

CREATE TABLE note_counter (total INTEGER NOT NULL);
INSERT INTO note_counter VALUES (0);

CREATE TRIGGER count_notes AFTER INSERT ON notes BEGIN
  UPDATE note_counter SET total = total + 1;
END;

CREATE VIEW starred AS SELECT id, title, stars FROM notes WHERE stars >= 4;

CREATE TABLE sessions (started_at TEXT, user TEXT);

INSERT INTO notebooks VALUES (1, 'Trabalho'), (2, 'Pessoal');

INSERT INTO notes (id, notebook_id, title, body, stars, attachment, tags) VALUES
  (9007199254740993, 1, 'Reunião', 'Pauta: orçamento; contratação', 4.5, X'25504446', '["work", "q3"]'),
  (2, 2, 'Mercado', NULL, NULL, NULL, '[]'),
  (3, 1, 'Ideias', 'it''s fine \ really', 5, NULL, NULL);

WITH RECURSIVE seq(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM seq WHERE n < 5000)
INSERT INTO notes (id, notebook_id, title, stars) SELECT 100 + n, 1 + n % 2, 'Nota ' || n, (n % 50) / 10.0 FROM seq;

INSERT INTO sessions VALUES ('2024-01-01 10:00:00', 'ana'), ('2024-01-02 11:30:00', 'bruno');
