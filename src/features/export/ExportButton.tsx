import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, Square } from "lucide-react";
import { commands, type ExportOutcome } from "@/bindings";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { errorMessage } from "@/lib/errors";

export type ExportFormat = {
  id: string;
  label: string;
  extension: string;
  /** streams to `path` in the backend; `runId` lets the export be cancelled */
  run: (path: string, runId: string) => Promise<ExportOutcome>;
};

type ExportButtonProps = {
  /** suggested file name, without extension */
  baseName: string;
  formats: ExportFormat[];
};

type ExportState =
  | { status: "idle" }
  | { status: "running"; runId: string }
  | { status: "done"; rows: number; path: string }
  | { status: "error"; message: string };

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** Asks where to save, streams the export there, and can cancel it midway. */
export function ExportButton({ baseName, formats }: ExportButtonProps) {
  const queryClient = useQueryClient();
  const [formatId, setFormatId] = useState(formats[0].id);
  const [state, setState] = useState<ExportState>({ status: "idle" });
  const format = formats.find(option => option.id === formatId) ?? formats[0];

  async function start() {
    const path = await save({
      defaultPath: `${baseName}.${format.extension}`,
      filters: [{ name: format.label, extensions: [format.extension] }]
    });
    if (!path) {
      return;
    }
    const runId = crypto.randomUUID();
    setState({ status: "running", runId });
    try {
      const outcome = await format.run(path, runId);
      setState({ status: "done", rows: outcome.rows, path });
    } catch (err) {
      setState({ status: "error", message: errorMessage(err) });
    }
    queryClient.invalidateQueries({ queryKey: ["history"] });
  }

  if (state.status === "running") {
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        Exportando…
        <Button
          size="xs"
          variant="outline"
          onClick={() => commands.cancelRun(state.runId).catch(() => undefined)}
        >
          <Square /> Cancelar export
        </Button>
      </span>
    );
  }

  return (
    <span className="flex items-center gap-2 text-xs">
      {state.status === "done" && (
        <span role="status" className="text-success" title={state.path}>
          {state.rows.toLocaleString("pt-BR")} {state.rows === 1 ? "item" : "itens"} →{" "}
          {fileName(state.path)}
        </span>
      )}
      {state.status === "error" && (
        <span role="alert" className="max-w-96 truncate text-destructive" title={state.message}>
          {state.message}
        </span>
      )}
      {formats.length > 1 && (
        <NativeSelect
          aria-label="Formato do export"
          className="h-7 text-xs"
          value={formatId}
          onChange={event => setFormatId(event.target.value)}
        >
          {formats.map(option => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      )}
      <Button size="xs" variant="outline" onClick={start}>
        <Download /> Exportar {formats.length === 1 ? format.label : ""}
      </Button>
    </span>
  );
}
