# Ordo — Decisões de design (v1)

> O app se chamava DB Manager até a v1; o identificador `dev.nemomartins.dbmanager` e o serviço do keychain `db-manager` continuam com o nome antigo para não perder conexões e senhas salvas.

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
- TLS na v1 (modo + CA opcional). Túnel SSH depois da v1 (ver "Depois da v1").

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
- Inferência de schema por amostra depois da v1 (ver "Depois da v1").
- Fora: builder visual, gestão de índices, change streams.

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

Redis cluster, edição de schema pela UI, builder de aggregation, pub/sub, assinatura e auto-update.

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

### M3

- **Enum em vez de `Box<dyn SqlAdapter>`**: `SqlConnection { Postgres, Mysql, Sqlite }` com despacho por `match` (macro `each!`). As engines são um conjunto fechado e métodos async atrás de `dyn` exigiriam futures boxeadas (`async_trait`). O contrato compartilhado é a trait `stream::Engine` (genérica, sem `dyn`): converter linhas, id de sessão, cancelar, descrever colunas.
- **Código compartilhado**: execução de script, cursor e streaming (`adapters/stream.rs`), transação das edições, montagem de SQL de navegação/edição (`sql_builder.rs`), dialetos (`dialect.rs`: aspas, literais, cast, parser) e um lexer configurável para dividir scripts (`split.rs`).
- **Custo por engine** (linhas não vazias): Postgres 389 + 261 de tipos; MySQL 376 + 83; SQLite 321. Acima dos ~300 combinados, mas ~200 de cada são consultas ao catálogo (information_schema, PRAGMAs), inerentes ao banco. Execução/navegação/edição/cancelamento custam ~60 linhas por engine.
- **MySQL**: protocolo texto (COM_QUERY), sessão em UTC, **sem tocar no `sql_mode`** (o sqlx adiciona PIPES_AS_CONCAT por padrão; desligado). Literais respeitam `NO_BACKSLASH_ESCAPES`, detectado na conexão. Cancelamento por `KILL QUERY`. Somente leitura via `SET SESSION TRANSACTION READ ONLY`. `DELIMITER` (convenção do cliente mysql) é aceito no editor para procedures. BOOLEAN é mostrado como número (é TINYINT(1)).
- **SQLite**: sem protocolo texto, cada valor é lido pela sua classe de armazenamento. Arquivo inexistente é erro (não cria banco vazio por engano de digitação). Somente leitura abre o arquivo em modo `ro`. Sem cancelamento (só timeout). Triggers com `BEGIN … END` são um comando só. Tabela sem PK declarada (só rowid) fica somente leitura.
- **Bug corrigido**: no MySQL, descartar o stream logo após o último resultado deixava a conexão "esperando" um pacote que nunca vem; o ping de devolução travava e o pool esgotava. Streams terminados agora são lidos até o fim antes de soltar (teste de regressão com 4× o tamanho do pool).

### M4

