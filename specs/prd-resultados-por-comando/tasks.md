# Tasks: Resultado de cada comando do script

PRD: [prd.md](prd.md) · Techspec: [techspec.md](techspec.md)

Este arquivo é efêmero: o `sdd-review` o apaga no fim.

**Branch:** `feat/resultados-por-comando`, criado a partir de `origin/main`. A branch atual (`fix/critica-ambiente-folhas`) já foi mergeada pela PR 48.

**Commits:** convenção do repositório, `tipo: descrição` em pt-BR (`feat:`, `fix:`, `docs:`, `chore:`), com a linha `Co-Authored-By` no fim.

**Verificação de cada task:**

```bash
cd src-tauri && cargo test && cargo clippy --all-targets -- -D warnings
pnpm typecheck && pnpm test
```

Os testes de integração pedem Docker.

O projeto não tem `CLAUDE.md` nem diretório de regras. As regras citadas abaixo vêm de `docs/decisions.md`, `DESIGN.md` e `README.md`.

---

## 0. Specs e skills SDD no repositório

**Escopo:** commitar `specs/` e `.claude/skills/sdd-*`.

**Contexto:** os documentos que guiam esta feature e as skills do pipeline ainda não estão em nenhum commit. O `.claude/launch.json` modificado não entra (não é desta feature).

**Skills:** nenhuma.

**Regras:** commit só do que é desta feature.

**Steps:**
1. `git fetch`, depois `git switch -c feat/resultados-por-comando origin/main`. As mudanças não commitadas vão junto.
2. `git add specs .claude/skills/sdd-*`.
3. Commit `docs: specs SDD das próximas features e skills do pipeline`.

**Teste:** `git show --stat` lista só `specs/` e `.claude/skills/sdd-*`.

---

## 1. Intervalo de cada comando no splitter

**Escopo:** `statement_spans` em `adapters/split.rs` e `Dialect::spans` em `dialect.rs`.

**Contexto:** techspec, "Intervalos em vez de texto na resposta". O front monta rótulos e realce recortando o texto executado. Para isso, o backend precisa dizer onde cada comando está nesse texto.

**Skills:** `tdd`.

**Regras:** o lexer continua um só (`split.rs`, decisão do M3). `split` mantém a saída idêntica para os chamadores atuais.

**Steps:**

`Splitter.statements` passa a guardar intervalos, e o recorte com trim continua no mesmo lugar:

```rust
// split.rs
statements: Vec<Range<usize>>,

fn finish_statement(&mut self, end: usize) {
    if self.has_code {
        let text = &self.sql[self.start..end];
        let from = self.start + (text.len() - text.trim_start().len());
        self.statements.push(from..end - (text.len() - text.trim_end().len()));
    }
    // … (resto igual)
}

/// Byte range of each statement in `sql`, trimmed: `&sql[range]` is what `split_statements` gives.
pub fn statement_spans(sql: &str, rules: SplitRules) -> Vec<Range<usize>> { /* o corpo atual de split_statements */ }

pub fn split_statements(sql: &str, rules: SplitRules) -> Vec<String> {
    statement_spans(sql, rules).into_iter().map(|range| sql[range].to_string()).collect()
}
```

```rust
// dialect.rs: o match vira `fn rules(self) -> SplitRules`, usado pelos dois
pub fn split(self, sql: &str) -> Vec<String> { split::split_statements(sql, self.rules()) }
pub fn spans(self, sql: &str) -> Vec<Range<usize>> { split::statement_spans(sql, self.rules()) }
```

**Teste:**
- Os testes de `split.rs` continuam verdes sem mudança.
- Um teste novo cobre, nas três regras: um script com `$tag$`, `DELIMITER $$`, trigger do SQLite, comentários e acentos. Para cada intervalo, `&sql[span] == split(sql)[i]`, e as fronteiras caem em limites de caractere (`sql.is_char_boundary`).

---

## 2. `run_steps`: todos os comandos com resultado, falha sem `Err`

