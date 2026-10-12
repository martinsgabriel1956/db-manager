import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Database,
  Eye,
  Lock,
  Network,
  Pencil,
  SquareTerminal,
  Table2,
  Unplug
} from "lucide-react";
import type { ConnectionConfig, SchemaInfo } from "@/bindings";
import { Button } from "@/components/ui/button";
import { EngineCode, EnvTag } from "@/features/connections/EnvTag";
import { useDisconnect, useSchemas } from "@/features/explorer/queries";
import { defaultSchemaFor, ENGINE_LABEL, isSqlEngine } from "@/features/connections/options";
import { useRedisDatabases } from "@/features/redis/queries";
import type { DiagramTarget, RedisTarget, TableTarget } from "@/features/tabs/store";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type TreeActions = {
  activeTable: TableTarget | null;
  activeRedis: RedisTarget | null;
  onEdit: (connectionId: string) => void;
  onOpenTable: (target: TableTarget) => void;
  onOpenEditor: (connectionId: string) => void;
  onOpenRedis: (target: RedisTarget) => void;
  onOpenDiagram: (target: DiagramTarget) => void;
};

type ConnectionTreeProps = TreeActions & { connections: ConnectionConfig[] };

type ConnectionNodeProps = TreeActions & { connection: ConnectionConfig };

type SchemaNodeProps = Pick<TreeActions, "activeTable" | "onOpenTable"> & {
  connectionId: string;
  schema: SchemaInfo;
  openByDefault: boolean;
  /** SQL only: MongoDB has no foreign keys */
  onOpenDiagram?: (target: DiagramTarget) => void;
};

/** Rows on the grid paper under a connection (schemas, tables, Redis databases). */
const TREE_ROW =
  "flex w-full items-center gap-1.5 px-1.5 h-7 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

/** Where you are: the table open in the active tab, filled in Crouwel blue. */
const ACTIVE_ROW = "bg-select text-select-foreground font-semibold hover:bg-select";

/** Second line of the label: where the connection points, as stored. */
export function targetSummary(connection: ConnectionConfig): string {
  const { target } = connection;
  if (target.kind === "file") {
    return target.path.split(/[\\/]/).pop() ?? target.path;
  }
  if (target.kind === "uri") {
    return "connection string";
  }
  return `${target.host}:${target.port}`;
}

export function ConnectionTree({ connections, ...actions }: ConnectionTreeProps) {
  if (connections.length === 0) {
    return <p className="px-4 text-sm text-muted-foreground">Nenhuma conexão cadastrada.</p>;
  }
  return (
    // one ruled ledger: shared rules, ink rules around an open connection's tree
    <ul
      aria-label="Conexões"
      className="mx-4 mb-4 grid grid-cols-1 border border-foreground bg-background"
    >
      {connections.map(connection => (
        <ConnectionNode key={connection.id} connection={connection} {...actions} />
      ))}
    </ul>
  );
}

