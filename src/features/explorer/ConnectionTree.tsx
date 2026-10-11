import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  Pencil,
  SquareTerminal,
  Table2,
  Unplug
} from "lucide-react";
import type { ConnectionConfig, SchemaInfo } from "@/bindings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDisconnect, useSchemas } from "@/features/explorer/queries";
import {
  defaultSchemaFor,
  ENGINE_LABEL,
  ENVIRONMENT_STYLE,
  isSqlEngine
} from "@/features/connections/options";
import type { TableTarget } from "@/features/tabs/store";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type TreeActions = {
  activeTable: TableTarget | null;
  onEdit: (connectionId: string) => void;
  onOpenTable: (target: TableTarget) => void;
  onOpenEditor: (connectionId: string) => void;
};

type ConnectionTreeProps = TreeActions & { connections: ConnectionConfig[] };

type ConnectionNodeProps = TreeActions & { connection: ConnectionConfig };

type SchemaNodeProps = Pick<TreeActions, "activeTable" | "onOpenTable"> & {
  connectionId: string;
  schema: SchemaInfo;
  openByDefault: boolean;
};

export function ConnectionTree({ connections, ...actions }: ConnectionTreeProps) {
  if (connections.length === 0) {
    return <p className="px-3 text-sm text-muted-foreground">Nenhuma conexão cadastrada.</p>;
  }
  return (
    <ul role="tree" aria-label="Conexões" className="grid gap-0.5 px-2">
      {connections.map(connection => (
        <ConnectionNode key={connection.id} connection={connection} {...actions} />
      ))}
    </ul>
  );
}

function ConnectionNode({
  connection,
  activeTable,
  onEdit,
  onOpenTable,
  onOpenEditor
}: ConnectionNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isSupported = isSqlEngine(connection.engine);
  const schemas = useSchemas(connection.id, expanded && isSupported);
  const disconnect = useDisconnect();
  const environment = ENVIRONMENT_STYLE[connection.environment];
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <li role="treeitem" aria-expanded={expanded} aria-selected={false}>
      <div className="group flex items-center gap-1 rounded-md pr-1 hover:bg-muted">
        <button
          type="button"
          onClick={() => setExpanded(prev => !prev)}
          className="flex min-w-0 flex-1 items-center gap-2 px-1 py-1.5 text-left text-sm"
        >
          <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
          <span
            className={cn("size-2 shrink-0 rounded-full", environment.dotClass)}
            title={environment.label}
          />
          <span className="min-w-0 flex-1 truncate">{connection.name}</span>
          <span className="text-xs text-muted-foreground">{ENGINE_LABEL[connection.engine]}</span>
          {connection.readOnly && <Badge variant="outline">RO</Badge>}
        </button>
        {isSupported && (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Abrir editor SQL de ${connection.name}`}
            onClick={() => onOpenEditor(connection.id)}
          >
            <SquareTerminal />
          </Button>
        )}
        {schemas.isSuccess && (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Desconectar ${connection.name}`}
            onClick={() => {
              disconnect.mutate(connection.id);
              setExpanded(false);
            }}
          >
            <Unplug />
          </Button>
        )}
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={`Editar ${connection.name}`}
          onClick={() => onEdit(connection.id)}
        >
          <Pencil />
        </Button>
      </div>

      {expanded && (
        <div className="pl-5">
          {!isSupported && (
            <p className="px-2 py-1 text-xs text-muted-foreground">
              Navegação para {ENGINE_LABEL[connection.engine]} chega em um próximo marco.
            </p>
          )}
          {schemas.isPending && isSupported && (
            <p className="px-2 py-1 text-xs text-muted-foreground">Conectando…</p>
          )}
          {schemas.isError && (
            <div className="grid gap-1 px-2 py-1">
              <p role="alert" className="text-xs text-destructive">
                {errorMessage(schemas.error)}
              </p>
              <Button
                size="xs"
                variant="outline"
                className="w-fit"
                onClick={() => schemas.refetch()}
              >
                Tentar de novo
              </Button>
            </div>
          )}
          {schemas.data && (
            <ul role="group" className="grid">
              {schemas.data.map(schema => (
                <SchemaNode
                  key={schema.name}
                  connectionId={connection.id}
                  schema={schema}
                  openByDefault={schema.name === defaultSchemaFor(connection)}
                  activeTable={activeTable}
                  onOpenTable={onOpenTable}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

function SchemaNode({
  connectionId,
  schema,
  openByDefault,
  activeTable,
  onOpenTable
}: SchemaNodeProps) {
  const [expanded, setExpanded] = useState(openByDefault);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <li role="treeitem" aria-expanded={expanded} aria-selected={false}>
      <button
        type="button"
        onClick={() => setExpanded(prev => !prev)}
        className="flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-sm hover:bg-muted"
      >
        <Chevron className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="truncate">{schema.name}</span>
        <span className="text-xs text-muted-foreground">{schema.relations.length}</span>
      </button>
      {expanded && (
        <ul role="group" className="grid pl-5">
          {schema.relations.length === 0 && (
            <li className="px-2 py-1 text-xs text-muted-foreground">Sem tabelas</li>
          )}
          {schema.relations.map(relation => {
            const isActive =
              activeTable?.connectionId === connectionId &&
              activeTable.schema === schema.name &&
              activeTable.table === relation.name;
            const Icon = relation.kind === "table" ? Table2 : Eye;
            return (
              <li key={relation.name} role="treeitem" aria-selected={isActive}>
                <button
                  type="button"
                  onClick={() =>
                    onOpenTable({ connectionId, schema: schema.name, table: relation.name })
                  }
                  className={cn(
                    "flex w-full items-center gap-1.5 rounded-md px-1 py-1 text-left text-sm hover:bg-muted",
                    isActive && "bg-muted font-medium"
                  )}
                >
                  <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">{relation.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