**Escopo:** `stream::run_steps` e o `run_script` atual reescrito como envoltório dele; `run_steps` nos três adapters e em `SqlConnection`.

**Contexto:** techspec, "Primeiro lote mais contagem nos comandos anteriores, e cursor só no último" e "Falha dentro do `ScriptOutcome`". Hoje cada comando anterior roda por `execute`, que lê as linhas e as descarta. Passam a ser lidos pelo `read_batch`, contando o resto. O "tudo ou erro" dos outros chamadores (explain, alter_schema, export, sessions, schema_diff, backup) continua no `run_script`, sem mudar nenhum deles.

**Skills:** `tdd`, `no-workarounds` (a drenagem do MySQL precisa ser a causa raiz, como no bug do M3), `testing-anti-patterns`.

**Regras:**
- O timeout de um comando anterior cobre a leitura inteira, como o `execute` de hoje.
- Num timeout, `close_on_drop`.
- O tipo do erro sobrevive ao `failed_at` (decisão do M1).

**Steps:**

```rust
// stream.rs
/// Earlier statements keep their first batch for the UI up to this many; past it they only
/// count rows. The last one always keeps it, so 20 result tabs at most.
// ponytail: 20 × EDITOR_BATCH_SIZE rows held per run; lower it if memory ever shows up
pub const EARLIER_RESULTS_KEPT: usize = 19;

pub struct StepRun {
    pub duration: Duration,
    /// the first batch (or the affected rows of a command); None past the limit or on failure
    pub first: Option<BatchRead>,
    /// rows read to the end (query) or affected (write); None while the last one streams
    pub row_count: Option<u64>,
}

/// Every statement that ran, the failed one included; the ones after it did not run.
pub struct ScriptSteps {
    pub steps: Vec<StepRun>,
    pub cursor: Option<Cursor>,
    pub failure: Option<AppError>,
}
```

`run_steps(engine, pool, statements, reads: &[bool], batch_size, timeout_secs, on_started)`:
- Devolve `Err` só antes do primeiro comando (pool ou session id).
- Para cada comando anterior, chama `with_timeout(read_earlier(…))`. Uma falha empurra um `StepRun { first: None, row_count: None }` com a duração e devolve `Ok(ScriptSteps { failure: Some(failed_at(err, index, total)), cursor: None, .. })`.
- A grade de um comando anterior com colunas só fica (`first: Some`) enquanto `kept < EARLIER_RESULTS_KEPT`. Um comando sem colunas (command) sempre fica, porque é pequeno.
- O último comando segue como hoje (`stream_task` + `cursor.next()` + `describe` se vazio). `row_count` é `Some` quando `!has_more`.

```rust
/// An earlier statement: its first batch, then read to its end to count the rest (what
/// `execute` already did, minus keeping rows). Draining also releases MySQL connections.
async fn read_earlier<E: Engine>(
    engine: &E, conn: &mut PoolConnection<E::Db>, sql: &str, batch_size: usize, reads: bool,
) -> Result<(BatchRead, u64), AppError> {
    let mut stream = sqlx::raw_sql(AssertSqlSafe(sql.to_string())).fetch_many(&mut **conn).peekable();
    let mut first = read_batch(Pin::new(&mut stream), batch_size, engine).await?;
    let (mut rows, mut affected) = (first.batch.rows.len() as u64, first.rows_affected.unwrap_or(0));
    while let Some(item) = stream.next().await {
        match item? { Either::Right(_) => rows += 1, Either::Left(done) => affected = E::rows_affected(&done) }
    }
    drop(stream);
    // a write with no rows skips the round trip; a SELECT matching nothing keeps its header
    if reads && rows == 0 && first.batch.columns.is_empty() {
        first.batch.columns = engine.describe(sql).await;
    }
    let count = if first.batch.columns.is_empty() { affected } else { rows };
    Ok((first, count))
}
```

