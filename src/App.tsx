import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  History,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Sun,
  TriangleAlert
} from "lucide-react";
import { commands, type ConnectionConfig } from "@/bindings";
import { CloseWindowDialog } from "@/components/CloseWindowDialog";
import { Button } from "@/components/ui/button";
import { UpdateDialog } from "@/components/UpdateDialog";
import { ConnectionForm } from "@/features/connections/ConnectionForm";
import { EnvTag } from "@/features/connections/EnvTag";
import { defaultSchemaFor, isSqlEngine } from "@/features/connections/options";
import { useConnections } from "@/features/connections/queries";
import { SqlWorkspace } from "@/features/editor/SqlWorkspace";
import { ConnectionTree } from "@/features/explorer/ConnectionTree";
import { isConnectionQuery } from "@/features/explorer/queries";
import { connectionRowId, useExplorer } from "@/features/explorer/store";
import { CollectionView } from "@/features/mongo/CollectionView";
import { HistoryView } from "@/features/history/HistoryView";
import { CommandPalette } from "@/features/palette/CommandPalette";
import { LegendDialog } from "@/features/palette/LegendDialog";
import type { PaletteTarget } from "@/features/palette/search";
import { RedisView } from "@/features/redis/RedisView";
import { TableView } from "@/features/table/TableView";
import { CloseTabDialog } from "@/features/tabs/CloseTabDialog";
import { TabBar, tabElementId, tabPanelId } from "@/features/tabs/TabBar";
import { focusActiveTab } from "@/features/tabs/focus";
import { useTabs, type Tab } from "@/features/tabs/store";
import { errorMessage } from "@/lib/errors";
import { SIDEBAR_SHORTCUT } from "@/lib/platform";
import { applyTheme, NEXT_THEME, storedTheme, THEME_LABEL, type Theme } from "@/lib/theme";
import { cn } from "@/lib/utils";

// React Flow and elk are only loaded when a diagram is opened
const DiagramView = lazy(() =>
  import("@/features/diagram/DiagramView").then(module => ({ default: module.DiagramView }))
);

