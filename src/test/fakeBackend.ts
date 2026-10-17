import { mockIPC } from "@tauri-apps/api/mocks";
import type { InvokeArgs } from "@tauri-apps/api/core";
import type {
  CompletionTable,
  ConnectionConfig,
  DiagramTable,
  KeyDetail,
  KeychainOutcome,
  RowBatch,
  RunResponse,
  SchemaInfo,
  ScriptOutcome,
  SessionList,
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

export const devMongo: ConnectionConfig = {
  ...prodPostgres,
  id: "mongo-1",
  name: "Mongo dev",
  engine: "mongo",
  environment: "dev",
  readOnly: false,
  target: { kind: "network", host: "localhost", port: 27017, database: "shop", username: "" },
  tls: { mode: "disable", caCertPath: null }
};

export const mongoDocuments = [
  '{"_id":{"$oid":"65a1b2c3d4e5f60718293a4b"},"name":"Ana","visits":{"$numberLong":"9007199254740993"},"address":{"city":"São Paulo"}}',
  '{"_id":{"$oid":"65a1b2c3d4e5f60718293a4c"},"name":"Bia","visits":{"$numberLong":"2"}}'
];

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

export const redisKeys: Record<string, KeyDetail> = {
  "user:1": {
    key: "user:1",
    ttlSecs: 120,
    length: 2,
    truncated: false,
    value: {
      kind: "hash",
      entries: [
        { field: { text: "city", binary: false }, value: { text: "São Paulo", binary: false } },
        { field: { text: "name", binary: false }, value: { text: "Ana", binary: false } }
      ]
    }
  },
  "user:2": {
    key: "user:2",
    ttlSecs: null,
    length: 5,
    truncated: false,
    value: { kind: "string", value: { text: "hello", binary: false } }
  },
  queue: {
    key: "queue",
    ttlSecs: null,
    length: 1500,
    truncated: true,
    value: {
      kind: "list",
      items: [
        { text: "a", binary: false },
        { text: "\\xff", binary: true }
      ]
    }
  },
  events: {
    key: "events",
    ttlSecs: null,
    length: 1,
    truncated: false,
    value: {
      kind: "stream",
      entries: [
        {
          id: "1-1",
          fields: [
            { field: { text: "kind", binary: false }, value: { text: "login", binary: false } }
          ]
        }
      ]
    }
  }
};

export const diagram: DiagramTable[] = [
  {
    name: "teams",
    columns: [
      {
        name: "id",
        dataType: "integer",
        nullable: false,
        default: null,
        isPrimaryKey: true,
        options: []
      },
      {
        name: "name",
        dataType: "text",
        nullable: true,
        default: null,
        isPrimaryKey: false,
        options: []
      }
    ],
    foreignKeys: []
  },
  {
    name: "users",
    columns: [
      {
        name: "id",
        dataType: "integer",
        nullable: false,
        default: null,
        isPrimaryKey: true,
        options: []
      },
      {
        name: "team_id",
        dataType: "integer",
        nullable: true,
        default: null,
        isPrimaryKey: false,
        options: []
      }
    ],
    foreignKeys: [
      {
        name: "users_team_id_fkey",
        definition: "FOREIGN KEY (team_id) REFERENCES teams(id)",
        columns: ["team_id"],
        referencedSchema: "public",
        referencedTable: "teams",
        referencedColumns: ["id"]
      },
      {
        name: "users_tenant_fkey",
        definition: "FOREIGN KEY (team_id) REFERENCES billing.tenants(id)",
        columns: ["team_id"],
        referencedSchema: "billing",
        referencedTable: "tenants",
        referencedColumns: ["id"]
      }
    ]
  }
];

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
    {
      name: "id",
      dataType: "integer",
      nullable: false,
      default: null,
      isPrimaryKey: true,
      options: []
    },
    {
      name: "profile",
      dataType: "jsonb",
      nullable: true,
      default: null,
      isPrimaryKey: false,
      options: []
    }
  ],
  indexes: [{ name: "users_pkey", definition: "CREATE UNIQUE INDEX users_pkey ON users (id)" }],
  foreignKeys: [],
  constraints: []
};

export const usersDdl = 'CREATE TABLE "public"."users" (\n    "id" integer NOT NULL\n);';

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