```rust
/// All-or-error, for callers that only want the last result (explain, schema changes, export…).
pub async fn run_script<E: Engine>(/* mesma assinatura de hoje */) -> Result<ScriptRun, AppError> {
    let run = run_steps(engine, pool, statements, &[], batch_size, timeout_secs, on_started).await?;
    if let Some(err) = run.failure { return Err(err); }
    let first = run.steps.into_iter().last().and_then(|step| step.first).ok_or_else(AppError::result_closed)?;
    Ok(ScriptRun { first, cursor: run.cursor })
}
```

Mudanças mecânicas:
- `run_steps` nos adapters Postgres, MySQL e SQLite, ao lado do `run_script`.
- `SqlConnection::run_steps` em `adapters/mod.rs` (macro `each!`).
- `AppError` ganha `Clone, PartialEq, Eq`, que vão ser necessários no domínio da task 3. Todas as variantes são `String`.

**Teste (integração, testcontainers):**
- **Postgres:** `run_steps(["SELECT 1", "SELECT g FROM generate_series(1,1500) g", "SELECT 2"])`. O passo 1 tem 1000 linhas, `has_more` e `row_count == 1500`; o último não tem cursor.
- **Postgres:** `["SELECT 1 WHERE false", "CREATE TEMP TABLE t(x int)", "SELECT 3"]` com `reads = [true, false, true]`. O 1º tem colunas e `row_count == 0`; o 2º não tem colunas.
- **Postgres, cancelamento:** cancelar no 2º comando de `SELECT 1; SELECT pg_sleep(10); SELECT 2`, no molde do teste de cancelamento atual. Resultado: 2 passos e `failure` `Cancelled` com "comando 2 de 3".
- **Postgres:** 25 × `SELECT 1`. Os passos de 0 a 18 têm `first`, os de 19 a 23 não têm, e o 24 (o último) tem.
- **MySQL:** um script com 4× o tamanho do pool de comandos anteriores grandes, seguido de outro script. A conexão volta ao pool e não trava (regressão do M3).
- **SQLite:** um `UPDATE` anterior traz `row_count` com as linhas afetadas.
- Os testes atuais que usam `run_script` continuam verdes sem mudança.

---

## 3. `ScriptOutcome` por passo, use case e front no formato novo

**Escopo:** domínio (`ScriptStep`, `StepStatus`, novo `ScriptOutcome`), `use_cases::run_script` montando os passos, `bindings.ts` regenerado e o front adaptado sem mudança visível.

**Contexto:** techspec, "Modelos de dado". O formato da resposta muda nos dois lados. Esta task deixa tudo verde ainda mostrando só o último resultado, e as abas vêm na task 5.

**Skills:** `tdd`, `testing-anti-patterns`.

**Regras:**
- `src/bindings.ts` é gerado (`cargo test`), nunca editado à mão.
- O histórico grava o erro do script como hoje (`failed_at`).

**Steps:**

```rust
// domain/sql.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum StepStatus { Done, Failed, Cancelled, NotRun }

#[derive(Debug, Clone, PartialEq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ScriptStep {
    pub status: StepStatus,
    pub duration_ms: u32,
    /// [from, to) in UTF-16 code units of the executed text
    pub span: (u32, u32),
    pub row_count: Option<u32>,
    pub result: Option<StatementResult>,
}

pub struct ScriptOutcome { pub statement_count: u32, pub duration_ms: u32, pub steps: Vec<ScriptStep>, pub error: Option<AppError> }

impl ScriptOutcome {
    /// One statement run as a command (schema changes).
    pub fn command(duration_ms: u32, sql: &str) -> Self;
    /// The last statement's result, for callers and tests that ran one statement.
    pub fn into_last(self) -> Option<StatementResult>;
}
```

`use_cases::run_script`:

