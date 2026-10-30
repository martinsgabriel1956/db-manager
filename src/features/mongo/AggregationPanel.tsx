import { useState } from "react";
import { Play, Square } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { DocumentCard } from "@/features/mongo/DocumentCard";
import { isValidJson } from "@/features/mongo/ejson";
import { JsonEditor } from "@/features/mongo/JsonEditor";
import {
  isStageText,
  mergeStages,
  PREVIEW_LIMIT,
  pipelineOf,
  previewPipeline,
  splitPipeline,
  stageOperator,
  type Stage
} from "@/features/mongo/pipeline";
import { PipelineStages } from "@/features/mongo/PipelineStages";
import { useAggregation } from "@/features/mongo/useAggregation";
import { RUN_SHORTCUT } from "@/lib/platform";

type AggregationPanelProps = { connectionId: string; database: string; collection: string };

const INITIAL_PIPELINE = '[\n  { "$match": {} },\n  { "$limit": 20 }\n]';

export function AggregationPanel({ connectionId, database, collection }: AggregationPanelProps) {
  const [pipeline, setPipeline] = useState(INITIAL_PIPELINE);
  const [stages, setStages] = useState(() => mergeStages([], splitPipeline(INITIAL_PIPELINE)!));
  const [problem, setProblem] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ id: string; position: number; operator: string } | null>(
    null
  );
  const aggregation = useAggregation(connectionId, database, collection);
  const { state } = aggregation;
  const isRunning = state.status === "running";
  const isStageList = splitPipeline(pipeline) !== null;

  function editPipeline(text: string) {
    // the echo of a text the stages just wrote
    if (text === pipeline) {
      return;
    }
    setPipeline(text);
    const texts = splitPipeline(text);
    if (texts) {
      setStages(current => mergeStages(current, texts));
    }
  }

  function changeStages(next: Stage[]) {
    setStages(next);
    const text = pipelineOf(next);
    if (text !== null) {
      setPipeline(text);
    }
  }

  function invalidStage(upTo: number): string | null {
    const index = stages.findIndex(
      (stage, i) => i <= upTo && stage.enabled && !isStageText(stage.text)
    );
    return index < 0 ? null : `Estágio ${index + 1}: JSON inválido`;
  }

  function run() {
    if (isRunning) {
      return;
    }
    const problem = isValidJson(pipeline) ? invalidStage(stages.length) : "JSON inválido";
    setProblem(problem);
    if (problem === null) {
      setPreview(null);
      aggregation.run(pipeline);
    }
  }

  function runPreview(index: number) {
    if (isRunning) {
      return;
    }
    const text = previewPipeline(stages, index);
    if (text === null) {
      setProblem(invalidStage(index) ?? "A prévia não executa $out nem $merge: use Executar");
      return;
    }
    setProblem(null);
    setPreview({
      id: stages[index].id,
      position: index + 1,
      operator: stageOperator(stages[index].text)!
    });
    aggregation.run(text);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b bg-muted px-3 py-1.5">
        <span className="text-xs text-muted-foreground">
          Pipeline em Extended JSON · {RUN_SHORTCUT} executa
        </span>
        <div className="ml-auto">
          {isRunning ? (
            <Button size="sm" variant="outline" onClick={aggregation.cancel}>
              <Square /> Cancelar
            </Button>
          ) : (
            <Button size="sm" onClick={run}>
              <Play /> Executar
            </Button>
          )}
        </div>
      </div>
      <div className="grid h-80 shrink-0 grid-cols-2 gap-2 p-2">
        <section aria-label="Estágios" className="min-h-0 overflow-auto">
          {isStageList ? (
            <PipelineStages
              stages={stages}
              onChange={changeStages}
              onPreview={runPreview}
              previewId={preview && state.status !== "idle" ? preview.id : null}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              Os estágios aparecem quando o pipeline for um array JSON de objetos.
            </p>
          )}
        </section>
        <JsonEditor label="Pipeline" value={pipeline} onChange={editPipeline} onRun={run} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto border-t bg-muted/30 p-3">
        {problem && (
          <p role="alert" className="text-sm text-destructive">
            {problem}
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
              {preview &&
                `Prévia até o estágio ${preview.position} (${preview.operator}), com { "$limit": ${PREVIEW_LIMIT} } no fim · `}
              {aggregationSummary(
                state.outcome.documents.length,
                state.outcome.truncated,
                state.outcome.durationMs
              )}
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
        connectionId={connectionId}
        confirmation={state.status === "confirm" ? state.confirmation : null}
        confirmLabel="Executar"
        onConfirm={aggregation.confirm}
        onCancel={aggregation.dismiss}
      />
    </div>
  );
}

/** "1 documento · 4 ms", or "100+ documentos (mostrando os primeiros) · 9 ms" when cut short. */
export function aggregationSummary(count: number, truncated: boolean, durationMs: number): string {
  const documents = truncated
    ? `${count}+ documentos (mostrando os primeiros)`
    : `${count} ${count === 1 ? "documento" : "documentos"}`;
  return `${documents} · ${durationMs} ms`;
}
