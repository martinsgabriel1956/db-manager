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
  /** folder in the sidebar; empty = ungrouped */
  group: string;
  engine: Engine;
  /** empty until chosen: the protection regime is never a silent default */
  environment: Environment | "";
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
  /** MongoDB only: host/port fields or a connection string */
  mongoMode: "network" | "uri";
  /** the connection string; kept in the keychain like a password */
  uri: string;
  /** host/port targets only: reach the server through the system ssh */
  sshEnabled: boolean;
  sshHost: string;
  /** empty fields are left to ~/.ssh/config */
  sshPort: string;
  sshUser: string;
  sshIdentityFile: string;
};

export type FormErrors = Partial<Record<keyof ConnectionFormValues, string>>;

export type ParsedForm =
  | { success: true; config: ConnectionConfig; secret: SecretChange }
  | { success: false; errors: FormErrors };

export const EMPTY_FORM: ConnectionFormValues = {
  name: "",
  group: "",
  engine: "postgres",
  environment: "",
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
  keySeparator: DEFAULT_REDIS_SEPARATOR,
  mongoMode: "network",
  uri: "",
  sshEnabled: false,
  sshHost: "",
  sshPort: "",
  sshUser: "",
  sshIdentityFile: ""
};

const CONNECTION_STRING = /^mongodb(\+srv)?:\/\//;

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