```rust
let spans = dialect.spans(sql);
let statements: Vec<String> = spans.iter().map(|span| sql[span.clone()].to_string()).collect();
// … guard e confirmação iguais …
let reads: Vec<bool> = statements.iter().map(|s| !guard::classify(s, dialect).writes).collect();
let result = connection.sql()?.run_steps(&statements, &reads, EDITOR_BATCH_SIZE, |pid| …).await;
registry.finish_run(run_id);
let error = match &result { Ok(run) => run.failure.as_ref(), Err(err) => Some(err) };
record(history, connection_id, &connection, sql, duration_ms, error).await;
let run = result?;
// cursor do último comando sob run_id, como hoje
let steps = script_steps(run.steps, run.failure.as_ref(), &utf16_spans(sql, &spans), cursor_id);
```

```rust
/// One step per statement: the failed one marked by the error's kind, the rest NotRun.
fn script_steps(ran: Vec<StepRun>, failure: Option<&AppError>, spans: &[(u32, u32)], cursor_id: Option<&str>) -> Vec<ScriptStep>;

/// The is_command split that run_script does today, moved out to serve every step.
fn statement_result(first: BatchRead, cursor_id: Option<&str>) -> StatementResult;

/// Byte ranges as UTF-16 offsets (what the editor counts), in one pass: spans come in order.
fn utf16_spans(sql: &str, spans: &[Range<usize>]) -> Vec<(u32, u32)>;
```

Mudanças mecânicas:
- `alter_schema` passa a usar `ScriptOutcome::command(duration_ms, &format!("{statement};"))`.
- Os testes que leem `outcome.result` (`use_cases/sql.rs`, `backup.rs`, `import.rs`) passam para `outcome.into_last().unwrap()`.

Front:
- `useScriptRunner.ts`: o estado `error` ganha `outcome?: ScriptOutcome`. Com `outcome.error`, o estado é `{ status: "error", message: errorMessage(outcome.error), outcome }`. Sem erro, `rows` ou `command` saem de `outcome.steps.at(-1)!.result!`, como hoje saem de `outcome.result`.
- `src/test/fakeBackend.ts`: um helper `scriptOutcome(results: StatementResult[], durationMs = 1)` monta um passo `done` por resultado, com spans sequenciais. `rowsOutcome` e os outros passam a usá-lo.
- `editor.test.tsx` e `valuePanel.test.tsx` passam para o helper.

**Teste (use case, Postgres do container, como os atuais):**
- `SELECT 1; CREATE TEMP TABLE t AS SELECT 1 x; SELECT 'é' AS s` devolve 3 passos `done`. O 2º é `Command`, o 3º tem o cursor `None`, e `span` está em UTF-16. Um caso com emoji antes do comando confere a conversão.
- `SELECT 1; SELECT FROMM; SELECT 2` devolve `done`, `failed` e `notRun`. `outcome.error` traz "comando 2 de 3: …", e o histórico grava essa mesma mensagem.
- `utf16_spans` em unidade: ASCII, acentos (2 bytes, 1 unidade) e emoji (4 bytes, 2 unidades).
- No front, os testes atuais passam com o formato novo. Um teste novo: um script que falha no 2º de 3 mostra a mensagem do erro, como hoje.

---

## 4. Export de um comando do script

**Escopo:** `export_query(…, statement: Option<u32>)` no use case, no comando Tauri e no front.

**Contexto:** PRD F4 (requisito 13) e techspec "Endpoints". O export reexecuta o script. Com `statement`, ele roda só até esse comando, que vira o último e sai inteiro em streaming. Vem antes da UI para que as abas já nasçam com export.

**Skills:** `tdd`.

**Regras:** o export nunca escreve (`guard::classify` nos comandos que vai rodar), e grava `.part` + rename (M6).

**Steps:**

```rust
// use_cases/export.rs
pub async fn export_query(registry, history, connection_id, run_id, sql, path, statement: Option<u32>) -> … {
    let mut statements = dialect.split(sql);
    if let Some(index) = statement {
        let keep = index as usize + 1;
        if keep > statements.len() { return Err(AppError::validation("comando fora do script")); }
        statements.truncate(keep);
    }
    // checagem de escrita e export_csv iguais, sobre `statements`
}
```

