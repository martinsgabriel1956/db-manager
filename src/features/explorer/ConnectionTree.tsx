import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject
} from "react";
import {
  Activity,
  ChevronDown,
  Braces,
  ChevronRight,
  Copy,
  Database,
  DatabaseBackup,
  Ellipsis,
  Eye,
  Folder,
  GitCompare,
  Lock,
  Network,
  Pencil,
  Plus,
  SquareTerminal,
  Table2,
  Unplug
} from "lucide-react";
import type { ConnectionConfig, Relation, SchemaInfo } from "@/bindings";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import { BackupDialog } from "@/features/backup/BackupDialog";
import { EngineCode, EnvTag } from "@/features/connections/EnvTag";
import { defaultSchemaFor, ENGINE_LABEL, isSqlEngine } from "@/features/connections/options";
import { useDisconnect, useSchemas } from "@/features/explorer/queries";
import { connectionRowId, useExplorer } from "@/features/explorer/store";
import { byGroup, treeMove } from "@/features/explorer/treeNav";
import { useRedisDatabases } from "@/features/redis/queries";
import { NewTableFlow } from "@/features/table/SchemaDialogs";
import type { DiagramTarget, RedisTarget, TableTarget } from "@/features/tabs/store";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type TreeActions = {
  /** the connection open in the form: marked as where you are */
  editingId: string | null;
  activeTable: TableTarget | null;
  activeRedis: RedisTarget | null;
  onEdit: (connectionId: string) => void;
  /** opens the form filled from this connection, as a new one */
  onDuplicate: (connectionId: string) => void;
  onOpenTable: (target: TableTarget) => void;
  onOpenEditor: (connectionId: string) => void;
  onOpenRedis: (target: RedisTarget) => void;
  onOpenDiagram: (target: DiagramTarget) => void;
  onOpenSessions: (connectionId: string) => void;
  /** the schema is the comparison's source */
  onOpenSchemaDiff: (source: DiagramTarget) => void;
};

type ConnectionTreeProps = TreeActions & { connections: ConnectionConfig[] };

/** `level`: the row's depth in the tree, 2 inside a group */
type ConnectionNodeProps = TreeActions & { connection: ConnectionConfig; level: number };

type GroupNodeProps = TreeActions & { name: string; connections: ConnectionConfig[] };

type SchemaNodeProps = Pick<TreeActions, "activeTable" | "onOpenTable"> & {
  connectionId: string;
  schema: SchemaInfo;
  level: number;
  /** what the count names: MongoDB lists collections */
  isMongo: boolean;
  openByDefault: boolean;
  /** SQL only: MongoDB has no foreign keys */
  onOpenDiagram?: (target: DiagramTarget) => void;
  /** SQL only */
  onOpenSchemaDiff?: (source: DiagramTarget) => void;
  /** SQL on a writable connection */
  canCreateTable: boolean;
};

/** `apart`: ruled off from the items above, so it is not hit on the way to them */
type RowAction = { label: string; icon: ReactNode; onSelect: () => void; apart?: boolean };