/** null connectionId = creating a new connection, from scratch or as a copy of `copyOf` */
type FormState = { connectionId: string | null; copyOf?: string };

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
    keepConnections,
    requestClose,
    requestQuit,
    reopenClosed,
    activate
  } = useTabs();
  const anyConnectionOpen = useExplorer(state => state.expanded.length > 0);
  const setExpanded = useExplorer(state => state.setExpanded);
  const setGroupOpen = useExplorer(state => state.setGroupOpen);
  // the open connection form: shown, or parked behind the tabs with its draft intact
  const [form, setForm] = useState<FormState | null>(null);
  const [formShown, setFormShown] = useState(false);
  const [formEdited, setFormEdited] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [legendOpen, setLegendOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem("sidebar-collapsed") === "1"
  );

  const toggleSidebar = () => setCollapsed(value => !value);

  const [theme, setTheme] = useState(storedTheme);
  const themeLabel = `Tema: ${THEME_LABEL[theme]} (mudar para ${THEME_LABEL[NEXT_THEME[theme]].toLowerCase()})`;
  const cycleTheme = () => {
    applyTheme(NEXT_THEME[theme]);
    setTheme(NEXT_THEME[theme]);
  };

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
  const formConnection = list.find(connection => connection.id === form?.connectionId) ?? null;
  const formSource = list.find(connection => connection.id === form?.copyOf) ?? null;
  const formLabel =
    form?.connectionId !== null
      ? `Editar ${formConnection?.name ?? "conexão"}`
      : formSource
        ? `Cópia de ${formSource.name}`
        : "Nova conexão";
  const activeConnectionId = form && formShown ? form.connectionId : tabConnectionId;
  const active = list.find(connection => connection.id === activeConnectionId) ?? null;
  const isProd = active?.environment === "prod";
  const editorConnectionId = active && isSqlEngine(active.engine) ? active.id : null;

  // app-wide accelerators; each one is also reachable from a visible control
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      // a dialog owns the keyboard while it is open; one still fading out no longer does
      if (
        document.querySelector(
          "[role='dialog']:not([data-state='closed']), [role='alertdialog']:not([data-state='closed'])"
        )
      ) {
        return;
      }
      if (event.key === "F6") {
        event.preventDefault();
        cycleRegion(event.shiftKey ? -1 : 1);
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === "tab" && formShown && tabs.length > 0) {
        // from the form back to the tabs, the draft parked in its own tab
        event.preventDefault();
        showTabs();
        requestAnimationFrame(focusActiveTab);
      } else if (key === "tab" && !formShown && tabs.length > 1) {
        event.preventDefault();
        const index = tabs.findIndex(tab => tab.id === activeId);
        const next = tabs[(index + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
        activate(next.id);
        focusTabSoon(next.id);
      } else if (key === "t" && event.shiftKey && !formShown) {
        // the tab closed last, editor text included (also in the tab's right-click menu)
        event.preventDefault();
        if (reopenClosed()) {
          requestAnimationFrame(focusActiveTab);
        }
      } else if (event.shiftKey) {
        return;
      } else if (key === "q") {
        // closing the window only hides it: this is how the app ends from the keyboard
        event.preventDefault();
        quit();
      } else if (key === "k" || key === "p") {
        event.preventDefault();
        openPalette();
      } else if (key === "b") {
        event.preventDefault();
        setCollapsed(value => !value);
      } else if (key === "t" && editorConnectionId) {
        // an editor on the active SQL connection
        event.preventDefault();
        showTabs();
        openEditor(editorConnectionId);
      } else if (key === "w" && formShown) {
        // the form's tab closes like Cancelar: a typed draft is never dropped without asking
        event.preventDefault();
        if (formEdited) {
          setNotice(
            "O rascunho tem alterações não salvas: Cancelar pede confirmação antes de descartar."
          );
        } else {
          closeForm();
        }
      } else if (key === "w" && activeId) {
        event.preventDefault();
        requestClose(activeId);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    formShown,
    formEdited,
    tabs,
    activeId,
    requestClose,
    requestQuit,
    reopenClosed,
    activate,
    editorConnectionId,
    openEditor
  ]);

  /** Ctrl+Q and "Sair do Ordo": staged edits are asked about first. */
  function quit() {
    if (requestQuit()) {
      void commands.quitApp();
    }
  }

  /** Back to the tabs; an open form is parked in its tab, not dropped. */
  function showTabs() {
    setFormShown(false);
    setNotice(null);
  }

  function closeForm() {
    setForm(null);
    setFormShown(false);
    setFormEdited(false);
  }

  function openForm(connectionId: string | null, copyOf?: string) {
    setNotice(null);
    const sameForm = form?.connectionId === connectionId && form.copyOf === copyOf;
    if (form && formEdited && !sameForm) {
      // one draft at a time: the one typed into comes back instead of being replaced
      setFormShown(true);
      setNotice(
        `${formLabel} tem um rascunho não salvo: salve ou cancele antes de abrir outro formulário.`
      );
      return;
    }
    if (!sameForm) {
      setFormEdited(false);
    }
    setForm({ connectionId, copyOf });
    setFormShown(true);
  }

  function openInEditor(connectionId: string, sql: string) {
    showTabs();
    openEditor(connectionId, sql);
  }

  function openPalette(query = "") {
    setPaletteQuery(query);
    setPaletteOpen(true);
  }

  function createConnection() {
    openForm(null);
  }

  function openFromPalette(target: PaletteTarget) {
    if (target.kind === "newConnection") {
      createConnection();
    } else if (target.kind === "editConnection") {
      openForm(target.connectionId);
    } else if (target.kind === "legend") {
      setLegendOpen(true);
    } else if (target.kind === "connect") {
      // connecting is the user's pick here; the tree lists it and takes focus
      showTabs();
      setExpanded(target.connectionId, true);
      // a folded group would hide the row that takes focus
      const group = list.find(connection => connection.id === target.connectionId)?.group;
      if (group) {
        setGroupOpen(group, true);
      }
      requestAnimationFrame(() =>
        document.getElementById(connectionRowId(target.connectionId))?.focus()
      );
    } else {
      showTabs();
      if (target.kind === "table") {
        openTable(target.target);
      } else if (target.kind === "redis") {
        openRedis(target.target);
      } else if (target.kind === "editor") {
        openEditor(target.connectionId);
      } else if (target.kind === "diagram") {
        openDiagram(target.target);
      } else {
        openHistory();
      }
      // focus follows the pick to the tab it opened
      requestAnimationFrame(focusActiveTab);
    }
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
        // clip: no toolbar may scroll the whole window sideways (and cut the wordmark)
        "relative flex h-screen flex-col overflow-clip bg-background text-foreground",
        // drawn above the panels, whose own backgrounds would hide an inset ring
        isProd &&
          "after:pointer-events-none after:absolute after:inset-0 after:z-40 after:ring-4 after:ring-safelight after:ring-inset"
      )}
    >
      <a
        href="#workspace"
        className="sr-only z-50 bg-background px-3 py-2 text-sm font-semibold focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:ring-2 focus:ring-ring"
      >
        Ir para a área de trabalho
      </a>
      {/* the environment band is always there, so moving between production and the rest never
          shifts the window under the pointer: it changes colour and words, not height.
          Production works under the safelight; the ring is a colour cue, the band says it in words */}
      {isProd && active ? (
        <p className="flex h-7 shrink-0 animate-in items-center gap-3 bg-safelight px-4 text-xs text-white duration-[120ms] fade-in-0 motion-reduce:animate-none">
          <TriangleAlert className="size-3.5" aria-hidden />
          <span className="legend text-[0.75rem]">Produção</span>
          <span className="truncate">
            {active.name} ·{" "}
            {active.readOnly
              ? "somente leitura, imposta pelo banco"
              : "toda escrita pede confirmação com o comando exato"}
          </span>
        </p>
      ) : (
        <p
          className={cn(
            "flex h-7 shrink-0 items-center gap-3 border-b bg-muted px-4 text-xs",
            // in use, the band speaks in ink; with nothing in use it steps back
            active ? "text-foreground" : "text-muted-foreground",
            // staging is a copy of production: half a safelight, the hatch its tag already wears
            active?.environment === "staging" && "border-b-foreground pl-0"
          )}
        >
          {active?.environment === "staging" && (
            <span aria-hidden className="h-full w-8 shrink-0 border-r border-foreground hatch" />
          )}
          {active ? (
            <>
              <EnvTag environment={active.environment} />
              <span className="truncate">
                {active.name} ·{" "}
                {active.readOnly
                  ? "somente leitura, imposta pelo banco"
                  : active.environment === "staging"
                    ? "cópia de produção; comandos destrutivos pedem confirmação"
                    : "comandos destrutivos pedem confirmação; o resto vai direto ao banco"}
              </span>
            </>
          ) : (
            <span>Nenhuma conexão em uso</span>
          )}
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        {/* 240px at the 960px minimum, 288px from 1100px: the grid keeps room for data */}
        <aside
          aria-label="Conexões"
          className={cn(
            "flex shrink-0 flex-col border-r border-foreground grid-paper",
            collapsed ? "w-12" : "w-60 min-[1100px]:w-72"
          )}
        >
          <div
            className={cn(
              "flex shrink-0 border-b border-foreground bg-background",
              // collapsed: the mark on top, the expand button under it (48px fits only one)
              collapsed
                ? "flex-col items-center gap-1 py-2.5"
                : "h-14 items-center justify-between gap-2 pr-2 pl-4"
            )}
          >
            {collapsed ? <Mark /> : <Wordmark />}
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
          {/* collapsed, the tools stay one click away as icons, named aloud and on hover */}
          {collapsed && (
            <nav
              aria-label="Ferramentas"
              className="grid justify-items-center gap-1 border-b border-foreground bg-background py-2"
            >
              <RailButton
                label="Ir para… (Ctrl K)"
                keys="Control+K Control+P"
                onClick={() => openPalette()}
              >
                <Search />
              </RailButton>
              <RailButton label="Nova conexão" onClick={createConnection}>
                <Plus />
              </RailButton>
              <RailButton
                label="Histórico"
                onClick={() => {
                  showTabs();
                  openHistory();
                }}
              >
                <History />
              </RailButton>
              <RailButton label="Legenda" onClick={() => setLegendOpen(true)}>
                <BookOpen />
              </RailButton>
              <RailButton label={themeLabel} onClick={cycleTheme}>
                <ThemeIcon theme={theme} />
              </RailButton>
            </nav>
          )}
          {/* hidden, not unmounted, so the tree keeps its expanded nodes; the attribute keeps F6 out */}
          <div className={cn("contents", collapsed && "hidden")} hidden={collapsed}>
            {/* the brand and this header stay put; only the ledger scrolls */}
            <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 pb-2">
              <h1 className="legend text-muted-foreground">Conexões</h1>
              <Button size="sm" variant="outline" onClick={createConnection}>
                <Plus /> Nova conexão
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {connections.isPending && (
                <p className="px-4 text-sm text-muted-foreground">Carregando conexões…</p>
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
                  editingId={formShown ? (form?.connectionId ?? null) : null}
                  activeTable={!formShown && activeTab?.kind === "table" ? activeTab : null}
                  activeRedis={!formShown && activeTab?.kind === "redis" ? activeTab : null}
                  onEdit={openForm}
                  onDuplicate={connectionId => openForm(null, connectionId)}
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
            <nav
              aria-label="Ferramentas"
              className="grid shrink-0 gap-px border-t border-foreground bg-background p-2"
            >
              <Button
                size="sm"
                variant="ghost"
                className="justify-start"
                aria-keyshortcuts="Control+K Control+P"
                onClick={() => openPalette()}
              >
                <Search /> Ir para…
                <kbd className="ml-auto legend text-muted-foreground">Ctrl K</kbd>
              </Button>
              <div className="grid grid-cols-2 gap-px">
                <Button
                  size="sm"
                  variant="ghost"
                  className="justify-start"
                  onClick={() => {
                    showTabs();
                    openHistory();
                  }}
                >
                  <History /> Histórico
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="justify-start"
                  onClick={() => setLegendOpen(true)}
                >
                  <BookOpen /> Legenda
                </Button>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="justify-start"
                aria-label={themeLabel}
                title={themeLabel}
                onClick={cycleTheme}
              >
                <ThemeIcon theme={theme} /> Tema
                <span className="ml-auto legend text-muted-foreground">{THEME_LABEL[theme]}</span>
              </Button>
            </nav>
          </div>
        </aside>

        <main id="workspace" tabIndex={-1} className="flex min-w-0 flex-1 flex-col outline-none">
          {/* the tabs stay in view over the form: their Δ and production marks never vanish */}
          {(tabs.length > 0 || form) && (
            <TabBar
              connections={list}
              form={
                form && {
                  label: formLabel,
                  edited: formEdited,
                  shown: formShown,
                  onShow: () => setFormShown(true),
                  onLeave: showTabs
                }
              }
            />
          )}
          {notice && (
            <p
              role="status"
              className="m-4 mb-0 border border-foreground bg-background p-3 text-sm text-foreground"
            >
              {notice}
            </p>
          )}
          {form && (form.connectionId === null || formConnection) && (
            // parked, not unmounted: what was typed survives a trip to the tabs
            <div hidden={!formShown} className="overflow-auto p-6">
              <ConnectionForm
                key={form.connectionId ?? `new:${form.copyOf ?? ""}`}
                connection={formConnection}
                copyOf={formSource}
                onCancel={closeForm}
                onEditedChange={setFormEdited}
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
                  closeForm();
                  setNotice(
                    keychainWarning &&
                      `Conexão excluída, mas a senha ficou no keychain: ${keychainWarning}`
                  );
                }}
              />
            </div>
          )}
          {/* the tabs stay mounted under the form: opening it must not drop staged edits */}
          <div hidden={formShown} className="flex min-h-0 flex-1 flex-col">
            {tabs.length === 0 && (
              <EmptyWorkspace
                hasConnections={list.length > 0}
                anyConnectionOpen={anyConnectionOpen}
                onCreate={createConnection}
                onSearch={openPalette}
                onLegend={() => setLegendOpen(true)}
              />
            )}
            <div className={cn("relative min-h-0 flex-1", tabs.length === 0 && "hidden")}>
              {/* every tab stays mounted so results and staged edits survive switching */}
              {tabs.map(tab => (
                <div
                  key={tab.id}
                  role="tabpanel"
                  id={tabPanelId(tab.id)}
                  aria-labelledby={tabElementId(tab.id)}
                  data-view
                  tabIndex={-1}
                  className={cn("absolute inset-0 outline-none", tab.id !== activeId && "hidden")}
                >
                  <TabContent tab={tab} connections={list} onOpenInEditor={openInEditor} />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
      <CloseTabDialog connections={list} />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        connections={list}
        activeConnectionId={tabConnectionId}
        initialQuery={paletteQuery}
        onSelect={openFromPalette}
      />
      <LegendDialog open={legendOpen} onOpenChange={setLegendOpen} />
      <CloseWindowDialog onQuit={quit} />
      <UpdateDialog connections={list} />
    </div>
  );
}

type EmptyWorkspaceProps = {
  hasConnections: boolean;
  anyConnectionOpen: boolean;
  onCreate: () => void;
  onSearch: (query?: string) => void;
  onLegend: () => void;
};

/** First run says what to do first; afterwards, how to get to a table fast. */
function EmptyWorkspace({
  hasConnections,
  anyConnectionOpen,
  onCreate,
  onSearch,
  onLegend
}: EmptyWorkspaceProps) {
  return (
    <div className="grid flex-1 content-center justify-items-start gap-4 px-12 grid-paper">
      <h2 className="display-caps text-4xl">
        {hasConnections ? "Nenhuma aba aberta" : "Comece por uma conexão"}
      </h2>
      <p className="max-w-[52ch] text-sm text-muted-foreground">
        {hasConnections
          ? "Abra uma conexão na lateral e escolha uma tabela, coleção ou banco Redis. Ou vá direto pelo nome."
          : "Ordo abre bancos que já existem: Postgres, MySQL, SQLite, MongoDB e Redis. Cada conexão leva um ambiente; em produção, toda escrita mostra o comando exato antes de rodar."}
      </p>
      <div className="flex flex-wrap gap-2">
        {/* the palette lists tables only of open connections: until one is open, offer to open one */}
        {hasConnections && anyConnectionOpen && (
          <Button onClick={() => onSearch()}>
            <Search /> Ir para…
            <kbd className="ml-1 legend opacity-70">Ctrl K</kbd>
          </Button>
        )}
        {hasConnections && !anyConnectionOpen && (
          <Button onClick={() => onSearch("abrir conexão")}>
            {/* not Ctrl K: this opens the same sheet already filtered to the connections */}
            <Search /> Abrir uma conexão
          </Button>
        )}
        {!hasConnections && (
          <Button onClick={onCreate}>
            <Plus /> Nova conexão
          </Button>
        )}
        <Button variant="outline" onClick={onLegend}>
          <BookOpen /> O que cada marca significa
        </Button>
      </div>
    </div>
  );
}

function focusTabSoon(tabId: string) {
  requestAnimationFrame(() => document.getElementById(tabElementId(tabId))?.focus());
}

type RailButtonProps = {
  label: string;
  keys?: string;
  onClick: () => void;
  children: ReactNode;
};

/** An icon-only tool of the collapsed sidebar: the name is spoken and shown on hover. */
function ThemeIcon({ theme }: { theme: Theme }) {
  return theme === "light" ? <Sun /> : theme === "dark" ? <Moon /> : <Monitor />;
}

function RailButton({ label, keys, onClick, children }: RailButtonProps) {
  return (
    <Button
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      aria-keyshortcuts={keys}
      title={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/**
 * F6 / Shift+F6 regions, in reading order: the sidebar (its tree, or the first tool
 * when collapsed), the tab strip, the view. The view is entered at its primary surface
 * (the grid, the editor), or at the panel itself so the next Tab goes into the view and
 * not back to the strip around it.
 */
function cycleRegion(step: 1 | -1) {
  const aside = document.querySelector<HTMLElement>("aside");
  const tree = document.querySelector<HTMLElement>("[role='tree']");
  const strip = document.querySelector<HTMLElement>("[role='tablist'][aria-label='Abas abertas']");
  const workspace = document.getElementById("workspace");
  const treeRow = tree?.querySelector<HTMLElement>("[tabindex='0']") ?? null;
  const regions = [
    {
      area: aside,
      target:
        treeRow && !treeRow.closest("[hidden]")
          ? treeRow
          : (aside?.querySelector<HTMLElement>("nav button") ?? null)
    },
    {
      area: strip,
      target: strip?.querySelector<HTMLElement>("[role='tab'][tabindex='0']") ?? null
    },
    { area: workspace, target: viewTarget(workspace) }
  ];
  const current = regions.findIndex(region => region.area?.contains(document.activeElement));
  for (let offset = 1; offset <= regions.length; offset++) {
    const index =
      (Math.max(current, step === 1 ? -1 : 0) + step * offset + regions.length * 2) %
      regions.length;
    const { target } = regions[index];
    if (target && !target.closest("[hidden]")) {
      target.focus();
      return;
    }
  }
}

function viewTarget(workspace: HTMLElement | null): HTMLElement | null {
  const panel = workspace?.querySelector<HTMLElement>("[data-view]:not(.hidden)");
  if (!panel || panel.closest("[hidden]")) {
    return workspace;
  }
  return panel.querySelector<HTMLElement>("[role='grid'], .cm-content") ?? panel;
}

/**
 * The mark for the collapsed sidebar, drawn like the tray's (src-tauri/icons/tray.svg):
 * at 32px the app icon's corner cut is 5px and gets lost, the tray's larger O and
 * corner were made for this size.
 */
function Mark() {
  return (
    <svg role="img" aria-label="Ordo" viewBox="0 0 64 64" className="size-8">
      <polygon points="46,0 64,0 64,18" className="fill-select" />
      <rect x="2" y="2" width="60" height="60" fill="none" stroke="currentColor" strokeWidth="4" />
      <path
        d="M25 17H39L47 25V39L39 47H25L17 39V25Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="8"
        strokeLinejoin="miter"
      />
    </svg>
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
  const freshEditorId = useTabs(state => state.freshEditorId);
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
        // a foreign key followed here starts the view over with its filter (never with
        // staged edits: followTable refuses those)
        key={tab.follow?.id}
        initialFilters={tab.follow?.filters}
        connectionId={tab.connectionId}
        schema={tab.schema}
        table={tab.table}
        readOnly={connection.readOnly}
      />
    );
  }
  return (
    <SqlWorkspace
      // a new editor is for typing: what opened it (tree, palette, Ctrl+T) leaves focus there
      autoFocus={tab.id === freshEditorId}
      connectionId={tab.connectionId}
      engine={connection.engine}
      defaultSchema={defaultSchemaFor(connection)}
      sql={tab.sql}
      onSqlChange={sql => setSql(tab.id, sql)}
    />
  );
}
