import { useQuery } from "@tanstack/react-query";
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { KeyRound, Link } from "lucide-react";
import { commands } from "@/bindings";
import { connected } from "@/features/explorer/queries";
import {
  HEADER_HEIGHT,
  layoutDiagram,
  NODE_WIDTH,
  ROW_HEIGHT,
  type TableNode
} from "@/features/diagram/layout";
import type { TableTarget } from "@/features/tabs/store";
import { errorMessage } from "@/lib/errors";

type DiagramViewProps = {
  connectionId: string;
  schema: string;
  onOpenTable: (target: TableTarget) => void;
};

const NODE_TYPES = { table: TableNodeView };

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Read-only ER diagram of one schema, from its foreign keys. */
export function DiagramView({ connectionId, schema, onOpenTable }: DiagramViewProps) {
  const diagram = useQuery({
    queryKey: ["diagram", connectionId, schema],
    queryFn: async () => {
      const tables = await connected(connectionId, () =>
        commands.schemaDiagram(connectionId, schema)
      );
      return layoutDiagram(schema, tables);
    }
  });

  if (diagram.isPending) {
    return <p className="p-4 text-sm text-muted-foreground">Montando o diagrama…</p>;
  }
  if (diagram.isError) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        {errorMessage(diagram.error)}
      </p>
    );
  }
  if (diagram.data.nodes.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">O schema {schema} não tem tabelas.</p>;
  }
  return (
    <div className="flex h-full flex-col">
      <p className="border-b bg-muted px-3 py-1.5 text-xs text-muted-foreground">
        {plural(diagram.data.nodes.length, "tabela", "tabelas")} ·{" "}
        {plural(diagram.data.edges.length, "chave estrangeira", "chaves estrangeiras")} · duplo
        clique ou Enter abre a tabela
      </p>
      <div className="min-h-0 flex-1">
        <ReactFlow
          nodes={diagram.data.nodes}
          edges={diagram.data.edges}
          nodeTypes={NODE_TYPES}
          nodesConnectable={false}
          edgesFocusable={false}
          deleteKeyCode={null}
          minZoom={0.05}
          fitView
          colorMode="system"
          onNodeDoubleClick={(_, node) => onOpenTable({ connectionId, schema, table: node.id })}
          onKeyDown={event => {
            // React Flow has no node key handler; nodes are focusable wrappers with data-id
            const node =
              event.key === "Enter" && event.target instanceof HTMLElement
                ? event.target.closest(".react-flow__node")
                : null;
            const table = node?.getAttribute("data-id");
            if (table) {
              onOpenTable({ connectionId, schema, table });
            }
          }}
        >
          <Background />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </div>
  );
}

function TableNodeView({ data }: NodeProps<TableNode>) {
  return (
    <div
      aria-label={`Tabela ${data.name}`}
      className="overflow-hidden rounded-[3px] border bg-card text-xs shadow-[0_1px_0_rgb(0_0_0/0.25)]"
      style={{ width: NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <div
        className="truncate border-b bg-muted px-2 font-mono font-semibold leading-8"
        style={{ height: HEADER_HEIGHT }}
      >
        {data.name}
      </div>
      <ul className="py-1">
        {data.columns.map(column => (
          <li
            key={column.name}
            className="flex items-center gap-1.5 px-2"
            style={{ height: ROW_HEIGHT }}
          >
            {column.isPrimaryKey ? (
              <KeyRound aria-label="chave primária" className="size-3 shrink-0 text-warning" />
            ) : data.foreignKeyColumns.includes(column.name) ? (
              <Link
                aria-label="chave estrangeira"
                className="size-3 shrink-0 text-muted-foreground"
              />
            ) : (
              <span className="size-3 shrink-0" />
            )}
            <span className="truncate font-mono">{column.name}</span>
            <span className="ml-auto truncate pl-2 text-muted-foreground">{column.dataType}</span>
          </li>
        ))}
        {data.external.length > 0 && (
          <li className="truncate px-2 text-muted-foreground" style={{ height: ROW_HEIGHT }}>
            → {data.external.join(", ")}
          </li>
        )}
      </ul>
      <Handle type="source" position={Position.Right} className="opacity-0" />
    </div>
  );
}
