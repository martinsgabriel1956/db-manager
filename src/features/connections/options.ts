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

/** Environment legend: the word always says it; the outline and hatch reinforce. */
export const ENVIRONMENT_STYLE: Record<Environment, { label: string; tagClass: string }> = {
  local: { label: "Local", tagClass: "border border-dotted border-current" },
  dev: { label: "Dev", tagClass: "border border-current" },
  // the hatch sits in its own cell so it never runs behind the letters
  staging: {
    label: "Staging",
    tagClass:
      "border border-current pl-0 before:mr-1.5 before:h-full before:w-2 before:border-r before:border-current before:hatch before:content-['']"
  },
  prod: { label: "Prod", tagClass: "border border-safelight bg-safelight text-white" }
};

/** Two-letter engine code, set in the legend face on connections and tabs. */
export const ENGINE_CODE: Record<Engine, string> = {
  postgres: "PG",
  mysql: "MY",
  sqlite: "SL",
  mongo: "MG",
  redis: "RD"
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
  if (
    (engine === "mysql" || engine === "mongo") &&
    (target.kind === "network" || target.kind === "uri")
  ) {
    return target.database;
  }
  return "public";
}