type RowMenuProps = {
  /** names the row: "Ações de Postgres prod" */
  label: string;
  actions: RowAction[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** where focus returns when the menu closes */
  rowRef: RefObject<HTMLButtonElement | null>;
  className?: string;
};

/** Rows on the grid paper under a connection (schemas, tables, Redis databases). */
// min-h, not h: a long name wraps (it is data, and no hover title reaches the keyboard);
// one line still reads at the 28px row
const TREE_ROW =
  "flex w-full items-center gap-1.5 px-1.5 min-h-7 py-1 text-left text-[13px] outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";

/**
 * Where you are: the table open in the active tab, filled in Crouwel blue. Focus draws a paper
 * ring 2px inside the edge, blue on both sides of it: at the edge it read as the fill shrinking
 */
const ACTIVE_ROW =
  "bg-select text-select-foreground font-semibold hover:bg-select focus-visible:ring-0 focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-4 focus-visible:outline-select-foreground";

/** Second line of the label: where the connection points, as stored. */
export function targetSummary(connection: ConnectionConfig): string {
  const { target } = connection;
  if (target.kind === "file") {
    return target.path.split(/[\\/]/).pop() ?? target.path;
  }
  if (target.kind === "uri") {
    return "URI de conexão";
  }
  if (target.kind === "redisCluster" || target.kind === "redisSentinel") {
    const [first, ...rest] = target.nodes;
    const nodes = `${first.host}:${first.port}${rest.length > 0 ? ` +${rest.length}` : ""}`;
    return target.kind === "redisCluster"
      ? `cluster ${nodes}`
      : `sentinel ${target.masterName} via ${nodes}`;
  }
  return `${target.host}:${target.port}`;
}

/** "2 tabelas", or "1 tabela e 1 view" when views are among them: the count says what it counts. */
export function countRelations(relations: Relation[], isMongo: boolean): string {
  const plural = (count: number, one: string, many: string) =>
    `${count} ${count === 1 ? one : many}`;
  if (isMongo) {
    return plural(relations.length, "coleção", "coleções");
  }
  const tables = relations.filter(relation => relation.kind === "table").length;
  const views = relations.length - tables;
  if (views === 0) {
    return plural(tables, "tabela", "tabelas");
  }
  const viewCount = plural(views, "view", "views");
  return tables === 0 ? viewCount : `${plural(tables, "tabela", "tabelas")} e ${viewCount}`;
}

function treeItems(tree: HTMLElement): HTMLElement[] {
  return [...tree.querySelectorAll<HTMLElement>("[role='treeitem']")];
}

/** ↑↓ ← → Home End over the visible rows; Tab leaves the tree in one step. */
function handleTreeKeyDown(event: KeyboardEvent<HTMLElement>) {
  const elements = treeItems(event.currentTarget);
  const index = elements.indexOf(event.target as HTMLElement);
  if (index === -1) {
    return;
  }
  const rows = elements.map(element => ({
    level: Number(element.getAttribute("aria-level")),
    expanded: element.hasAttribute("aria-expanded")
      ? element.getAttribute("aria-expanded") === "true"
      : null
  }));
  const move = treeMove(rows, index, event.key);
  if (!move) {
    return;
  }
  event.preventDefault();
  if ("toggle" in move) {
    elements[move.toggle].click();
  } else {
    elements[move.focus].focus();
  }
}

/** Shift+F10 or the menu key opens the focused row's actions, as a right click does. */
function isMenuKey(event: KeyboardEvent) {
  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

/**
 * Roving tab stop: exactly one row is tabbable, the last one focused, else the
 * row of the open tab, else the first. Set on the DOM so re-renders keep it.
 * A newly opened tab moves the stop to its row (F6 lands where you are) and scrolls it
 * into the sidebar's view.
 */
function useRovingTabStop(treeRef: RefObject<HTMLUListElement | null>) {
  const lastFocused = useRef<HTMLElement | null>(null);
  const lastSelected = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) {
      return;
    }
    const items = treeItems(tree);
    const selected = items.find(item => item.getAttribute("aria-selected") === "true") ?? null;
    if (selected && selected !== lastSelected.current) {
      lastFocused.current = selected;
      selected.scrollIntoView?.({ block: "nearest" });
    }
    lastSelected.current = selected;
    const current = items.find(item => item === lastFocused.current) ?? selected ?? items[0];
    for (const item of items) {
      item.tabIndex = item === current ? 0 : -1;
    }
  });

  return (target: EventTarget) => {
    const tree = treeRef.current;
    if (!tree || !(target instanceof HTMLElement) || target.getAttribute("role") !== "treeitem") {
      return;
    }
    lastFocused.current = target;
    for (const item of treeItems(tree)) {
      item.tabIndex = item === target ? 0 : -1;
    }
  };
}

export function ConnectionTree({ connections, ...actions }: ConnectionTreeProps) {
  const treeRef = useRef<HTMLUListElement>(null);
  const trackFocus = useRovingTabStop(treeRef);
  const { ungrouped, groups } = byGroup(connections);

  if (connections.length === 0) {
    return (
      <div className="mx-4 mb-4 grid gap-2 border border-foreground bg-background p-3">
        <p className="text-sm font-semibold">Nenhuma conexão cadastrada.</p>
        <p className="text-xs text-muted-foreground">
          Cadastre um Postgres, MySQL, SQLite, MongoDB ou Redis que já existe. A senha fica no
          keychain do sistema, nunca em texto puro.
        </p>
      </div>
    );
  }
  return (
    // one ruled ledger: shared rules, ink rules around an open connection's tree
    <ul
      ref={treeRef}
      role="tree"
      aria-label="Conexões"
      onKeyDown={handleTreeKeyDown}
      onFocus={event => trackFocus(event.target)}
      className="mx-4 mb-4 grid grid-cols-1 border border-foreground bg-background"
    >
      {/* without a group at the top, then each group as a folder */}
      {ungrouped.map(connection => (
        <ConnectionNode key={connection.id} connection={connection} level={1} {...actions} />
      ))}
      {groups.map(group => (
        <GroupNode key={group.name} {...group} {...actions} />
      ))}
    </ul>
  );
}

