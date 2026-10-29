import ELK from "elkjs/lib/elk-api.js";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import type { Edge, Node } from "@xyflow/react";
import type { ColumnInfo, DiagramTable } from "@/bindings";

export type TableNodeData = {
  name: string;
  columns: ColumnInfo[];
  /** each foreign key: its columns and the table they point to ("schema.table" outside) */
  references: { columns: string[]; target: string }[];
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
 * The layout runs in a worker: a big schema takes seconds, and on the main thread it would
 * freeze tabs and editor meanwhile. Without workers (the test DOM) it runs in place.
 */
let engine: Promise<InstanceType<typeof ELK>> | null = null;

/** One engine, so one worker, for every diagram opened. */
function layoutEngine() {
  engine ??=
    typeof Worker === "undefined"
      ? import("elkjs/lib/elk.bundled.js").then(({ default: InPlace }) => new InPlace())
      : Promise.resolve(new ELK({ workerUrl: elkWorkerUrl }));
  return engine;
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
    references: table.foreignKeys.map(key => ({
      columns: key.columns,
      target: isInternal(key)
        ? key.referencedTable
        : `${key.referencedSchema}.${key.referencedTable}`
    })),
    external: table.foreignKeys
      .filter(key => !isInternal(key))
      .map(key => `${key.referencedSchema}.${key.referencedTable}`)
  }));

  const graph = await (
    await layoutEngine()
  ).layout({
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
    // names the focusable node wrapper, which React Flow owns; the edges are only drawn,
    // so the keys are said here
    ariaLabel: [
      `Tabela ${table.name}`,
      ...table.references.map(key => `${key.columns.join(", ")} aponta para ${key.target}`)
    ].join(", "),
    position: positions.get(table.name) ?? { x: 0, y: 0 },
    // the minimap draws only nodes with known dimensions, read from these props
    // (the canvas measures its own): without them it shows an empty frame
    initialWidth: NODE_WIDTH,
    initialHeight: nodeHeight(table),
    data: table
  }));
  return { nodes, edges };
}
