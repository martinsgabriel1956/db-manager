import { lazy, Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { History } from "lucide-react";
import type { ConnectionConfig } from "@/bindings";
import { Button } from "@/components/ui/button";
import { ConnectionForm } from "@/features/connections/ConnectionForm";
import { defaultSchemaFor } from "@/features/connections/options";
import { useConnections } from "@/features/connections/queries";
import { SqlWorkspace } from "@/features/editor/SqlWorkspace";
import { ConnectionTree } from "@/features/explorer/ConnectionTree";
import { isConnectionQuery } from "@/features/explorer/queries";
import { CollectionView } from "@/features/mongo/CollectionView";
import { HistoryView } from "@/features/history/HistoryView";
import { RedisView } from "@/features/redis/RedisView";
import { TableView } from "@/features/table/TableView";
import { TabBar } from "@/features/tabs/TabBar";
import { useTabs, type Tab } from "@/features/tabs/store";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

// React Flow and elk are only loaded when a diagram is opened
const DiagramView = lazy(() =>
  import("@/features/diagram/DiagramView").then(module => ({ default: module.DiagramView }))
);

/** null connectionId = creating a new connection */
type FormState = { connectionId: string | null };

type TabContentProps = {
  tab: Tab;
  connections: ConnectionConfig[];
  onOpenInEditor: (connectionId: string, sql: string) => void;
};

export function App() {
  const connections = useConnections();
  const queryClient = useQueryClient();
  const {
    tabs,
    activeId,
    openTable,
    openEditor,
    openRedis,
    openDiagram,
    openHistory,
    keepConnections
  } = useTabs();
  const [form, setForm] = useState<FormState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (connections.data) {
      keepConnections(connections.data.map(connection => connection.id));
    }
  }, [connections.data, keepConnections]);

  const list = connections.data ?? [];
  const activeTab = tabs.find(tab => tab.id === activeId) ?? null;
  const tabConnectionId = activeTab && activeTab.kind !== "history" ? activeTab.connectionId : null;
  const activeConnectionId = form ? form.connectionId : tabConnectionId;
  const active = list.find(connection => connection.id === activeConnectionId) ?? null;
  const isProd = active?.environment === "prod";

  function showTabs() {
    setForm(null);
    setNotice(null);
  }

  function openInEditor(connectionId: string, sql: string) {
    showTabs();
    openEditor(connectionId, sql);
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
        <div className="flex items-center justify-between gap-2 px-3">
          <h1 className="text-sm font-semibold">Conexões</h1>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                showTabs();
                openHistory();
              }}
            >
              <History /> Histórico
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setNotice(null);
                setForm({ connectionId: null });
              }}
            >
              Nova
            </Button>
          </div>
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
            activeTable={!form && activeTab?.kind === "table" ? activeTab : null}
            activeRedis={!form && activeTab?.kind === "redis" ? activeTab : null}
            onEdit={connectionId => {
              setNotice(null);
              setForm({ connectionId });
            }}
            onOpenTable={target => {
              showTabs();
              openTable(target);
            }}
            onOpenEditor={connectionId => {
              showTabs();
              openEditor(connectionId);
            }}
            onOpenRedis={target => {
              showTabs();
              openRedis(target);
            }}
            onOpenDiagram={target => {
              showTabs();
              openDiagram(target);
            }}
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
        {form ? (
          (form.connectionId === null || active) && (
            <div className="overflow-auto p-6">
              <ConnectionForm
                key={form.connectionId ?? "new"}
                connection={active}
                onSaved={(id, keychainWarning) => {
                  dropConnectionCache(id);
                  setForm({ connectionId: id });
                  setNotice(
                    keychainWarning &&
                      `Conexão salva, mas a senha não foi guardada: ${keychainWarning}`
                  );
                }}
                onDeleted={keychainWarning => {
                  if (form.connectionId) {
                    dropConnectionCache(form.connectionId);
                  }
                  setForm(null);
                  setNotice(
                    keychainWarning &&
                      `Conexão excluída, mas a senha ficou no keychain: ${keychainWarning}`
                  );
                }}
              />
            </div>
          )
        ) : (
          <>
            {tabs.length > 0 && <TabBar connections={list} />}
            {tabs.length === 0 && (
              <p className="p-6 text-sm text-muted-foreground">
                Abra uma conexão na lateral para navegar pelas tabelas, ou crie uma nova.
              </p>
            )}
            <div className="relative min-h-0 flex-1">
              {/* every tab stays mounted so results and staged edits survive switching */}
              {tabs.map(tab => (
                <div
                  key={tab.id}
                  className={cn("absolute inset-0", tab.id !== activeId && "hidden")}
                >
                  <TabContent tab={tab} connections={list} onOpenInEditor={openInEditor} />
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function TabContent({ tab, connections, onOpenInEditor }: TabContentProps) {
  const setSql = useTabs(state => state.setSql);
  const openTable = useTabs(state => state.openTable);

  if (tab.kind === "history") {
    return <HistoryView connections={connections} onOpenInEditor={onOpenInEditor} />;
  }
  const connection = connections.find(c => c.id === tab.connectionId);
  if (!connection) {
    return null;
  }
  if (tab.kind === "diagram") {
    return (
      <Suspense fallback={<p className="p-4 text-sm text-muted-foreground">Carregando…</p>}>
        <DiagramView connectionId={tab.connectionId} schema={tab.schema} onOpenTable={openTable} />
      </Suspense>
    );
  }
  if (tab.kind === "redis") {
    return <RedisView connection={connection} db={tab.db} />;
  }
  if (tab.kind === "table" && connection.engine === "mongo") {
    return (
      <CollectionView
        connectionId={tab.connectionId}
        database={tab.schema}
        collection={tab.table}
        readOnly={connection.readOnly}
      />
    );
  }
  if (tab.kind === "table") {
    return (
      <TableView
        connectionId={tab.connectionId}
        schema={tab.schema}
        table={tab.table}
        readOnly={connection.readOnly}
      />
    );
  }
  return (
    <SqlWorkspace
      connectionId={tab.connectionId}
      connectionName={connection.name}
      engine={connection.engine}
      defaultSchema={defaultSchemaFor(connection)}
      sql={tab.sql}
      onSqlChange={sql => setSql(tab.id, sql)}
    />
  );
}
