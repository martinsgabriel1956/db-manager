import type { KeyboardEvent } from "react";
import { Database, History, Network, SquareTerminal, Table2, X } from "lucide-react";
import type { ConnectionConfig } from "@/bindings";
import { EnvTag } from "@/features/connections/EnvTag";
import { ENGINE_CODE, ENGINE_LABEL } from "@/features/connections/options";
import { tableKey, useTabs, type Tab } from "@/features/tabs/store";
import { cn } from "@/lib/utils";

type TabBarProps = { connections: ConnectionConfig[] };

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

/** Ids that tie each open tab to its panel in App. */
export function tabElementId(tabId: string): string {
  return `open-tab-${tabId}`;
}

export function tabPanelId(tabId: string): string {
  return `open-tab-panel-${tabId}`;
}

export function TabBar({ connections }: TabBarProps) {
  const { tabs, activeId, activate, close, pending } = useTabs();

  function focusTab(index: number) {
    const tab = tabs[(index + tabs.length) % tabs.length];
    activate(tab.id);
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
      close(id);
      // keep focus in the strip on the neighbour that takes its place
      const next = tabs[index + 1] ?? tabs[index - 1];
      if (next) {
        requestAnimationFrame(() => document.getElementById(tabElementId(next.id))?.focus());
      }
    } else {
      return;
    }
    event.preventDefault();
  }

  return (
    <div
      role="tablist"
      aria-label="Abas abertas"
      className="flex h-9 shrink-0 overflow-x-auto border-b border-foreground bg-muted [scrollbar-width:thin]"
    >
      {tabs.map((tab, index) => {
        const label = tabLabel(tab, connections);
        const { connection, title } = tabParts(tab, connections);
        const Icon = ICON[tab.kind];
        const engine = connection?.engine ?? null;
        const isActive = tab.id === activeId;
        const staged = tab.kind === "table" ? (pending[tableKey(tab)] ?? 0) : 0;
        const isProd = connection?.environment === "prod";
        // spelled out: the visible parts are separate spans that would read run together
        const accessibleName = [
          label,
          isProd ? " · produção" : "",
          staged > 0
            ? ` (${staged} ${staged === 1 ? "alteração pendente" : "alterações pendentes"})`
            : ""
        ].join("");
        return (
          <div
            key={tab.id}
            role="presentation"
            className={cn(
              "group flex shrink-0 items-center border-r text-sm",
              isActive
                ? // the system's one diagonal: the active tab's corner is cut in blue
                  "relative -mb-px bg-background font-semibold shadow-[inset_0_3px_0_var(--select)] after:absolute after:top-0 after:right-0 after:size-2.5 after:bg-select after:[clip-path:polygon(0_0,100%_0,100%_100%)]"
                : "text-muted-foreground hover:bg-background hover:text-foreground"
            )}
          >
            {/* the engine code, read before the connection name */}
            {engine && (
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
              aria-selected={isActive}
              aria-controls={tabPanelId(tab.id)}
              aria-keyshortcuts="Delete"
              tabIndex={isActive ? 0 : -1}
              onClick={() => activate(tab.id)}
              onKeyDown={event => handleKeyDown(event, index, tab.id)}
              onAuxClick={event => event.button === 1 && close(tab.id)}
              className={cn(
                "flex max-w-72 min-w-0 items-center gap-1.5 py-1.5 pr-1 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                engine ? "pl-1.5" : "pl-3"
              )}
            >
              <Icon className="size-3.5 shrink-0" />
              {/* the connection gives way first, so the table name stays readable */}
              {connection && (
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
              onClick={() => close(tab.id)}
              className="mr-0.5 grid size-6 place-items-center text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
