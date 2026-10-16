import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { ConnectionConfig, SchemaChange } from "@/bindings";
import { useTabs } from "@/features/tabs/store";
import { callsTo, devPostgres, fakeBackend, prodPostgres } from "@/test/fakeBackend";
import { renderWithClient, rowAction } from "@/test/render";

type AlterArgs = { table: string; change: SchemaChange; confirmed: boolean };

const shopMysql: ConnectionConfig = {
  ...devPostgres,
  id: "my-1",
  name: "Loja MySQL",
  engine: "mysql",
  target: { kind: "network", host: "localhost", port: 3306, database: "public", username: "root" }
};

const localSqlite: ConnectionConfig = {
  ...devPostgres,
  id: "lite-1",
  name: "Arquivo",
  engine: "sqlite",
  target: { kind: "file", path: "/tmp/app.db" }
};

async function openStructure(connection: ConnectionConfig) {
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(
    await screen.findByRole("treeitem", { name: new RegExp(`^${connection.name}`) })
  );
  await user.click(await screen.findByRole("treeitem", { name: "users" }));
  await user.click(await screen.findByRole("tab", { name: "Estrutura" }));
  await screen.findByRole("heading", { name: "Colunas" });
  return user;
}

function altered(calls: ReturnType<typeof fakeBackend>) {
  return callsTo(calls, "alter_schema") as AlterArgs[];
}

test("adding a column shows the exact DDL first and runs it only once confirmed", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openStructure(devPostgres);

  await user.click(screen.getByRole("button", { name: "Adicionar coluna" }));
  const form = await screen.findByRole("dialog", { name: "Adicionar coluna" });
  const review = within(form).getByRole("button", { name: "Revisar comando" });
  expect(review).toBeDisabled();
  await user.type(within(form).getByLabelText("Nome"), "email");
  await user.type(within(form).getByLabelText("Tipo"), "text");
  await user.type(within(form).getByLabelText("Default (opcional)"), "'x'");
  await user.click(within(form).getByLabelText("NOT NULL"));
  await user.click(review);

  // the command, before anything runs
  const confirm = await screen.findByRole("alertdialog");
  expect(within(confirm).getByText("-- addColumn;")).toBeInTheDocument();
  expect(altered(calls)).toEqual([
    {
      connectionId: "pg-dev",
      schema: "public",
      table: "users",
      change: {
        kind: "addColumn",
        column: { name: "email", dataType: "text", nullable: false, default: "'x'" }
      },
      confirmed: false
    }
  ]);
  const structureReads = callsTo(calls, "table_structure").length;

  await user.click(within(confirm).getByRole("button", { name: "Executar" }));

  expect(await screen.findByRole("status")).toHaveTextContent("Executado: -- addColumn");
  expect(altered(calls)[1].confirmed).toBe(true);
  // the structure is read again
  await waitFor(() =>
    expect(callsTo(calls, "table_structure").length).toBeGreaterThan(structureReads)
  );
  expect(screen.queryByRole("dialog", { name: "Adicionar coluna" })).not.toBeInTheDocument();
});

test("cancelling the confirmation goes back to the filled form; nothing runs", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openStructure(devPostgres);

  await user.click(screen.getByRole("button", { name: "Ações da coluna profile" }));
  await user.click(await screen.findByRole("menuitem", { name: "Renomear…" }));
  const name = await screen.findByLabelText("Novo nome");
  // the form takes the focus from the menu
  await waitFor(() => expect(name).toHaveFocus());
  await user.clear(name);
  await user.type(name, "perfil{Enter}");
  const confirm = await screen.findByRole("alertdialog");
  await user.click(within(confirm).getByRole("button", { name: "Cancelar" }));

  expect(await screen.findByLabelText("Novo nome")).toHaveValue("perfil");
  expect(altered(calls).every(call => !call.confirmed)).toBe(true);
});

test("removing a column or an index is confirmed as destructive", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openStructure(devPostgres);

  await user.click(screen.getByRole("button", { name: "Ações da coluna profile" }));
  await user.click(await screen.findByRole("menuitem", { name: "Remover coluna" }));
  let confirm = await screen.findByRole("alertdialog");
  expect(within(confirm).getByText("Comando destrutivo: ALTER TABLE … DROP")).toBeInTheDocument();
  await user.click(within(confirm).getByRole("button", { name: "Cancelar" }));

  await user.click(screen.getByRole("button", { name: "Remover índice users_pkey" }));
  confirm = await screen.findByRole("alertdialog");
  expect(within(confirm).getByText("-- dropIndex;")).toBeInTheDocument();
  expect(altered(calls).map(call => call.change)).toEqual([
    { kind: "dropColumn", column: "profile" },
    { kind: "dropIndex", name: "users_pkey" }
  ]);
});

