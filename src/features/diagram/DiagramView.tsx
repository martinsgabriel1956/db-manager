import { useQuery } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  type NodeProps
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ConnectionContext } from "@/features/connections/ConnectionContext";
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
      {/* the same view header as tables: the schema is an identifier, so it keeps its case */}
      <div className="flex items-center gap-4 border-b border-foreground bg-background px-4">
        <h2 className="flex min-w-0 shrink-0 items-baseline py-2">
          {/* "ER" is a title, not data: lettered like "SQL" in the editor's header */}
          <span className="display-caps text-[1.75rem] leading-[1.15]">ER</span>
          <span className="text-muted-foreground">&nbsp;·&nbsp;</span>
          <span className="display text-[1.75rem] leading-[1.15]">{schema}</span>
        </h2>
        <p className="min-w-0 truncate text-xs text-muted-foreground">
          {plural(diagram.data.nodes.length, "tabela", "tabelas")} ·{" "}
          {plural(diagram.data.edges.length, "chave estrangeira", "chaves estrangeiras")} · duplo
          clique ou Enter abre a tabela
        </p>
        <ConnectionContext connectionId={connectionId} className="ml-auto shrink-0" />
      </div>
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
          // the diagram is part of Ordo's own drawing; the library is credited in the README
          proOptions={{ hideAttribution: true }}
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
          {/* the 14px construction grid */}
          <Background variant={BackgroundVariant.Lines} gap={14} />
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
      className="overflow-hidden border border-foreground bg-card text-xs"
      style={{ width: NODE_WIDTH }}
    >
      <Handle type="target" position={Position.Left} className="opacity-0" />
      <div
        className="truncate border-b border-foreground bg-muted px-2 font-mono font-semibold leading-8"
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
              <KeyRound aria-label="chave primária" className="size-3 shrink-0 text-foreground" />
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
