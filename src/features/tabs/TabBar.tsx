import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import {
  Braces,
  ChevronDown,
  Database,
  History,
  Network,
  Plug,
  RotateCcw,
  SquareTerminal,
  Table2,
  X
} from "lucide-react";
import type { ConnectionConfig } from "@/bindings";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { EnvTag } from "@/features/connections/EnvTag";
import { ENGINE_CODE, ENGINE_LABEL } from "@/features/connections/options";
import { tableKey, useTabs, type Tab } from "@/features/tabs/store";
import { cn } from "@/lib/utils";

/**
 * The connection form, shown as a tab of its own while it is open: the open tabs and
 * their Δ stay in view, and leaving it parks the draft instead of dropping it.
 */
export type FormTab = {
  label: string;
  /** typed but not saved */
  edited: boolean;
  shown: boolean;
  onShow: () => void;
  /** a regular tab was picked: the form steps aside */
  onLeave: () => void;
};

type TabBarProps = { connections: ConnectionConfig[]; form?: FormTab | null };

export const FORM_TAB_ID = "open-tab-connection-form";

type TabParts = { connection: ConnectionConfig | null; title: string };

/** Every tab but history names its connection: two `users` tables must never read alike. */
function tabParts(tab: Tab, connections: ConnectionConfig[]): TabParts {
  if (tab.kind === "history") {
    return { connection: null, title: "Histórico" };
  }
  const connection = connections.find(c => c.id === tab.connectionId) ?? null;
  const title =
    tab.kind === "table"
      ? tab.table
      : tab.kind === "redis"
        ? `db${tab.db}`
        : tab.kind === "diagram"
          ? `ER ${tab.schema}`
          : tab.title;
  return { connection, title };
}

export function tabLabel(tab: Tab, connections: ConnectionConfig[]): string {
  const { connection, title } = tabParts(tab, connections);
  return connection ? `${connection.name} · ${title}` : title;
}

const ICON = {
  table: Table2,
  editor: SquareTerminal,
  redis: Database,
  diagram: Network,
  history: History
};

/** A Mongo collection opens as a table tab, but it holds documents: its own glyph, as in the tree. */
function tabIcon(tab: Tab, connection: ConnectionConfig | null) {
  return tab.kind === "table" && connection?.engine === "mongo" ? Braces : ICON[tab.kind];
}

/** Ids that tie each open tab to its panel in App. */
export function tabElementId(tabId: string): string {
  return `open-tab-${tabId}`;
}

export function tabPanelId(tabId: string): string {
  return `open-tab-panel-${tabId}`;
}

/** Visible width of a tab the left edge cuts through; 0 when a tab starts right at the edge. */
function leftFragment(strip: HTMLElement): number {
  const left = strip.scrollLeft;
  for (const child of Array.from(strip.children)) {
    const tab = child as HTMLElement;
    const end = tab.offsetLeft + tab.offsetWidth;
    if (end > left) {
      return tab.offsetLeft < left - 1 ? end - left : 0;
    }
  }
  return 0;
}