- **Formato dos documentos**: Extended JSON v2 relaxado, **exceto Int64, sempre `{"$numberLong": "…"}`**. O modo relaxado escreve Int64 como número simples: na volta, um Long pequeno viraria Int32 e um grande perderia precisão no JavaScript. Com a regra, número inteiro simples = Int32, número com ponto = Double, e o front pode usar `JSON.parse` com segurança. Ordem dos campos preservada (`serde_json` com `preserve_order`). Ida e volta testada contra o banco real, byte a byte.
- **Edição** substitui o documento inteiro por `_id` (`replaceOne`), um por vez, sem stage. Tem de casar exatamente 1 documento (senão conflito); o `_id` não pode mudar (nem de tipo). Note: o MongoDB compara números entre tipos, então `NumberLong(3)` encontra `_id: 3`.
- **Agregação** mostra até 1000 documentos (avisa quando há mais), sem cursor paginado. Cada execução leva o run id como `comment`; cancelar faz `currentOp` (`$ownOps`) + `killOp`. Timeout é `maxTimeMS` (no servidor). O mapeamento do erro 50 → timeout é testado em unidade: `maxTimeMS` não interrompe `sleep()` em JavaScript no servidor, então não dá para provocá-lo de forma determinística.
- **Regras de escrita**: somente leitura recusa insert/replace/delete e pipelines com `$out`/`$merge` (no app, já que o MongoDB não tem sessão read-only). `$out` substitui a coleção de destino: sempre pede confirmação. Em `prod`, toda escrita pede.
- **Connection string** (`mongodb+srv://…`): novo alvo `Target::Uri { database }`; a string inteira (com credenciais) vai para o keychain como segredo. No modo host/porta, autenticação contra `admin` e TLS conforme o modo (Mongo não tem TLS oportunista: "preferir" = sem TLS).
- **Registry**: `enum Live { Sql(SqlConnection), Mongo(MongoAdapter) }`. A árvore reaproveita `SchemaInfo` (databases = schemas, coleções = relações) e as abas de tabela abrem a tela de coleção quando a conexão é MongoDB.
- **Sem shell/console** do Mongo (fora do escopo): drop de coleção, `deleteMany` etc. não existem na UI, então não há outro caminho destrutivo além de `$out`.

### M5

- **Uma conexão multiplexada por database** (`SELECT` fixo na conexão), aberta no primeiro uso. Conexão quebrada (servidor reiniciou) é descartada e reaberta na próxima chamada. O timeout da conexão vira o `response_timeout` do driver: o comando é abandonado, mas **continua rodando no Redis** (não existe KILL para um comando em execução), e a mensagem diz isso.
- **Árvore**: a lateral lista os databases (`CONFIG GET databases`, 16 quando o CONFIG é bloqueado, comum em serviços gerenciados) com a contagem do `INFO keyspace`. Cada database abre uma aba com Chaves / Console / Servidor. As chaves vêm de `SCAN MATCH` em páginas (para em ~1000 chaves ou 10 chamadas, para um padrão raro não varrer o banco inteiro); "Carregar mais" continua do cursor. O agrupamento pelo separador é feito no front.
- **Valores**: até 1000 elementos por coleção e 1 MiB por string (avisa quando há mais; string truncada não é editável). Texto que não é UTF-8 aparece escapado como no redis-cli (`\xff`) e fica somente leitura. Nomes de chave não UTF-8 aparecem com perda e não abrem (raro; documentado no código).
- **Edição** imediata, sem stage (como no Mongo): `SET … KEEPTTL`, HSET/HDEL, LSET/RPUSH/LREM, SADD/SREM, ZADD/ZREM, EXPIRE/PERSIST, `RENAMENX` (não sobrescreve outra chave: conflito) e DEL. Renomear um campo/membro **adiciona o novo antes de remover o antigo**: o contrário esvaziaria a coleção e o Redis apaga chave vazia junto com o TTL (pego no teste). Vários comandos vão num MULTI/EXEC, mas o Redis **não tem rollback**: um comando que falha dentro do EXEC é reportado e os anteriores ficam aplicados. Sem checagem de concorrência: a última escrita vence. Criar chave recusa nome existente (EXISTS antes, com corrida aceita).
- **Console** (estilo redis-cli: aspas, `\xHH`, respostas numeradas) roda na conexão compartilhada do database, então recusa o que travaria ou mudaria o estado dela: SELECT, MULTI/EXEC/WATCH, pub/sub, MONITOR, AUTH/HELLO/QUIT/RESET e comandos bloqueantes (BLPOP…, XREAD BLOCK, WAIT). Conexão dedicada para o console fica para quando fizer falta.
- **Regras** (`use_cases/redis.rs`): somente leitura = allowlist de comandos de leitura (com subcomando, ex.: `CONFIG GET`); qualquer outro é escrita. Sempre pedem confirmação: FLUSHDB/FLUSHALL, SWAPDB, SHUTDOWN, DEBUG, `KEYS` (bloqueia o servidor; o app sempre usa SCAN), CONFIG SET/RESETSTAT/REWRITE, SCRIPT/FUNCTION FLUSH, REPLICAOF, CLIENT KILL. Em `prod`, toda escrita (console e edições), mostrando o comando gerado. Stream é somente leitura.
- **Histórico**: comandos do console e edições entram com `SELECT n` na frente. "Abrir no editor" só aparece para conexões SQL (corrige entradas do Mongo, que abriam o editor SQL).
- **Sem cancelamento** (como decidido): só timeout.

