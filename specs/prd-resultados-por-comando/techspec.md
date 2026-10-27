# Techspec: Resultado de cada comando do script

## Resumo executivo

O script continua rodando numa sessão só (`adapters/stream.rs::run_script`). A diferença está nos comandos anteriores ao último. Hoje eles rodam por `execute`, que lê as linhas e as descarta. Passam a ser lidos pelo mesmo `read_batch` do último comando: o primeiro lote (1000 linhas) é guardado, e o resto é lido até o fim só para contar as linhas. O custo de rede e de servidor continua o mesmo, porque essas linhas já eram lidas e jogadas fora. Só o último comando continua com cursor e "carregar mais". Isso não tem como mudar: uma sessão mantém um único resultado aberto por vez.

A resposta de `run_script` deixa de ter um resultado único e passa a ter um `ScriptStep` por comando. Ela também deixa de virar erro quando um comando falha. A falha passa a ir dentro do próprio `ScriptOutcome`, junto com os passos que já rodaram. No front, o `useScriptRunner` mantém os estados atuais. Quando há mais de um comando, a área de resultado vira abas (Radix Tabs, já usadas no app): "Execução" e uma aba por resultado guardado.

## Arquitetura

### Visão de componentes

| Componente | Muda o quê |
|---|---|
| `adapters/split.rs` + `dialect.rs` | `split_spans` devolve cada comando com o intervalo (início e fim em bytes) que ocupa no texto executado. `split` continua devolvendo só o texto, para os outros chamadores. |
| `adapters/stream.rs` | `run_steps` (novo) lê cada comando anterior com `read_batch` + contagem, guarda até `EARLIER_RESULTS_KEPT` grades, e devolve a falha em `ScriptSteps.failure` em vez de `Err`. `run_script` vira um envoltório "tudo ou erro" dele, com a mesma assinatura. |
| `adapters/{postgres,mysql,sqlite}` e `adapters/mod.rs` | Ganham `run_steps`. O `describe` de um comando anterior vazio só roda quando `reads[i]` diz que é leitura. |
| `use_cases/sql.rs::run_script` | Calcula `reads` pelo guard, chama `run_steps`, monta os `ScriptStep` (status, duração, contagem, grade, intervalo em UTF-16) e grava o histórico com o erro de `failure`. |
| Os outros chamadores (`explain`, `alter_schema`, export, sessions, schema_diff, backup) | Continuam no `run_script`, que mantém o "tudo ou erro". Para eles, nada muda. |
| `use_cases/export.rs::export_query` | Novo parâmetro `statement: Option<u32>`: roda o script só até esse comando, que vira o último e é exportado inteiro, em streaming. |
| `domain/sql.rs` | `ScriptOutcome` com `steps` e `error`, mais os tipos novos `ScriptStep` e `StepStatus`. |
| `useScriptRunner.ts` | O estado `error` ganha `outcome?` (falha com passos). Os estados `rows` e `command` continuam descrevendo o último comando, que é o único com cursor. |
| `SqlWorkspace.tsx` | `ResultsPanel` decide: um comando, a tela de hoje; mais de um, `ScriptResults`. |
| `ScriptResults.tsx` (novo, em `features/editor`) | As abas "Execução" e uma por resultado, mais a lista do resumo. Cada aba reaproveita `ResultGrid`, `CellDetail`, `CopyRowsMenu` e `ExportButton`. |
| `SqlEditor.tsx` | A `SqlEditorApi` ganha `select(text, from, to)`, que acha o texto executado no documento e seleciona o trecho. |

Fluxo:

1. O editor chama `prepareRun()`, que devolve o texto a executar, como hoje.
2. O front envia `run_script(sql)`.
3. O use case divide o script com intervalos e passa pelo guard e pela confirmação, como hoje.
4. O adapter roda cada comando em ordem e devolve `ScriptRun { steps, cursor, failure }`.
5. O use case converte isso em `ScriptOutcome { steps, error }`, registra o cursor do último comando sob o `run_id` e grava o histórico.
6. O front mostra as abas. Selecionar um passo no resumo chama `select(texto executado, span)` no editor.

## Design de implementação

### Interfaces principais