- O comando em `commands/export.rs` repassa `statement`.
- No front, `ExportButton` em `SqlWorkspace` passa `null` por enquanto (o mesmo comportamento de hoje).

**Teste:**
- Use case (Postgres): `SELECT g FROM generate_series(1,1500) g; SELECT 1` com `statement: Some(0)` gera um CSV com 1500 linhas e cabeçalho `g`.
- `Some(5)` num script de 2 comandos dá erro de validação.
- `None` mantém o teste atual.

---

## 5. Abas de resultado e resumo da execução

**Escopo:** `features/editor/ScriptResults.tsx` (novo) e a extração de `RowsView` do `ResultsPanel`.

**Contexto:**
- PRD F1, F2 e F3, e a seção Experiência.
- Techspec: Radix Tabs, Alt+PageDown/PageUp e limite de 20 abas (que já chega pronto do backend).
- Os comandos anteriores truncados chegam com `hasMore` e sem cursor.

**Skills:** `impeccable` (abas e resumo seguindo o DESIGN.md), `tdd`, `testing-anti-patterns`.

**Regras:**
- DESIGN.md: "Tabs internas" com sublinhado de 2px em `--select`, linhas de 28px, tabular-nums, e Ctrl+Tab reservado às abas de trabalho.
- Interface em pt-BR.
- O status nunca é sinalizado só por cor.

**Steps:**

`RowsView`: o bloco de grade de hoje sai do `ResultsPanel` sem mudar o comportamento. Ele inclui a barra com Receipt, DetailToggle, CopyRowsMenu e ExportButton, o `loadError`, o `CellDetail` e o `ResultGrid`. O estado `selected` e o `useCellDetail` vão junto.

```tsx
type RowsViewProps = {
  connectionId: string;
  sql: string;
  columns: ResultColumn[];
  rows: Cell[][];
  hasMore: boolean;            // false for a truncated earlier result
  loadingMore: boolean;
  loadError: string | null;
  onLoadMore: () => void;
  /** "Mostrando 1000 de 1500 linhas…" on an earlier result that kept only its first batch */
  notice: string | null;
  /** which statement the export re-runs up to; null = the last one */
  exportStatement: number | null;
  receipt: ReactNode;
};
```

`ScriptResults`:

```tsx
type ScriptResultsProps = {
  connectionId: string;
  sql: string;                      // the executed text, sliced by each step's span
  outcome: ScriptOutcome;
  /** the live last result (rows paged through the cursor), when the script finished */
  last: Extract<SettledRun, { status: "rows" }> | null;
  onLoadMore: () => void;
  onSelectStatement: (from: number, to: number) => void;
  receipt: ReactNode;
};
```

Comportamento:
- **Abas.** `Execução` vem primeiro, e depois uma aba por passo com `result.kind === "rows"`. O rótulo é `N · <início do comando>` (primeira linha, até 40 caracteres) e o `aria-label` é `comando N de M, <status>`.
- **Aba inicial.** É a do último comando com linhas. Com erro, ou se nenhum comando devolveu linhas, é `Execução`.
- **Atalho.** O `onKeyDown` na raiz das Tabs troca de aba com Alt+PageDown/Alt+PageUp, em ciclo.
- **Resumo.** Uma lista virtualizada (o `@tanstack/react-virtual` que já existe) com uma linha de 28px por passo:
  - colunas: nº, comando (1ª linha, truncada, com o texto inteiro no `title`), status em texto, linhas e ms;
  - status: "concluído", "erro", "cancelado", "não executado";
  - linhas: `N linhas afetadas`, `N linhas`, `1000 de N` ou `N+`;
  - o passo com falha mostra `outcome.error` logo abaixo, em `text-destructive`, com `role="alert"`;
  - ativar um passo (Enter ou clique) chama `onSelectStatement(span)` e, se o passo tem aba, vai para ela.
