import { useState } from "react";
import { Play, Square } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { DocumentCard } from "@/features/mongo/DocumentCard";
import { isValidJson } from "@/features/mongo/ejson";
import { JsonEditor } from "@/features/mongo/JsonEditor";
import { useAggregation } from "@/features/mongo/useAggregation";

type AggregationPanelProps = { connectionId: string; database: string; collection: string };

const INITIAL_PIPELINE = '[\n  { "$match": {} },\n  { "$limit": 20 }\n]';

export function AggregationPanel({ connectionId, database, collection }: AggregationPanelProps) {
  const [pipeline, setPipeline] = useState(INITIAL_PIPELINE);
  const [syntaxError, setSyntaxError] = useState(false);
  const aggregation = useAggregation(connectionId, database, collection);
  const { state } = aggregation;
  const isRunning = state.status === "running";

  function run() {
    if (isRunning) {
      return;
    }
    if (!isValidJson(pipeline)) {
      setSyntaxError(true);
      return;
    }
    setSyntaxError(false);
    aggregation.run(pipeline);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="text-xs text-muted-foreground">
          Pipeline em Extended JSON · Ctrl+Enter executa
        </span>
        <div className="ml-auto">
          {isRunning ? (
            <Button size="sm" variant="destructive" onClick={aggregation.cancel}>
              <Square /> Cancelar
            </Button>
          ) : (
            <Button size="sm" onClick={run}>
              <Play /> Executar
            </Button>
          )}
        </div>
      </div>
      <div className="h-48 shrink-0 p-2">
        <JsonEditor label="Pipeline" value={pipeline} onChange={setPipeline} onRun={run} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto border-t bg-muted/30 p-3">
        {syntaxError && (
          <p role="alert" className="text-sm text-destructive">
            JSON inválido
          </p>
        )}
        {state.status === "running" && <p className="text-sm text-muted-foreground">Executando…</p>}
        {state.status === "error" && (
          <p role="alert" className="font-mono text-sm whitespace-pre-wrap text-destructive">
            {state.message}
          </p>
        )}
        {state.status === "done" && (
          <>
            <p role="status" className="mb-2 text-xs text-muted-foreground">
              {state.outcome.documents.length}
              {state.outcome.truncated
                ? "+ documentos (mostrando os primeiros)"
                : " documentos"} · {state.outcome.durationMs} ms
            </p>
            <div className="grid gap-2">
              {/* aggregation output may lack or repeat _id: position is the identity here */}
              {state.outcome.documents.map((document, index) => (
                <DocumentCard key={`${state.runId}:${index}`} document={document} view="tree" />
              ))}
            </div>
          </>
        )}
      </div>
      <ConfirmDialog
        confirmation={state.status === "confirm" ? state.confirmation : null}
        confirmLabel="Executar mesmo assim"
        onConfirm={aggregation.confirm}
        onCancel={aggregation.dismiss}
      />
    </div>
  );
}
