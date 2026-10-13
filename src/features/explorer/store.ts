import { create } from "zustand";

type ExplorerState = {
  /** connections open in the tree (open = connected and listed); not persisted */
  expanded: string[];
  setExpanded: (connectionId: string, open: boolean) => void;
};

export const useExplorer = create<ExplorerState>()(set => ({
  expanded: [],
  setExpanded: (connectionId, open) =>
    set(state => {
      const others = state.expanded.filter(id => id !== connectionId);
      return { expanded: open ? [...others, connectionId] : others };
    })
}));

/** The connection's row in the tree, focused from the palette after opening it. */
export function connectionRowId(connectionId: string): string {
  return `tree-connection-${connectionId}`;
}