- **Aba do último comando.** Usa `last` (com cursor e "carregar mais"). As anteriores usam `step.result.batch` com `hasMore = false`, `notice` quando truncadas e `exportStatement = índice`.
- **No `ResultsPanel`.** Se o estado tem `outcome` e `statementCount > 1`, renderiza `ScriptResults`. Isso vale para `rows`, `command` e `error` com `outcome`. Com um comando só, a tela é a de hoje.
- **Texto do Receipt.** `summary()` troca "· N comandos (resultado do último)" por "· N comandos". Para um erro com `outcome`, o texto é "Parou no comando K de N".
- **Por enquanto.** `onSelectStatement` é um no-op até a task 6.

**Teste (Vitest + fakeBackend):**
- Um script de 3 comandos (rows, command, rows) mostra as abas "Execução", "1 · …" e "3 · …". A aba ativa é a 3, e o Alt+PageUp leva à 1.
- Uma falha no 2º de 3: a aba ativa é "Execução", a linha 2 diz "erro" e mostra a mensagem, e a linha 3 diz "não executado".
- Um anterior truncado mostra "Mostrando 1000 de 1500 linhas" e não tem "carregar mais".
- O export na aba 1 chama `exportQuery(…, 0)`.
- Um script de 1 comando: os testes atuais do editor passam sem mudança de expectativa.
- Acessibilidade: `getByRole("tab", { name: /comando 2 de 3, erro/ })`.

---

## 6. Realce do comando no editor

**Escopo:** `SqlEditorApi.select(text, from, to)`, ligado ao `onSelectStatement`.

**Contexto:** PRD, requisito 8. O techspec previa mudar o `prepareRun`. A versão mais simples procura o texto executado no documento e seleciona `[origem + from, origem + to)`. Se o texto não está mais lá (o usuário editou depois de rodar, ou o texto era o resultado de preencher parâmetros), nada é selecionado.

**Skills:** `tdd`.

**Regras:** não mover o foco para o editor. A seleção aparece com o editor desfocado.

**Steps:**

```ts
// SqlEditor.tsx, dentro de apiRef.current
select: (text, from, to) => {
  // ponytail: first occurrence; a run selection repeated earlier in the file highlights the first one
  const origin = view.state.doc.toString().indexOf(text);
  if (origin < 0) return false;
  view.dispatch({ selection: EditorSelection.range(origin + from, origin + to), scrollIntoView: true });
  return true;
}
```

No `SqlWorkspace`, o handler passa a ser `onSelectStatement={(from, to) => editorApi.current?.select(lastSql, from, to)}`.

**Teste:**
- Com o documento `"SELECT 1;\nSELECT 2;"`, `select(doc, 10, 19)` seleciona `SELECT 2;`.
- Com o texto ausente, o retorno é `false` e a seleção não muda.
- No `SqlWorkspace`, ativar o passo 2 do resumo seleciona o trecho dele.

---

## 7. Registrar as decisões

**Escopo:** `docs/decisions.md` e o índice `specs/README.md`.

**Contexto:** o techspec manda registrar as decisões ao fechar a feature. A nota do M1 fica desatualizada.

**Skills:** nenhuma.

**Regras:** o decisions.md é a fonte de verdade técnica. As entradas novas vão em "Depois da v1", no mesmo tom das outras.

**Steps:**
- Nova entrada "Resultado de cada comando do script" em "Depois da v1". Ela cobre:
  - comandos anteriores com o primeiro lote mais a contagem, e cursor só no último (uma sessão, um resultado aberto);
  - limite de 20 abas;
  - falha dentro do `ScriptOutcome`, com `run_script` como envoltório "tudo ou erro";
  - `describe` só em leitura;
  - intervalos em UTF-16 e realce pelo texto;
  - export por comando.
- A nota do M1 "o resultado mostrado é o do último" passa a remeter à entrada nova.
- `specs/README.md`: a feature fica em "em tasks". O `sdd-review` marca "implementado".

**Teste:** leitura. Os links e os termos batem com o código.
