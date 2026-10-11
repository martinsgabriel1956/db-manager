import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { commands, type AggregateOutcome, type Confirmation } from "@/bindings";
import { connected } from "@/features/explorer/queries";
import { errorMessage } from "@/lib/errors";

export type AggregationState =
  | { status: "idle" }
  | { status: "running"; runId: string }
  | { status: "confirm"; runId: string; pipeline: string; confirmation: Confirmation }
  | { status: "done"; runId: string; outcome: AggregateOutcome }
  | { status: "error"; runId: string; message: string };

/** Runs pipelines tagged with a run id, so `cancel` can kill them server-side. */
export function useAggregation(connectionId: string, database: string, collection: string) {
  const [state, setState] = useState<AggregationState>({ status: "idle" });
  const queryClient = useQueryClient();

  async function run(pipeline: string, confirmed = false) {
    const runId = crypto.randomUUID();
    setState({ status: "running", runId });
    try {
      const response = await connected(connectionId, () =>
        commands.runAggregation(connectionId, runId, database, collection, pipeline, confirmed)
      );
      if (response.status === "needsConfirmation") {
        setState({ status: "confirm", runId, pipeline, confirmation: response.confirmation });
        return;
      }
      setState({ status: "done", runId, outcome: response.outcome });
    } catch (error) {
      setState({ status: "error", runId, message: errorMessage(error) });
    } finally {
      queryClient.invalidateQueries({ queryKey: ["history"] });
    }
  }

  return {
    state,
    run: (pipeline: string) => run(pipeline),
    cancel: () => {
      if (state.status === "running") {
        commands.cancelRun(state.runId).catch(() => undefined);
      }
    },
    confirm: () => state.status === "confirm" && run(state.pipeline, true),
    dismiss: () => setState({ status: "idle" })
  };
}
