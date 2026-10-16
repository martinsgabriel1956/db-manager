import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, Eye, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { JsonEditor } from "@/features/mongo/JsonEditor";
import {
  isStageText,
  newStage,
  PREVIEW_LIMIT,
  stageOperator,
  type Stage
} from "@/features/mongo/pipeline";
import { cn } from "cn";

const TEMPLATES: Record<string, string> = {
  $match: '{ "$match": {} }',
  $project: '{ "$project": { "_id": 1 } }',
  $addFields: '{ "$addFields": {} }',
  $group: '{ "$group": { "_id": null, "total": { "$sum": 1 } } }',
  $sort: '{ "$sort": { "_id": 1 } }',
  $limit: '{ "$limit": 20 }',
  $skip: '{ "$skip": 0 }',
  $unwind: '{ "$unwind": "$campo" }',
  $lookup: '{ "$lookup": { "from": "", "localField": "", "foreignField": "", "as": "" } }',
  $count: '{ "$count": "total" }'
};

type PipelineStagesProps = {
  stages: Stage[];
  onChange: (stages: Stage[]) => void;
  onPreview: (index: number) => void;
  /** the stage whose preview is on screen */
  previewId: string | null;
};

/** The pipeline as blocks; every change goes back into the pipeline text. */
export function PipelineStages({ stages, onChange, onPreview, previewId }: PipelineStagesProps) {
  const [operator, setOperator] = useState("$match");
  const addRef = useRef<HTMLButtonElement>(null);

  function update(index: number, change: Partial<Stage>) {
    onChange(stages.map((stage, i) => (i === index ? { ...stage, ...change } : stage)));
  }

  function move(index: number, by: -1 | 1) {
    const target = index + by;
    if (target < 0 || target >= stages.length) {
      return;
    }
    const next = [...stages];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        Estágios desligados ficam fora do JSON e da execução. A prévia roda até o estágio com{" "}
        <code className="font-mono">{`{ "$limit": ${PREVIEW_LIMIT} }`}</code> no fim, que não entra
        no pipeline.
      </p>
      <ol className="grid gap-2">
        {stages.map((stage, index) => {
          const position = index + 1;
          const valid = isStageText(stage.text);
          const previewed = stage.id === previewId;
          return (
            <li
              key={stage.id}
              aria-current={previewed ? "step" : undefined}
              className={cn("border bg-background", previewed && "border-select")}
            >
              <div className="flex items-center gap-1 border-b px-2 py-1">
                <span className="legend w-5 text-muted-foreground">{position}</span>
                <span
                  className={cn(
                    "font-mono text-xs font-semibold",
                    !stage.enabled && "line-through"
                  )}
                >
                  {stageOperator(stage.text) ?? "?"}
                </span>
                {!stage.enabled && <Badge variant="held">Desligado</Badge>}
                {previewed && <Badge variant="outline">Prévia</Badge>}
                <label className="ml-auto flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={stage.enabled}
                    aria-label={`Estágio ${position} ligado`}
                    onChange={event => update(index, { enabled: event.target.checked })}
                  />
                  Ligado
                </label>
                {/* aria-disabled, not disabled: the focused button stays focusable at the ends */}
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Mover estágio ${position} para cima`}
                  aria-disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Mover estágio ${position} para baixo`}
                  aria-disabled={index === stages.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Prévia até o estágio ${position}`}
                  disabled={!stage.enabled}
                  onClick={() => onPreview(index)}
                >
                  <Eye />
                </Button>
                <Button
                  size="icon-xs"
                  variant="ghost"
                  aria-label={`Remover estágio ${position}`}
                  onClick={() => {
                    onChange(stages.filter((_, i) => i !== index));
                    addRef.current?.focus();
                  }}
                >
                  <Trash2 />
                </Button>
              </div>
              <div className={cn("max-h-48 overflow-auto", !stage.enabled && "opacity-60")}>
                <JsonEditor
                  label={`Estágio ${position}`}
                  value={stage.text}
                  // the echo of a text pushed from the pipeline is not an edit
                  onChange={text => text !== stage.text && update(index, { text })}
                  onRun={() => stage.enabled && onPreview(index)}
                />
              </div>
              {!valid && (
                <p role="alert" className="px-2 py-1 text-xs text-destructive">
                  Estágio inválido (esperado um objeto JSON): o pipeline mantém a última versão
                  válida
                </p>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex items-center gap-2">
        <NativeSelect
          aria-label="Operador do novo estágio"
          className="h-7 font-mono text-xs"
          value={operator}
          onChange={event => setOperator(event.target.value)}
        >
          {Object.keys(TEMPLATES).map(name => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </NativeSelect>
        <Button
          ref={addRef}
          size="sm"
          variant="outline"
          onClick={() => onChange([...stages, newStage(TEMPLATES[operator])])}
        >
          <Plus /> Adicionar estágio
        </Button>
      </div>
    </div>
  );
}
