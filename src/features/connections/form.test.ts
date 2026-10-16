import { describe, expect, test } from "vitest";
import type { ConnectionConfig } from "@/bindings";
import {
  changeEngine,
  EMPTY_FORM,
  fromConfig,
  parseConnectionUrl,
  parseForm,
  parseNodes,
  type ConnectionFormValues
} from "@/features/connections/form";

function form(patch: Partial<ConnectionFormValues>): ConnectionFormValues {
  return { ...EMPTY_FORM, environment: "local", ...patch };
}

const postgresConfig: ConnectionConfig = {
  id: "1",
  name: "pg",
  engine: "postgres",
  environment: "prod",
  readOnly: true,
  timeoutSecs: 10,
  target: { kind: "network", host: "db", port: 5433, database: "app", username: "me" },
  tls: { mode: "verifyFull", caCertPath: "/ca.pem" },
  keySeparator: null,
  ssh: null
};

test("a new connection has no environment until one is chosen", () => {
  expect(EMPTY_FORM.environment).toBe("");
  expect(parseForm({ ...form({ name: "pg" }), environment: "" }, "1")).toEqual({
    success: false,
    errors: { environment: "Escolha o ambiente: ele define as proteções desta conexão" }
  });
});

describe("parseForm", () => {
  test("builds a postgres config and sets the typed password", () => {
    const result = parseForm(
      form({
        name: " pg ",
        host: " db ",
        port: "5433",
        database: "app",
        username: "me",
        password: "pw"
      }),
      "1"
    );

    expect(result).toEqual({
      success: true,
      config: {
        id: "1",
        name: "pg",
        engine: "postgres",
        environment: "local",
        readOnly: false,
        timeoutSecs: 30,
        target: { kind: "network", host: "db", port: 5433, database: "app", username: "me" },
        tls: { mode: "prefer", caCertPath: null },
        keySeparator: null,
        ssh: null
      },
      secret: { action: "set", value: "pw" }
    });
  });

  test("keeps the stored password when the field is empty and clears it on request", () => {
    const keep = parseForm(form({ name: "pg" }), "1");
    const clear = parseForm(form({ name: "pg", clearPassword: true, password: "ignored" }), "1");

    expect(keep.success && keep.secret).toEqual({ action: "keep" });
    expect(clear.success && clear.secret).toEqual({ action: "clear" });
  });

  test("builds a sqlite config with a file target, no TLS and no secret", () => {
    const result = parseForm(
      form({
        name: "lite",
        engine: "sqlite",
        filePath: " /tmp/a.db ",
        password: "x",
        tlsMode: "require"
      }),
      "2"
    );

    expect(result.success && result.config.target).toEqual({ kind: "file", path: "/tmp/a.db" });
    expect(result.success && result.config.tls).toEqual({ mode: "disable", caCertPath: null });
    expect(result.success && result.secret).toEqual({ action: "keep" });
  });

  test("builds a redis config with its key separator", () => {
    const result = parseForm(
      form({ name: "cache", engine: "redis", port: "6379", database: "3", keySeparator: "::" }),
      "3"
    );

    expect(result.success && result.config.keySeparator).toBe("::");
  });

  test("keeps a non-empty CA path", () => {
    const result = parseForm(form({ name: "pg", caCertPath: " /ca.pem " }), "1");

    expect(result.success && result.config.tls.caCertPath).toBe("/ca.pem");
  });

  test("reports one message per invalid field", () => {
    const result = parseForm(form({ name: " ", host: "", port: "70000", timeoutSecs: "-1" }), "1");

    expect(result).toEqual({
      success: false,
      errors: {
        name: "Informe um nome",
        host: "Informe o host",
        port: "Porta inválida",
        timeoutSecs: "Use 0 ou mais"
      }
    });
  });

  test("rejects non numeric port and timeout", () => {
    const result = parseForm(form({ name: "pg", port: "abc", timeoutSecs: "1.5" }), "1");

    expect(result.success === false && result.errors).toEqual({
      port: "Porta inválida",
      timeoutSecs: "Use um número inteiro"
    });
  });

  test("requires a file path for sqlite", () => {
    const result = parseForm(form({ name: "lite", engine: "sqlite", filePath: "" }), "1");

    expect(result.success === false && result.errors).toEqual({
      filePath: "Informe o caminho do arquivo"
    });
  });

  test("validates redis database range and separator", () => {
    const result = parseForm(
      form({ name: "cache", engine: "redis", database: "16", keySeparator: "" }),
      "1"
    );

    expect(result.success === false && result.errors).toEqual({
      database: "Use um número de 0 a 15",
      keySeparator: "Informe o separador"
    });
  });
});

