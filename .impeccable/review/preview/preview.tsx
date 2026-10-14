// Dev-only review harness: the real App over the test fake backend, no Tauri.
import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "@/App";
import "@/index.css";
import {
  devMongo,
  devPostgres,
  executed,
  fakeBackend,
  localRedis,
  prodPostgres,
  rowsOutcome
} from "@/test/fakeBackend";

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
      ? executed(rowsOutcome)
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
