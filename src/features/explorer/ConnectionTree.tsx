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
import { EnvTag } from "@/features/connections/EnvTag";
import { useDisconnect, useSchemas } from "@/features/explorer/queries";
import {
  defaultSchemaFor,
  ENGINE_CAP,
  ENGINE_LABEL,
  isSqlEngine
} from "@/features/connections/options";
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

/** Rows that sit directly on the bench (schemas, tables, Redis databases). */
const BENCH_ROW =
  "flex w-full items-center gap-1.5 rounded-[2px] px-1.5 h-7 text-left text-[13px] outline-none hover:bg-bench-raised focus-visible:ring-2 focus-visible:ring-ring";

const ACTIVE_ROW =
  "bg-tag text-tag-foreground font-semibold shadow-[inset_3px_0_0_var(--tag-select)] hover:bg-tag";

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
    return <p className="px-3 text-sm text-bench-muted">Nenhuma conexão cadastrada.</p>;
  }
  return (
    <ul aria-label="Conexões" className="grid grid-cols-1 gap-2 px-3">
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
    <li>
      {/* the sample label stuck on the bench: cap colour, name, environment, target */}
      <div className="group flex overflow-hidden rounded-[3px] bg-tag text-tag-foreground shadow-[0_1px_0_rgb(0_0_0/0.4)] [--ring:var(--tag-select)]">
        <span aria-hidden className={cn("w-1.5 shrink-0", ENGINE_CAP[connection.engine])} />
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(prev => !prev)}
          className="grid min-w-0 flex-1 gap-0.5 py-1.5 pr-1 pl-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <span className="flex min-w-0 items-center gap-1.5">
            <Chevron className="size-3.5 shrink-0 text-tag-muted" />
            <span className="min-w-0 truncate text-[13px] font-semibold">{connection.name}</span>
            <EnvTag environment={connection.environment} className="ml-auto" />
          </span>
          <span className="flex min-w-0 items-center gap-1.5 pl-5 font-mono text-[11px] text-tag-muted">
            <span className="min-w-0 truncate">
              {ENGINE_LABEL[connection.engine]} · {targetSummary(connection)}
            </span>
            {connection.readOnly && (
              <span title="Somente leitura" className="ml-auto shrink-0">
                <Lock aria-hidden className="size-3" />
                <span className="sr-only">somente leitura</span>
              </span>
            )}
          </span>
        </button>
        {/* collapsed (not removed) at rest: still tabbable and announced, opens on hover or focus */}
        <div className="flex max-w-0 shrink-0 items-center gap-0.5 overflow-hidden group-focus-within:max-w-24 group-focus-within:pr-1 group-hover:max-w-24 group-hover:pr-1">
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
        <div className="mt-1 ml-1.5 border-l border-bench-border pl-2">
          {listing.isPending && <p className="px-1.5 py-1 text-xs text-bench-muted">Conectando…</p>}
          {listing.isError && (
            // an error slip on the bench, so the red stays readable on black
            <div className="my-1 grid gap-1.5 rounded-[2px] bg-tag p-2 text-tag-foreground [--ring:var(--tag-select)]">
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
                        BENCH_ROW,
                        database.keys === 0 && "text-bench-muted",
                        isActive && ACTIVE_ROW
                      )}
                    >
                      <Database className="size-3.5 shrink-0 opacity-70" />
                      <span className="font-mono">db{database.index}</span>
                      <span className="ml-auto font-mono text-[11px] opacity-80">
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
      <div className="group flex items-center rounded-[2px] hover:bg-bench-raised">
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded(prev => !prev)}
          className={cn(BENCH_ROW, "min-w-0 flex-1 text-bench-muted hover:bg-transparent")}
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
            className="mr-0.5 text-bench-foreground opacity-0 group-hover:opacity-100 hover:bg-bench hover:text-bench-foreground focus-visible:opacity-100"
            onClick={() => onOpenDiagram({ connectionId, schema: schema.name })}
          >
            <Network />
          </Button>
        )}
      </div>
      {expanded && (
        <ul className="grid grid-cols-1 pl-4">
          {schema.relations.length === 0 && (
            <li className="px-1.5 py-1 text-xs text-bench-muted">Sem tabelas</li>
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
                  className={cn(BENCH_ROW, isActive && ACTIVE_ROW)}
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