export const sessionList: SessionList = {
  statement: "SELECT pid, usename … FROM pg_stat_activity",
  actions: ["cancelQuery", "endSession"],
  slowLog: [],
  sessions: [
    {
      id: "101",
      user: "me",
      database: "app",
      state: "active",
      seconds: 0,
      client: "10.0.0.5:5000 · ordo",
      query: "SELECT pid, usename … FROM pg_stat_activity",
      own: true
    },
    {
      id: "202",
      user: "worker",
      database: "app",
      state: "active",
      seconds: 3725,
      client: "10.0.0.9:6000 · jobs",
      query: "UPDATE jobs SET done = true",
      own: false
    }
  ]
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
    quit_app: () => null,
    hide_window: () => null,
    test_connection: () => null,
    disconnect_database: () => null,
    list_schemas: () => schemas,
    table_structure: () => usersStructure,
    table_ddl: () => ({ sql: usersDdl, reconstructed: true }),
    completion_tables: () => completion,
    browse_table: () => usersPage,
    estimate_rows: () => "12345",
    count_rows: () => "12346",
    run_script: () => executed(rowsOutcome),
    apply_changes: () => ({ status: "applied", rowsChanged: 1 }),
    alter_schema: args => {
      const { change, confirmed } = args as { change: { kind: string }; confirmed: boolean };
      if (confirmed) {
        return executed({
          statementCount: 1,
          durationMs: 2,
          result: { kind: "command", rowsAffected: 0 }
        });
      }
      const destructive = change.kind.startsWith("drop");
      return {
        status: "needsConfirmation",
        confirmation: {
          reason: destructive
            ? "Comando destrutivo: ALTER TABLE … DROP"
            : "Alteração de estrutura: confira o comando antes de executar",
          statements: [`-- ${change.kind}`],
          destructive
        }
      };
    },
    column_definition: () => "varchar(10) NOT NULL COMMENT 'x'",
    copy_as_insert: () => 'INSERT INTO "public"."users" ("id", "profile") VALUES (\'2\', NULL);\n',
    search_history: () => [],
    browse_collection: () => ({ documents: mongoDocuments, hasMore: true }),
    collection_indexes: () => [{ name: "_id_", definition: '{"_id":1}' }],
    index_statement: args => {
      const { index } = args as { index: { collection: string; keys: { field: string }[] } };
      return `shop.runCommand({"createIndexes":"${index.collection}","keys":"${index.keys.map(k => k.field).join(",")}"})`;
    },
    create_index: () => ({ status: "applied" }),
    drop_index: () => ({ status: "applied" }),
    run_aggregation: () => ({
      status: "executed",
      outcome: { documents: ['{"_id":"even","total":110}'], truncated: false, durationMs: 4 }
    }),
    write_document: () => ({ status: "written", id: '{"$oid":"65a1b2c3d4e5f60718293a4b"}' }),
    watch_collection: () => null,
    stop_watch: () => null,
    redis_databases: () => [
      { index: 0, keys: 4 },
      { index: 1, keys: 0 }
    ],
    scan_keys: () => ({
      keys: Object.values(redisKeys).map(detail => ({ name: detail.key, kind: detail.value.kind })),
      cursor: "0"
    }),
    read_key: args => {
      const detail = redisKeys[(args as { key: string }).key];
      if (!detail) {
        return Promise.reject({ kind: "notFound", message: "não encontrado: chave" });
      }
      return detail;
    },
    edit_key: () => ({ status: "applied" }),
    run_redis_command: () => ({ status: "executed", outcome: { output: "OK", durationMs: 1 } }),
    redis_subscribe: () => null,
    stop_redis_session: () => null,
    redis_monitor: () => ({ status: "started" }),
    redis_publish: () => ({
      status: "executed",
      outcome: { output: "(integer) 1", durationMs: 1 }
    }),
    server_modules: () => [{ name: "ReJSON", version: "20609" }],
    server_info: () => [
      { name: "Server", entries: [["redis_version", "7.4.0"]] },
      { name: "Memory", entries: [["used_memory_human", "1.2M"]] }
    ],
    schema_diagram: () => diagram,
    list_sessions: () => sessionList,
    kill_session: () => ({ status: "done" }),
    export_query: () => ({ rows: 1, durationMs: 3 }),
    export_table: () => ({ rows: 1234, durationMs: 3 }),
    export_collection: () => ({ rows: 2, durationMs: 3 }),
    export_keys: () => ({ rows: 4, durationMs: 3 }),
    "plugin:dialog|save": () => "/tmp/export.csv",
    "plugin:dialog|open": () => "/tmp/users.csv",
    preview_csv: () => ({
      columns: ["ID", "perfil"],
      rows: [
        ["1", '{"a": 1}'],
        ["2", null]
      ],
      delimiter: ";"
    }),
    import_documents: args =>
      (args as { confirmed: boolean }).confirmed
        ? { status: "imported", rows: 2, durationMs: 4 }
        : {
            status: "needsConfirmation",
            confirmation: {
              reason: "Importar 2 documentos de customers.ndjson em shop.customers",
              statements: [`shop.customers.insertMany([${mongoDocuments[0]}, …])`],
              destructive: false
            }
          },
    import_csv: args =>
      (args as { confirmed: boolean }).confirmed
        ? { status: "imported", rows: 1200, durationMs: 9 }
        : {
            status: "needsConfirmation",
            confirmation: {
              reason: "Importar 1200 linhas de users.csv em public.users",
              statements: ['INSERT INTO "public"."users" ("id") VALUES (\'1\'), (\'2\')'],
              destructive: false
            }
          },
    fetch_more: () => ({ columns: [], rows: [], hasMore: false }),
    close_cursor: () => null,
    // the launch check finds nothing new unless a test says otherwise
    check_update: () => ({ current: "0.3.0", available: null, installable: true }),
    cancel_run: () => null
  };

  mockIPC(
    (cmd, args) => {
      calls.push({ cmd, args });
      const handler = overrides[cmd] ?? defaults[cmd];
      // tab persistence is mocked in setup.ts; other plugin calls answer null unless a test overrides them
      if (!handler && cmd.startsWith("plugin:")) {
        return null;
      }
      if (!handler) {
        throw new Error(`unexpected command ${cmd}`);
      }
      return handler(args);
      // events (the window's close-requested) go through the mock too, so tests can emit them
    },
    { shouldMockEvents: true }
  );

  return calls;
}

export function callsTo(calls: Call[], cmd: string) {
  return calls.filter(call => call.cmd === cmd).map(call => call.args);
}