```rust
// adapters/stream.rs
/// Earlier statements keep their first batch for the UI; beyond this they only count rows.
pub const EARLIER_RESULTS_KEPT: usize = 19; // + the last one = 20 tabs

pub struct StepRun {
    pub duration: Duration,
    /// first batch (rows) or rows_affected (command); None when not kept
    pub first: Option<BatchRead>,
    /// rows read to the end (queries) or affected (writes); None while the last one streams
    pub row_count: Option<u64>,
}

/// Every statement that ran, the failed one included; the ones after it did not run.
pub struct ScriptSteps {
    pub steps: Vec<StepRun>,
    pub cursor: Option<Cursor>,       // only the last statement
    pub failure: Option<AppError>,    // message already says "comando N de M: …"
}

/// `reads[i]`: statement i may return rows (decides the `describe` of an empty result).
pub async fn run_steps<E: Engine>(
    engine: &E, pool: &Pool<E::Db>, statements: &[String], reads: &[bool],
    batch_size: usize, timeout_secs: u32, on_started: impl FnOnce(i64),
) -> Result<ScriptSteps, AppError>; // Err only before the first statement (pool, session id)

/// Same signature as today: all-or-error over run_steps, for the other callers.
pub async fn run_script<E: Engine>(/* … */) -> Result<ScriptRun, AppError>;
```

```ts
// SqlEditor.tsx
export type SqlEditorApi = {
  prepareRun: () => string;
  prepareExplain: () => string;
  format: () => void;
  /** finds `text` in the document and selects [origin + from, origin + to); false when gone */
  select: (text: string, from: number, to: number) => boolean;
};
```

### Modelos de dado

```rust
// domain/sql.rs (exportados ao TS pelo tauri-specta)
pub enum StepStatus { Done, Failed, Cancelled, NotRun }   // serde camelCase

pub struct ScriptStep {
    pub status: StepStatus,
    pub duration_ms: u32,
    /// [from, to) in UTF-16 code units of the executed text, for labels and highlight
    pub span: (u32, u32),
    /// returned (query) or affected (write); None while the last one still streams
    pub row_count: Option<u32>,
    /// Rows / Command as today; None when not kept (past the tab limit) or not run
    pub result: Option<StatementResult>,
}

pub struct ScriptOutcome {
    pub statement_count: u32,
    pub duration_ms: u32,
    pub steps: Vec<ScriptStep>,   // one per statement; after a failure, NotRun
    pub error: Option<AppError>,  // why it stopped; the step that failed has Failed/Cancelled
}
```

- `ScriptOutcome.result` sai. O último resultado passa a ser o `result` do último passo `Done`. Quem lia `outcome.result` (`useScriptRunner`, `summary`, `fakeBackend`, testes) passa a ler o último passo.
- Um resultado anterior truncado é `Rows { batch: { hasMore: true, … }, cursorId: null }`, e a contagem completa fica em `rowCount`. A combinação `hasMore` sem cursor quer dizer "rode este comando sozinho para ver todas as linhas".
- `StepStatus` vem do tipo do erro: `AppError::Cancelled` vira `Cancelled`, e qualquer outro erro (timeout incluído) vira `Failed`.
- Os textos dos comandos não voltam pela resposta, porque o front já tem o texto executado. Os rótulos e o realce são recortes dele pelo `span`. Isso evita mandar de volta um script grande (um dump de milhares de `INSERT`s) pelo IPC.

### Endpoints de API

São comandos Tauri, não HTTP:

| Comando | Mudança |
|---|---|
| `run_script(connection_id, run_id, sql, confirmed)` | Mesma assinatura. `RunResponse::Executed.outcome` ganha o formato novo. A falha de um comando vem em `outcome.error`, não como rejeição. Uma rejeição continua valendo para erros antes do primeiro comando (conexão, validação). |
| `export_query(connection_id, run_id, sql, path, statement)` | `statement: Option<u32>` novo. `None` mantém o comportamento de hoje (o último comando). |
| `fetch_more` e `close_cursor` | Sem mudança: só o último comando tem cursor. |

## Pontos de integração

Nenhum serviço externo. O banco é o de sempre. Duas consequências:

- **Timeout.** Para um comando anterior, ele cobre a leitura inteira (primeiro lote e contagem), como o `execute` de hoje. Para o último, continua valendo só até o primeiro lote. Num timeout, a conexão é descartada (`close_on_drop`), como já acontece.
- **Cancelamento.** Continua pelo `cancel_run`. O passo em execução vira `Cancelled`, os anteriores ficam `Done` com as grades, e os seguintes ficam `NotRun`.

## Estratégia de teste

**Unitário (Rust)**
- `split_spans` contra a tabela de casos do `split.rs`: o intervalo recorta exatamente o texto que `split` devolve, inclusive com `$tag$`, `DELIMITER` e comentários.
- Conversão de byte para UTF-16 com acentos e emoji.
- `StepStatus` derivado do `AppError`.
- O envoltório `run_script` continua "tudo ou erro" (os testes atuais).

