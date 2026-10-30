import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  commands,
  type Cell,
  type Confirmation,
  type ExplainPlan,
  type ResultColumn,
  type ScriptOutcome
} from "@/bindings";
import { errorMessage } from "@/lib/errors";

/** Set when the run asks for the plan instead; ANALYZE executes the statement. */
export type ExplainMode = { analyze: boolean };

export type RunState =
  | { status: "idle" }
  | { status: "running"; runId: string }
  /** destructive script, or a write on prod: waits for the user */
  | {
      status: "confirm";
      runId: string;
      sql: string;
      explain: ExplainMode | null;
      confirmation: Confirmation;
    }
  /** the confirmation was dismissed: nothing ran, the previous result is still shown */
  | { status: "cancelled"; runId: string; previous: SettledRun | null }
  | SettledRun;

/** A run that finished; `confirmed` when it went through the confirmation first. */
export type SettledRun =
  /**
   * `outcome` when a statement of the script failed: the steps before it ran. `previous` is
   * the result the failed run replaced, kept on screen under the error like under a cancel
   */
  | {
      status: "error";
      runId: string;
      message: string;
      outcome?: ScriptOutcome;
      previous?: SettledRun | null;
      /** a confirmed script that stopped midway: what ran before went through the sheet */
      confirmed?: boolean;
    }
  | { status: "plan"; runId: string; confirmed: boolean; plan: ExplainPlan }
  | {
      status: "command";
      runId: string;
      confirmed: boolean;
      outcome: ScriptOutcome;
      rowsAffected: number;
    }
  | {
      status: "rows";
      runId: string;
      confirmed: boolean;
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
/** What a new run would replace: kept so dismissing its confirmation can bring it back. */
function settled(state: RunState, kept: SettledRun | null): SettledRun | null {
  switch (state.status) {
    case "idle":
    case "running":
      return null;
    case "confirm":
      return kept;
    case "cancelled":
      return state.previous;
    default:
      return state;
  }
}

/**
 * The result kept under a cancel or an error. Its cursor went at the start of the run: the
 * rows on screen stay, the rest is gone. An error keeps what it replaced, not itself.
 */
function kept(previous: SettledRun | null): SettledRun | null {
  if (previous?.status === "error" && !previous.outcome) {
    return previous.previous ?? null;
  }
  return previous?.status === "rows" && previous.hasMore
    ? {
        ...previous,
        cursorId: null,
        hasMore: false,
        loadError: "O restante deste resultado foi liberado; execute de novo para carregá-lo."
      }
    : previous;
}

export function useScriptRunner(connectionId: string) {
  const [state, setState] = useState<RunState>({ status: "idle" });
  const previousRef = useRef<SettledRun | null>(null);
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
    async (sql: string, confirmed = false, explain: ExplainMode | null = null) => {
      if (sql.trim() === "") {
        return;
      }
      releaseCursor();
      const runId = crypto.randomUUID();
      setState(prev => {
        previousRef.current = settled(prev, previousRef.current);
        return { status: "running", runId };
      });
      try {
        await commands.connectDatabase(connectionId);
        const response = explain
          ? await commands.explain(connectionId, runId, sql, explain.analyze, confirmed)
          : await commands.runScript(connectionId, runId, sql, confirmed);
        if (response.status === "needsConfirmation") {
          setState({ status: "confirm", runId, sql, explain, confirmation: response.confirmation });
          return;
        }
        queryClient.invalidateQueries({ queryKey: ["history"] });
        if (response.status === "explained") {
          setState({ status: "plan", runId, confirmed, plan: response.plan });
          return;
        }
        const { outcome } = response;
        if (outcome.error) {
          setState({
            status: "error",
            runId,
            message: errorMessage(outcome.error),
            outcome,
            confirmed,
            previous: kept(previousRef.current)
          });
          return;
        }
        // a script that ran to its end has the last statement's result
        const result = outcome.steps[outcome.steps.length - 1].result!;
        if (result.kind === "command") {
          setState({
            status: "command",
            runId,
            confirmed,
            outcome,
            rowsAffected: result.rowsAffected
          });
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
          confirmed,
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
        setState({
          status: "error",
          runId,
          message: errorMessage(error),
          previous: kept(previousRef.current)
        });
      }
    },
    [connectionId, releaseCursor, queryClient]
  );

  const confirm = useCallback(() => {
    if (state.status === "confirm") {
      run(state.sql, true, state.explain);
    }
  }, [state, run]);

  const dismiss = useCallback(() => {
    if (state.status !== "confirm") {
      return;
    }
    setState({ status: "cancelled", runId: state.runId, previous: kept(previousRef.current) });
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
