/** One focusable row of the tree, as read from the DOM. */
export type TreeRow = { level: number; expanded: boolean | null };

export type TreeMove = { focus: number } | { toggle: number } | null;

/**
 * Arrow-key navigation over the visible rows, in DOM order:
 * ↑/↓ move, Home/End jump, → expands or enters, ← collapses or goes up a level.
 */
export function treeMove(rows: TreeRow[], index: number, key: string): TreeMove {
  const row = rows[index];
  if (!row) {
    return null;
  }
  switch (key) {
    case "ArrowDown":
      return index + 1 < rows.length ? { focus: index + 1 } : null;
    case "ArrowUp":
      return index > 0 ? { focus: index - 1 } : null;
    case "Home":
      return { focus: 0 };
    case "End":
      return { focus: rows.length - 1 };
    case "ArrowRight":
      if (row.expanded === false) {
        return { toggle: index };
      }
      return row.expanded === true && (rows[index + 1]?.level ?? 0) > row.level
        ? { focus: index + 1 }
        : null;
    case "ArrowLeft": {
      if (row.expanded === true) {
        return { toggle: index };
      }
      for (let parent = index - 1; parent >= 0; parent--) {
        if (rows[parent].level < row.level) {
          return { focus: parent };
        }
      }
      return null;
    }
    default:
      return null;
  }
}

/**
 * The sidebar's folders: connections without a group first, then each group in
 * alphabetical order. Connections keep the order they came in (by name, from the backend).
 */
export function byGroup<T extends { group?: string | null }>(
  connections: T[]
): { ungrouped: T[]; groups: { name: string; connections: T[] }[] } {
  const groups = new Map<string, T[]>();
  const ungrouped: T[] = [];
  for (const connection of connections) {
    if (connection.group) {
      groups.set(connection.group, [...(groups.get(connection.group) ?? []), connection]);
    } else {
      ungrouped.push(connection);
    }
  }
  return {
    ungrouped,
    groups: [...groups]
      .sort(([a], [b]) => a.localeCompare(b, "pt-BR"))
      .map(([name, members]) => ({ name, connections: members }))
  };
}