### M6

- **Export em streaming para arquivo**: o "Salvar como" vem do `tauri-plugin-dialog` (permissão só `dialog:allow-save`); o backend recebe o caminho e grava lote a lote, sem juntar o resultado em memória. Grava em `<arquivo>.part` e renomeia no fim: export que falha ou é cancelado não apaga um arquivo existente com o mesmo nome. Cancelável pelo mesmo `cancel_run` do editor (PG/MySQL no servidor, Mongo via `killOp`); sem timeout depois do primeiro lote. Cada export entra no histórico.
- **CSV (SQL)**, de dois lugares: a tabela (com o filtro e a ordenação da grade, todas as páginas) e o resultado do editor (reexecuta o script inteiro; só aceita leitura, checado com o `sqlparser`: escrita vai pelo editor e suas confirmações). Formato do `COPY … CSV` do Postgres: NULL é campo vazio e string vazia é `""`. Sem BOM (Excel pode errar acentos; LibreOffice pergunta a codificação).
- **Limites do CSV** (`ponytail` no código): a grade só carrega 32 bytes de cada binário, então blob maior sai como `<N bytes>`; arrays saem como `{a,b}` sem aspas nos elementos.
- **Mongo**: NDJSON ou array JSON, com filtro/ordenação/projeção aplicados, em Extended JSON (mesmo formato da tela: Int64 em `$numberLong`). Sem `maxTimeMS`: um export grande pode demorar.
- **Diagrama ER** (somente leitura, só SQL): botão no schema da árvore abre uma aba. Tabelas viram nós com colunas (PK/FK marcadas) e cada FK vira uma aresta tabela→tabela; FKs para outro schema aparecem listadas no nó em vez de desenhadas. Layout `layered` do elkjs, React Flow para pan/zoom/minimapa; duplo clique abre a tabela. As FKs passaram a vir estruturadas do catálogo (colunas, schema/tabela/colunas referenciadas) nos três engines.
- **Custo**: o diagrama consulta a estrutura de cada tabela (até 8 em paralelo). Uma consulta ao catálogo do schema inteiro por engine fica para quando schemas grandes ficarem lentos. React Flow + elk (~1,6 MB) carregam sob demanda, num chunk separado.

### Depois da v1

