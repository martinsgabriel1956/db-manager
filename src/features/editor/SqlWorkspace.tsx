import { useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import { Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SqlEditor, type SqlEditorApi } from "@/features/editor/SqlEditor";
import { useScriptRunner, type RunState } from "@/features/editor/useScriptRunner";
import { useCompletion } from "@/features/explorer/queries";
import { CellDetail } from "@/features/results/CellDetail";
import { ResultGrid, type SelectedCell } from "@/features/results/ResultGrid";

type SqlWorkspaceProps = {
  connectionId: string;
  connectionName: string;
  sql: string;
  onSqlChange: (sql: string) => void;
};

type ResultsPanelProps = {
  state: RunState;
  onLoadMore: () => void;
};

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
  connectionName,
  sql,
  onSqlChange
}: SqlWorkspaceProps) {
  const completion = useCompletion(connectionId);
  const runner = useScriptRunner(connectionId);
  const editorApi = useRef<SqlEditorApi | null>(null);
  const isRunning = runner.state.status === "running";

  function runFromEditor(text: string) {
    if (!isRunning) {
      runner.run(text);
    }
  }

  return (
    <Group orientation="vertical" className="h-full">
      <Panel defaultSize="45" minSize={80}>
        <div className="flex h-full flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-1.5">
            <h2 className="text-sm font-semibold">SQL · {connectionName}</h2>
            <span className="text-xs text-muted-foreground">
              Ctrl+Enter executa a seleção ou tudo
            </span>
            <div className="ml-auto flex gap-2">
              {isRunning ? (
                <Button size="sm" variant="destructive" onClick={runner.cancel}>
                  <Square /> Cancelar
                </Button>
              ) : (
                <Button
                  size="sm"
                  onClick={() => runFromEditor(editorApi.current?.textToRun() ?? sql)}
                >
                  <Play /> Executar
                </Button>
              )}
            </div>
          </div>
          <div className="min-h-0 flex-1">
            <SqlEditor
              value={sql}
              onChange={onSqlChange}
              onRun={runFromEditor}
              completion={completion.data}
              apiRef={editorApi}
            />
          </div>
        </div>
      </Panel>
      <Separator className="h-1 bg-border hover:bg-primary/40" />
      <Panel minSize={80}>
        {/* keyed per run so a stale cell selection never points into a new result */}
        <ResultsPanel
          key={runner.state.status === "idle" ? "idle" : runner.state.runId}
          state={runner.state}
          onLoadMore={runner.loadMore}
        />
      </Panel>
    </Group>
  );
}

function ResultsPanel({ state, onLoadMore }: ResultsPanelProps) {
  const [selected, setSelected] = useState<SelectedCell | null>(null);
  const text = summary(state);

  if (state.status === "idle") {
    return (
      <p className="p-3 text-sm text-muted-foreground">Execute uma query para ver o resultado.</p>
    );
  }
  if (state.status === "running") {
    return <p className="p-3 text-sm text-muted-foreground">Executando…</p>;
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
      <p role="status" className="border-b px-3 py-1 text-xs text-muted-foreground">
        {text}
      </p>
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
