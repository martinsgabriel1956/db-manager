import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { commands, type BrowseRequest } from "@/bindings";
import { Button } from "@/components/ui/button";
import { connected } from "@/features/explorer/queries";
import { errorMessage } from "@/lib/errors";

type RowCountProps = {
  connectionId: string;
  request: BrowseRequest;
  /** when the estimate shows: in a crowded bar it gives its room before the write buttons */
  estimateClassName: string;
};

type CountState =
  | { status: "idle" }
  | { status: "counting"; runId: string }
  | { status: "done"; count: string }
  | { status: "error"; message: string };

/** "12.345 linhas": the count is exact text, formatted without passing through a float. */
export function rowsLabel(count: string): string {
  return `${BigInt(count).toLocaleString("pt-BR")} ${count === "1" ? "linha" : "linhas"}`;
}

/**
 * The cheap estimate on open (≈, none on SQLite), and the exact COUNT(*) only when asked:
 * it can scan the whole table, so it is cancellable and bound by the connection's timeout.
 * Remount it (key) when the filters change or rows are saved: the count speaks of those.
 */
export function RowCount({ connectionId, request, estimateClassName }: RowCountProps) {
  const { schema, table } = request;
  const filtered = request.filters.length > 0;
  const estimate = useQuery({
    queryKey: ["estimate", connectionId, schema, table],
    queryFn: () =>
      connected(connectionId, () => commands.estimateRows(connectionId, schema, table)),
    staleTime: Infinity
  });
  const [state, setState] = useState<CountState>({ status: "idle" });
  const running = useRef<string | null>(null);

  // leaving (another filter, another tab) stops a count still scanning
  useEffect(
    () => () => {
      if (running.current) {
        void commands.cancelRun(running.current);
      }
    },
    []
  );

  const verb = state.status === "done" ? "Recontar" : "Contar";

  async function count() {
    const runId = crypto.randomUUID();
    running.current = runId;
    setState({ status: "counting", runId });
    try {
      const exact = await connected(connectionId, () =>
        commands.countRows(connectionId, runId, request)
      );
      setState({ status: "done", count: exact });
    } catch (err) {
      const cancelled = (err as { kind?: string }).kind === "cancelled";
      setState({ status: "error", message: cancelled ? "Contagem cancelada" : errorMessage(err) });
    } finally {
      running.current = null;
    }
  }

  return (
    <span className="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
      {state.status === "done" && (
        <span role="status" className="font-medium text-foreground">
          {rowsLabel(state.count)}
          {filtered && " com o filtro"}
        </span>
      )}
      {state.status === "idle" && !filtered && estimate.data && (
        <span className={estimateClassName} title="Estimativa do banco, sem contar as linhas">
          <span aria-hidden>≈ </span>
          <span className="sr-only">cerca de </span>
          {rowsLabel(estimate.data)}
        </span>
      )}
      {state.status === "error" && (
        <span role="alert" className="max-w-96 break-words text-destructive">
          {state.message}
        </span>
      )}
      {state.status === "counting" && <span role="status">Contando…</span>}
      {/* one button that turns into Cancelar: focus stays on it while the count runs */}
      <Button
        size="xs"
        variant="outline"
        aria-label={
          state.status === "counting"
            ? "Cancelar contagem"
            : `${verb} linhas${filtered ? " com o filtro" : ""}`
        }
        onClick={() =>
          state.status === "counting" ? void commands.cancelRun(state.runId) : count()
        }
      >
        {state.status === "counting" ? "Cancelar" : verb}
      </Button>
    </span>
  );
}
