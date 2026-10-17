import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { Filter } from "@/bindings";
import type { ParamInput } from "@/features/editor/params";
import { tauriStorage } from "@/features/tabs/storage";

export type TableTarget = { connectionId: string; schema: string; table: string };

/**
 * The filters a foreign key opened the table with; a new `id` starts the view over with
 * them (not persisted: the filters you changed since are not saved either).
 */
export type TableFollow = { id: string; filters: Filter[] };

export type TableTab = { id: string; kind: "table"; follow?: TableFollow } & TableTarget;
export type EditorTab = {
  id: string;
  kind: "editor";
  connectionId: string;
  title: string;
  sql: string;
  /** the `:name` values last used in this editor; absent in tabs saved before parameters */
  params?: Record<string, ParamInput>;
};
export type RedisTarget = { connectionId: string; db: number };
export type RedisTab = { id: string; kind: "redis" } & RedisTarget;
export type DiagramTarget = { connectionId: string; schema: string };
export type DiagramTab = { id: string; kind: "diagram" } & DiagramTarget;
export type HistoryTab = { id: "history"; kind: "history" };
export type SessionsTab = { id: string; kind: "sessions"; connectionId: string };
/** opened from a schema: the comparison's source, the target is picked in the view */
export type SchemaDiffTab = { id: string; kind: "schemaDiff" } & DiagramTarget;
export type Tab =
  TableTab | EditorTab | RedisTab | DiagramTab | HistoryTab | SessionsTab | SchemaDiffTab;

type TabsState = {
  tabs: Tab[];
  activeId: string | null;
  /** focuses the table's tab if already open */
  openTable: (target: TableTarget) => void;
  /**
   * Opens (or focuses) the table filtered by `filters`. False when that table holds staged
   * edits: its rows are keyed by position, so the filter cannot change under them.
   */
  followTable: (target: TableTarget, filters: Filter[]) => boolean;
  /** always a new tab: several editors per connection are allowed */
  openEditor: (connectionId: string, sql?: string) => void;
  /** the editor openEditor just created: it takes focus when it mounts (not persisted) */
  freshEditorId: string | null;
  /** focuses the database's tab if already open */
  openRedis: (target: RedisTarget) => void;
  /** focuses the schema's diagram if already open */
  openDiagram: (target: DiagramTarget) => void;
  /** focuses the connection's sessions if already open */
  openSessions: (connectionId: string) => void;
  /** focuses the schema's comparison if already open */
  openSchemaDiff: (source: DiagramTarget) => void;
  openHistory: () => void;
  activate: (id: string) => void;
  close: (id: string) => void;
  closeTabs: (ids: string[]) => void;
  /** closed tabs, most recent last, with their editor text (not persisted) */
  closed: Tab[];
  /** reopens the most recently closed tab (Ctrl+Shift+T); false when none is left */
  reopenClosed: () => boolean;
  /** closes at once, or asks first when the tab holds staged edits; true when it closed */
  requestClose: (id: string) => boolean;
  /** same, for several tabs: one question covers all of them */
  requestCloseTabs: (ids: string[]) => boolean;
  /** the tabs waiting for "discard staged edits?" (not persisted) */
  closeRequest: string[] | null;
  /** quits at once (Ctrl+Q), or asks first when a table holds staged edits; true = quit now */
  requestQuit: () => boolean;
  /** quitting waits for "discard staged edits?" (not persisted) */
  quitRequest: boolean;
  cancelQuit: () => void;
  cancelClose: () => void;
  /** drops tabs of connections that no longer exist (deleted, or stale persisted state) */
  keepConnections: (connectionIds: string[]) => void;
  setSql: (id: string, sql: string) => void;
  setParams: (id: string, params: Record<string, ParamInput>) => void;
  /** staged edit count per table (not persisted: staged edits die with the window) */
  pending: Record<string, number>;
  setPending: (key: string, count: number) => void;
};

/** Table tabs among `tabs` holding staged edits: what closing or quitting would drop. */
export function heldEdits(tabs: Tab[], pending: Record<string, number>): TableTab[] {
  return tabs.filter(
    (tab): tab is TableTab => tab.kind === "table" && (pending[tableKey(tab)] ?? 0) > 0
  );
}

/** Identifies a table across tabs and the editing view. */
export function tableKey(target: TableTarget): string {
  return `${target.connectionId}/${target.schema}/${target.table}`;
}

