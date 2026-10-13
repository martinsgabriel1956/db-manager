import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { ConnectionConfig, SchemaInfo } from "@/bindings";
import { defaultSchemaFor, isSqlEngine } from "@/features/connections/options";
import { useTabs } from "@/features/tabs/store";
import { fakeBackend, prodPostgres } from "@/test/fakeBackend";
import { renderWithClient, rowAction } from "@/test/render";

const shopMysql: ConnectionConfig = {
  ...prodPostgres,
  id: "my-1",
  name: "Loja MySQL",
  engine: "mysql",
  environment: "dev",
  readOnly: false,
  target: { kind: "network", host: "localhost", port: 3306, database: "shop", username: "root" }
};

const localSqlite: ConnectionConfig = {
  ...prodPostgres,
  id: "lite-1",
  name: "Arquivo",
  engine: "sqlite",
  environment: "local",
  readOnly: false,
  target: { kind: "file", path: "/tmp/app.db" },
  tls: { mode: "disable", caCertPath: null }
};

const mysqlSchemas: SchemaInfo[] = [
  { name: "analytics", relations: [{ name: "events", kind: "table" }] },
  { name: "shop", relations: [{ name: "orders", kind: "table" }] }
];

test("SQL engines are recognised and get their default schema", () => {
  expect(
    ["postgres", "mysql", "sqlite"].every(e => isSqlEngine(e as ConnectionConfig["engine"]))
  ).toBe(true);
  expect(isSqlEngine("mongo")).toBe(false);
  expect(isSqlEngine("redis")).toBe(false);
  expect(defaultSchemaFor(prodPostgres)).toBe("public");
  expect(defaultSchemaFor(shopMysql)).toBe("shop");
  expect(defaultSchemaFor(localSqlite)).toBe("main");
});

test("MySQL opens the configured database in the tree and has a SQL editor", async () => {
  fakeBackend([shopMysql], { list_schemas: () => mysqlSchemas });
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("treeitem", { name: /^Loja MySQL/ }));

  expect(await screen.findByRole("treeitem", { name: "orders" })).toBeInTheDocument();
  expect(screen.queryByRole("treeitem", { name: "events" })).not.toBeInTheDocument();

  await rowAction(user, "Loja MySQL", "Nova query SQL");
  expect(useTabs.getState().tabs).toMatchObject([{ kind: "editor", connectionId: "my-1" }]);
});

test("SQLite opens main", async () => {
  fakeBackend([localSqlite], {
    list_schemas: () => [{ name: "main", relations: [{ name: "notes", kind: "table" }] }]
  });
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("treeitem", { name: /^Arquivo/ }));

  expect(await screen.findByRole("treeitem", { name: "notes" })).toBeInTheDocument();
});
