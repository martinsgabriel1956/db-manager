import { useRef, useState, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Play, Square } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { commands, type Engine } from "@/bindings";
import { Button } from "@/components/ui/button";
import { ConnectionContext } from "@/features/connections/ConnectionContext";
import { SqlEditor, type SqlEditorApi } from "@/features/editor/SqlEditor";
import { useScriptRunner, type RunState } from "@/features/editor/useScriptRunner";
import { ExportButton } from "@/features/export/ExportButton";
import { connected, useCompletion } from "@/features/explorer/queries";
import { CellDetail } from "@/features/results/CellDetail";
import { ResultGrid, type SelectedCell } from "@/features/results/ResultGrid";
import { RUN_SHORTCUT } from "@/lib/platform";

type SqlWorkspaceProps = {
  connectionId: string;
  engine: Engine;
  defaultSchema: string;
  sql: string;
  onSqlChange: (sql: string) => void;
};

type ResultsPanelProps = {
  connectionId: string;
  /** the script behind the result, re-run in full by the export */
  sql: string;
  state: RunState;
  engine: Engine;
  onLoadMore: () => void;
};

type WaitingPaneProps = { title: string; children: ReactNode };

export function summary(state: RunState): string | null {
  if (state.status !== "rows" && state.status !== "command") {
    return null;
  }
  const { statementCount, durationMs } = state.outcome;
  const statements =
    statementCount > 1 ? ` · ${statementCount} comandos (resultado do último)` : "";
  if (state.status === "command") {
    const noun = state.rowsAffected === 1 ? "linha afetada" : "linhas afetadas";
    return `Comando executado · ${state.rowsAffected} ${noun} · ${durationMs} ms${statements}`;
  }
  const more = state.hasMore ? "+" : "";
  const noun = state.rows.length === 1 && !state.hasMore ? "linha" : "linhas";
  return `${state.rows.length}${more} ${noun} · ${durationMs} ms${statements}`;
}

export function SqlWorkspace({
  connectionId,
  engine,
  defaultSchema,
  sql,
  onSqlChange
}: SqlWorkspaceProps) {
  const completion = useCompletion(connectionId);
  const runner = useScriptRunner(connectionId);
  const editorApi = useRef<SqlEditorApi | null>(null);
  const [lastSql, setLastSql] = useState("");
  const isRunning = runner.state.status === "running";

  function runFromEditor(text: string) {
    if (!isRunning) {
      setLastSql(text);
      runner.run(text);
    }
  }

  return (
    <div className="flex h-full flex-col">
      {/* the same view header as tables and collections: title left, connection and action right */}
      <div className="flex items-center gap-4 border-b border-foreground bg-background px-4 py-2">
        <h2 className="display-caps text-[1.75rem] leading-[1.15]">SQL</h2>
        <span className="hidden text-xs text-muted-foreground min-[1100px]:inline">
          {RUN_SHORTCUT} executa a seleção ou tudo
        </span>
        <div className="ml-auto flex min-w-0 items-center gap-4">
          <ConnectionContext connectionId={connectionId} />
          {isRunning ? (
            <Button size="sm" variant="outline" onClick={runner.cancel}>
              <Square /> Cancelar
            </Button>
          ) : (
            <Button
              size="sm"
              title={`${RUN_SHORTCUT} executa a seleção ou tudo`}
              onClick={() => runFromEditor(editorApi.current?.textToRun() ?? sql)}
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
            onChange={onSqlChange}
            onRun={runFromEditor}
            completion={completion.data}
            engine={engine}
            defaultSchema={defaultSchema}
            apiRef={editorApi}
          />
        </Panel>
        {/* 1px line with a 9px grab area; focused it thickens to 3px without moving the panels */}
        <Separator className="relative h-px bg-border outline-none after:absolute after:inset-x-0 after:-inset-y-1 hover:bg-primary/40 focus-visible:bg-ring focus-visible:shadow-[0_0_0_1px_var(--ring)] data-[separator=active]:bg-primary/40" />
        <Panel minSize={80}>
          {/* keyed per run so a stale cell selection never points into a new result */}
          <ResultsPanel
            key={runner.state.status === "idle" ? "idle" : runner.state.runId}
            connectionId={connectionId}
            sql={lastSql}
            state={runner.state}
            engine={engine}
            onLoadMore={runner.loadMore}
          />
        </Panel>
      </Group>
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

function ResultsPanel({ connectionId, sql, state, engine, onLoadMore }: ResultsPanelProps) {
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const text = summary(state);

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
  if (state.status === "error") {
    return (
      <p role="alert" className="p-3 font-mono text-sm whitespace-pre-wrap text-destructive">
        {state.message}
      </p>
    );
  }
  if (state.status === "command") {
    return (
      <p role="status" className="p-3 text-sm">
        {text}
      </p>
    );
  }

  const selectedCell = selected && state.rows[selected.row]?.[selected.column];
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b bg-muted px-3 py-1">
        <p role="status" className="text-xs text-muted-foreground">
          {text}
        </p>
        <div className="ml-auto">
          <ExportButton
            baseName="resultado"
            formats={[
              {
                id: "csv",
                label: "CSV",
                extension: "csv",
                run: (path, runId) =>
                  connected(connectionId, () =>
                    commands.exportQuery(connectionId, runId, sql, path)
                  )
              }
            ]}
          />
        </div>
      </div>
      {state.loadError && (
        <p role="alert" className="border-b px-3 py-1 text-sm text-destructive">
          {state.loadError}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          <ResultGrid
            columns={state.columns}
            rows={state.rows}
            hasMore={state.hasMore}
            isLoadingMore={state.loadingMore}
            onLoadMore={onLoadMore}
            selected={selected}
            onSelect={setSelected}
            readOnlyHint="Resultado de query: somente leitura; para editar, abra a tabela"
          />
        </div>
        {selected && selectedCell && (
          <CellDetail
            column={state.columns[selected.column]}
            cell={selectedCell}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
    </div>
  );
}
