# DB Manager — Decisões de design (v1)

Resultado da sessão de grill de 2026-10-10. Uso pessoal, um único usuário.

## Produto

- Cliente desktop para gerenciar bancos existentes (estilo TablePlus/DBeaver).
- Engines v1: **Postgres, MySQL, SQLite, MongoDB, Redis (standalone)**.
- Três UIs: grade relacional (SQL), documento (Mongo), chave-valor (Redis).

## Stack

- **Tauri** + **React + Vite** (front) + **Rust puro** (backend via comandos Tauri/IPC, sem servidor HTTP).
- Drivers: `sqlx` (pg/mysql/sqlite), `mongodb`, `redis`. Sem ORM.
- Contrato tipado: `tauri-specta` gera os tipos TS a partir do Rust.
- Front: TanStack Query (estado do Rust), Zustand + `persist` via `tauri-plugin-store` (estado de UI), TanStack Table + Virtual, Tailwind + shadcn/ui, CodeMirror 6, `react-resizable-panels`, React Flow + `elkjs`, Zod só em formulários. Sem roteador.

## Conexões

- Metadados em JSON (diretório de dados do app); senha/URI no keychain do SO (crate `keyring`, chave `db-manager:<id>`).
- Linux sem Secret Service: fallback com aviso claro na UI, nunca texto puro silencioso.
- TLS na v1 (modo + CA opcional). **Túnel SSH na v2** (até lá: `ssh -L`).

## UI SQL

- Árvore conexão → schema → tabelas/views.
- Navegação paginada, ordenação, filtro simples (SQL parametrizado).
- Edição inline **em stage**, aplicada numa transação; **só em tabela com PK**, senão somente leitura.
- Editor SQL (CodeMirror, autocomplete), executar seleção ou script.
- Estrutura da tabela (somente leitura): colunas, índices, FKs.
- Múltiplas abas (persistidas), histórico de queries (SQLite local, com busca), export CSV (streaming para arquivo), diagrama ER (somente leitura, a partir das FKs).
- Fora: edição de schema pela UI.

## UI MongoDB

- Árvore databases → collections (+ índices somente leitura).
- Filtro, sort e projection em JSON; visualização em árvore ou JSON cru.
- CRUD por documento (`replaceOne` por `_id`, sem stage).
- **Extended JSON obrigatório** (ObjectId/Date/Decimal128/Binary preservados).
- Editor de pipeline de aggregation (JSON). Export JSON/NDJSON.
- Fora: builder visual, inferência de schema, gestão de índices, change streams.

## UI Redis

- DB 0–15 → chaves agrupadas por separador (padrão `:`, configurável).
- **Sempre `SCAN`, nunca `KEYS`.**
- Viewer/editor por tipo (string/hash/list/set/zset; stream somente leitura), TTL, renomear.
- Console de comandos (entra no histórico e nas abas). `INFO` formatado.
- Fora: pub/sub, monitor, módulos, cluster/sentinel, export.

## Segurança contra acidentes

1. Etiqueta de ambiente por conexão (`local/dev/staging/prod`) com cor; `prod` em vermelho na borda/abas/árvore.
2. Modo somente leitura no nível do banco: PG `default_transaction_read_only`, MySQL `SESSION TRANSACTION READ ONLY`, SQLite `mode=ro`, Mongo/Redis allowlist no Rust.
3. Confirmação de destrutivos (detectados com `sqlparser-rs`, não regex): DROP/TRUNCATE, UPDATE/DELETE sem WHERE, `deleteMany({})`, FLUSH*, etc. Em `prod`, **toda escrita** confirma, mostrando o comando gerado.

## Resultados grandes / queries lentas

- Editor: 1000 linhas iniciais, próximo lote via stream mantido aberto.
- Grade virtualizada; células grandes truncadas, completas em painel lateral.
- **Cancelamento real**: PG `pg_cancel_backend(pid)`, MySQL `KILL QUERY id`, Mongo `maxTimeMS` + `killOp`, SQLite/Redis só timeout.
- Timeout padrão 30 s por conexão (`0` desativa).

## Contrato de valores (Rust ↔ TS)

- `enum Cell` com tag `#[serde(tag = "t", content = "v")]`: Null, Bool, Int (string), Float, Decimal (string), Text, Bytes (preview), Date, Timestamp {value, tz}, Json, Array, ObjectId, Unknown.
- `Unknown` = exibido como texto, **não editável**.

## Arquitetura Rust

```
src-tauri/src/
  domain/      Cell, ConnectionConfig, Environment, AppError (thiserror)
  adapters/sql/{mod.rs (trait SqlAdapter), postgres.rs, mysql.rs, sqlite.rs}
  adapters/mongo.rs, adapters/redis.rs   (structs concretas, sem trait)
  use_cases/   regras: stage→SQL, somente leitura, destrutivos, paginação, export, histórico
  commands/    #[tauri::command] finos
  storage/     connections.json, keychain, history.sqlite
  registry.rs  RwLock<HashMap<ConnId, Live>>; enum Live { Sql(Box<dyn SqlAdapter>), Mongo, Redis }
```

- Fluxo: commands → use_cases → adapters. `AppError` serializado com tag (`NeedsConfirmation` abre o diálogo no front).
- Conexões abertas sob demanda, pool por conexão. Repo único (`src/` + `src-tauri/`).

## Testes

- Adapters: integração com `testcontainers` contra os 5 bancos reais (sem mock de driver).
- Use cases: `cargo test` com `FakeAdapter`.
- Parser de destrutivos: testes em tabela de casos.
- Front: Vitest + Testing Library com `invoke` mockado.
- Sem E2E na v1.
- Cobertura ≥ 70% (`cargo llvm-cov` + `vitest --coverage`), gate no CI (GitHub Actions, Linux).

## Distribuição

- Só Linux (AppImage + `.deb`), release via tag `v*` no GitHub Releases.
- Sem assinatura, sem auto-update, sem builds de macOS/Windows.

## Marcos

| Marco | Entrega                                                                                                                                 |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| M0    | Esqueleto Tauri + React + specta, cadastro de conexão (JSON + keychain), registry, etiquetas, CI com cobertura                          |
| M1    | Postgres somente leitura: árvore, navegação, editor SQL, `Cell`, streaming 1000, cancelamento, timeout, modo somente leitura, estrutura |
| M2    | Postgres escrita: stage + transação, destrutivos, confirmação em prod, abas, histórico                                                  |
| M3    | MySQL + SQLite (valida a trait; ~300 linhas cada, senão revisar)                                                                        |
| M4    | MongoDB                                                                                                                                 |
| M5    | Redis                                                                                                                                   |
| M6    | Export CSV/NDJSON, diagrama ER                                                                                                          |

## v2+

Túnel SSH, Redis cluster, edição de schema pela UI, builder de aggregation, pub/sub, assinatura e auto-update.
