import { useRef, useState, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { AlignLeft, ChevronDown, ListTree, Play, Square } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { commands, type Engine } from "@/bindings";
import { Receipt } from "@/components/Receipt";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { ConnectionContext } from "@/features/connections/ConnectionContext";
import { SqlEditor, type SqlEditorApi } from "@/features/editor/SqlEditor";
import { ParamsDialog } from "@/features/editor/ParamsDialog";
import { RowsView } from "@/features/editor/RowsView";
import { ScriptResults } from "@/features/editor/ScriptResults";
import {
  findParams,
  paramValue,
  type FoundParams,
  type ParamInput
} from "@/features/editor/params";
import {
  useScriptRunner,
  type ExplainMode,
  type RunState
} from "@/features/editor/useScriptRunner";
import { connected, useCompletion } from "@/features/explorer/queries";
import { PlanView } from "@/features/results/PlanView";
import { errorMessage } from "@/lib/errors";
import { EXPLAIN_SHORTCUT, FORMAT_SHORTCUT, RUN_SHORTCUT } from "@/lib/platform";

type SqlWorkspaceProps = {
  connectionId: string;
  engine: Engine;
  defaultSchema: string;
  sql: string;
  onSqlChange: (sql: string) => void;
  /** the `:name` values last used in this tab, offered again the next time */
  params: Record<string, ParamInput>;
  onParamsChange: (params: Record<string, ParamInput>) => void;
  autoFocus?: boolean;
};

/** SQL with placeholders, waiting for their values before it runs or is explained. */
type ParamRequest = { found: FoundParams; explain: ExplainMode | null };

type ResultsPanelProps = {
  connectionId: string;
  /** the script behind the result, re-run in full by the export */
  sql: string;
  state: RunState;
  engine: Engine;
  onLoadMore: () => void;
  /** a statement picked in a script's summary: [from, to) of `sql` */
  onSelectStatement: (from: number, to: number) => void;
  /** an earlier run's result, under a cancelled one: it must not read as what just ran */
  superseded?: boolean;
};

type WaitingPaneProps = { title: string; children: ReactNode };

export function summary(state: RunState): string | null {
  if (state.status === "plan") {
    // ANALYZE ran the statement: the receipt says so
    const analyzed = state.plan.root.actualRows !== null ? " com ANALYZE · a instrução rodou" : "";
    return `Plano de execução${analyzed} · ${state.plan.durationMs} ms`;
  }
  if (state.status === "error" && state.outcome) {
    const { steps, durationMs } = state.outcome;
    const at = steps.findIndex(step => step.status === "failed" || step.status === "cancelled");
    return `Parou no comando ${at + 1} de ${steps.length} · ${durationMs} ms`;
  }
  if (state.status !== "rows" && state.status !== "command") {
    return null;
  }
  const { statementCount, durationMs } = state.outcome;
  const statements = statementCount > 1 ? ` · ${statementCount} comandos` : "";
  if (state.status === "command") {
    const noun = state.rowsAffected === 1 ? "linha afetada" : "linhas afetadas";
    return `Comando executado · ${state.rowsAffected} ${noun} · ${durationMs} ms${statements}`;
  }
  const more = state.hasMore ? "+" : "";
  // "retornada", not a bare "linha": after a confirmed write, rows read back must not pass for rows written
  const noun = state.rows.length === 1 && !state.hasMore ? "linha retornada" : "linhas retornadas";
  return `${state.rows.length}${more} ${noun} · ${durationMs} ms${statements}`;
}

export function SqlWorkspace({
  connectionId,
  engine,
  defaultSchema,
  sql,
  onSqlChange,
  params,
  onParamsChange,
  autoFocus = false
}: SqlWorkspaceProps) {
  const completion = useCompletion(connectionId);
  const runner = useScriptRunner(connectionId);
  const editorApi = useRef<SqlEditorApi | null>(null);
  const [lastSql, setLastSql] = useState("");
  // why the last format changed nothing; gone with the next edit
  const [formatError, setFormatError] = useState<string | null>(null);
  const [paramRequest, setParamRequest] = useState<ParamRequest | null>(null);
  const [paramError, setParamError] = useState<string | null>(null);
  const [filling, setFilling] = useState(false);
  const isRunning = runner.state.status === "running";

  /** the export re-runs `lastSql`: with placeholders, that is the filled text */
  function execute(text: string, explain: ExplainMode | null) {
    if (explain) {
      runner.run(text, false, explain);
    } else {
      setLastSql(text);
      runner.run(text);
    }
  }

  function start(text: string, explain: ExplainMode | null) {
    if (isRunning || text.trim() === "") {
      return;
    }
    const found = findParams(text, engine);
    if (found.names.length === 0) {
      execute(text, explain);
      return;
    }
    setParamError(null);
    setParamRequest({ found, explain });
  }

  async function fill(values: Record<string, ParamInput>) {
    if (!paramRequest) {
      return;
    }
    onParamsChange({ ...params, ...values });
    setFilling(true);
    try {
      const { found, explain } = paramRequest;
      const filled = await connected(connectionId, () =>
        commands.fillParams(
          connectionId,
          found.parts,
          found.names.map(name => paramValue(values[name]))
        )
      );
      setParamRequest(null);
      execute(filled, explain);
    } catch (error) {
      setParamError(errorMessage(error));
    } finally {
      setFilling(false);
    }
  }

  function runFromEditor(text: string) {
    start(text, null);
  }

  function explainFromEditor(text: string, analyze = false) {
    start(text, { analyze });
  }

  const explainText = () => editorApi.current?.prepareExplain() ?? sql;

  return (
    <div className="flex h-full flex-col">
      {/* the same view header as tables and collections: title left, connection and action right */}
      {/* wraps rather than clips (zoomed in, the actions drop to a second line, flush right) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-foreground bg-background px-4 py-2">
        <h2 className="display-caps text-[1.75rem] leading-[1.15]">SQL</h2>
        <span className="hidden text-xs text-muted-foreground min-[1100px]:inline">
          {RUN_SHORTCUT} executa a seleção ou tudo
        </span>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-4 gap-y-1">
          <ConnectionContext connectionId={connectionId} />
          {formatError && (
            <span
              role="alert"
              className="max-w-96 truncate text-xs text-destructive"
              title={formatError}
            >
              Não formatado: {formatError}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            title={`${FORMAT_SHORTCUT} formata a seleção ou tudo`}
            onClick={() => editorApi.current?.format()}
          >
            <AlignLeft /> Formatar
          </Button>
          <div className="flex">
            <Button
              size="sm"
              variant="outline"
              disabled={isRunning}
              title={`${EXPLAIN_SHORTCUT} explica a seleção ou a instrução sob o cursor`}
              onClick={() => explainFromEditor(explainText())}
            >
              <ListTree /> Explicar
            </Button>
            {/* only Postgres reports ANALYZE as JSON; it runs the statement, so no shortcut */}
            {engine === "postgres" && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isRunning}
                    aria-label="Mais formas de explicar"
                    className="-ml-px px-1.5"
                  >
                    <ChevronDown />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => explainFromEditor(explainText(), true)}>
                    Explicar com ANALYZE (executa a instrução)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {isRunning ? (
            <Button size="sm" variant="outline" onClick={runner.cancel}>
              <Square /> Cancelar
            </Button>
          ) : (
            <Button
              size="sm"
              title={`${RUN_SHORTCUT} executa a seleção ou tudo`}
              onClick={() => runFromEditor(editorApi.current?.prepareRun() ?? sql)}
            >
              <Play /> Executar
            </Button>
          )}
        </div>
      </div>
      <Group orientation="vertical" className="min-h-0 flex-1">
        <Panel defaultSize="45" minSize={80}>
          <SqlEditor
            value={sql}
            onChange={text => {
              setFormatError(null);
              onSqlChange(text);
            }}
            onRun={runFromEditor}
            onFormatted={setFormatError}
            onExplain={explainFromEditor}
            completion={completion.data}
            engine={engine}
            defaultSchema={defaultSchema}
            apiRef={editorApi}
            autoFocus={autoFocus}
          />
        </Panel>
        {/* 1px line with a 9px grab area; focused it thickens to 3px without moving the panels */}
        <Separator
          aria-label="Altura do editor"
          className="relative h-px bg-border outline-none after:absolute after:inset-x-0 after:-inset-y-1 hover:bg-primary/40 focus-visible:bg-ring focus-visible:shadow-[0_0_0_1px_var(--ring)] data-[separator=active]:bg-primary/40"
        />
        <Panel minSize={80}>
          {/* keyed per run so a stale cell selection never points into a new result */}
          <ResultsPanel
            key={runner.state.status === "idle" ? "idle" : runner.state.runId}
            connectionId={connectionId}
            sql={lastSql}
            state={runner.state}
            engine={engine}
            onLoadMore={runner.loadMore}
            onSelectStatement={(from, to) => editorApi.current?.select(lastSql, from, to)}
          />
        </Panel>
      </Group>
      {paramRequest && (
        <ParamsDialog
          connectionId={connectionId}
          found={paramRequest.found}
          remembered={params}
          error={paramError}
          pending={filling}
          onSubmit={fill}
          onCancel={() => setParamRequest(null)}
        />
      )}
      <ConfirmDialog
        connectionId={connectionId}
        confirmation={runner.state.status === "confirm" ? runner.state.confirmation : null}
        confirmLabel="Executar mesmo assim"
        onConfirm={runner.confirm}
        onCancel={runner.dismiss}
      />
    </div>
  );
}

