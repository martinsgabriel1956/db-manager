import type { ConnectionConfig, Engine, Environment, TlsMode } from "@/bindings";

export const ENGINES = [
  "postgres",
  "mysql",
  "sqlite",
  "mongo",
  "redis"
] as const satisfies readonly Engine[];

export const ENVIRONMENTS = [
  "local",
  "dev",
  "staging",
  "prod"
] as const satisfies readonly Environment[];

export const TLS_MODES = [
  "disable",
  "prefer",
  "require",
  "verifyFull"
] as const satisfies readonly TlsMode[];

export const ENGINE_LABEL: Record<Engine, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
  mongo: "MongoDB",
  redis: "Redis"
};

export const DEFAULT_PORT: Record<Exclude<Engine, "sqlite">, number> = {
  postgres: 5432,
  mysql: 3306,
  mongo: 27017,
  redis: 6379
};

/** Printed environment tag: the label always says it, colour only reinforces. */
export const ENVIRONMENT_STYLE: Record<Environment, { label: string; tagClass: string }> = {
  local: { label: "Local", tagClass: "border border-dashed border-current" },
  dev: { label: "Dev", tagClass: "border border-current" },
  staging: { label: "Staging", tagClass: "bg-warning text-primary-foreground" },
  prod: { label: "Prod", tagClass: "bg-seal text-white" }
};

/** Tube-cap colour per engine, used on connection labels and tabs. */
export const ENGINE_CAP: Record<Engine, string> = {
  postgres: "bg-cap-postgres",
  mysql: "bg-cap-mysql",
  sqlite: "bg-cap-sqlite",
  mongo: "bg-cap-mongo",
  redis: "bg-cap-redis"
};

export const TLS_LABEL: Record<TlsMode, string> = {
  disable: "Desativado",
  prefer: "Preferir",
  require: "Exigir",
  verifyFull: "Exigir e verificar certificado"
};

export const DEFAULT_REDIS_SEPARATOR = ":";

export const DEFAULT_TIMEOUT_SECS = 30;

/** Engines with tables and the SQL editor. */
export function isSqlEngine(engine: Engine): boolean {
  return engine === "postgres" || engine === "mysql" || engine === "sqlite";
}

/** Schema (MongoDB: database) opened by default in the tree, also used for autocomplete. */
export function defaultSchemaFor(connection: ConnectionConfig): string {
  const { engine, target } = connection;
  if (engine === "sqlite") {
    return "main";
  }
  if ((engine === "mysql" || engine === "mongo") && target.kind !== "file") {
    return target.database;
  }
  return "public";
}
