import { lazy, Suspense, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { History, PanelLeftClose, PanelLeftOpen, Plus, TriangleAlert } from "lucide-react";
import type { ConnectionConfig } from "@/bindings";
import { Button } from "@/components/ui/button";
import { ConnectionForm } from "@/features/connections/ConnectionForm";
import { defaultSchemaFor, isSqlEngine } from "@/features/connections/options";
import { useConnections } from "@/features/connections/queries";
import { SqlWorkspace } from "@/features/editor/SqlWorkspace";
import { ConnectionTree } from "@/features/explorer/ConnectionTree";
import { isConnectionQuery } from "@/features/explorer/queries";
import { CollectionView } from "@/features/mongo/CollectionView";
import { HistoryView } from "@/features/history/HistoryView";
import { RedisView } from "@/features/redis/RedisView";
import { TableView } from "@/features/table/TableView";
import { TabBar, tabElementId, tabPanelId } from "@/features/tabs/TabBar";
import { useTabs, type Tab } from "@/features/tabs/store";
import { errorMessage } from "@/lib/errors";
import { SIDEBAR_SHORTCUT } from "@/lib/platform";
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
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebar-collapsed") === "1"
  );

  const toggleSidebar = () => setCollapsed(value => !value);

  useEffect(() => {
    localStorage.setItem("sidebar-collapsed", collapsed ? "1" : "0");
  }, [collapsed]);

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
  const editorConnectionId = active && isSqlEngine(active.engine) ? active.id : null;

  // Ctrl+B toggles the sidebar, Ctrl+T opens an editor on the active SQL connection
  // (Cmd on macOS), from anywhere in the window
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        setCollapsed(value => !value);
      } else if (key === "t" && editorConnectionId) {
        event.preventDefault();
        setForm(null);
        setNotice(null);
        openEditor(editorConnectionId);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editorConnectionId, openEditor]);

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
        "relative flex h-screen flex-col bg-background text-foreground",
        // drawn above the panels, whose own backgrounds would hide an inset ring
        isProd &&
          "after:pointer-events-none after:absolute after:inset-0 after:z-40 after:ring-4 after:ring-safelight after:ring-inset"
      )}
    >
      {/* production works under the safelight: the ring is a colour cue, the band says it in words */}
      {isProd && active && (
        <p className="flex h-7 shrink-0 animate-in items-center gap-3 bg-safelight px-4 text-xs text-white duration-[120ms] fade-in-0 slide-in-from-top-1 motion-reduce:animate-none">
          <TriangleAlert className="size-3.5" aria-hidden />
          <span className="legend text-[0.75rem]">Produção</span>
          <span>
            {active.name} ·{" "}
            {active.readOnly
              ? "somente leitura, imposta pelo banco"
              : "toda escrita pede confirmação com o comando exato"}
          </span>
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            "flex shrink-0 flex-col overflow-y-auto border-r border-foreground grid-paper",
            collapsed ? "w-12" : "w-72"
          )}
        >
          <div
            className={cn(
              "flex h-14 shrink-0 items-center border-b border-foreground bg-background",
              collapsed ? "justify-center" : "justify-between gap-2 pr-2 pl-4"
            )}
          >
            {!collapsed && <Wordmark />}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={collapsed ? "Expandir lateral" : "Recolher lateral"}
              aria-expanded={!collapsed}
              aria-keyshortcuts="Control+B"
              title={`${collapsed ? "Expandir" : "Recolher"} lateral (${SIDEBAR_SHORTCUT})`}
              onClick={toggleSidebar}
            >
              {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
            </Button>
          </div>
          {/* hidden, not unmounted, so the tree keeps its expanded nodes */}
          <div className={cn("contents", collapsed && "hidden")}>
            <div className="flex items-center justify-between gap-2 px-4 pt-4 pb-2">
              <h1 className="legend text-muted-foreground">Conexões</h1>
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
                  <Plus /> Nova
                </Button>
              </div>
            </div>
            {connections.isPending && (
              <p className="px-4 text-sm text-muted-foreground">Carregando…</p>
            )}
            {connections.isError && (
              <p
                role="alert"
                className="mx-4 border border-destructive bg-background p-2 text-sm text-destructive"
              >
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
          </div>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {notice && (
            <p
              role="status"
              className="m-4 mb-0 border border-foreground bg-background p-3 text-sm text-foreground"
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
                <div className="grid flex-1 content-center justify-items-start gap-3 px-12 grid-paper">
                  <h2 className="display-caps text-6xl">Nenhuma aba aberta</h2>
                  <p className="max-w-[46ch] text-sm text-muted-foreground">
                    Abra uma conexão na lateral para navegar pelas tabelas, ou crie uma nova.
                  </p>
                </div>
              )}
              <div className={cn("relative min-h-0 flex-1", tabs.length === 0 && "hidden")}>
                {/* every tab stays mounted so results and staged edits survive switching */}
                {tabs.map(tab => (
                  <div
                    key={tab.id}
                    role="tabpanel"
                    id={tabPanelId(tab.id)}
                    aria-labelledby={tabElementId(tab.id)}
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
    </div>
  );
}

/** ORDO/: the gridded name closed by the system's one diagonal. */
function Wordmark() {
  return (
    <p className="flex items-center">
      <span className="display-caps text-[1.75rem] [font-stretch:75%] tracking-[0.14em]">Ordo</span>
      <svg aria-hidden viewBox="0 0 16 24" className="-ml-0.5 h-7 w-4 text-select">
        <line x1="2" y1="23" x2="14" y2="1" stroke="currentColor" strokeWidth="2.5" />
      </svg>
    </p>
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