export const INITIAL_TABS = {
  tabs: [] as Tab[],
  activeId: null,
  closed: [] as Tab[],
  freshEditorId: null
};

/** How many closed tabs Ctrl+Shift+T can bring back. */
const CLOSED_LIMIT = 20;

/** Numbered across every connection: two "SQL 1" tabs would read the same in the strip. */
function nextEditorTitle(tabs: Tab[]): string {
  const used = tabs
    .filter((tab): tab is EditorTab => tab.kind === "editor")
    .map(tab => Number(tab.title.replace("SQL ", "")) || 0);
  return `SQL ${Math.max(0, ...used) + 1}`;
}

/** Two tabs showing the same thing; editors never count, several per connection are allowed. */
function sameTarget(a: Tab, b: Tab): boolean {
  if (a.kind === "editor" || b.kind === "editor") {
    return a.id === b.id;
  }
  // the filters a table was followed with do not make it another table
  return (
    JSON.stringify({ ...a, id: "", follow: undefined }) ===
    JSON.stringify({ ...b, id: "", follow: undefined })
  );
}

function sameTable(tab: Tab, target: TableTarget): tab is TableTab {
  return (
    tab.kind === "table" &&
    tab.connectionId === target.connectionId &&
    tab.schema === target.schema &&
    tab.table === target.table
  );
}

/** After closing the active tab, focus the nearest open tab to its left (or else to its right). */
function neighbourOf(tabs: Tab[], activeIndex: number, closed: Set<string>): string | null {
  const open = (tab: Tab | undefined) => tab !== undefined && !closed.has(tab.id);
  const left = tabs.slice(0, activeIndex).reverse().find(open);
  return (left ?? tabs.slice(activeIndex + 1).find(open))?.id ?? null;
}

