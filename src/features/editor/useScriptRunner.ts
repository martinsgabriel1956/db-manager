import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  commands,
  type Cell,
  type Confirmation,
  type ResultColumn,
  type ScriptOutcome
} from "@/bindings";
import { errorMessage } from "@/lib/errors";

export type RunState =
  | { status: "idle" }
  | { status: "running"; runId: string }
  /** destructive script, or a write on prod: waits for the user */
  | { status: "confirm"; runId: string; sql: string; confirmation: Confirmation }
  | { status: "error"; runId: string; message: string }
  | { status: "command"; runId: string; outcome: ScriptOutcome; rowsAffected: number }
  | {
      status: "rows";
      runId: string;
      outcome: ScriptOutcome;
      columns: ResultColumn[];
      rows: Cell[][];
      cursorId: string | null;
      hasMore: boolean;
      loadingMore: boolean;
      loadError: string | null;
    };

/**
 * Runs scripts and pages through the last statement's rows. The backend keeps a
 * cursor (and a connection) open while rows remain, so it is released on re-run
 * and on unmount.
 */
export function useScriptRunner(connectionId: string) {
  const [state, setState] = useState<RunState>({ status: "idle" });
  const queryClient = useQueryClient();
  const cursorRef = useRef<string | null>(null);
  const disposedRef = useRef(false);

  const releaseCursor = useCallback(() => {
    const cursorId = cursorRef.current;
    cursorRef.current = null;
    if (cursorId) {
      commands.closeCursor(cursorId).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      releaseCursor();
    };
  }, [releaseCursor]);

  const run = useCallback(
    async (sql: string, confirmed = false) => {
      if (sql.trim() === "") {
        return;
      }
      releaseCursor();
      const runId = crypto.randomUUID();
      setState({ status: "running", runId });
      try {
        await commands.connectDatabase(connectionId);
        const response = await commands.runScript(connectionId, runId, sql, confirmed);
        if (response.status === "needsConfirmation") {
          setState({ status: "confirm", runId, sql, confirmation: response.confirmation });
          return;
        }
        queryClient.invalidateQueries({ queryKey: ["history"] });
        const { outcome } = response;
        const { result } = outcome;
        if (result.kind === "command") {
          setState({ status: "command", runId, outcome, rowsAffected: result.rowsAffected });
          return;
        }
        cursorRef.current = result.cursorId;
        if (disposedRef.current) {
          releaseCursor();
          return;
        }
        setState({
          status: "rows",
          runId,
          outcome,
          columns: result.batch.columns,
          rows: result.batch.rows,
          cursorId: result.cursorId,
          hasMore: result.batch.hasMore,
          loadingMore: false,
          loadError: null
        });
      } catch (error) {
        queryClient.invalidateQueries({ queryKey: ["history"] });
        setState({ status: "error", runId, message: errorMessage(error) });
      }
    },
    [connectionId, releaseCursor, queryClient]
  );

  const confirm = useCallback(() => {
    if (state.status === "confirm") {
      run(state.sql, true);
    }
  }, [state, run]);

  const dismiss = useCallback(() => {
    if (state.status === "confirm") {
      setState({ status: "idle" });
    }
  }, [state]);

  const cancel = useCallback(() => {
    if (state.status === "running") {
      commands.cancelRun(state.runId).catch(() => undefined);
    }
  }, [state]);

  const loadMore = useCallback(async () => {
    if (state.status !== "rows" || !state.cursorId || !state.hasMore || state.loadingMore) {
      return;
    }
    const cursorId = state.cursorId;
    const isCurrent = (prev: RunState) => prev.status === "rows" && prev.cursorId === cursorId;
    setState(prev => (isCurrent(prev) ? { ...prev, loadingMore: true } : prev));
    try {
      const batch = await commands.fetchMore(cursorId);
      if (!batch.hasMore) {
        // the backend drops an exhausted cursor by itself
        cursorRef.current = null;
      }
      setState(prev =>
        isCurrent(prev) && prev.status === "rows"
          ? {
              ...prev,
              rows: [...prev.rows, ...batch.rows],
              hasMore: batch.hasMore,
              loadingMore: false
            }
          : prev
      );
    } catch (error) {
      cursorRef.current = null;
      setState(prev =>
        isCurrent(prev) && prev.status === "rows"
          ? { ...prev, hasMore: false, loadingMore: false, loadError: errorMessage(error) }
          : prev
      );
    }
  }, [state]);

  return { state, run, cancel, loadMore, confirm, dismiss };
}