**Use case (`use_cases/sql.rs`, SQLite real em arquivo, como os testes atuais)**
- `SELECT; UPDATE; SELECT` gera 3 passos, com grade no 1º e no 3º e contagem de afetadas no 2º.
- Erro no 2º de 4: passo 1 `Done` com grade, passo 2 `Failed` com a mensagem de `failed_at`, passos 3 e 4 `NotRun`. O histórico grava o erro.
- 25 `SELECT`s: 19 grades anteriores mais a última. Os outros passos têm `rowCount` e `result: None`.
- Anterior com mais de 1000 linhas: `hasMore` sem cursor e `rowCount` com o total.
- Uma escrita vazia não chama `describe` (contar as chamadas no adapter de teste, se ele existir; senão, cobrir na integração).

**Integração (testcontainers, Postgres e MySQL)**
- Cancelar no 2º comando de `SELECT 1; SELECT pg_sleep(10); SELECT 2`: o passo 1 fica `Done` e o 2 fica `Cancelled`.
- MySQL: um anterior grande, lido até o fim, devolve a conexão ao pool. É o mesmo cuidado do bug de stream não drenado, já coberto para o último comando.
- `export_query` com `statement` exporta todas as linhas do comando do meio.

**Front (Vitest + `fakeBackend`)**
- Com um comando, a tela é idêntica à de hoje (os testes atuais do editor continuam passando, só com o formato do outcome atualizado).
- Com vários comandos, há abas "Execução" e por resultado. Alt+PageDown e Alt+PageUp trocam de aba, e o nome acessível diz "comando 3 de 5, erro".
- Selecionar um passo chama `select(texto, span.0, span.1)`. Quando o documento mudou, nada é selecionado.
- O export da aba envia o `statement` certo.

**E2E**: não se aplica. O projeto não tem E2E ainda (PRD próprio, em `specs/prd-testes-e2e`).

## Sequenciamento

1. `split_spans` e testes. Não depende de nada.
2. `stream::run_steps` e o `run_script` como envoltório dele. Os chamadores atuais não mudam. Este passo bloqueia os seguintes.
3. `use_cases::run_script` montando os passos e o histórico. Regenerar `src/bindings.ts` (`cargo test`).
4. Front: adaptar `useScriptRunner`, `summary` e `fakeBackend` ao formato novo, ainda mostrando só o último (os testes atuais ficam verdes).
5. `ScriptResults` com abas, resumo e atalhos. `SqlEditorApi.select` e `prepareRun` com a posição.
6. `export_query` com `statement`, e o export por aba.

Os passos 1 a 4 entram juntos ou em sequência rápida, porque o formato da resposta muda dos dois lados.

## Observabilidade

O app não tem métricas nem log estruturado além do histórico. O histórico continua com uma entrada por script, e a mensagem de erro é a mesma de hoje (`failed_at`). Nada novo.

## Considerações técnicas

### Decisões principais

- **Primeiro lote mais contagem nos comandos anteriores, e cursor só no último.** Uma sessão mantém um único resultado aberto. As alternativas eram guardar até 50 000 linhas em memória ou reexecutar o comando sozinho para paginar. Foram descartadas: a primeira pela memória; a segunda porque os dados podem ter mudado e porque não serve para escrita com `RETURNING`. Decidido com o usuário. Ler até o fim para contar não custa nada a mais do que hoje.
- **Falha dentro do `ScriptOutcome`, não em `Err`.** O resultado parcial precisa chegar ao front, e um `AppError` com passos dentro misturaria erro e dado em todos os outros comandos. O `run_script` vira um envoltório "tudo ou erro" do `run_steps`, então nenhum dos ~15 chamadores muda. O tipo do erro sobrevive (`Cancelled` continua sendo `Cancelled`), como a decisão do M1 já exige.
- **Limite de 20 abas (19 anteriores mais o último).** Decidido com o usuário. O teto de memória fica em 20 × 1000 linhas. O último comando sempre tem grade, porque é o comportamento de hoje.
- **`describe` só para comando anterior classificado como leitura.** O use case calcula `reads` pelo guard e passa para baixo, porque o adapter não pode depender de `use_cases`. Um `SELECT` anterior com zero linhas mantém o cabeçalho. Uma escrita sem linhas não gasta uma ida extra ao banco. Sem essa regra, um script de 500 `INSERT`s faria 500 `describe`s, e por um túnel SSH isso dá dezenas de segundos. A classificação é a do guard (`sqlparser`), que já existe.
- **Intervalos em vez de texto na resposta.** O front tem o texto executado. Com o intervalo, ele monta o rótulo e o realce sem receber o script de volta. A conversão de byte para UTF-16 é feita no Rust, onde o texto está.
- **Realce pelo texto executado.** O editor procura o texto executado no documento e seleciona o trecho a partir dali. Se o usuário editou depois de rodar, ou se o texto era o resultado de preencher `:parâmetros`, nada é selecionado, em vez de selecionar o trecho errado. Por isso `prepareRun` e `onRun` não mudam. Teto conhecido: uma seleção cujo texto se repete antes no arquivo realça a primeira ocorrência.
- **Abas: Radix Tabs (`components/ui/tabs.tsx`).** As setas, o Home/End e a ligação entre aba e painel já vêm do Radix e já são usadas em `TableView`, `RedisView` e `CollectionView`. O atalho é Alt+PageDown/Alt+PageUp, porque Ctrl+Tab já troca as abas de trabalho (DESIGN.md, "Regiões e atalhos").