function ConnectionNode({
  connection,
  activeTable,
  activeRedis,
  onEdit,
  onOpenTable,
  onOpenEditor,
  onOpenRedis,
  onOpenDiagram
}: ConnectionNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const isRedis = connection.engine === "redis";
  const hasSqlEditor = isSqlEngine(connection.engine);
  const schemas = useSchemas(connection.id, expanded && !isRedis);
  const databases = useRedisDatabases(connection.id, expanded && isRedis);
  // Redis lists databases instead of schemas; both connect on first load
  const listing = isRedis ? databases : schemas;
  const disconnect = useDisconnect();
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <li className={cn("border-b border-border last:border-b-0", expanded && "border-b-foreground")}>
      {/* the record line: engine code, name, environment, target */}
      <div className="group relative flex items-stretch">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(prev => !prev)}
          className="grid min-w-0 flex-1 grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-0.5 py-2 pr-1.5 pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <EngineCode engine={connection.engine} className="row-span-2" />
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate text-[13px] font-semibold">{connection.name}</span>
            <EnvTag environment={connection.environment} className="ml-auto" />
          </span>
          <span className="flex min-w-0 items-center gap-1.5 font-mono text-[11px] text-muted-foreground">
            <Chevron aria-hidden className="-ml-0.5 size-3 shrink-0" />
            {/* the engine is already in the code cell; screen readers still hear it */}
            <span className="sr-only">{ENGINE_LABEL[connection.engine]} · </span>
            <span className="min-w-0 truncate">{targetSummary(connection)}</span>
            {connection.readOnly && (
              <span
                title="Somente leitura"
                className="ml-auto shrink-0 border border-dotted border-current p-px"
              >
                <Lock aria-hidden className="size-3" />
                <span className="sr-only">somente leitura</span>
              </span>
            )}
          </span>
        </button>
        {/* laid over the end of the target line, never over the name or the environment: hidden at rest but still tabbable */}
        <div className="pointer-events-none absolute right-1 bottom-1 flex items-center gap-0.5 bg-background pl-1 opacity-0 group-focus-within:pointer-events-auto group-focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100">
          {hasSqlEditor && (
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label={`Abrir editor SQL de ${connection.name}`}
              onClick={() => onOpenEditor(connection.id)}
            >
              <SquareTerminal />
            </Button>
          )}
          {listing.isSuccess && (
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
      </div>

      {expanded && (
        <div className="mb-2 ml-5 border-l border-foreground py-0.5 pl-2">
          {listing.isPending && (
            <p className="px-1.5 py-1 text-xs text-muted-foreground">Conectando…</p>
          )}
          {listing.isError && (
            <div className="my-1 grid gap-1.5 border border-destructive bg-background p-2">
              <p role="alert" className="text-xs text-destructive">
                {errorMessage(listing.error)}
              </p>
              <Button
                size="xs"
                variant="outline"
                className="w-fit"
                onClick={() => listing.refetch()}
              >
                Tentar de novo
              </Button>
            </div>
          )}
          {databases.data && (
            <ul className="grid grid-cols-1">
              {databases.data.map(database => {
                const isActive =
                  activeRedis?.connectionId === connection.id && activeRedis.db === database.index;
                return (
                  <li key={database.index}>
                    <button
                      type="button"
                      aria-current={isActive || undefined}
                      onClick={() =>
                        onOpenRedis({ connectionId: connection.id, db: database.index })
                      }
                      className={cn(
                        TREE_ROW,
                        database.keys === 0 && "text-muted-foreground",
                        isActive && ACTIVE_ROW
                      )}
                    >
                      <Database className="size-3.5 shrink-0 opacity-70" />
                      <span className="font-mono">db{database.index}</span>
                      {/* full strength on the blue fill: 11px needs 4.5:1 */}
                      <span
                        className={cn(
                          "ml-auto font-mono text-[11px]",
                          !isActive && "text-muted-foreground"
                        )}
                      >
                        {database.keys > 0 && database.keys}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {schemas.data && (
            <ul className="grid grid-cols-1">
              {schemas.data.map(schema => (
                <SchemaNode
                  key={schema.name}
                  connectionId={connection.id}
                  schema={schema}
                  openByDefault={schema.name === defaultSchemaFor(connection)}
                  activeTable={activeTable}
                  onOpenTable={onOpenTable}
                  onOpenDiagram={hasSqlEditor ? onOpenDiagram : undefined}
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
  onOpenTable,
  onOpenDiagram
}: SchemaNodeProps) {
  const [expanded, setExpanded] = useState(openByDefault);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <li>
      <div className="group flex items-center hover:bg-muted">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(prev => !prev)}
          className={cn(TREE_ROW, "min-w-0 flex-1 text-muted-foreground hover:bg-transparent")}
        >
          <Chevron className="size-3.5 shrink-0" />
          <span className="truncate">{schema.name}</span>
          <span className="font-mono text-[11px]">{schema.relations.length}</span>
        </button>
        {onOpenDiagram && (
          <Button
            size="icon-xs"
            variant="ghost"
            aria-label={`Diagrama ER de ${schema.name}`}
            className="mr-0.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            onClick={() => onOpenDiagram({ connectionId, schema: schema.name })}
          >
            <Network />
          </Button>
        )}
      </div>
      {expanded && (
        <ul className="grid grid-cols-1 pl-4">
          {schema.relations.length === 0 && (
            <li className="px-1.5 py-1 text-xs text-muted-foreground">Sem tabelas</li>
          )}
          {schema.relations.map(relation => {
            const isActive =
              activeTable?.connectionId === connectionId &&
              activeTable.schema === schema.name &&
              activeTable.table === relation.name;
            const Icon = relation.kind === "table" ? Table2 : Eye;
            return (
              <li key={relation.name}>
                <button
                  type="button"
                  aria-current={isActive || undefined}
                  onClick={() =>
                    onOpenTable({ connectionId, schema: schema.name, table: relation.name })
                  }
                  className={cn(TREE_ROW, isActive && ACTIVE_ROW)}
                >
                  <Icon className="size-3.5 shrink-0 opacity-70" />
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
