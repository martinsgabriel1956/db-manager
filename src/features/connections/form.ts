import { z } from "zod";
import type {
  ConnectionConfig,
  Engine,
  Environment,
  SecretChange,
  Target,
  TlsMode
} from "@/bindings";
import {
  DEFAULT_PORT,
  DEFAULT_REDIS_SEPARATOR,
  DEFAULT_TIMEOUT_SECS
} from "@/features/connections/options";

// Form state mirrors the inputs (strings), parseForm turns it into a ConnectionConfig.
// The Rust use case is the source of truth; this validation only exists for inline UX.

export type ConnectionFormValues = {
  name: string;
  engine: Engine;
  environment: Environment;
  readOnly: boolean;
  timeoutSecs: string;
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  clearPassword: boolean;
  filePath: string;
  tlsMode: TlsMode;
  caCertPath: string;
  keySeparator: string;
};

export type FormErrors = Partial<Record<keyof ConnectionFormValues, string>>;

export type ParsedForm =
  | { success: true; config: ConnectionConfig; secret: SecretChange }
  | { success: false; errors: FormErrors };

export const EMPTY_FORM: ConnectionFormValues = {
  name: "",
  engine: "postgres",
  environment: "local",
  readOnly: false,
  timeoutSecs: String(DEFAULT_TIMEOUT_SECS),
  host: "localhost",
  port: String(DEFAULT_PORT.postgres),
  database: "",
  username: "",
  password: "",
  clearPassword: false,
  filePath: "",
  tlsMode: "prefer",
  caCertPath: "",
  keySeparator: DEFAULT_REDIS_SEPARATOR
};

const commonSchema = z.object({
  name: z.string().trim().min(1, "Informe um nome"),
  timeoutSecs: z.coerce
    .number({ error: "Use um número" })
    .int("Use um número inteiro")
    .min(0, "Use 0 ou mais")
});

const networkSchema = z.object({
  host: z.string().trim().min(1, "Informe o host"),
  port: z.coerce
    .number({ error: "Porta inválida" })
    .int("Porta inválida")
    .min(1, "Porta inválida")
    .max(65535, "Porta inválida"),
  database: z.string().trim(),
  username: z.string().trim()
});

const redisSchema = z.object({
  database: z
    .string()
    .trim()
    .regex(/^([0-9]|1[0-5])?$/, "Use um número de 0 a 15"),
  keySeparator: z.string().min(1, "Informe o separador")
});

const fileSchema = z.object({
  filePath: z.string().trim().min(1, "Informe o caminho do arquivo")
});

function collect<T>(schema: z.ZodType<T>, input: unknown, errors: FormErrors): T | undefined {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  for (const issue of result.error.issues) {
    const field = issue.path[0] as keyof ConnectionFormValues;
    errors[field] ??= issue.message;
  }
  return undefined;
}

function toTarget(
  file: z.infer<typeof fileSchema> | undefined,
  network: z.infer<typeof networkSchema> | undefined
): Target | undefined {
  if (file) {
    return { kind: "file", path: file.filePath };
  }
  if (network) {
    return { kind: "network", ...network };
  }
  return undefined;
}

function secretChange(values: ConnectionFormValues): SecretChange {
  if (values.engine === "sqlite") {
    return { action: "keep" };
  }
  if (values.clearPassword) {
    return { action: "clear" };
  }
  if (values.password !== "") {
    return { action: "set", value: values.password };
  }
  return { action: "keep" };
}

export function parseForm(values: ConnectionFormValues, id: string): ParsedForm {
  const errors: FormErrors = {};
  const isSqlite = values.engine === "sqlite";
  const isRedis = values.engine === "redis";

  const common = collect(commonSchema, values, errors);
  const network = isSqlite ? undefined : collect(networkSchema, values, errors);
  const file = isSqlite ? collect(fileSchema, values, errors) : undefined;
  const redis = isRedis ? collect(redisSchema, values, errors) : undefined;

  const target = toTarget(file, network);

  if (!common || !target || Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  const caCertPath = values.caCertPath.trim();

  return {
    success: true,
    config: {
      id,
      name: common.name,
      engine: values.engine,
      environment: values.environment,
      readOnly: values.readOnly,
      timeoutSecs: common.timeoutSecs,
      target,
      tls: {
        mode: isSqlite ? "disable" : values.tlsMode,
        caCertPath: isSqlite || caCertPath === "" ? null : caCertPath
      },
      keySeparator: redis ? redis.keySeparator : null
    },
    secret: secretChange(values)
  };
}

export function fromConfig(config: ConnectionConfig): ConnectionFormValues {
  const network = config.target.kind === "network" ? config.target : null;
  return {
    ...EMPTY_FORM,
    name: config.name,
    engine: config.engine,
    environment: config.environment,
    readOnly: config.readOnly,
    timeoutSecs: String(config.timeoutSecs),
    host: network?.host ?? "",
    port: network ? String(network.port) : "",
    database: network?.database ?? "",
    username: network?.username ?? "",
    filePath: config.target.kind === "file" ? config.target.path : "",
    tlsMode: config.tls.mode,
    caCertPath: config.tls.caCertPath ?? "",
    keySeparator: config.keySeparator ?? DEFAULT_REDIS_SEPARATOR
  };
}

/** Swaps the engine and carries over sensible defaults (port, TLS) without clobbering user input. */
export function changeEngine(values: ConnectionFormValues, engine: Engine): ConnectionFormValues {
  // any engine's default counts as untouched: the port is hidden while on sqlite,
  // so "previous engine's default" alone misses postgres → sqlite → mongo
  const defaultPorts = Object.values(DEFAULT_PORT).map(String);
  const portUntouched = values.port === "" || defaultPorts.includes(values.port);
  const port = engine === "sqlite" || !portUntouched ? values.port : String(DEFAULT_PORT[engine]);
  const tlsMode =
    engine === "sqlite" ? "disable" : values.tlsMode === "disable" ? "prefer" : values.tlsMode;
  const database = engine === "redis" && values.database === "" ? "0" : values.database;
  return { ...values, engine, port, tlsMode, database };
}