### Riscos conhecidos

- **Scripts com milhares de comandos** (restaurar um dump pelo editor) geram milhares de `ScriptStep`s. Cada passo é pequeno (sem texto), mas a lista do resumo precisa ser virtualizada, com o mesmo TanStack Virtual da grade.
- **Um único comando que devolve vários conjuntos de resultado** (`CALL` no MySQL): hoje só o primeiro aparece. Num comando anterior, a contagem soma todos os conjuntos. Continua fora de escopo e fica registrado.
- **Classificação errada pelo guard** (SQL que o parser não entende) decide só se roda o `describe`. No pior caso, um `SELECT` anterior vazio aparece como comando de 0 linhas, sem cabeçalho.
- **O formato da resposta muda dos dois lados ao mesmo tempo.** O CI já falha com `bindings.ts` desatualizado, então a divergência não passa despercebida.

### Conformidade com regras do projeto

O projeto não tem `CLAUDE.md` nem diretório de regras. As fontes são `docs/decisions.md`, `PRODUCT.md`, `DESIGN.md` e o README.

- Fluxo commands → use_cases → adapters, e `AppError` serializado com tag (decisions.md, Arquitetura Rust). Respeitado.
- `src/bindings.ts` gerado, nunca editado à mão (README). Regenerado no passo 3.
- Fidelidade dos valores: as grades anteriores usam o mesmo `Engine::batch`, com protocolo texto e `Cell`. Respeitado.
- Segurança: o guard e a confirmação rodam antes, sobre o script inteiro, sem mudança. O `export_query` com `statement` aplica a checagem de escrita aos comandos que vai rodar.
- Testes: adapters contra bancos reais, use cases sem mock de driver, cobertura ≥ 70% nos dois lados.
- Interface em pt-BR e "tabs internas" com sublinhado de 2px em `--select` (DESIGN.md).
- Comentários `ponytail:` onde houver corte com teto conhecido: o limite de 20 abas e o primeiro lote dos anteriores.
- Ao fechar a feature, registrar as decisões em `docs/decisions.md` ("Depois da v1") e corrigir a nota do M1 ("o resultado mostrado é o do último").

### Conformidade com skills disponíveis

- `tdd` e `testing-anti-patterns` nos testes do use case e do front (nada de testar o mock).
- `no-workarounds` para o caso MySQL de stream não drenado, que precisa da causa raiz, não de retry.
- `impeccable` para as abas e o resumo, seguindo o DESIGN.md.
- `feature-prints` para a PR.

### Arquivos relevantes

- `src-tauri/src/adapters/split.rs`, `dialect.rs`, `stream.rs`, `mod.rs`, `postgres/mod.rs`, `mysql/mod.rs`, `sqlite/mod.rs`, `*/integration_tests.rs`
- `src-tauri/src/domain/sql.rs`
- `src-tauri/src/use_cases/sql.rs` (`run_script`, `explain`, `alter_schema`), `use_cases/export.rs`
- `src-tauri/src/commands/sql.rs`, `commands/export.rs`
- `src/bindings.ts` (gerado)
- `src/features/editor/useScriptRunner.ts`, `SqlWorkspace.tsx`, `SqlEditor.tsx`, `ScriptResults.tsx` (novo), `editor.test.tsx`
- `src/features/results/*` (reuso, sem mudança esperada)
- `src/test/fakeBackend.ts`
- `docs/decisions.md`

## Histórico

**2026-10-27**. Documento criado.

**2026-10-27**. Ajustes ao detalhar as tasks:
- `run_steps` novo, com o `run_script` como envoltório "tudo ou erro", no lugar de `ScriptRun::into_result()`. Assim nenhum chamador muda.
- `reads: &[bool]`, calculado no use case, no lugar de `impl Fn`: o guard mora em `use_cases`.
- `select(text, from, to)` no editor, que acha o texto executado, no lugar de mudar o `prepareRun` e o `onRun`.
