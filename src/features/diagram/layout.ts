import ELK from "elkjs/lib/elk.bundled.js";
import type { Edge, Node } from "@xyflow/react";
import type { ColumnInfo, DiagramTable } from "@/bindings";

export type TableNodeData = {
  name: string;
  columns: ColumnInfo[];
  /** columns that take part in a foreign key */
  foreignKeyColumns: string[];
  /** foreign keys pointing outside the schema, as "schema.table" */
  external: string[];
};

export type TableNode = Node<TableNodeData, "table">;

export const NODE_WIDTH = 260;
export const HEADER_HEIGHT = 32;
export const ROW_HEIGHT = 22;

export function nodeHeight(data: TableNodeData): number {
  const rows = data.columns.length + (data.external.length > 0 ? 1 : 0);
  return HEADER_HEIGHT + rows * ROW_HEIGHT + 8;
}

/**
 * Tables become nodes and foreign keys become edges (one per key, table to
 * table), placed left to right by elk's layered layout. Keys to other schemas
 * are listed on the node instead of drawn.
 */
export async function layoutDiagram(
  schema: string,
  tables: DiagramTable[]
): Promise<{ nodes: TableNode[]; edges: Edge[] }> {
  const names = new Set(tables.map(table => table.name));
  const isInternal = (key: DiagramTable["foreignKeys"][number]) =>
    key.referencedSchema === schema && names.has(key.referencedTable);

  const edges: Edge[] = tables.flatMap(table =>
    table.foreignKeys.filter(isInternal).map(key => ({
      id: `${table.name}:${key.name}`,
      source: table.name,
      target: key.referencedTable,
      label: key.columns.join(", ")
    }))
  );
  const data: TableNodeData[] = tables.map(table => ({
    name: table.name,
    columns: table.columns,
    foreignKeyColumns: table.foreignKeys.flatMap(key => key.columns),
    external: table.foreignKeys
      .filter(key => !isInternal(key))
      .map(key => `${key.referencedSchema}.${key.referencedTable}`)
  }));

  const graph = await new ELK().layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.layered.spacing.nodeNodeBetweenLayers": "80",
      "elk.spacing.nodeNode": "40",
      "elk.spacing.componentComponent": "60"
    },
    children: data.map(table => ({ id: table.name, width: NODE_WIDTH, height: nodeHeight(table) })),
    edges: edges.map(edge => ({ id: edge.id, sources: [edge.source], targets: [edge.target] }))
  });

  const positions = new Map(
    (graph.children ?? []).map(child => [child.id, { x: child.x ?? 0, y: child.y ?? 0 }])
  );
  const nodes: TableNode[] = data.map(table => ({
    id: table.name,
    type: "table",
    position: positions.get(table.name) ?? { x: 0, y: 0 },
    data: table
  }));
  return { nodes, edges };
}