describe("ssh tunnel", () => {
  test("empty optional fields become null, left to ~/.ssh/config", () => {
    const result = parseForm(form({ name: "pg", sshEnabled: true, sshHost: " bastion " }), "1");

    expect(result.success && result.config.ssh).toEqual({
      host: "bastion",
      port: null,
      user: null,
      identityFile: null
    });
  });

  test("requires a host, a valid port and no certificate verification", () => {
    const result = parseForm(
      form({ name: "pg", sshEnabled: true, sshPort: "70000", tlsMode: "verifyFull" }),
      "1"
    );

    expect(result.success === false && result.errors).toEqual({
      sshHost: "Informe o host SSH",
      sshPort: "Porta inválida",
      tlsMode: 'Pelo túnel SSH o certificado não confere com o host: use "Exigir"'
    });
  });

  test("is dropped for sqlite and mongo URIs", () => {
    const sqlite = parseForm(
      form({ name: "f", engine: "sqlite", filePath: "/a.db", sshEnabled: true }),
      "1"
    );

    expect(sqlite.success && sqlite.config.ssh).toBeNull();
  });

  test("round-trips through fromConfig", () => {
    const config: ConnectionConfig = {
      ...postgresConfig,
      tls: { mode: "require", caCertPath: null },
      ssh: { host: "bastion", port: 2222, user: "deploy", identityFile: "~/.ssh/id" }
    };

    expect(parseForm(fromConfig(config), "1")).toMatchObject({ success: true, config });
  });
});

describe("fromConfig", () => {
  test("round-trips a network config through parseForm", () => {
    const result = parseForm(fromConfig(postgresConfig), "1");

    expect(result.success && result.config).toEqual(postgresConfig);
  });

  test("maps a file target", () => {
    const values = fromConfig({
      ...postgresConfig,
      engine: "sqlite",
      target: { kind: "file", path: "/a.db" },
      tls: { mode: "disable", caCertPath: null }
    });

    expect(values).toMatchObject({ filePath: "/a.db", host: "", port: "", caCertPath: "" });
  });
});

describe("changeEngine", () => {
  test("swaps an untouched default port", () => {
    expect(changeEngine(EMPTY_FORM, "mysql").port).toBe("3306");
  });

  test("keeps a port the user typed", () => {
    expect(changeEngine(form({ port: "6000" }), "mysql").port).toBe("6000");
  });

  test("disables TLS for sqlite and restores a default when leaving it", () => {
    const sqlite = changeEngine(EMPTY_FORM, "sqlite");
    const back = changeEngine(sqlite, "mongo");

    expect(sqlite.tlsMode).toBe("disable");
    expect(back.tlsMode).toBe("prefer");
    expect(back.port).toBe("27017");
  });

  test("defaults the redis database to 0", () => {
    expect(changeEngine(EMPTY_FORM, "redis").database).toBe("0");
    expect(changeEngine(form({ database: "5" }), "redis").database).toBe("5");
  });

  test("drops the redis default 0 when leaving redis, keeps a typed number", () => {
    const redis = changeEngine(EMPTY_FORM, "redis");
    expect(changeEngine(redis, "mongo").database).toBe("");
    expect(changeEngine({ ...redis, database: "3" }, "postgres").database).toBe("3");
  });
});

