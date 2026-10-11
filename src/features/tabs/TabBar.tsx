import type { KeyboardEvent } from "react";
import { Database, History, Network, SquareTerminal, Table2, X } from "lucide-react";
import type { ConnectionConfig } from "@/bindings";
import { ENGINE_CAP } from "@/features/connections/options";
import { useTabs, type Tab } from "@/features/tabs/store";
import { cn } from "@/lib/utils";

type TabBarProps = { connections: ConnectionConfig[] };

export function tabLabel(tab: Tab, connections: ConnectionConfig[]): string {
  if (tab.kind === "history") {
    return "Histórico";
  }
  if (tab.kind === "table") {
    return tab.table;
  }
  const connection = connections.find(c => c.id === tab.connectionId);
  const title =
    tab.kind === "redis" ? `db${tab.db}` : tab.kind === "diagram" ? `ER ${tab.schema}` : tab.title;
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
  const { tabs, activeId, activate, close } = useTabs();

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
      className="flex shrink-0 overflow-x-auto border-b bg-muted/40 [scrollbar-width:thin]"
    >
      {tabs.map((tab, index) => {
        const label = tabLabel(tab, connections);
        const Icon = ICON[tab.kind];
        const engine =
          tab.kind === "history"
            ? null
            : (connections.find(c => c.id === tab.connectionId)?.engine ?? null);
        const isActive = tab.id === activeId;
        return (
          <div
            key={tab.id}
            role="presentation"
            className={cn(
              "group flex shrink-0 items-center border-r text-sm",
              isActive
                ? "bg-background font-medium shadow-[inset_0_2px_0_var(--select)]"
                : "text-muted-foreground hover:bg-background/60"
            )}
          >
            <button
              type="button"
              role="tab"
              id={tabElementId(tab.id)}
              aria-selected={isActive}
              aria-controls={tabPanelId(tab.id)}
              aria-keyshortcuts="Delete"
              tabIndex={isActive ? 0 : -1}
              onClick={() => activate(tab.id)}
              onKeyDown={event => handleKeyDown(event, index, tab.id)}
              onAuxClick={event => event.button === 1 && close(tab.id)}
              className="flex max-w-56 items-center gap-1.5 py-1.5 pr-1 pl-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            >
              {/* the tube-cap colour of the tab's engine */}
              {engine && (
                <span
                  aria-hidden
                  className={cn("size-2 shrink-0 rounded-[1px]", ENGINE_CAP[engine])}
                />
              )}
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
            {/* keyboard users close with Delete on the tab, so this stays out of the tab order */}
            <button
              type="button"
              tabIndex={-1}
              aria-label={`Fechar aba ${label}`}
              onClick={() => close(tab.id)}
              className="mr-1 rounded-[2px] p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
