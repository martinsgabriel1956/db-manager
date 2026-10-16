import { useId, useState } from "react";
import { Play, Square } from "lucide-react";
import { commands, type SchemaSample } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connected } from "@/features/explorer/queries";
import { errorMessage } from "@/lib/errors";

type SchemaPanelProps = { connectionId: string; database: string; collection: string };

/** use_cases/mongo.rs MAX_SAMPLE_SIZE */
const MAX_SAMPLE_SIZE = 10_000;

type SampleState =
  | { status: "idle" }
  | { status: "running"; runId: string }
  | { status: "done"; sample: SchemaSample }
  | { status: "error"; message: string };

/** Field paths of a `$sample`: a picture of some documents, not a schema MongoDB enforces. */
export function SchemaPanel({ connectionId, database, collection }: SchemaPanelProps) {
  const [sizeText, setSizeText] = useState("100");
  const [state, setState] = useState<SampleState>({ status: "idle" });
  const hintId = useId();
  const size = Number(sizeText);
  const validSize = Number.isInteger(size) && size >= 1 && size <= MAX_SAMPLE_SIZE;
  const command = `${database}.${collection}.aggregate([{ "$sample": { "size": ${validSize ? size : "…"} } }])`;

  async function sample() {
    if (!validSize || state.status === "running") {
      return;
    }
    const runId = crypto.randomUUID();
    setState({ status: "running", runId });
    try {
      const result = await connected(connectionId, () =>
        commands.sampleSchema(connectionId, runId, database, collection, size)
      );
      setState({ status: "done", sample: result });
    } catch (error) {
      setState({ status: "error", message: errorMessage(error) });
    }
  }

  return (
    <div className="flex h-full flex-col">
      <form
        className="flex flex-wrap items-center gap-2 border-b bg-muted px-3 py-1.5"
        onSubmit={event => {
          event.preventDefault();
          sample();
        }}
      >
        <label className="flex items-center gap-2 text-xs">
          Amostra de
          <Input
            type="number"
            min={1}
            max={MAX_SAMPLE_SIZE}
            value={sizeText}
            aria-invalid={!validSize}
            aria-label="Documentos na amostra"
            aria-describedby={hintId}
            className="h-7 w-24 font-mono"
            onChange={event => setSizeText(event.target.value)}
          />
          documentos
        </label>
        <code className="min-w-0 font-mono text-xs [overflow-wrap:anywhere] text-muted-foreground">
          {command}
        </code>
        <div className="ml-auto">
          {state.status === "running" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => commands.cancelRun(state.runId).catch(() => undefined)}
            >
              <Square /> Cancelar
            </Button>
          ) : (
            <Button type="submit" size="sm" disabled={!validSize}>
              <Play /> Amostrar
            </Button>
          )}
        </div>
      </form>
      <p id={hintId} className="border-b px-3 py-1.5 text-xs text-muted-foreground">
        Amostra aleatória (de 1 a {MAX_SAMPLE_SIZE.toLocaleString("pt-BR")} documentos), não o
        schema da coleção: o MongoDB não impõe um, e campos raros podem ficar de fora.
      </p>
      <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-3">
        {state.status === "idle" && (
          <p className="text-sm text-muted-foreground">
            Amostrar lê documentos ao acaso e lista cada caminho de campo com os tipos BSON
            encontrados.
          </p>
        )}
        {state.status === "running" && <p className="text-sm text-muted-foreground">Amostrando…</p>}
        {state.status === "error" && (
          <p role="alert" className="font-mono text-sm whitespace-pre-wrap text-destructive">
            {state.message}
          </p>
        )}
        {state.status === "done" && <SampleTable sample={state.sample} />}
      </div>
    </div>
  );
}

function SampleTable({ sample }: { sample: SchemaSample }) {
  const { sampled, fields, durationMs } = sample;
  return (
    <>
      <p role="status" className="mb-2 text-xs text-muted-foreground">
        {sampleSummary(sampled, fields.length, durationMs)}
      </p>
      {fields.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="h-7 border-b text-left legend text-muted-foreground">
              <th className="py-1.5 pr-6 font-medium">Campo</th>
              <th className="py-1.5 pr-6 font-medium">Tipos (ocorrências)</th>
              <th className="py-1.5 pr-6 font-medium">Presente em</th>
              <th className="py-1.5 font-medium">Exemplo</th>
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {fields.map(field => (
              <tr key={field.path} className="border-b align-top">
                {/* break-word, not anywhere: the column stays as wide as its longest name */}
                <td className="py-1.5 pr-6 font-semibold break-words">{field.path}</td>
                <td className="py-1.5 pr-6">
                  {field.types.map((type, index) => (
                    <span key={type.name} className="whitespace-nowrap">
                      {index > 0 && " · "}
                      {type.name} {type.count}
                    </span>
                  ))}
                </td>
                <td className="py-1.5 pr-6 whitespace-nowrap">
                  {presence(field.documents, sampled)}
                </td>
                <td className="py-1.5 [overflow-wrap:anywhere]">
                  {field.example ?? <span className="text-muted-foreground">—</span>}
                  {field.exampleTruncated && (
                    <span className="font-sans text-muted-foreground"> … (cortado)</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

export function sampleSummary(sampled: number, fields: number, durationMs: number): string {
  const documents = `${sampled} ${sampled === 1 ? "documento amostrado" : "documentos amostrados"}`;
  return `${documents} · ${fields} ${fields === 1 ? "caminho" : "caminhos"} · ${durationMs} ms`;
}

/** "3 de 4 (75%)" */
export function presence(documents: number, sampled: number): string {
  return `${documents} de ${sampled} (${Math.round((documents / sampled) * 100)}%)`;
}
