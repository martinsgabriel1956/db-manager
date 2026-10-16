import { useState, type ReactNode } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { Square } from "lucide-react";
import { commands, type ImportResponse } from "@/bindings";
import { Button } from "@/components/ui/button";
import { errorMessage } from "@/lib/errors";

type RunState =
  | { status: "idle" }
  | { status: "running"; runId: string }
  | { status: "done"; rows: number }
  | { status: "error"; message: string };

export type ImportRunner = ReturnType<typeof useImportRun>;

/**
 * A confirmed import: runs under its own id (so it can be cancelled), then reloads
 * what it wrote into (`reload`) and the history.
 */
export function useImportRun(reload: QueryKey, doneLabel: (rows: number) => string) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<RunState>({ status: "idle" });

  async function run(start: (runId: string) => Promise<ImportResponse>) {
    const runId = crypto.randomUUID();
    setState({ status: "running", runId });
    try {
      const response = await start(runId);
      if (response.status === "imported") {
        setState({ status: "done", rows: response.rows });
      }
    } catch (err) {
      setState({ status: "error", message: errorMessage(err) });
    }
    queryClient.invalidateQueries({ queryKey: reload });
    queryClient.invalidateQueries({ queryKey: ["history"] });
  }

  return {
    state,
    doneLabel,
    run,
    fail: (err: unknown) => setState({ status: "error", message: errorMessage(err) })
  };
}

/** While running, the cancel button; otherwise the last outcome next to the trigger. */
export function ImportStatus({ runner, children }: { runner: ImportRunner; children: ReactNode }) {
  const { state } = runner;
  if (state.status === "running") {
    return (
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        Importando…
        <Button
          size="xs"
          variant="outline"
          onClick={() => commands.cancelRun(state.runId).catch(() => undefined)}
        >
          <Square /> Cancelar importação
        </Button>
      </span>
    );
  }
  return (
    <span className="flex items-center gap-2 text-xs">
      {state.status === "done" && (
        <span role="status" className="text-success">
          {runner.doneLabel(state.rows)}
        </span>
      )}
      {state.status === "error" && (
        <span role="alert" className="max-w-96 break-words text-destructive">
          {state.message}
        </span>
      )}
      {children}
    </span>
  );
}