describe("mongo connection string", () => {
  const uriForm = form({ name: "atlas", engine: "mongo", mongoMode: "uri", database: " shop " });

  test("builds a uri target and stores the string as the secret", () => {
    const result = parseForm(
      { ...uriForm, uri: " mongodb+srv://me:pw@cluster0.example.net/ " },
      "1"
    );

    expect(result.success && result.config.target).toEqual({ kind: "uri", database: "shop" });
    expect(result.success && result.secret).toEqual({
      action: "set",
      value: "mongodb+srv://me:pw@cluster0.example.net/"
    });
  });

  test("requires the string for new connections, keeps it when editing", () => {
    expect(parseForm(uriForm, "1")).toEqual({
      success: false,
      errors: { uri: "Informe a URI de conexão" }
    });
    const editing = parseForm(uriForm, "1", true);
    expect(editing.success && editing.secret).toEqual({ action: "keep" });
    expect(parseForm({ ...uriForm, uri: "http://nope" }, "1")).toEqual({
      success: false,
      errors: { uri: "Use mongodb:// ou mongodb+srv://" }
    });
  });

  test("round-trips through fromConfig and leaves the mode when the engine changes", () => {
    const values = fromConfig({
      ...postgresConfig,
      engine: "mongo",
      target: { kind: "uri", database: "shop" }
    });

    expect(values).toMatchObject({ mongoMode: "uri", database: "shop" });
    expect(changeEngine(values, "postgres").mongoMode).toBe("network");
    expect(changeEngine(values, "mongo").mongoMode).toBe("uri");
  });
});

test("a pasted connection URL fills the fields it states", () => {
  expect(
    parseConnectionUrl("postgresql://ana:p%40ss@db.example.com:6543/app?sslmode=require")
  ).toEqual({
    engine: "postgres",
    patch: {
      host: "db.example.com",
      port: "6543",
      database: "app",
      username: "ana",
      password: "p@ss",
      tlsMode: "require"
    }
  });
  // no port: the engine's default stays
  expect(parseConnectionUrl(" mysql://root@localhost/shop ")?.patch).toEqual({
    host: "localhost",
    database: "shop",
    username: "root",
    password: ""
  });
  expect(parseConnectionUrl("rediss://:secret@[::1]:6380/2")).toEqual({
    engine: "redis",
    patch: {
      host: "::1",
      port: "6380",
      database: "2",
      username: "",
      password: "secret",
      tlsMode: "require"
    }
  });
  expect(parseConnectionUrl("mongodb://x")).toBeNull();
  expect(parseConnectionUrl("not a url")).toBeNull();
});

describe("redis cluster", () => {
  test("parses seed nodes, IPv6 in brackets and the default port", () => {
    expect(parseNodes(" a:7000,b  [::1]:7001 ", 6379)).toEqual([
      { host: "a", port: 7000 },
      { host: "b", port: 6379 },
      { host: "::1", port: 7001 }
    ]);
    expect(parseNodes("a:0", 6379)).toBeNull();
    expect(parseNodes("::1", 6379)).toBeNull();
  });

  test("builds a cluster target without database or tunnel", () => {
    const result = parseForm(
      form({
        name: "r",
        engine: "redis",
        redisMode: "cluster",
        redisNodes: "a:7000, b:7001",
        username: " app ",
        database: "16",
        sshEnabled: true,
        sshHost: "bastion"
      }),
      "1"
    );

    expect(result.success && result.config).toMatchObject({
      target: {
        kind: "redisCluster",
        nodes: [
          { host: "a", port: 7000 },
          { host: "b", port: 7001 }
        ],
        username: "app"
      },
      ssh: null
    });
  });

  test("requires a node that parses", () => {
    const errors = (redisNodes: string) => {
      const result = parseForm(
        form({ name: "r", engine: "redis", redisMode: "cluster", redisNodes }),
        "1"
      );
      return result.success === false && result.errors;
    };

    expect(errors(" ")).toEqual({ redisNodes: "Informe ao menos um nó" });
    expect(errors("a:x")).toEqual({ redisNodes: "Use host:porta, separados por vírgula" });
  });

  test("round-trips through fromConfig", () => {
    const config: ConnectionConfig = {
      ...postgresConfig,
      engine: "redis",
      target: {
        kind: "redisCluster",
        nodes: [
          { host: "a", port: 7000 },
          { host: "::1", port: 7001 }
        ],
        username: "me"
      },
      tls: { mode: "require", caCertPath: null },
      keySeparator: ":"
    };

    expect(fromConfig(config).redisNodes).toBe("a:7000, [::1]:7001");
    expect(parseForm(fromConfig(config), "1")).toMatchObject({ success: true, config });
  });
});
