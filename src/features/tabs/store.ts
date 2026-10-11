import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { tauriStorage } from "@/features/tabs/storage";

export type TableTarget = { connectionId: string; schema: string; table: string };

export type TableTab = { id: string; kind: "table" } & TableTarget;
export type EditorTab = {
  id: string;
  kind: "editor";
  connectionId: string;
  title: string;
  sql: string;
};
export type HistoryTab = { id: "history"; kind: "history" };
export type Tab = TableTab | EditorTab | HistoryTab;

type TabsState = {
  tabs: Tab[];
  activeId: string | null;
  /** focuses the table's tab if already open */
  openTable: (target: TableTarget) => void;
  /** always a new tab: several editors per connection are allowed */
  openEditor: (connectionId: string, sql?: string) => void;
  openHistory: () => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  /** drops tabs of connections that no longer exist (deleted, or stale persisted state) */
  keepConnections: (connectionIds: string[]) => void;
  setSql: (id: string, sql: string) => void;
};

export const INITIAL_TABS = { tabs: [] as Tab[], activeId: null };

function nextEditorTitle(tabs: Tab[], connectionId: string): string {
  const used = tabs
    .filter((tab): tab is EditorTab => tab.kind === "editor" && tab.connectionId === connectionId)
    .map(tab => Number(tab.title.replace("SQL ", "")) || 0);
  return `SQL ${Math.max(0, ...used) + 1}`;
}

/** After closing the active tab, focus its left neighbour (or the new first tab). */
function neighbourOf(tabs: Tab[], closedIndex: number): string | null {
  return (tabs[closedIndex - 1] ?? tabs[closedIndex])?.id ?? null;
}

export const useTabs = create<TabsState>()(
  persist(
    set => ({
      ...INITIAL_TABS,
      openTable: target =>
        set(state => {
          const existing = state.tabs.find(
            tab =>
              tab.kind === "table" &&
              tab.connectionId === target.connectionId &&
              tab.schema === target.schema &&
              tab.table === target.table
          );
          if (existing) {
            return { activeId: existing.id };
          }
          const tab: TableTab = { id: crypto.randomUUID(), kind: "table", ...target };
          return { tabs: [...state.tabs, tab], activeId: tab.id };
        }),
      openEditor: (connectionId, sql = "") =>
        set(state => {
          const tab: EditorTab = {
            id: crypto.randomUUID(),
            kind: "editor",
            connectionId,
            title: nextEditorTitle(state.tabs, connectionId),
            sql
          };
          return { tabs: [...state.tabs, tab], activeId: tab.id };
        }),
      openHistory: () =>
        set(state => {
          if (state.tabs.some(tab => tab.kind === "history")) {
            return { activeId: "history" };
          }
          return { tabs: [...state.tabs, { id: "history", kind: "history" }], activeId: "history" };
        }),
      activate: id => set({ activeId: id }),
      close: id =>
        set(state => {
          const index = state.tabs.findIndex(tab => tab.id === id);
          if (index === -1) {
            return state;
          }
          const tabs = state.tabs.filter(tab => tab.id !== id);
          const activeId = state.activeId === id ? neighbourOf(tabs, index) : state.activeId;
          return { tabs, activeId };
        }),
      keepConnections: connectionIds =>
        set(state => {
          const tabs = state.tabs.filter(
            tab => tab.kind === "history" || connectionIds.includes(tab.connectionId)
          );
          if (tabs.length === state.tabs.length) {
            return state;
          }
          const activeStillOpen = tabs.some(tab => tab.id === state.activeId);
          return { tabs, activeId: activeStillOpen ? state.activeId : (tabs[0]?.id ?? null) };
        }),
      setSql: (id, sql) =>
        set(state => ({
          tabs: state.tabs.map(tab =>
            tab.id === id && tab.kind === "editor" ? { ...tab, sql } : tab
          )
        }))
    }),
    {
      name: "tabs",
      storage: createJSONStorage(() => tauriStorage),
      partialize: state => ({ tabs: state.tabs, activeId: state.activeId })
    }
  )
);
