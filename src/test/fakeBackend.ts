import { mockIPC } from "@tauri-apps/api/mocks";
import type { InvokeArgs } from "@tauri-apps/api/core";
import type {
  CompletionTable,
  ConnectionConfig,
  KeychainOutcome,
  RowBatch,
  RunResponse,
  SchemaInfo,
  ScriptOutcome,
  TableStructure
} from "@/bindings";

export type Call = { cmd: string; args: InvokeArgs | undefined };

type Handler = (args: InvokeArgs | undefined) => unknown;

export const prodPostgres: ConnectionConfig = {
  id: "pg-1",
  name: "Postgres prod",
  engine: "postgres",
  environment: "prod",
  readOnly: true,
  timeoutSecs: 30,
  target: { kind: "network", host: "db", port: 5432, database: "app", username: "me" },
  tls: { mode: "require", caCertPath: null },
  keySeparator: null
};

export const devPostgres: ConnectionConfig = {
  ...prodPostgres,
  id: "pg-dev",
  name: "Postgres dev",
  environment: "dev",
  readOnly: false
};

export const localRedis: ConnectionConfig = {
  ...prodPostgres,
  id: "redis-1",
  name: "Cache",
  engine: "redis",
  environment: "local",
  readOnly: false,
  target: { kind: "network", host: "localhost", port: 6379, database: "0", username: "" },
  keySeparator: ":"
};

export const schemas: SchemaInfo[] = [
  {
    name: "public",
    relations: [
      { name: "users", kind: "table" },
      { name: "active_users", kind: "view" }
    ]
  },
  { name: "audit", relations: [] }
];

export const usersStructure: TableStructure = {
  columns: [
    { name: "id", dataType: "integer", nullable: false, default: null, isPrimaryKey: true },
    { name: "profile", dataType: "jsonb", nullable: true, default: null, isPrimaryKey: false }
  ],
  indexes: [{ name: "users_pkey", definition: "CREATE UNIQUE INDEX users_pkey ON users (id)" }],
  foreignKeys: []
};

export const usersPage: RowBatch = {
  columns: [
    { name: "id", typeName: "int4", editable: true },
    { name: "profile", typeName: "jsonb", editable: true }
  ],
  rows: [
    [
      { t: "int", v: "1" },
      { t: "json", v: '{"id": 9007199254740993}' }
    ],
    [{ t: "int", v: "2" }, { t: "null" }]
  ],
  hasMore: true
};

export const completion: CompletionTable[] = [
  { schema: "public", table: "users", columns: ["id", "profile"] }
];

export const rowsOutcome: ScriptOutcome = {
  statementCount: 1,
  durationMs: 5,
  result: {
    kind: "rows",
    batch: {
      columns: [{ name: "n", typeName: "int4", editable: true }],
      rows: [[{ t: "int", v: "1" }]],
      hasMore: false
    },
    cursorId: null
  }
};

export function executed(outcome: ScriptOutcome): RunResponse {
  return { status: "executed", outcome };
}

/**
 * In-memory stand-in for the Rust commands. Records every call; `overrides`
 * replaces a command's behaviour (return a value, a rejected promise or a pending one).
 */
export function fakeBackend(initial: ConnectionConfig[], overrides: Record<string, Handler> = {}) {
  let connections = [...initial];
  const calls: Call[] = [];
  const ok: KeychainOutcome = { keychainWarning: null };

  const defaults: Record<string, Handler> = {
    list_connections: () => connections,
    save_connection: args => {
      const { config } = args as { config: ConnectionConfig };
      connections = [...connections.filter(c => c.id !== config.id), config];
      return ok;
    },
    delete_connection: args => {
      const { id } = args as { id: string };
      connections = connections.filter(c => c.id !== id);
      return ok;
    },
    connect_database: () => null,
    disconnect_database: () => null,
    list_schemas: () => schemas,
    table_structure: () => usersStructure,
    completion_tables: () => completion,
    browse_table: () => usersPage,
    run_script: () => executed(rowsOutcome),
    apply_changes: () => ({ status: "applied", rowsChanged: 1 }),
    search_history: () => [],
    fetch_more: () => ({ columns: [], rows: [], hasMore: false }),
    close_cursor: () => null,
    cancel_run: () => null
  };

  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    // tab persistence is mocked in setup.ts; nothing else talks to plugins
    if (cmd.startsWith("plugin:")) {
      return null;
    }
    const handler = overrides[cmd] ?? defaults[cmd];
    if (!handler) {
      throw new Error(`unexpected command ${cmd}`);
    }
    return handler(args);
  });

  return calls;
}

export function callsTo(calls: Call[], cmd: string) {
  return calls.filter(call => call.cmd === cmd).map(call => call.args);
}
