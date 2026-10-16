import { z } from "zod";
import type {
  ConnectionConfig,
  Engine,
  Environment,
  NodeAddress,
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
  /** Redis only: one server, or a cluster reached through its seed nodes */
  redisMode: "standalone" | "cluster";
  /** "host:porta" separated by commas or spaces */
  redisNodes: string;
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
  redisMode: "standalone",
  redisNodes: "",
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

/**
 * "host:porta" separated by commas or spaces, IPv6 in brackets; a node without a port
 * gets `defaultPort`. Null when a node does not parse.
 */
export function parseNodes(text: string, defaultPort: number): NodeAddress[] | null {
  const nodes: NodeAddress[] = [];
  for (const part of text.split(/[\s,]+/).filter(Boolean)) {
    const match = /^(\[[^\]]+\]|[^:[\]]+)(?::(\d+))?$/.exec(part);
    const port = match?.[2] === undefined ? defaultPort : Number(match[2]);
    if (!match || port < 1 || port > 65535) {
      return null;
    }
    nodes.push({ host: match[1].replace(/^\[(.*)\]$/, "$1"), port });
  }
  return nodes;
}

export function formatNodes(nodes: NodeAddress[]): string {
  return nodes
    .map(({ host, port }) => `${host.includes(":") ? `[${host}]` : host}:${port}`)
    .join(", ");
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

function isClusterMode(values: ConnectionFormValues): boolean {
  return values.engine === "redis" && values.redisMode === "cluster";
}

function isUriMode(values: ConnectionFormValues): boolean {
  return values.engine === "mongo" && values.mongoMode === "uri";
}

function secretChange(values: ConnectionFormValues): SecretChange {
  if (values.engine === "sqlite") {
    return { action: "keep" };
  }
  if (isUriMode(values)) {
    const uri = values.uri.trim();
    return uri === "" ? { action: "keep" } : { action: "set", value: uri };
  }
  if (values.clearPassword) {
    return { action: "clear" };
  }
  if (values.password !== "") {
    return { action: "set", value: values.password };
  }
  return { action: "keep" };
}

/** `isEditing`: an existing connection may leave secrets empty to keep the stored ones. */
export function parseForm(values: ConnectionFormValues, id: string, isEditing = false): ParsedForm {
  const errors: FormErrors = {};
  const isSqlite = values.engine === "sqlite";
  const isRedis = values.engine === "redis";
  const isUri = isUriMode(values);
  const isCluster = isClusterMode(values);

  const common = collect(commonSchema, values, errors);
  const network =
    isSqlite || isUri || isCluster ? undefined : collect(networkSchema, values, errors);
  const file = isSqlite ? collect(fileSchema, values, errors) : undefined;
  const redis = isRedis
    ? collect(isCluster ? redisSchema.pick({ keySeparator: true }) : redisSchema, values, errors)
    : undefined;
  // the cluster's nodes announce their own addresses, which a tunnel cannot follow
  const hasSsh = values.sshEnabled && !isSqlite && !isUri && !isCluster;
  let cluster: Target | undefined;
  if (isCluster) {
    const nodes = parseNodes(values.redisNodes, DEFAULT_PORT.redis);
    if (!nodes) {
      errors.redisNodes = "Use host:porta, separados por vírgula";
    } else if (nodes.length === 0) {
      errors.redisNodes = "Informe ao menos um nó";
    } else {
      cluster = { kind: "redisCluster", nodes, username: values.username.trim() };
    }
  }
  const ssh = hasSsh ? collect(sshSchema, values, errors) : undefined;
  if (hasSsh && values.tlsMode === "verifyFull") {
    errors.tlsMode = 'Pelo túnel SSH o certificado não confere com o host: use "Exigir"';
  }
  if (isUri) {
    const uri = values.uri.trim();
    if (uri === "" && !isEditing) {
      errors.uri = "Informe a URI de conexão";
    } else if (uri !== "" && !CONNECTION_STRING.test(uri)) {
      errors.uri = "Use mongodb:// ou mongodb+srv://";
    }
  }

  const target = cluster ?? toTarget(file, network, isUri ? values.database.trim() : undefined);
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
    secret: secretChange(values)
  };
}

export function fromConfig(config: ConnectionConfig): ConnectionFormValues {
  const network = config.target.kind === "network" ? config.target : null;
  const uri = config.target.kind === "uri" ? config.target : null;
  const cluster = config.target.kind === "redisCluster" ? config.target : null;
  return {
    ...EMPTY_FORM,
    name: config.name,
    engine: config.engine,
    environment: config.environment,
    readOnly: config.readOnly,
    timeoutSecs: String(config.timeoutSecs),
    host: network?.host ?? "",
    port: network ? String(network.port) : "",
    database: network?.database ?? uri?.database ?? "",
    username: network?.username ?? cluster?.username ?? "",
    filePath: config.target.kind === "file" ? config.target.path : "",
    tlsMode: config.tls.mode,
    caCertPath: config.tls.caCertPath ?? "",
    keySeparator: config.keySeparator ?? DEFAULT_REDIS_SEPARATOR,
    mongoMode: uri ? "uri" : "network",
    redisMode: cluster ? "cluster" : "standalone",
    redisNodes: cluster ? formatNodes(cluster.nodes) : "",
    sshEnabled: Boolean(config.ssh),
    sshHost: config.ssh?.host ?? "",
    sshPort: config.ssh?.port == null ? "" : String(config.ssh.port),
    sshUser: config.ssh?.user ?? "",
    sshIdentityFile: config.ssh?.identityFile ?? ""
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
