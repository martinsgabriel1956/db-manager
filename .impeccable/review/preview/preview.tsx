// Dev-only review harness: the real App over the test fake backend, no Tauri.
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/App";
import "@/index.css";
import type { ScriptOutcome, ScriptStep } from "@/bindings";
import {
  devMongo,
  devPostgres,
  executed,
  fakeBackend,
  localRedis,
  prodPostgres,
  rowsOutcome
} from "@/test/fakeBackend";

/**
 * A script answered statement by statement, with spans into the real text: a SELECT returns
 * rows (one with FAIL in it fails, and what follows does not run), anything else is a command.
 */
function scriptOf(sql: string): ScriptOutcome {
  const spans: [number, number][] = [];
  let from = 0;
  for (const match of sql.matchAll(/;/g)) {
    spans.push([from, match.index + 1]);
    from = match.index + 1;
  }
  if (sql.slice(from).trim()) {
    spans.push([from, sql.length]);
  }
  const trimmed = spans.map(([start, end]): [number, number] => {
    const text = sql.slice(start, end);
    const lead = text.length - text.trimStart().length;
    return [start + lead, start + text.trimEnd().length];
  });
  if (trimmed.length <= 1) {
    return rowsOutcome;
  }
  const failAt = trimmed.findIndex(([start, end]) => /FAIL/i.test(sql.slice(start, end)));
  const steps: ScriptStep[] = trimmed.map(([start, end], index) => {
    const text = sql.slice(start, end);
    if (failAt >= 0 && index > failAt) {
      return { status: "notRun", durationMs: 0, span: [start, end], rowCount: null, result: null };
    }
    if (index === failAt) {
      return { status: "failed", durationMs: 3, span: [start, end], rowCount: null, result: null };
    }
    const count = 4210 - index * 1000;
    return /^\s*SELECT/i.test(text)
      ? {
          status: "done",
          durationMs: 12 + index,
          span: [start, end],
          rowCount: count,
          result: {
            kind: "rows",
            batch: {
              columns: [
                { name: "id", typeName: "int4", editable: false },
                { name: "name", typeName: "text", editable: false }
              ],
              rows: Array.from({ length: 50 }, (_, row) => [
                { t: "int", v: String(row + 1) },
                { t: "text", v: `linha ${row + 1}` }
              ]),
              hasMore: true
            },
            cursorId: null
          }
        }
      : {
          status: "done",
          durationMs: 3,
          span: [start, end],
          rowCount: 3,
          result: { kind: "command", rowsAffected: 3 }
        };
  });
  return {
    statementCount: steps.length,
    durationMs: steps.reduce((sum, step) => sum + step.durationMs, 0),
    steps,
    error:
      failAt >= 0
        ? {
            kind: "database",
            message: `comando ${failAt + 1} de ${steps.length}: syntax error at or near "FAIL" [42601]`
          }
        : null
  };
}

fakeBackend([
  { ...prodPostgres, readOnly: false },
  devPostgres,
  { ...devPostgres, id: "pg-ro", name: "Réplica leitura", readOnly: true },
  { ...devPostgres, id: "my-stg", name: "Loja MySQL", engine: "mysql", environment: "staging" },
  devMongo,
  localRedis
], {
  // saving on prod asks first, as the Rust side does, so the ficha shows for table edits too
  apply_changes: args => {
    const { connectionId, confirmed } = args as { connectionId: string; confirmed: boolean };
    return connectionId !== prodPostgres.id || confirmed
      ? { status: "applied", rowsChanged: 1 }
      : {
          status: "needsConfirmation",
          confirmation: {
            destructive: false,
            reason: "Conexão de produção: confira as alterações antes de salvar",
            statements: ["UPDATE \"public\".\"users\" SET … WHERE \"id\" = '2'"]
          }
        };
  },
  // the first unconfirmed run asks, so the confirmation can be reviewed
  run_script: args => {
    const { confirmed, sql } = args as { confirmed: boolean; sql: string };
    return confirmed
      ? executed(scriptOf(sql))
      : {
          status: "needsConfirmation",
          confirmation: {
            destructive: true,
            reason: "Comando destrutivo: DELETE sem WHERE",
            statements: [sql.trim().replace(/;$/, "")]
          }
        };
  }
});

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