export function TabBar({ connections, form = null }: TabBarProps) {
  const {
    tabs,
    activeId,
    activate,
    requestClose,
    requestCloseTabs,
    reopenClosed,
    closed,
    pending
  } = useTabs();
  // one connection open: the view header names it, so the tabs drop the repeated prefix
  const connectionIds = new Set(
    tabs.flatMap(tab => (tab.kind === "history" ? [] : [tab.connectionId]))
  );
  const showConnection = connectionIds.size > 1;

  const stripRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);
  /**
   * Width of the tab cut by the strip's left edge. That fragment is masked out whole:
   * a stray "PROD ×" with no name in front of it reads as a tag of the tab beside it.
   */
  const [cutStart, setCutStart] = useState(0);

  // the strip clips tabs past its edge: measure it whenever the tabs or the window change
  useLayoutEffect(() => {
    const strip = stripRef.current;
    if (!strip) {
      return;
    }
    const measure = () => {
      setOverflowing(strip.scrollWidth > strip.clientWidth);
      setCutStart(leftFragment(strip));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [tabs.length]);

  // a new or reactivated tab may sit past the strip's edge; "Todas as abas" appearing
  // narrows the strip, and a Δ appearing widens the tab, so scroll again after either.
  // The whole tab comes into view, its Δ and × included, not only the button that names it.
  const activeTab = tabs.find(tab => tab.id === activeId);
  const activeStaged = activeTab?.kind === "table" ? (pending[tableKey(activeTab)] ?? 0) : 0;
  /** with the form shown, no regular tab is the current one */
  const away = form?.shown ?? false;
  // the form tab is the current one while shown: it scrolls into view the same way
  const currentId = away ? FORM_TAB_ID : activeId ? tabElementId(activeId) : null;
  useEffect(() => {
    if (currentId) {
      document
        .getElementById(currentId)
        ?.parentElement?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }, [currentId, overflowing, activeStaged]);

  // a short fragment (a lone "PROD ×") goes whole; a wide one keeps its name and only fades in
  const cutMask =
    cutStart === 0
      ? null
      : cutStart <= 96
        ? `linear-gradient(to right, transparent ${cutStart}px, black ${cutStart + 12}px)`
        : "linear-gradient(to right, transparent, black 32px)";

  // what the overflow menu holds, summed on its trigger: staged work and production
  // must not hide past the edge just because the tab that carries them did
  const stagedTotal = tabs.reduce(
    (sum, tab) => sum + (tab.kind === "table" ? (pending[tableKey(tab)] ?? 0) : 0),
    0
  );
  const anyProd = tabs.some(tab => tabParts(tab, connections).connection?.environment === "prod");
  const overflowName = [
    `Todas as abas (${tabs.length})`,
    stagedTotal > 0
      ? `, ${stagedTotal} ${stagedTotal === 1 ? "alteração pendente" : "alterações pendentes"}`
      : "",
    anyProd ? ", inclui produção" : ""
  ].join("");

  function select(id: string) {
    activate(id);
    if (away) {
      form?.onLeave();
    }
  }

  function focusForm() {
    form?.onShow();
    document.getElementById(FORM_TAB_ID)?.focus();
  }

  /** the form tab, when open, sits before the first tab in the arrow order */
  function focusTab(index: number) {
    if (form && (index === -1 || index === tabs.length)) {
      focusForm();
      return;
    }
    if (tabs.length === 0) {
      return;
    }
    const tab = tabs[(index + tabs.length) % tabs.length];
    select(tab.id);
    document.getElementById(tabElementId(tab.id))?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number, id: string) {
    if (event.key === "ArrowRight") {
      focusTab(index + 1);
    } else if (event.key === "ArrowLeft") {
      focusTab(index - 1);
    } else if (event.key === "Home") {
      focusTab(0);
    } else if (event.key === "End") {
      focusTab(tabs.length - 1);
    } else if (event.key === "Delete") {
      // with staged edits the discard dialog takes focus instead
      const closed = requestClose(id);
      // keep focus in the strip on the neighbour that takes its place
      const next = tabs[index + 1] ?? tabs[index - 1];
      if (closed && next) {
        requestAnimationFrame(() => document.getElementById(tabElementId(next.id))?.focus());
      }
    } else {
      return;
    }
    event.preventDefault();
  }

  return (
    <div className="flex h-9 shrink-0 border-b border-foreground bg-muted">
      <div
        ref={stripRef}
        role="tablist"
        aria-label="Abas abertas"
        onScroll={event => setCutStart(leftFragment(event.currentTarget))}
        // no scrollbar stealing height from the tabs: the wheel scrolls the strip sideways
        onWheel={event => {
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            event.currentTarget.scrollLeft += event.deltaY;
          }
        }}
        style={cutMask ? { maskImage: cutMask, WebkitMaskImage: cutMask } : undefined}
        className="relative flex min-w-0 flex-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {form && (
          <div
            role="presentation"
            className={cn(
              "flex shrink-0 items-center border-r text-sm",
              form.shown
                ? "relative -mb-px bg-background font-semibold shadow-[inset_0_3px_0_var(--select)] after:absolute after:top-0 after:right-0 after:size-2.5 after:bg-select after:[clip-path:polygon(0_0,100%_0,100%_100%)]"
                : "text-muted-foreground hover:bg-background hover:text-foreground"
            )}
          >
            <button
              type="button"
              role="tab"
              id={FORM_TAB_ID}
              // spelled out: the label and the "rascunho" mark would read run together
              aria-label={form.edited ? `${form.label} · rascunho` : form.label}
              aria-selected={form.shown}
              tabIndex={form.shown ? 0 : -1}
              onClick={form.onShow}
              onKeyDown={event => {
                if (event.key === "ArrowRight" || event.key === "End") {
                  event.preventDefault();
                  focusTab(event.key === "End" ? tabs.length - 1 : 0);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  focusTab(tabs.length - 1);
                }
              }}
              className="flex max-w-60 min-w-0 items-center gap-1.5 py-1.5 pr-3 pl-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              <Plug className="size-3.5 shrink-0" />
              <span className="min-w-0 truncate">{form.label}</span>
              {/* the "retido" dotted outline: held, not saved */}
              {form.edited && (
                <span className="h-[18px] shrink-0 border border-dotted border-foreground px-1 legend leading-4">
                  rascunho
                </span>
              )}
            </button>
          </div>
        )}
        {tabs.map((tab, index) => {
          const label = tabLabel(tab, connections);
          const { connection, title } = tabParts(tab, connections);
          const Icon = tabIcon(tab, connection);
          const engine = connection?.engine ?? null;
          const isActive = !away && tab.id === activeId;
          const staged = tab.kind === "table" ? (pending[tableKey(tab)] ?? 0) : 0;
          const isProd = connection?.environment === "prod";
          // spelled out: the visible parts are separate spans that would read run together
          const accessibleName = [
            label,
            isProd ? " · produção" : "",
            connection?.readOnly ? " · somente leitura" : "",
            staged > 0
              ? ` (${staged} ${staged === 1 ? "alteração pendente" : "alterações pendentes"})`
              : ""
          ].join("");
          return (
            // right click (or the menu key / Shift+F10 on the tab) closes this tab or all of them
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <div
                  role="presentation"
                  className={cn(
                    "group flex shrink-0 items-center border-r text-sm",
                    // the tab a right click acts on stays marked while its menu is open
                    !isActive &&
                      "data-[state=open]:bg-background data-[state=open]:text-foreground data-[state=open]:shadow-[inset_0_0_0_1px_var(--foreground)]",
                    isActive
                      ? // the system's one diagonal: the active tab's corner is cut in blue
                        "relative -mb-px bg-background font-semibold shadow-[inset_0_3px_0_var(--select)] after:absolute after:top-0 after:right-0 after:size-2.5 after:bg-select after:[clip-path:polygon(0_0,100%_0,100%_100%)]"
                      : "text-muted-foreground hover:bg-background hover:text-foreground"
                  )}
                >
                  {/* the engine code names a lone connection's tabs; with several, the name does */}
                  {engine && !showConnection && (
                    <span
                      title={ENGINE_LABEL[engine]}
                      aria-hidden
                      className="pl-3 legend text-muted-foreground"
                    >
                      {ENGINE_CODE[engine]}
                    </span>
                  )}
                  <button
                    type="button"
                    role="tab"
                    id={tabElementId(tab.id)}
                    aria-label={accessibleName}
                    // the whole name on hover, when the strip truncates it
                    title={accessibleName}
                    aria-selected={isActive}
                    aria-controls={tabPanelId(tab.id)}
                    aria-keyshortcuts="Delete"
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => select(tab.id)}
                    onKeyDown={event => handleKeyDown(event, index, tab.id)}
                    onAuxClick={event => event.button === 1 && requestClose(tab.id)}
                    className={cn(
                      "flex max-w-60 min-w-0 items-center gap-1.5 py-1.5 pr-1 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      engine && !showConnection ? "pl-1.5" : "pl-3"
                    )}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    {/* the connection gives way first, so the table name stays readable */}
                    {connection && showConnection && (
                      // room for "Postgres prod": two names that share a prefix still part
                      <span className="max-w-28 min-w-0 shrink-[2] truncate font-normal">
                        {connection.name} ·
                      </span>
                    )}
                    <span className="min-w-0 truncate">{title}</span>
                    {/* production is printed on the tab itself, not only once the tab is active */}
                    {isProd && <EnvTag environment="prod" />}
                  </button>
                  {/* staged exposure on this table: the same Δ the save button carries */}
                  {staged > 0 && (
                    <span
                      aria-hidden
                      title={`${staged === 1 ? "1 alteração pendente" : `${staged} alterações pendentes`}: salve ou descarte na tabela`}
                      className="mr-0.5 h-[18px] bg-foreground px-1 font-mono text-[11px] leading-[18px] text-background"
                    >
                      Δ {staged}
                    </span>
                  )}
                  {/* keyboard users close with Delete on the tab, so this stays out of the tab order */}
                  <button
                    type="button"
                    tabIndex={-1}
                    aria-label={`Fechar aba ${label}`}
                    onClick={() => requestClose(tab.id)}
                    className="mr-0.5 grid size-6 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent
                className="max-w-80"
                // the tab that opened the menu may be gone: land on whichever tab is active now
                onCloseAutoFocus={event => {
                  event.preventDefault();
                  // read now, not from this render: the menu's pick may have closed tabs
                  const { activeId: nowActive } = useTabs.getState();
                  if (nowActive) {
                    document.getElementById(tabElementId(nowActive))?.focus();
                  }
                }}
              >
                <ContextMenuItem onSelect={() => requestClose(tab.id)}>
                  <X /> Fechar aba <span className="min-w-0 truncate font-semibold">{label}</span>
                </ContextMenuItem>
                {/* pl-8: in line with the labels that follow an icon */}
                <ContextMenuItem
                  className="pl-8"
                  disabled={tabs.length === 1}
                  onSelect={() =>
                    requestCloseTabs(tabs.filter(open => open.id !== tab.id).map(open => open.id))
                  }
                >
                  Fechar outras abas
                </ContextMenuItem>
                <ContextMenuItem
                  className="pl-8"
                  onSelect={() => requestCloseTabs(tabs.map(open => open.id))}
                >
                  Fechar todas as abas ({tabs.length})
                </ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem disabled={closed.length === 0} onSelect={reopenClosed}>
                  <RotateCcw /> Reabrir aba fechada
                  <kbd className="ml-auto pl-4 font-mono text-[11px] opacity-70">Ctrl Shift T</kbd>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      {/* past the edge, every tab is still one pick away */}
      {overflowing && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={overflowName}
              className="flex shrink-0 items-center gap-1.5 border-l border-foreground px-2.5 text-xs text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              Todas as abas ({tabs.length}){anyProd && <EnvTag environment="prod" />}
              {stagedTotal > 0 && (
                <span className="h-[18px] bg-foreground px-1 font-mono text-[11px] leading-[18px] text-background">
                  Δ {stagedTotal}
                </span>
              )}
              <ChevronDown className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-80 max-w-96 overflow-y-auto">
            {tabs.map(tab => {
              const { connection, title } = tabParts(tab, connections);
              const Icon = tabIcon(tab, connection);
              const isActive = !away && tab.id === activeId;
              const staged = tab.kind === "table" ? (pending[tableKey(tab)] ?? 0) : 0;
              return (
                // the same marks as the strip: blue rule where you are, PROD, Δ
                <DropdownMenuItem
                  key={tab.id}
                  onSelect={() => select(tab.id)}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(isActive && "font-semibold shadow-[inset_3px_0_0_var(--select)]")}
                >
                  <Icon />
                  {connection && (
                    <span className="max-w-32 min-w-0 shrink-[2] truncate font-normal">
                      {connection.name} ·
                    </span>
                  )}
                  <span className="min-w-0 truncate">{title}</span>
                  {connection?.environment === "prod" && <EnvTag environment="prod" />}
                  {staged > 0 && (
                    <span className="ml-auto h-[18px] shrink-0 bg-foreground px-1 font-mono text-[11px] leading-[18px] text-background">
                      <span className="sr-only">
                        {staged === 1 ? "1 alteração pendente" : `${staged} alterações pendentes`}
                      </span>
                      <span aria-hidden>Δ {staged}</span>
                    </span>
                  )}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
