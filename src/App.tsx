import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ConnectionForm } from "@/features/connections/ConnectionForm";
import { useConnections } from "@/features/connections/queries";
import { SqlWorkspace } from "@/features/editor/SqlWorkspace";
import { ConnectionTree, type TableTarget } from "@/features/explorer/ConnectionTree";
import { isConnectionQuery } from "@/features/explorer/queries";
import { TableView } from "@/features/table/TableView";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type View =
  | { kind: "none" }
  | { kind: "form"; connectionId: string | null }
  | ({ kind: "table" } & TableTarget)
  | { kind: "editor"; connectionId: string };

export function App() {
  const connections = useConnections();
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>({ kind: "none" });
  const [notice, setNotice] = useState<string | null>(null);
  // ponytail: editor text per connection lives in memory; M2 tabs persist it
  const [editorSql, setEditorSql] = useState<Record<string, string>>({});

  const viewConnectionId = view.kind === "none" ? null : view.connectionId;
  const active = connections.data?.find(connection => connection.id === viewConnectionId) ?? null;
  const isProd = active?.environment === "prod";

  function open(next: View) {
    setNotice(null);
    setView(next);
  }

  /** The backend closed this connection's session; cached schemas/results are stale. */
  function dropConnectionCache(connectionId: string) {
    queryClient.removeQueries({
      predicate: query => isConnectionQuery(query.queryKey, connectionId)
    });
  }

  return (
    <div
      data-environment={active?.environment}
      className={cn(
        "flex h-screen bg-background text-foreground",
        isProd && "ring-4 ring-inset ring-red-600"
      )}
    >
      <aside className="flex w-72 shrink-0 flex-col gap-3 overflow-y-auto border-r py-3">
        <div className="flex items-center justify-between px-3">
          <h1 className="text-sm font-semibold">Conexões</h1>
          <Button
            size="sm"
            variant="outline"
            onClick={() => open({ kind: "form", connectionId: null })}
          >
            Nova
          </Button>
        </div>
        {connections.isPending && <p className="px-3 text-sm text-muted-foreground">Carregando…</p>}
        {connections.isError && (
          <p role="alert" className="px-3 text-sm text-destructive">
            {errorMessage(connections.error)}
          </p>
        )}
        {connections.data && (
          <ConnectionTree
            connections={connections.data}
            activeTable={view.kind === "table" ? view : null}
            onEdit={connectionId => open({ kind: "form", connectionId })}
            onOpenTable={target => open({ kind: "table", ...target })}
            onOpenEditor={connectionId => open({ kind: "editor", connectionId })}
          />
        )}
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {notice && (
          <p
            role="status"
            className="m-4 mb-0 rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900"
          >
            {notice}
          </p>
        )}
        {view.kind === "none" && (
          <p className="p-6 text-sm text-muted-foreground">
            Abra uma conexão na lateral para navegar pelas tabelas, ou crie uma nova.
          </p>
        )}
        {view.kind === "form" && (view.connectionId === null || active) && (
          <div className="overflow-auto p-6">
            <ConnectionForm
              key={view.connectionId ?? "new"}
              connection={active}
              onSaved={(id, keychainWarning) => {
                dropConnectionCache(id);
                setView({ kind: "form", connectionId: id });
                setNotice(
                  keychainWarning &&
                    `Conexão salva, mas a senha não foi guardada: ${keychainWarning}`
                );
              }}
              onDeleted={keychainWarning => {
                if (view.connectionId) {
                  dropConnectionCache(view.connectionId);
                }
                setView({ kind: "none" });
                setNotice(
                  keychainWarning &&
                    `Conexão excluída, mas a senha ficou no keychain: ${keychainWarning}`
                );
              }}
            />
          </div>
        )}
        {view.kind === "table" && (
          <TableView
            key={`${view.connectionId}:${view.schema}.${view.table}`}
            connectionId={view.connectionId}
            schema={view.schema}
            table={view.table}
          />
        )}
        {view.kind === "editor" && active && (
          <SqlWorkspace
            key={view.connectionId}
            connectionId={view.connectionId}
            connectionName={active.name}
            sql={editorSql[view.connectionId] ?? ""}
            onSqlChange={sql => setEditorSql(prev => ({ ...prev, [view.connectionId]: sql }))}
          />
        )}
      </main>
    </div>
  );
}
