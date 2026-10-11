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

## Notas de implementação

Decisões tomadas durante a implementação, que refinam ou adiam itens acima.

### M1

- **Protocolo texto no Postgres.** Toda query roda pelo simple query protocol (`sqlx::raw_sql`): o servidor renderiza cada valor em texto exato e o adapter só classifica pelo OID do tipo. Um único caminho de conversão para `Cell`, fidelidade total (numeric, int8, arrays).
- **Filtros da navegação** viram literais escapados com o algoritmo do `PQescapeLiteral` da libpq (aspas dobradas; com barra invertida, `E''`), porque o protocolo texto não aceita bind parameters. Identificadores sempre entre aspas. Testado contra injeção no teste de integração.
- **`Cell::Json` carrega o texto JSON**, não um valor parseado: números acima de 2^53 seriam arredondados pelo JavaScript. O front formata sem `JSON.parse`.
- **Sessão com `TimeZone=UTC`, `DateStyle=ISO`, `bytea_output=hex`** para que os textos sejam determinísticos. `timestamptz` aparece em UTC.
- **Somente leitura forçado em toda conexão no M1** (`FORCE_READ_ONLY` em `use_cases/sql.rs`). O M2 remove isso junto com a detecção de comandos destrutivos.
- **Sem trait `SqlAdapter` ainda**: `PostgresAdapter` é concreto. A trait é extraída no M3, quando MySQL e SQLite forem a 2ª e a 3ª implementação.
- **Script com vários comandos**: dividido por um lexer próprio (`split.rs`: strings, `E''`, `$tag$`, comentários aninhados); todos rodam na mesma sessão e o resultado mostrado é o do último.
- **Timeout** vale para o tempo até o primeiro lote de cada comando (e cancela no servidor). Lotes seguintes não contam, porque o usuário pode ficar lendo o resultado.
- **Cursor**: uma task tokio é dona da conexão e do stream do último comando. Fechar/abandonar o resultado cancela no servidor (`pg_cancel_backend`) e descarta a conexão em vez de drenar.
- **Tipos customizados** (enums, domínios, extensões) aparecem como `Unknown` (texto, não editável) no M1; resolver pelo catálogo entra no M2, quando edição importa.
- **TanStack Table adiado**: a grade só precisa de virtualização (TanStack Virtual). Entra quando houver redimensionar/fixar colunas.

### M2

- **Confirmação é uma resposta, não um erro**: `run_script`/`apply_changes` devolvem `NeedsConfirmation { reason, statements }` (em vez de `AppError::NeedsConfirmation`, como planejado). O front mostra o SQL exato e reenvia com `confirmed: true`.
- **O que pede confirmação** (`use_cases/guard.rs`, com `sqlparser`): DROP, TRUNCATE, UPDATE/DELETE sem WHERE, **ALTER TABLE … DROP COLUMN/CONSTRAINT** (adicionado), inclusive dentro de CTE e `EXPLAIN ANALYZE`. Em `prod`, toda escrita. Conexão somente leitura não confirma nada: o próprio banco recusa.
- **SQL que o parser não entende** cai na palavra-chave inicial: DROP/TRUNCATE são destrutivos; DELETE/UPDATE/ALTER pedem confirmação porque não dá para checar o WHERE.
- **Edição em stage**: linhas identificadas pela chave primária completa (validada no backend contra o catálogo); valores vão como literais texto que o Postgres converte para o tipo da coluna. Ordem: exclusões, alterações, inserções. Tudo numa transação e cada comando precisa afetar exatamente 1 linha, senão rollback com erro de conflito.
- **Editáveis**: tipos escalares modelados e enums. Arrays, bytea e tipos não modelados ficam somente leitura; tabela sem PK (ou com PK de tipo não editável) também. Paginação, ordenação e filtro travam enquanto houver alterações pendentes.
- **Tipos customizados**: enums e domínios resolvidos pelo `pg_type` (cache por conexão). Corrige um crash do M1: o sqlx entra em pânico ao chamar `kind()` num tipo não resolvido.
- **Abas** persistidas em `ui-state.json` (`tauri-plugin-store`, via `persist` do Zustand): tabelas, editores (com o SQL) e histórico. Resultados não persistem (o cursor morre com o app).
- **Histórico** em `history.sqlite` (sqlx sqlite): scripts executados (com erro, se houver) e edições salvas; o que ficou só na confirmação não entra. Sem limite de retenção por enquanto.
- **Salvar edições não tem timeout** (são poucas linhas por PK); o editor SQL continua com o timeout da conexão.