const sshSchema = z.object({
  sshHost: z.string().trim().min(1, "Informe o host SSH"),
  sshPort: z
    .string()
    .trim()
    .regex(/^\d*$/, "Porta inválida")
    .refine(port => port === "" || (Number(port) >= 1 && Number(port) <= 65535), "Porta inválida"),
  sshUser: z.string().trim(),
  sshIdentityFile: z.string().trim()
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
  network: z.infer<typeof networkSchema> | undefined,
  uriDatabase: string | undefined
): Target | undefined {
  if (uriDatabase !== undefined) {
    return { kind: "uri", database: uriDatabase };
  }
  if (file) {
    return { kind: "file", path: file.filePath };
  }
  if (network) {
    return { kind: "network", ...network };
  }
  return undefined;
}

function isUriMode(values: ConnectionFormValues): boolean {
  return values.engine === "mongo" && values.mongoMode === "uri";
}

function secretChange(values: ConnectionFormValues, copyOf: string | undefined): SecretChange {
  // left empty on a copy, the original's stored secret is copied by the backend
  const keep: SecretChange = copyOf ? { action: "copyFrom", value: copyOf } : { action: "keep" };
  if (values.engine === "sqlite") {
    return { action: "keep" };
  }
  if (isUriMode(values)) {
    const uri = values.uri.trim();
    return uri === "" ? keep : { action: "set", value: uri };
  }
  if (values.clearPassword) {
    return { action: "clear" };
  }
  if (values.password !== "") {
    return { action: "set", value: values.password };
  }
  return keep;
}

/**
 * `isEditing`: an existing connection may leave secrets empty to keep the stored ones.
 * `copyOf`: the id of the connection being duplicated, whose stored secrets an empty field copies.
 */
export function parseForm(
  values: ConnectionFormValues,
  id: string,
  isEditing = false,
  copyOf?: string
): ParsedForm {
  const errors: FormErrors = {};
  const isSqlite = values.engine === "sqlite";
  const isRedis = values.engine === "redis";
  const isUri = isUriMode(values);

  const common = collect(commonSchema, values, errors);
  const network = isSqlite || isUri ? undefined : collect(networkSchema, values, errors);
  const file = isSqlite ? collect(fileSchema, values, errors) : undefined;
  const redis = isRedis ? collect(redisSchema, values, errors) : undefined;
  const hasSsh = values.sshEnabled && !isSqlite && !isUri;
  const ssh = hasSsh ? collect(sshSchema, values, errors) : undefined;
  if (hasSsh && values.tlsMode === "verifyFull") {
    errors.tlsMode = 'Pelo túnel SSH o certificado não confere com o host: use "Exigir"';
  }
  if (isUri) {
    const uri = values.uri.trim();
    if (uri === "" && !isEditing && !copyOf) {
      errors.uri = "Informe a URI de conexão";
    } else if (uri !== "" && !CONNECTION_STRING.test(uri)) {
      errors.uri = "Use mongodb:// ou mongodb+srv://";
    }
  }

  const target = toTarget(file, network, isUri ? values.database.trim() : undefined);
  const environment = values.environment === "" ? null : values.environment;
  if (!environment) {
    errors.environment = "Escolha o ambiente: ele define as proteções desta conexão";
  }

  if (!common || !target || !environment || Object.keys(errors).length > 0) {
    return { success: false, errors };
  }

  const caCertPath = values.caCertPath.trim();

  return {
    success: true,
    config: {
      id,
      name: common.name,
      group: values.group.trim() || null,
      engine: values.engine,
      environment,
      readOnly: values.readOnly,
      timeoutSecs: common.timeoutSecs,
      target,
      tls: {
        mode: isSqlite ? "disable" : values.tlsMode,
        caCertPath: isSqlite || caCertPath === "" ? null : caCertPath
      },
      keySeparator: redis ? redis.keySeparator : null,
      ssh: ssh
        ? {
            host: ssh.sshHost,
            port: ssh.sshPort === "" ? null : Number(ssh.sshPort),
            user: ssh.sshUser || null,
            identityFile: ssh.sshIdentityFile || null
          }
        : null
    },
    secret: secretChange(values, copyOf)
  };
}

export function fromConfig(config: ConnectionConfig): ConnectionFormValues {
  const network = config.target.kind === "network" ? config.target : null;
  const uri = config.target.kind === "uri" ? config.target : null;
  return {
    ...EMPTY_FORM,
    name: config.name,
    group: config.group ?? "",
    engine: config.engine,
    environment: config.environment,
    readOnly: config.readOnly,
    timeoutSecs: String(config.timeoutSecs),
    host: network?.host ?? "",
    port: network ? String(network.port) : "",
    database: network?.database ?? uri?.database ?? "",
    username: network?.username ?? "",
    filePath: config.target.kind === "file" ? config.target.path : "",
    tlsMode: config.tls.mode,
    caCertPath: config.tls.caCertPath ?? "",
    keySeparator: config.keySeparator ?? DEFAULT_REDIS_SEPARATOR,
    mongoMode: uri ? "uri" : "network",
    sshEnabled: Boolean(config.ssh),
    sshHost: config.ssh?.host ?? "",
    sshPort: config.ssh?.port == null ? "" : String(config.ssh.port),
    sshUser: config.ssh?.user ?? "",
    sshIdentityFile: config.ssh?.identityFile ?? ""
  };
}

/**
 * A copy of a connection as a new one. The environment comes back empty: the protection
 * regime is chosen again, never carried over silently.
 */
export function duplicateForm(config: ConnectionConfig): ConnectionFormValues {
  return { ...fromConfig(config), name: `${config.name} (cópia)`, environment: "" };
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
  // Redis's "0" is a default too: it does not follow the form into a database name
  const leavingRedisDefault = values.engine === "redis" && values.database === "0";
  const database =
    engine === "redis"
      ? values.database === ""
        ? "0"
        : values.database
      : leavingRedisDefault
        ? ""
        : values.database;
  const mongoMode = engine === "mongo" ? values.mongoMode : "network";
  return { ...values, engine, port, tlsMode, database, mongoMode };
}

const URL_ENGINE: Record<string, Engine> = {
  "postgres:": "postgres",
  "postgresql:": "postgres",
  "mysql:": "mysql",
  "redis:": "redis",
  "rediss:": "redis"
};

/** libpq's sslmode and MySQL's ssl-mode; verify-ca reads as the stricter verifyFull */
const URL_TLS: Record<string, TlsMode> = {
  disable: "disable",
  disabled: "disable",
  allow: "prefer",
  prefer: "prefer",
  preferred: "prefer",
  require: "require",
  required: "require",
  "verify-ca": "verifyFull",
  verify_ca: "verifyFull",
  "verify-full": "verifyFull",
  verify_identity: "verifyFull"
};

export type ConnectionUrl = { engine: Engine; patch: Partial<ConnectionFormValues> };

/**
 * A pasted `postgres://`, `mysql://` or `redis://` URL split into the form's fields;
 * null when it is not one. Only what the URL states is filled in: a URL without a port
 * keeps the engine's default.
 */
export function parseConnectionUrl(text: string): ConnectionUrl | null {
  let url: URL;
  try {
    url = new URL(text.trim());
  } catch {
    return null;
  }
  const engine = URL_ENGINE[url.protocol];
  if (!engine || !url.hostname) {
    return null;
  }
  const decode = (part: string) => {
    try {
      return decodeURIComponent(part);
    } catch {
      return part;
    }
  };
  const patch: Partial<ConnectionFormValues> = {
    // IPv6 hosts come bracketed: the host field takes the bare address
    host: url.hostname.replace(/^\[(.*)\]$/, "$1"),
    database: decode(url.pathname.replace(/^\//, "")),
    username: decode(url.username),
    password: decode(url.password)
  };
  if (url.port) {
    patch.port = url.port;
  }
  const tls =
    url.protocol === "rediss:"
      ? "require"
      : URL_TLS[
          (url.searchParams.get("sslmode") ?? url.searchParams.get("ssl-mode") ?? "").toLowerCase()
        ];
  if (tls) {
    patch.tlsMode = tls;
  }
  return { engine, patch };
}
