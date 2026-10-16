import { useState } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { BrowseRequest, ExportOutcome, FindRequest } from "@/bindings";
import { SqlWorkspace } from "@/features/editor/SqlWorkspace";
import { callsTo, devMongo, devPostgres, fakeBackend, localRedis } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

type SaveArgs = { options: { defaultPath: string; filters: { extensions: string[] }[] } };
type TableExportArgs = {
  connectionId: string;
  runId: string;
  request: BrowseRequest;
  path: string;
};

async function openUsers() {
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(await screen.findByRole("treeitem", { name: /^Postgres dev/ }));
  await user.click(await screen.findByRole("treeitem", { name: "users" }));
  await screen.findByRole("button", { name: /Exportar CSV/ });
  return user;
}

test("a table exports with the grid's filter and sort to the chosen file", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openUsers();

  await user.click(await screen.findByRole("button", { name: /^id/ }));
  await user.selectOptions(screen.getByLabelText("Operador do filtro"), "isNotNull");
  await user.click(screen.getByRole("button", { name: "Aplicar" }));
  await user.click(screen.getByRole("button", { name: /Exportar CSV/ }));

  expect(await screen.findByText("1.234 itens → export.csv")).toBeInTheDocument();
  const save = callsTo(calls, "plugin:dialog|save")[0] as SaveArgs;
  expect(save.options.defaultPath).toBe("users.csv");
  expect(save.options.filters[0].extensions).toEqual(["csv"]);
  const [exported] = callsTo(calls, "export_table") as TableExportArgs[];
  expect(exported.path).toBe("/tmp/export.csv");
  expect(exported.request).toMatchObject({
    schema: "public",
    table: "users",
    filters: [{ column: "id", op: "isNotNull" }],
    sort: { column: "id", direction: "asc" }
  });
});

test("closing the save dialog exports nothing", async () => {
  const calls = fakeBackend([devPostgres], { "plugin:dialog|save": () => null });
  const user = await openUsers();

  await user.click(screen.getByRole("button", { name: /Exportar CSV/ }));

  await waitFor(() => expect(callsTo(calls, "plugin:dialog|save")).toHaveLength(1));
  expect(callsTo(calls, "export_table")).toHaveLength(0);
});

test("a running export can be cancelled; the error is shown", async () => {
  let fail: (reason: unknown) => void = () => undefined;
  const calls = fakeBackend([devPostgres], {
    export_table: () =>
      new Promise<ExportOutcome>((_, reject) => {
        fail = reject;
      }),
    cancel_run: () => {
      fail({ kind: "cancelled", message: "query cancelada" });
      return null;
    }
  });
  const user = await openUsers();

  await user.click(screen.getByRole("button", { name: /Exportar CSV/ }));
  await user.click(await screen.findByRole("button", { name: "Cancelar export" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("query cancelada");
  const [exported] = callsTo(calls, "export_table") as TableExportArgs[];
  expect(callsTo(calls, "cancel_run")).toEqual([{ runId: exported.runId }]);
  expect(screen.getByRole("button", { name: /Exportar CSV/ })).toBeInTheDocument();
});

function Workspace() {
  const [sql, setSql] = useState("SELECT * FROM users");
  return (
    <SqlWorkspace
      connectionId="pg-dev"
      engine="postgres"
      defaultSchema="public"
      sql={sql}
      onSqlChange={setSql}
    />
  );
}

test("the editor exports the query behind the result", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = userEvent.setup();
  renderWithClient(<Workspace />);

  await user.click(screen.getByRole("button", { name: "Executar" }));
  await user.click(await screen.findByRole("button", { name: /Exportar CSV/ }));

  await waitFor(() =>
    expect(callsTo(calls, "export_query")).toEqual([
      expect.objectContaining({
        connectionId: "pg-dev",
        sql: "SELECT * FROM users",
        path: "/tmp/export.csv"
      })
    ])
  );
  expect(await screen.findByText(/1 item → export.csv/)).toBeInTheDocument();
});

test("a collection exports the applied filter as NDJSON or a JSON array", async () => {
  const calls = fakeBackend([devMongo], {
    list_schemas: () => [{ name: "shop", relations: [{ name: "customers", kind: "table" }] }],
    "plugin:dialog|save": () => "/tmp/customers.json"
  });
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(await screen.findByRole("treeitem", { name: /^Mongo dev/ }));
  await user.click(await screen.findByRole("treeitem", { name: "customers" }));

  await user.type(screen.getByLabelText("Filtro"), '{{"name": "Ana"}');
  await user.click(screen.getByRole("button", { name: "Aplicar" }));
  await user.selectOptions(screen.getByLabelText("Formato do export"), "jsonArray");
  await user.click(screen.getByRole("button", { name: /Exportar/ }));

  await waitFor(() => expect(callsTo(calls, "export_collection")).toHaveLength(1));
  const [exported] = callsTo(calls, "export_collection") as {
    request: FindRequest;
    format: string;
  }[];
  expect(exported.format).toBe("jsonArray");
  expect(exported.request).toMatchObject({
    database: "shop",
    collection: "customers",
    filter: '{"name": "Ana"}'
  });
  const save = callsTo(calls, "plugin:dialog|save")[0] as SaveArgs;
  expect(save.options.defaultPath).toBe("customers.json");
  expect(await screen.findByText(/2 itens → customers.json/)).toBeInTheDocument();
});

test("Redis keys export as NDJSON with the searched pattern", async () => {
  const calls = fakeBackend([localRedis], { "plugin:dialog|save": () => "/tmp/db0.ndjson" });
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(await screen.findByRole("treeitem", { name: /^Cache/ }));
  await user.click(await screen.findByRole("treeitem", { name: /^db0/ }));
  await user.type(await screen.findByLabelText("Padrão de chaves"), "user:*");
  await user.click(screen.getByRole("button", { name: "Buscar" }));
  await user.click(screen.getByRole("button", { name: /Exportar NDJSON/ }));

  expect(await screen.findByText("4 itens → db0.ndjson")).toBeInTheDocument();
  const save = callsTo(calls, "plugin:dialog|save")[0] as SaveArgs;
  expect(save.options.defaultPath).toBe("db0.ndjson");
  expect(callsTo(calls, "export_keys")).toEqual([
    {
      connectionId: "redis-1",
      runId: expect.any(String),
      db: 0,
      pattern: "user:*",
      path: "/tmp/db0.ndjson"
    }
  ]);
});
