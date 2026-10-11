import { History, SquareTerminal, Table2, X } from "lucide-react";
import type { ConnectionConfig } from "@/bindings";
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
  return connection ? `${connection.name} · ${tab.title}` : tab.title;
}

const ICON = { table: Table2, editor: SquareTerminal, history: History };

export function TabBar({ connections }: TabBarProps) {
  const { tabs, activeId, activate, close } = useTabs();

  return (
    <div
      role="tablist"
      aria-label="Abas abertas"
      className="flex shrink-0 overflow-x-auto border-b bg-muted/40"
    >
      {tabs.map(tab => {
        const label = tabLabel(tab, connections);
        const Icon = ICON[tab.kind];
        const isActive = tab.id === activeId;
        return (
          <div
            key={tab.id}
            className={cn(
              "group flex shrink-0 items-center border-r text-sm",
              isActive ? "bg-background" : "text-muted-foreground hover:bg-background/60"
            )}
          >
            <button
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => activate(tab.id)}
              onAuxClick={event => event.button === 1 && close(tab.id)}
              className="flex max-w-56 items-center gap-1.5 py-1.5 pr-1 pl-3"
            >
              <Icon className="size-3.5 shrink-0" />
              <span className="truncate">{label}</span>
            </button>
            <button
              type="button"
              aria-label={`Fechar aba ${label}`}
              onClick={() => close(tab.id)}
              className="mr-1 rounded p-0.5 opacity-60 hover:bg-muted hover:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