- **Queries favoritas**: uma coluna `starred` no próprio `history.sqlite`, não uma tabela ou tela de "snippets". A entrada favorita continua sendo uma execução do histórico (com conexão, duração e erro), e a busca no SQL já serve para achá-la; por isso não tem nome. Arquivos de antes da coluna recebem `ALTER TABLE … ADD COLUMN` ao abrir (checado pelo `pragma_table_info`, sem engolir erro), com teste contra um arquivo no formato antigo. Marcar um id inexistente é `NotFound`.
- **Ctrl+P = Ctrl+K**: os dois abrem a mesma paleta. Uma busca rápida própria do Ctrl+P chegou a existir e saiu ao juntar com a paleta, que já fazia o mesmo (só lista o que a lateral carregou, nunca conecta sozinha).
- **Timeout dos testes do front em 20 s** (`vite.config.ts`): é detector de travamento, não medida de desempenho. Com cobertura e arquivos em paralelo numa máquina ocupada, testes de UI levam de 1 a 6 s e o padrão de 5 s derrubava testes saudáveis ao acaso.
- **Copiar linhas como INSERT ou JSON**: a linha selecionada ou todas as carregadas, sempre o valor gravado (alterações pendentes não entram; linha adicionada e não salva não é copiável). O INSERT vem do backend (`copy_as_insert`) e não do front, porque os literais dependem do dialeto da conexão aberta (`E''` no Postgres, `NO_BACKSLASH_ESCAPES` detectado no MySQL): usa o mesmo `change_sql` das edições. No editor só há JSON, já que o resultado de uma query qualquer não tem tabela de destino. O JSON é montado como texto (Int64 e decimais exatos, colunas JSON como estão, `NaN`/`Infinity` como string). Binário que a grade só mostra em parte, array e tipo não modelado são recusados com o nome da coluna em vez de copiados com perda (no JSON, array e tipo não modelado saem, porque o texto já é exato). Área de transferência pelo `navigator.clipboard`, sem plugin; se o WebKitGTK recusar, o erro aparece ao lado do botão.
- **Fechar a janela deixa o Ordo na bandeja**: o X só esconde a janela (`CloseRequested` → `hide`), com conexões, abas e alterações pendentes intactas; "Abrir Ordo" na bandeja a traz de volta. Sair é pela bandeja ("Sair") ou por **Ctrl+Q**, que existe porque nem todo ambiente mostra a bandeja (GNOME sem a extensão de AppIndicator). Ctrl+Q com alterações pendentes pergunta antes, como o Ctrl+W, e não fecha abas: elas são persistidas e voltam na próxima abertura. "Sair" na bandeja encerra sem perguntar. Com o app escondido, abrir o Ordo de novo criaria um segundo processo: o `tauri-plugin-single-instance` faz a segunda abertura só mostrar a janela existente.
- **Túnel SSH pelo `ssh` do sistema**, não por uma crate SSH: assim valem o `~/.ssh/config` (aliases, `ProxyJump`), o agente e o `known_hosts` sem reimplementar nada. `ssh -N -L 127.0.0.1:<porta livre>:<host>:<porta>` com `BatchMode=yes` (não há terminal para perguntas: só chave ou agente, sem senha SSH), `ExitOnForwardFailure=yes` e `StrictHostKeyChecking=accept-new` (confia no primeiro uso, recusa chave trocada). O `open` sobe o túnel e troca host/porta do alvo por `127.0.0.1:<porta>`; os adapters não sabem do túnel, exceto o Mongo, que liga `directConnection` para não descobrir membros do replica set por endereços inalcançáveis. Pronto = a porta local aceita conexão (o OpenSSH só abre o `-L` depois do login); se o `ssh` sai antes, o stderr dele vira o erro. O túnel vive na sessão aberta (`kill_on_drop`) e morre com o app mesmo em `exit` ou crash (`PR_SET_PDEATHSIG`). Só alvo host/porta: SQLite não tem rede e a URI do Mongo (`+srv`, vários hosts) não cabe num `-L`. TLS "verificar certificado" é recusado com túnel, porque o certificado não é de `127.0.0.1`.
- **Schema da coleção por amostra** (aba Schema): `aggregate([{ "$sample": { "size": N } }])`, com N de 1 a 10 000 (padrão 100, ajustável), e o comando aparece na tela antes de rodar. O Rust percorre os documentos (`adapters/mongo/schema.rs`) e devolve cada caminho (`a.b` dentro de objetos, `a[]` para elementos de array, `a[].b`…) com os tipos BSON pelo nome do `$type`, quantos documentos da amostra têm o caminho e o primeiro exemplo escalar em Extended JSON (mesmo formato da tela, Int64 em `$numberLong`), cortado em 200 caracteres com aviso. Tipos contam ocorrências (os elementos de um array contam um a um); presença conta documentos. A tela diz que é uma amostra aleatória e não o schema: o MongoDB não impõe um e campos raros podem não aparecer. É leitura (vale em conexão somente leitura), não entra no histórico (como a navegação), usa `maxTimeMS` do timeout da conexão e o run id como `comment`, então Cancelar faz `killOp` como na agregação. Roda só ao clicar em Amostrar, nunca ao abrir a aba. O limite de 10 000 existe porque `$sample` acima de ~5% da coleção ordena os documentos em memória no servidor, e a amostra inteira fica em memória no Rust até ser resumida (só o resumo vai para a tela).
