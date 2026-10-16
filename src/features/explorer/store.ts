import { create } from "zustand";
import { persist } from "zustand/middleware";

type ExplorerState = {
  /** connections open in the tree (open = connected and listed); not persisted */
  expanded: string[];
  setExpanded: (connectionId: string, open: boolean) => void;
  /** groups folded in the sidebar; kept across restarts, like the sidebar itself */
  collapsedGroups: string[];
  setGroupOpen: (group: string, open: boolean) => void;
};

export const useExplorer = create<ExplorerState>()(
  persist(
    set => ({
      expanded: [],
      setExpanded: (connectionId, open) =>
        set(state => {
          const others = state.expanded.filter(id => id !== connectionId);
          return { expanded: open ? [...others, connectionId] : others };
        }),
      collapsedGroups: [],
      setGroupOpen: (group, open) =>
        set(state => {
          const others = state.collapsedGroups.filter(name => name !== group);
          return { collapsedGroups: open ? others : [...others, group] };
        })
    }),
    { name: "explorer", partialize: state => ({ collapsedGroups: state.collapsedGroups }) }
  )
);

/** The connection's row in the tree, focused from the palette after opening it. */
export function connectionRowId(connectionId: string): string {
  return `tree-connection-${connectionId}`;
}