export const useTabs = create<TabsState>()(
  persist(
    (set, get) => ({
      ...INITIAL_TABS,
      openTable: target =>
        set(state => {
          const existing = state.tabs.find(tab => sameTable(tab, target));
          if (existing) {
            return { activeId: existing.id };
          }
          const tab: TableTab = { id: crypto.randomUUID(), kind: "table", ...target };
          return { tabs: [...state.tabs, tab], activeId: tab.id };
        }),
      followTable: (target, filters) => {
        const { tabs, pending } = get();
        if ((pending[tableKey(target)] ?? 0) > 0) {
          return false;
        }
        const follow: TableFollow = { id: crypto.randomUUID(), filters };
        const existing = tabs.find(tab => sameTable(tab, target));
        if (existing) {
          set({
            tabs: tabs.map(tab => (tab.id === existing.id ? { ...existing, follow } : tab)),
            activeId: existing.id
          });
          return true;
        }
        const tab: TableTab = { id: crypto.randomUUID(), kind: "table", ...target, follow };
        set({ tabs: [...tabs, tab], activeId: tab.id });
        return true;
      },
      openEditor: (connectionId, sql = "") =>
        set(state => {
          const tab: EditorTab = {
            id: crypto.randomUUID(),
            kind: "editor",
            connectionId,
            title: nextEditorTitle(state.tabs),
            sql
          };
          return { tabs: [...state.tabs, tab], activeId: tab.id, freshEditorId: tab.id };
        }),
      openRedis: target =>
        set(state => {
          const existing = state.tabs.find(
            tab =>
              tab.kind === "redis" &&
              tab.connectionId === target.connectionId &&
              tab.db === target.db
          );
          if (existing) {
            return { activeId: existing.id };
          }
          const tab: RedisTab = { id: crypto.randomUUID(), kind: "redis", ...target };
          return { tabs: [...state.tabs, tab], activeId: tab.id };
        }),
      openDiagram: target =>
        set(state => {
          const existing = state.tabs.find(
            tab =>
              tab.kind === "diagram" &&
              tab.connectionId === target.connectionId &&
              tab.schema === target.schema
          );
          if (existing) {
            return { activeId: existing.id };
          }
          const tab: DiagramTab = { id: crypto.randomUUID(), kind: "diagram", ...target };
          return { tabs: [...state.tabs, tab], activeId: tab.id };
        }),
      openSessions: connectionId =>
        set(state => {
          const existing = state.tabs.find(
            tab => tab.kind === "sessions" && tab.connectionId === connectionId
          );
          if (existing) {
            return { activeId: existing.id };
          }
          const tab: SessionsTab = { id: crypto.randomUUID(), kind: "sessions", connectionId };
          return { tabs: [...state.tabs, tab], activeId: tab.id };
        }),
      openSchemaDiff: source =>
        set(state => {
          const existing = state.tabs.find(
            tab =>
              tab.kind === "schemaDiff" &&
              tab.connectionId === source.connectionId &&
              tab.schema === source.schema
          );
          if (existing) {
            return { activeId: existing.id };
          }
          const tab: SchemaDiffTab = { id: crypto.randomUUID(), kind: "schemaDiff", ...source };
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
      close: id => get().closeTabs([id]),
      closeTabs: ids =>
        set(state => {
          const closed = new Set(ids);
          const tabs = state.tabs.filter(tab => !closed.has(tab.id));
          const activeIndex = state.tabs.findIndex(tab => tab.id === state.activeId);
          const activeId =
            state.activeId !== null && closed.has(state.activeId)
              ? neighbourOf(state.tabs, activeIndex, closed)
              : state.activeId;
          // an unrun SQL draft closed by mistake comes back with Ctrl+Shift+T
          const dropped = state.tabs.filter(tab => closed.has(tab.id));
          return {
            tabs,
            activeId,
            closeRequest: null,
            closed: [...state.closed, ...dropped].slice(-CLOSED_LIMIT)
          };
        }),
      closed: [],
      reopenClosed: () => {
        const { closed, tabs } = get();
        const tab = closed.at(-1);
        if (!tab) {
          return false;
        }
        // a table, Redis db, diagram or history opened again since then: just go there
        const twin = tabs.find(open => sameTarget(open, tab));
        set({
          closed: closed.slice(0, -1),
          tabs: twin ? tabs : [...tabs, tab],
          activeId: (twin ?? tab).id
        });
        return true;
      },
      requestClose: id => get().requestCloseTabs([id]),
      requestCloseTabs: ids => {
        const { tabs, pending, closeTabs } = get();
        // staged edits live only in the open view: closing it would drop them silently
        if (
          heldEdits(
            tabs.filter(tab => ids.includes(tab.id)),
            pending
          ).length > 0
        ) {
          set({ closeRequest: ids });
          return false;
        }
        closeTabs(ids);
        return true;
      },
      closeRequest: null,
      cancelClose: () => set({ closeRequest: null }),
      // the tabs stay open: they are persisted and come back on the next launch
      requestQuit: () => {
        const { tabs, pending } = get();
        if (heldEdits(tabs, pending).length > 0) {
          set({ quitRequest: true });
          return false;
        }
        return true;
      },
      quitRequest: false,
      cancelQuit: () => set({ quitRequest: false }),
      keepConnections: connectionIds =>
        set(state => {
          const tabs = state.tabs.filter(
            tab => tab.kind === "history" || connectionIds.includes(tab.connectionId)
          );
          const closed = state.closed.filter(
            tab => tab.kind === "history" || connectionIds.includes(tab.connectionId)
          );
          if (tabs.length === state.tabs.length) {
            return closed.length === state.closed.length ? state : { closed };
          }
          const activeStillOpen = tabs.some(tab => tab.id === state.activeId);
          return {
            tabs,
            closed,
            activeId: activeStillOpen ? state.activeId : (tabs[0]?.id ?? null)
          };
        }),
      pending: {},
      setPending: (key, count) =>
        set(state =>
          (state.pending[key] ?? 0) === count
            ? state
            : { pending: { ...state.pending, [key]: count } }
        ),
      setSql: (id, sql) =>
        set(state => ({
          tabs: state.tabs.map(tab =>
            tab.id === id && tab.kind === "editor" ? { ...tab, sql } : tab
          )
        })),
      setParams: (id, params) =>
        set(state => ({
          tabs: state.tabs.map(tab =>
            tab.id === id && tab.kind === "editor" ? { ...tab, params } : tab
          )
        }))
    }),
    {
      name: "tabs",
      storage: createJSONStorage(() => tauriStorage),
      partialize: state => ({
        tabs: state.tabs.map(tab => (tab.kind === "table" ? { ...tab, follow: undefined } : tab)),
        activeId: state.activeId
      })
    }
  )
);
