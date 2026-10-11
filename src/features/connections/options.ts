import type { Engine, Environment, TlsMode } from "@/bindings";

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

export const ENVIRONMENT_STYLE: Record<Environment, { label: string; dotClass: string }> = {
  local: { label: "Local", dotClass: "bg-neutral-400" },
  dev: { label: "Dev", dotClass: "bg-emerald-500" },
  staging: { label: "Staging", dotClass: "bg-amber-500" },
  prod: { label: "Prod", dotClass: "bg-red-600" }
};

export const TLS_LABEL: Record<TlsMode, string> = {
  disable: "Desativado",
  prefer: "Preferir",
  require: "Exigir",
  verifyFull: "Exigir e verificar certificado"
};

export const DEFAULT_REDIS_SEPARATOR = ":";

export const DEFAULT_TIMEOUT_SECS = 30;