/** A folder of connections; folded or not, it stays folded across restarts. */
function GroupNode({ name, connections, ...actions }: GroupNodeProps) {
  const open = useExplorer(state => !state.collapsedGroups.includes(name));
  const setGroupOpen = useExplorer(state => state.setGroupOpen);
  const Chevron = open ? ChevronDown : ChevronRight;
  const count = connections.length === 1 ? "1 conexão" : `${connections.length} conexões`;
  return (
    <li role="none" className="border-b border-border last:border-b-0">
      <button
        type="button"
        role="treeitem"
        aria-level={1}
        aria-expanded={open}
        tabIndex={-1}
        onClick={() => setGroupOpen(name, !open)}
        className={cn(TREE_ROW, "min-h-8 gap-2 px-2")}
      >
        <Chevron aria-hidden className="size-3.5 shrink-0" />
        <Folder aria-hidden className="size-3.5 shrink-0" />
        {/* the user's name for it, case kept, like a connection's */}
        <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{name}</span>
        {/* read as "Cliente X · 3 conexões"; the bare number on screen */}
        {/* the space between the spans, not inside one: names trim each span's own */}{" "}
        <span className="sr-only">· {count}</span>
        <span
          aria-hidden
          title={count}
          className="ml-auto font-mono text-[11px] text-muted-foreground"
        >
          {connections.length}
        </span>
      </button>
      {open && (
        // indented under its folder by a rule, like the rows under an open connection
        <ul role="group" className="ml-3.5 grid grid-cols-1 border-t border-l border-border">
          {connections.map(connection => (
            <ConnectionNode key={connection.id} connection={connection} level={2} {...actions} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** The row's actions: a quiet "⋯" for the mouse, Shift+F10 or a right click from the row. */
function RowMenu({ label, actions, open, onOpenChange, rowRef, className }: RowMenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          size="icon-xs"
          variant="ghost"
          // the row is the keyboard's way in (Shift+F10): one tab stop per tree, not per row.
          // Hidden from the accessibility tree too: a tree may only hold treeitems, and the
          // row already offers this menu
          tabIndex={-1}
          aria-hidden
          aria-label={label}
          className={cn(
            "text-muted-foreground hover:text-foreground aria-expanded:text-foreground",
            className
          )}
        >
          <Ellipsis />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        aria-label={label}
        onCloseAutoFocus={event => {
          event.preventDefault();
          // an action that took focus elsewhere (a new SQL editor) keeps it
          if (!document.activeElement || document.activeElement === document.body) {
            rowRef.current?.focus();
          }
        }}
      >
        {actions.map(action => (
          <Fragment key={action.label}>
            {action.apart && <div role="separator" className="my-1 h-px bg-foreground" />}
            <DropdownMenuItem onSelect={action.onSelect}>
              {action.icon}
              {action.label}
            </DropdownMenuItem>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ConnectionNode({
  connection,
  level,
  editingId,
  activeTable,
  activeRedis,
  onEdit,
  onDuplicate,
  onOpenTable,
  onOpenEditor,
  onOpenRedis,
  onOpenDiagram,
  onOpenSessions,
  onOpenSchemaDiff
}: ConnectionNodeProps) {
  const expanded = useExplorer(state => state.expanded.includes(connection.id));
  const setExpanded = useExplorer(state => state.setExpanded);
  const [menuOpen, setMenuOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const isRedis = connection.engine === "redis";
  const hasSqlEditor = isSqlEngine(connection.engine);
  const schemas = useSchemas(connection.id, expanded && !isRedis);
  const databases = useRedisDatabases(connection.id, expanded && isRedis);
  // Redis lists databases instead of schemas; both connect on first load
  const listing = isRedis ? databases : schemas;
  const disconnect = useDisconnect();
  const Chevron = expanded ? ChevronDown : ChevronRight;

  const actions: RowAction[] = [
    ...(hasSqlEditor
      ? [
          {
            label: "Nova query SQL",
            icon: <SquareTerminal />,
            onSelect: () => onOpenEditor(connection.id)
          },
          {
            label: "Backup e restauração…",
            icon: <DatabaseBackup />,
            onSelect: () => setBackupOpen(true)
          }
        ]
      : []),
    // a SQLite file has no server, so no sessions
    ...(connection.engine !== "sqlite"
      ? [
          {
            label: "Sessões ativas",
            icon: <Activity />,
            onSelect: () => onOpenSessions(connection.id)
          }
        ]
      : []),
    // three groups of at most three: work on the server, the saved connection, leaving it
    {
      label: "Editar conexão",
      icon: <Pencil />,
      apart: hasSqlEditor || connection.engine !== "sqlite",
      onSelect: () => onEdit(connection.id)
    },
    { label: "Duplicar conexão", icon: <Copy />, onSelect: () => onDuplicate(connection.id) },
    ...(listing.isSuccess
      ? [
          {
            label: "Desconectar",
            icon: <Unplug />,
            apart: true,
            onSelect: () => {
              disconnect.mutate(connection.id);
              setExpanded(connection.id, false);
            }
          }
        ]
      : [])
  ];

  return (
    <li
      role="none"
      className={cn(
        "border-b border-border last:border-b-0",
        expanded &&
          (connection.environment === "prod" ? "border-b-safelight" : "border-b-foreground")
      )}
    >
      {/* the record line: engine code, name, environment, target */}
      <div
        className="group relative flex items-stretch"
        onContextMenu={event => {
          event.preventDefault();
          setMenuOpen(true);
        }}
      >
        <button
          ref={rowRef}
          type="button"
          id={connectionRowId(connection.id)}
          role="treeitem"
          aria-level={level}
          aria-expanded={expanded}
          aria-current={editingId === connection.id || undefined}
          // the row's actions; the "⋯" next to it is the mouse's copy of the same menu
          aria-keyshortcuts="Shift+F10"
          tabIndex={-1}
          onClick={() => setExpanded(connection.id, !expanded)}
          onKeyDown={event => {
            if (isMenuKey(event)) {
              event.preventDefault();
              setMenuOpen(true);
            }
          }}
          className={cn(
            "grid min-w-0 flex-1 grid-cols-[auto_1fr] items-center gap-x-2.5 gap-y-0.5 py-2 pr-1.5 pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            // the form is open on this one: the "where you are" rule, inset like the active tab's
            editingId === connection.id && "shadow-[inset_3px_0_0_var(--select)]"
          )}
        >
          <EngineCode engine={connection.engine} className="row-span-2" />
          {/* the name wraps rather than truncating: "Postgres staging-eu" and "-us" never read alike */}
          <span className="flex min-w-0 items-start gap-1.5">
            <span className="min-w-0 text-[13px] font-semibold [overflow-wrap:anywhere]">
              {connection.name}
            </span>
            <EnvTag environment={connection.environment} className="ml-auto" />
          </span>
          {/* the second line ends short of the corner: the "⋯" sits there */}
          <span className="flex min-w-0 items-center gap-1.5 pr-6 font-mono text-[11px] text-muted-foreground">
            <Chevron aria-hidden className="-ml-0.5 size-3 shrink-0" />
            {/* the engine is already in the code cell; screen readers still hear it */}
            <span className="sr-only">{ENGINE_LABEL[connection.engine]} · </span>
            {/* the address stays on one line (wrapped at its hyphens it took three); the name above
                is what tells connections apart, and the whole address is read aloud and on hover */}
            <span className="min-w-0 truncate" title={targetSummary(connection)}>
              {targetSummary(connection)}
            </span>
            {connection.readOnly && (
              <span
                title="Somente leitura: o próprio banco recusa escritas"
                className="ml-auto shrink-0 border border-dotted border-current p-px"
              >
                <Lock aria-hidden className="size-3" />
                <span className="sr-only">somente leitura</span>
              </span>
            )}
          </span>
        </button>
        <RowMenu
          label={`Ações de ${connection.name}`}
          actions={actions}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          rowRef={rowRef}
          className="absolute right-1 bottom-1"
        />
      </div>
      {backupOpen && <BackupDialog connection={connection} onClose={() => setBackupOpen(false)} />}

      {expanded && (
        // dashed under the safelight on prod, a texture and not only a colour: production
        // stays legible after its header scrolls away. Drawn, not border-dashed: a 1px
        // dashed border renders as dots, which is the "retido" notation
        <ul
          role="group"
          className={cn(
            "mb-2 ml-5 border-l py-0.5 pl-2",
            connection.environment === "prod"
              ? "border-l-0 bg-[linear-gradient(var(--safelight)_5px,transparent_0)] bg-[length:1px_8px] bg-repeat-y"
              : "border-foreground"
          )}
        >
          {/* the editor needs no schema: offered before the listing even loads, not after it failed */}
          {hasSqlEditor && !listing.isError && (
            <li role="none">
              <button
                type="button"
                role="treeitem"
                aria-level={level + 1}
                tabIndex={-1}
                onClick={() => onOpenEditor(connection.id)}
                className={cn(TREE_ROW, "font-medium")}
              >
                <SquareTerminal className="size-3.5 shrink-0" />
                Nova query SQL
                <span className="sr-only"> em {connection.name}</span>
              </button>
            </li>
          )}
          {listing.isPending && (
            <li role="none" className="px-1.5 py-1 text-xs text-muted-foreground">
              Conectando…
            </li>
          )}
          {listing.isError && (
            <li
              role="none"
              className="my-1 grid gap-1.5 border border-destructive bg-background p-2"
            >
              {/* the headline in our words; the driver's own, often English, follows as data */}
              <div role="alert" className="grid gap-1">
                <p className="text-xs font-semibold text-destructive">
                  Não foi possível conectar
                  {connection.target.kind === "network" && ` a ${targetSummary(connection)}`}
                </p>
                <p className="font-mono text-[11px] break-words text-muted-foreground">
                  {errorMessage(listing.error)}
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Confira host, porta e senha em Editar conexão e use Testar conexão, que tenta sem
                salvar. Banco atrás de bastion: marque Conectar por túnel SSH.
              </p>
              {/* both ways out the text names, within reach of Tab */}
              <div className="flex flex-wrap gap-1.5">
                <Button size="xs" variant="outline" onClick={() => listing.refetch()}>
                  Tentar de novo
                </Button>
                <Button size="xs" variant="outline" onClick={() => onEdit(connection.id)}>
                  Editar conexão
                </Button>
              </div>
            </li>
          )}
          {databases.data?.map(database => {
            const isActive =
              activeRedis?.connectionId === connection.id && activeRedis.db === database.index;
            return (
              <li role="none" key={database.index}>
                <button
                  type="button"
                  role="treeitem"
                  aria-level={level + 1}
                  aria-selected={isActive || undefined}
                  tabIndex={-1}
                  onClick={() => onOpenRedis({ connectionId: connection.id, db: database.index })}
                  className={cn(
                    TREE_ROW,
                    database.keys === 0 && "text-muted-foreground",
                    isActive && ACTIVE_ROW
                  )}
                >
                  <Database className="size-3.5 shrink-0 opacity-70" />
                  <span className="font-mono">db{database.index}</span>
                  {/* full strength on the blue fill: 11px needs 4.5:1 */}
                  {/* "db0 · 4 chaves" aloud and on hover; the bare number on screen */}
                  {database.keys > 0 && (
                    <span
                      title={database.keys === 1 ? "1 chave" : `${database.keys} chaves`}
                      className={cn(
                        "ml-auto font-mono text-[11px]",
                        !isActive && "text-muted-foreground"
                      )}
                    >
                      <span className="sr-only"> · </span>
                      {database.keys}
                      <span className="sr-only">{database.keys === 1 ? " chave" : " chaves"}</span>
                    </span>
                  )}
                </button>
              </li>
            );
          })}
          {schemas.data?.map(schema => (
            <SchemaNode
              key={schema.name}
              connectionId={connection.id}
              schema={schema}
              level={level + 1}
              isMongo={connection.engine === "mongo"}
              openByDefault={schema.name === defaultSchemaFor(connection)}
              activeTable={activeTable}
              onOpenTable={onOpenTable}
              onOpenDiagram={hasSqlEditor ? onOpenDiagram : undefined}
              onOpenSchemaDiff={hasSqlEditor ? onOpenSchemaDiff : undefined}
              canCreateTable={hasSqlEditor && !connection.readOnly}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function SchemaNode({
  connectionId,
  schema,
  level,
  isMongo,
  openByDefault,
  activeTable,
  onOpenTable,
  onOpenDiagram,
  onOpenSchemaDiff,
  canCreateTable
}: SchemaNodeProps) {
  const [expanded, setExpanded] = useState(openByDefault);
  const [menuOpen, setMenuOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  const relationCount = countRelations(schema.relations, isMongo);
  const actions: RowAction[] = [
    ...(onOpenDiagram
      ? [
          {
            label: "Abrir diagrama ER",
            icon: <Network />,
            onSelect: () => onOpenDiagram({ connectionId, schema: schema.name })
          }
        ]
      : []),
    ...(onOpenSchemaDiff
      ? [
          {
            label: "Comparar com outro schema…",
            icon: <GitCompare />,
            onSelect: () => onOpenSchemaDiff({ connectionId, schema: schema.name })
          }
        ]
      : []),
    ...(canCreateTable
      ? [{ label: "Nova tabela…", icon: <Plus />, onSelect: () => setCreating(true) }]
      : [])
  ];

  return (
    <li role="none">
      <div
        className="group flex items-center hover:bg-muted"
        onContextMenu={event => {
          if (actions.length > 0) {
            event.preventDefault();
            setMenuOpen(true);
          }
        }}
      >
        <button
          ref={rowRef}
          type="button"
          role="treeitem"
          aria-level={level}
          aria-expanded={expanded}
          aria-keyshortcuts={actions.length > 0 ? "Shift+F10" : undefined}
          tabIndex={-1}
          onClick={() => setExpanded(prev => !prev)}
          onKeyDown={event => {
            if (actions.length > 0 && isMenuKey(event)) {
              event.preventDefault();
              setMenuOpen(true);
            }
          }}
          className={cn(TREE_ROW, "min-w-0 flex-1 text-muted-foreground hover:bg-transparent")}
        >
          <Chevron className="size-3.5 shrink-0" />
          <span className="min-w-0 [overflow-wrap:anywhere]">{schema.name}</span>
          {/* read as "public · 2 tabelas", never "public2"; the word shows on hover */}
          <span className="sr-only"> · </span>
          <span aria-hidden className="font-mono text-[11px]" title={relationCount}>
            {schema.relations.length}
          </span>
          <span className="sr-only">{relationCount}</span>
        </button>
        {actions.length > 0 && (
          <RowMenu
            label={`Ações de ${schema.name}`}
            actions={actions}
            open={menuOpen}
            onOpenChange={setMenuOpen}
            rowRef={rowRef}
            className="mr-0.5"
          />
        )}
      </div>
      {creating && (
        <NewTableFlow
          connectionId={connectionId}
          schema={schema.name}
          onCancel={() => setCreating(false)}
          onCreated={table => {
            setCreating(false);
            onOpenTable({ connectionId, schema: schema.name, table });
          }}
        />
      )}
      {expanded && (
        <ul role="group" className="grid grid-cols-1 pl-4">
          {schema.relations.length === 0 && (
            <li role="none" className="px-1.5 py-1 text-xs text-muted-foreground">
              {isMongo ? "Sem coleções" : "Sem tabelas"}
            </li>
          )}
          {schema.relations.map(relation => {
            const isActive =
              activeTable?.connectionId === connectionId &&
              activeTable.schema === schema.name &&
              activeTable.table === relation.name;
            // a collection holds documents, not rows: it does not wear the table's grid
            const Icon = isMongo ? Braces : relation.kind === "table" ? Table2 : Eye;
            return (
              <li role="none" key={relation.name}>
                <button
                  type="button"
                  role="treeitem"
                  aria-level={level + 1}
                  aria-selected={isActive || undefined}
                  tabIndex={-1}
                  onClick={() =>
                    onOpenTable({ connectionId, schema: schema.name, table: relation.name })
                  }
                  className={cn(TREE_ROW, isActive && ACTIVE_ROW)}
                >
                  <Icon className="size-3.5 shrink-0 opacity-70" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {relation.name}
                    {/* the eye is the only mark of a view: said aloud too (tables are the norm) */}
                    {!isMongo && relation.kind !== "table" && (
                      <span className="sr-only">, view</span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
