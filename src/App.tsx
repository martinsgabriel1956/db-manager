import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ConnectionForm } from "@/features/connections/ConnectionForm";
import { ConnectionList } from "@/features/connections/ConnectionList";
import { useConnections } from "@/features/connections/queries";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Selection = { mode: "none" } | { mode: "new" } | { mode: "edit"; id: string };

export function App() {
  const connections = useConnections();
  const [selection, setSelection] = useState<Selection>({ mode: "none" });
  const [notice, setNotice] = useState<string | null>(null);

  const selectedId = selection.mode === "edit" ? selection.id : null;
  const selected = connections.data?.find(connection => connection.id === selectedId) ?? null;
  const isProd = selected?.environment === "prod";

  function select(next: Selection) {
    setNotice(null);
    setSelection(next);
  }

  return (
    <div
      data-environment={selected?.environment}
      className={cn(
        "flex h-screen bg-background text-foreground",
        isProd && "ring-4 ring-inset ring-red-600"
      )}
    >
      <aside className="flex w-72 shrink-0 flex-col gap-3 border-r py-3">
        <div className="flex items-center justify-between px-3">
          <h1 className="text-sm font-semibold">Conexões</h1>
          <Button size="sm" variant="outline" onClick={() => select({ mode: "new" })}>
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
          <ConnectionList
            connections={connections.data}
            selectedId={selectedId}
            onSelect={id => select({ mode: "edit", id })}
          />
        )}
      </aside>

      <main className="flex-1 overflow-auto p-6">
        {notice && (
          <p
            role="status"
            className="mb-4 rounded-md border border-amber-500 bg-amber-50 p-3 text-sm text-amber-900"
          >
            {notice}
          </p>
        )}
        {selection.mode === "none" && (
          <p className="text-sm text-muted-foreground">Selecione uma conexão ou crie uma nova.</p>
        )}
        {(selection.mode === "new" || selected) && (
          <ConnectionForm
            key={selected?.id ?? "new"}
            connection={selected}
            onSaved={(id, keychainWarning) => {
              setSelection({ mode: "edit", id });
              setNotice(
                keychainWarning && `Conexão salva, mas a senha não foi guardada: ${keychainWarning}`
              );
            }}
            onDeleted={keychainWarning => {
              setSelection({ mode: "none" });
              setNotice(
                keychainWarning &&
                  `Conexão excluída, mas a senha ficou no keychain: ${keychainWarning}`
              );
            }}
          />
        )}
      </main>
    </div>
  );
}