/** The results area while nothing can be shown yet: the same grid paper as the idle state. */
function WaitingPane({ title, children }: WaitingPaneProps) {
  return (
    <div
      role="status"
      className="grid h-full content-center justify-items-start gap-2 px-8 grid-paper"
    >
      <p className="display-caps text-3xl">{title}</p>
      <p className="max-w-[52ch] text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

function ResultsPanel({
  connectionId,
  sql,
  state,
  engine,
  onLoadMore,
  onSelectStatement,
  superseded = false
}: ResultsPanelProps) {
  const result = summary(state);
  const text = superseded && result ? `Resultado anterior · ${result}` : result;
  // the receipt belongs to the run that just happened, never to the one kept under a cancel
  const confirmed = "confirmed" in state && state.confirmed && !superseded;

  if (state.status === "idle") {
    return (
      <div className="grid h-full content-center justify-items-start gap-2 px-8 grid-paper">
        <p aria-hidden className="display-caps text-3xl">
          Sem resultado
        </p>
        <p className="text-sm text-muted-foreground">Execute uma query para ver o resultado.</p>
      </div>
    );
  }
  if (state.status === "running") {
    return (
      <WaitingPane title="Executando…">
        {/* SQLite has no real cancel, only the connection timeout */}
        {engine === "sqlite"
          ? "O SQLite não cancela uma query em andamento: ela para no timeout da conexão."
          : "Cancelar, no topo, interrompe a query no próprio banco."}
      </WaitingPane>
    );
  }
  if (state.status === "confirm") {
    return (
      <WaitingPane title="Aguardando confirmação…">
        Nada rodou ainda: o comando só vai ao banco depois que você confirmar.
      </WaitingPane>
    );
  }
  if (state.status === "cancelled") {
    if (!state.previous) {
      return (
        <WaitingPane title="Execução cancelada">
          Nada rodou no banco. Execute de novo quando quiser.
        </WaitingPane>
      );
    }
    return (
      <div className="flex h-full flex-col">
        <p
          role="status"
          className="flex flex-wrap items-baseline gap-x-2 border-b border-foreground bg-background px-3 py-1.5 text-sm"
        >
          <span className="legend text-[0.75rem]">Execução cancelada</span>{" "}
          <span>Nada rodou no banco.</span>
        </p>
        <div className="min-h-0 flex-1">
          <ResultsPanel
            connectionId={connectionId}
            sql={sql}
            state={state.previous}
            engine={engine}
            onLoadMore={onLoadMore}
            onSelectStatement={onSelectStatement}
            superseded
          />
        </div>
      </div>
    );
  }
  const outcome = "outcome" in state ? state.outcome : undefined;
  if (outcome && outcome.statementCount > 1) {
    return (
      <ScriptResults
        connectionId={connectionId}
        sql={sql}
        outcome={outcome}
        last={state.status === "rows" ? state : null}
        onLoadMore={onLoadMore}
        onSelectStatement={onSelectStatement}
        receipt={<Receipt connectionId={connectionId} confirmed={confirmed} text={text} />}
        muted={!confirmed}
      />
    );
  }
  if (state.status === "error") {
    return (
      <p role="alert" className="p-3 font-mono text-sm whitespace-pre-wrap text-destructive">
        {state.message}
      </p>
    );
  }
  if (state.status === "plan") {
    return (
      <PlanView
        plan={state.plan}
        header={
          <div
            role="status"
            className={`flex min-w-0 items-center gap-2 ${confirmed ? "" : "text-muted-foreground"}`}
          >
            <Receipt connectionId={connectionId} confirmed={confirmed} text={text} />
          </div>
        }
      />
    );
  }
  if (state.status === "command") {
    return (
      <div
        role="status"
        className="@container flex flex-wrap items-center gap-x-2 gap-y-1 p-3 text-sm"
      >
        <Receipt connectionId={connectionId} confirmed={confirmed} text={text} />
      </div>
    );
  }

  return (
    <RowsView
      connectionId={connectionId}
      sql={sql}
      columns={state.columns}
      rows={state.rows}
      hasMore={state.hasMore}
      loadingMore={state.loadingMore}
      loadError={state.loadError}
      onLoadMore={onLoadMore}
      notice={null}
      exportStatement={null}
      receipt={<Receipt connectionId={connectionId} confirmed={confirmed} text={text} />}
      muted={!confirmed}
    />
  );
}