test("Postgres toggles NULL and changes type with USING", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openStructure(devPostgres);

  await user.click(screen.getByRole("button", { name: "Ações da coluna profile" }));
  await user.click(await screen.findByRole("menuitem", { name: "Exigir NOT NULL" }));
  await screen.findByRole("alertdialog");
  await user.click(screen.getByRole("button", { name: "Cancelar" }));

  await user.click(screen.getByRole("button", { name: "Ações da coluna profile" }));
  await user.click(await screen.findByRole("menuitem", { name: "Mudar tipo…" }));
  const type = await screen.findByLabelText("Novo tipo");
  expect(type).toHaveValue("jsonb");
  await user.clear(type);
  await user.type(type, "text");
  await user.type(screen.getByLabelText("USING (opcional)"), "profile::text{Enter}");
  await screen.findByRole("alertdialog");

  expect(altered(calls).map(call => call.change)).toEqual([
    { kind: "setNullable", column: "profile", nullable: false },
    { kind: "setType", column: "profile", dataType: "text", using: "profile::text" }
  ]);
});

test("MySQL redefines the column from its whole current definition", async () => {
  const calls = fakeBackend([shopMysql]);
  const user = await openStructure(shopMysql);

  await user.click(screen.getByRole("button", { name: "Ações da coluna profile" }));
  expect(screen.queryByRole("menuitem", { name: "Mudar tipo…" })).not.toBeInTheDocument();
  await user.click(await screen.findByRole("menuitem", { name: "Redefinir (tipo, NULL)…" }));
  const definition = await screen.findByLabelText("Definição de profile");
  expect(definition).toHaveValue("varchar(10) NOT NULL COMMENT 'x'");
  await user.clear(definition);
  await user.type(definition, "varchar(20) NOT NULL COMMENT 'x'");
  await user.click(screen.getByRole("button", { name: "Revisar comando" }));
  await screen.findByRole("alertdialog");

  expect(altered(calls)[0].change).toEqual({
    kind: "redefineColumn",
    column: "profile",
    definition: "varchar(20) NOT NULL COMMENT 'x'"
  });
});

test("SQLite says what it cannot alter instead of offering it", async () => {
  fakeBackend([localSqlite], {
    list_schemas: () => [{ name: "main", relations: [{ name: "users", kind: "table" }] }]
  });
  const user = await openStructure(localSqlite);

  expect(screen.getByText(/O SQLite não muda o tipo, o default nem o NULL/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Ações da coluna profile" }));
  const items = (await screen.findAllByRole("menuitem")).map(item => item.textContent?.trim());
  expect(items).toEqual(["Renomear…", "Remover coluna"]);
});

test("a read-only connection shows the structure without changes", async () => {
  fakeBackend([prodPostgres]);
  await openStructure(prodPostgres);

  expect(
    screen.getByText("Conexão somente leitura: a estrutura não pode ser alterada.")
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Adicionar coluna" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Ações da coluna/ })).not.toBeInTheDocument();
});

test("a new table is created from the schema menu and opens", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(await screen.findByRole("treeitem", { name: /^Postgres dev/ }));
  await screen.findByRole("treeitem", { name: "users" });

  await rowAction(user, "public", "Nova tabela…");
  const form = await screen.findByRole("dialog", { name: "Nova tabela" });
  await user.type(within(form).getByLabelText("Nome da tabela"), "teams");
  const first = within(form).getByRole("group", { name: "Coluna 1" });
  await user.type(within(first).getByLabelText("Tipo"), "serial");
  await user.click(within(form).getByRole("button", { name: "Adicionar coluna" }));
  const second = within(form).getByRole("group", { name: "Coluna 2" });
  await user.type(within(second).getByLabelText("Nome"), "name");
  await user.type(within(second).getByLabelText("Tipo"), "text");
  await user.click(within(form).getByRole("button", { name: "Revisar comando" }));
  const confirm = await screen.findByRole("alertdialog");
  await user.click(within(confirm).getByRole("button", { name: "Criar tabela" }));

  await waitFor(() =>
    expect(useTabs.getState().tabs).toContainEqual(
      expect.objectContaining({ kind: "table", schema: "public", table: "teams" })
    )
  );
  expect(altered(calls)[0]).toEqual({
    connectionId: "pg-dev",
    schema: "public",
    table: "teams",
    change: {
      kind: "createTable",
      columns: [
        { name: "id", dataType: "serial", nullable: false, default: null },
        { name: "name", dataType: "text", nullable: true, default: null }
      ],
      primaryKey: ["id"]
    },
    confirmed: false
  });
});

test("a command the database refuses brings the form back with the error", async () => {
  fakeBackend([devPostgres], {
    alter_schema: args =>
      (args as { confirmed: boolean }).confirmed
        ? Promise.reject({ kind: "database", message: 'column "x" already exists [42701]' })
        : {
            status: "needsConfirmation",
            confirmation: { reason: "confira", statements: ["ALTER …"], destructive: false }
          }
  });
  const user = await openStructure(devPostgres);

  await user.click(screen.getByRole("button", { name: "Adicionar coluna" }));
  await user.type(await screen.findByLabelText("Nome"), "x");
  await user.type(screen.getByLabelText("Tipo"), "int{Enter}");
  await user.click(await screen.findByRole("button", { name: "Executar" }));

  const form = await screen.findByRole("dialog", { name: "Adicionar coluna" });
  expect(within(form).getByRole("alert")).toHaveTextContent('column "x" already exists');
  expect(within(form).getByLabelText("Nome")).toHaveValue("x");
});
