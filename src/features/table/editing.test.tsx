import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import { useTabs } from "@/features/tabs/store";
import type { AppError, ConnectionConfig, TableChanges, TableStructure } from "@/bindings";
import {
  callsTo,
  devPostgres,
  fakeBackend,
  prodPostgres,
  usersStructure
} from "@/test/fakeBackend";
import { renderWithClient, rowAction } from "@/test/render";

type ApplyArgs = { connectionId: string; changes: TableChanges; confirmed: boolean };

async function openUsers(connection: ConnectionConfig) {
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(
    await screen.findByRole("treeitem", { name: new RegExp(`^${connection.name}`) })
  );
  await user.click(await screen.findByRole("treeitem", { name: "users" }));
  await screen.findAllByRole("gridcell");
  return user;
}

/** Matches the value shown in the cell, ignoring the screen-reader-only state text. */
function cell(text: string) {
  return screen
    .getAllByRole("gridcell")
    .find(
      element =>
        element.firstChild?.nodeType === Node.TEXT_NODE && element.firstChild.textContent === text
    )!;
}

async function editCell(user: ReturnType<typeof userEvent.setup>, from: string, to: string) {
  await user.dblClick(cell(from));
  const input = screen.getByRole("textbox", { name: /^Editar / });
  await user.clear(input);
  await user.type(input, `${to}{Enter}`);
}

function applied(calls: ReturnType<typeof fakeBackend>) {
  return callsTo(calls, "apply_changes") as ApplyArgs[];
}

test("editing a cell stages it and save sends an update keyed by the primary key", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);

  await editCell(user, "2", "20");

  expect(cell("20")).toHaveAttribute("data-edited", "true");
  expect(screen.getByText("1 alteração pendente")).toBeInTheDocument();
  // navigation is locked while edits are pending
  expect(screen.getByRole("button", { name: "Próxima página" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();
  // and they say why
  expect(screen.getByRole("button", { name: "Aplicar" })).toHaveAccessibleDescription(
    "Salve ou descarte as alterações para paginar, filtrar ou ordenar"
  );

  await user.click(screen.getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(applied(calls)).toHaveLength(1));
  expect(applied(calls)[0]).toEqual({
    connectionId: "pg-dev",
    confirmed: false,
    changes: {
      schema: "public",
      table: "users",
      changes: [
        {
          kind: "update",
          key: [{ column: "id", value: { t: "int", v: "2" } }],
          values: [{ column: "id", value: "20" }]
        }
      ]
    }
  });
  expect(await screen.findByText("1 alteração salva")).toBeInTheDocument();
  // Salvar is gone with the staged edits: focus is back on the grid, not on <body>
  expect(screen.getByRole("grid")).toHaveFocus();
  await waitFor(() => expect(callsTo(calls, "browse_table").length).toBeGreaterThan(1));
});

test("escape cancels an edit, typing the original value back unstages it", async () => {
  fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);

  await user.dblClick(cell("1"));
  await user.type(screen.getByRole("textbox", { name: "Editar id" }), "99{Escape}");
  expect(screen.queryByText(/alteração pendente/)).not.toBeInTheDocument();

  await editCell(user, "1", "5");
  expect(screen.getByText("1 alteração pendente")).toBeInTheDocument();
  await editCell(user, "5", "1");
  expect(screen.queryByText(/alteração pendente/)).not.toBeInTheDocument();
});

test("rows can be added, deleted, restored and set to NULL", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);

  // NULL through the detail panel
  await user.click(cell('{"id": 9007199254740993}'));
  await user.click(screen.getByRole("button", { name: "Definir como NULL" }));

  // delete the second row, restore it, delete it again
  await user.click(cell("2"));
  await user.click(screen.getByRole("button", { name: "Excluir linha" }));
  expect(
    screen.getAllByRole("row").find(row => row.getAttribute("data-status") === "deleted")
  ).toBeDefined();
  await user.click(screen.getByRole("button", { name: "Restaurar linha" }));
  await user.click(screen.getByRole("button", { name: "Excluir linha" }));

  // a new row: unset columns stay DEFAULT
  await user.click(screen.getByRole("button", { name: "Adicionar linha" }));
  const newRow = screen.getAllByRole("row").find(row => row.getAttribute("data-status") === "new")!;
  await user.dblClick(within(newRow).getAllByRole("gridcell")[0]);
  await user.type(screen.getByRole("textbox", { name: "Editar id" }), "3{Enter}");

  expect(screen.getByText("3 alterações pendentes")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(applied(calls)).toHaveLength(1));
  expect(applied(calls)[0].changes.changes).toEqual([
    { kind: "delete", key: [{ column: "id", value: { t: "int", v: "2" } }] },
    {
      kind: "update",
      key: [{ column: "id", value: { t: "int", v: "1" } }],
      values: [{ column: "profile", value: null }]
    },
    { kind: "insert", values: [{ column: "id", value: "3" }] }
  ]);
});

test("a new row can be dropped and discard clears everything", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);

  await user.click(screen.getByRole("button", { name: "Adicionar linha" }));
  const newRow = screen.getAllByRole("row").find(row => row.getAttribute("data-status") === "new")!;
  await user.click(within(newRow).getAllByRole("gridcell")[1]);
  await user.click(screen.getByRole("button", { name: "Excluir linha" }));
  expect(screen.queryByText(/alteração pendente/)).not.toBeInTheDocument();

  await editCell(user, "1", "7");
  await user.click(screen.getByRole("button", { name: "Descartar" }));
  // dropping staged edits asks first, like closing the tab
  const dialog = await screen.findByRole("dialog", { name: "Descartar alterações?" });
  expect(dialog).toHaveTextContent("users tem 1 alteração pendente");
  await user.click(within(dialog).getByRole("button", { name: "Descartar alterações" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.queryByText(/alteração pendente/)).not.toBeInTheDocument();
  expect(cell("1")).toBeInTheDocument();
  expect(applied(calls)).toHaveLength(0);
});

test("on prod, saving shows the generated SQL and applies only after confirming", async () => {
  const prodWritable = { ...prodPostgres, readOnly: false };
  const calls = fakeBackend([prodWritable], {
    apply_changes: args =>
      (args as ApplyArgs).confirmed
        ? { status: "applied", rowsChanged: 1 }
        : {
            status: "needsConfirmation",
            confirmation: {
              reason: "Conexão de produção: confira as alterações antes de salvar",
              statements: [`UPDATE "public"."users" SET "id" = '20' WHERE "id" = '2'`]
            }
          }
  });
  const user = await openUsers(prodWritable);

  await editCell(user, "2", "20");
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  const dialog = await screen.findByRole("dialog");
  expect(dialog).toHaveTextContent(`UPDATE "public"."users" SET "id" = '20' WHERE "id" = '2';`);
  await user.click(screen.getByRole("button", { name: "Executar em produção" }));

  expect(await screen.findByText("1 alteração salva")).toBeInTheDocument();
  expect(applied(calls).map(call => call.confirmed)).toEqual([false, true]);
});

test("a failed save keeps the staged edits and shows why", async () => {
  const conflict: AppError = {
    kind: "conflict",
    message: "uma das linhas foi alterada ou removida por outra sessão; nada foi salvo"
  };
  fakeBackend([devPostgres], { apply_changes: () => Promise.reject(conflict) });
  const user = await openUsers(devPostgres);

  await editCell(user, "2", "20");
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("nada foi salvo");
  expect(screen.getByText("1 alteração pendente")).toBeInTheDocument();
});

test("read-only connections cannot edit", async () => {
  fakeBackend([prodPostgres]);
  const user = await openUsers(prodPostgres);

  expect(screen.getByText("Somente leitura")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Adicionar linha" })).not.toBeInTheDocument();
  await user.dblClick(cell("2"));
  expect(screen.queryByRole("textbox", { name: /^Editar / })).not.toBeInTheDocument();
  // the refused edit says why, to screen readers too
  expect(
    screen.getByText("Conexão somente leitura: a célula não pode ser editada")
  ).toBeInTheDocument();
});

test("tables without a primary key are read-only", async () => {
  const noKey: TableStructure = {
    ...usersStructure,
    columns: usersStructure.columns.map(column => ({ ...column, isPrimaryKey: false }))
  };
  fakeBackend([devPostgres], { table_structure: () => noKey });
  const user = await openUsers(devPostgres);

  expect(
    await screen.findByText("Sem chave primária editável: tabela somente leitura")
  ).toBeInTheDocument();
  await user.dblClick(cell("2"));
  expect(screen.queryByRole("textbox", { name: /^Editar / })).not.toBeInTheDocument();
});

test("the grid is operable from the keyboard: arrows select, Enter edits and commits", async () => {
  fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);
  const grid = screen.getByRole("grid", { name: "Resultado" });

  await user.click(cell("1"));
  expect(grid).toHaveFocus();
  await user.keyboard("{ArrowDown}");
  expect(cell("2")).toHaveAttribute("aria-selected", "true");
  expect(grid).toHaveAttribute("aria-activedescendant", cell("2").id);

  await user.keyboard("{Enter}");
  const input = screen.getByRole("textbox", { name: "Editar id" });
  await user.clear(input);
  await user.type(input, "20{Enter}");

  expect(cell("20")).toHaveAttribute("data-edited", "true");
  // the pending state is spoken, not only hatched
  expect(cell("20")).toHaveTextContent("alteração pendente");
  expect(grid).toHaveFocus();

  await user.keyboard("{F2}");
  await user.type(screen.getByRole("textbox", { name: "Editar id" }), "9{Escape}");
  expect(cell("20")).toBeInTheDocument();
  expect(screen.getByText("1 alteração pendente")).toBeInTheDocument();
  expect(grid).toHaveFocus();
});

test("closing a tab with staged edits asks first and keeps them on Voltar", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);
  await editCell(user, "2", "20");

  const tab = screen.getByRole("tab", { name: /· users \(1 alteração pendente\)/ });
  await user.click(tab);
  await user.keyboard("{Delete}");

  const dialog = await screen.findByRole("dialog", { name: "Descartar alterações?" });
  expect(dialog).toHaveTextContent("Postgres dev · users tem 1 alteração pendente");
  // the safe choice has focus: Enter on reflex keeps the edits
  expect(within(dialog).getByRole("button", { name: "Voltar" })).toHaveFocus();
  await user.keyboard("{Enter}");

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(cell("20")).toHaveAttribute("data-edited", "true");
  await waitFor(() => expect(screen.getByRole("tab", { name: /· users/ })).toHaveFocus());

  await user.click(screen.getByRole("button", { name: "Fechar aba Postgres dev · users" }));
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", { name: "Descartar e fechar" })
  );
  await waitFor(() =>
    expect(screen.queryByRole("tab", { name: /· users/ })).not.toBeInTheDocument()
  );
  // discarding never touches the database
  expect(applied(calls)).toHaveLength(0);
});

test("Escape in the grid clears the selection and closes the cell detail", async () => {
  fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);

  await user.click(cell("2"));
  expect(screen.getByRole("complementary", { name: "Valor da célula" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("complementary", { name: "Valor da célula" })).not.toBeInTheDocument();
});

test("the sort chip names the sorted column and clears it", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);

  await user.click(screen.getByRole("button", { name: /^id/ }));
  expect(screen.getByText("Ordenado")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Remover ordenação" }));
  expect(screen.queryByText("Ordenado")).not.toBeInTheDocument();
  const browses = callsTo(calls, "browse_table") as { request: { sort: unknown } }[];
  expect(browses.at(-1)?.request.sort).toBeNull();
});

test("opening the connection form keeps staged edits in the hidden tabs", async () => {
  fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);
  await editCell(user, "2", "20");

  await rowAction(user, "Postgres dev", "Editar conexão");
  expect(screen.getByRole("heading", { name: /^Editar conexão/ })).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Cancelar" }));

  expect(cell("20")).toHaveAttribute("data-edited", "true");
  expect(screen.getByText("1 alteração pendente")).toBeInTheDocument();
});

test("closing every tab with staged edits asks once; Voltar keeps all of them open", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);
  await editCell(user, "2", "20");
  await user.click(screen.getByRole("button", { name: "Histórico" }));

  await user.pointer({
    keys: "[MouseRight]",
    target: screen.getByRole("tab", { name: "Histórico" })
  });
  await user.click(await screen.findByRole("menuitem", { name: "Fechar todas as abas (2)" }));

  const dialog = await screen.findByRole("dialog", { name: "Descartar alterações?" });
  expect(dialog).toHaveTextContent(
    "Postgres dev · users tem 1 alteração pendente. Fechar as abas descarta todas"
  );
  await user.click(within(dialog).getByRole("button", { name: "Voltar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("tab", { name: "Histórico" })).toBeInTheDocument();
  expect(screen.getByRole("tab", { name: /· users/ })).toBeInTheDocument();

  await user.pointer({
    keys: "[MouseRight]",
    target: screen.getByRole("tab", { name: "Histórico" })
  });
  await user.click(await screen.findByRole("menuitem", { name: "Fechar todas as abas (2)" }));
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", { name: "Descartar e fechar" })
  );
  await waitFor(() =>
    expect(screen.queryByRole("tab", { name: /· users/ })).not.toBeInTheDocument()
  );
  expect(screen.queryByRole("tab", { name: "Histórico" })).not.toBeInTheDocument();
  expect(applied(calls)).toHaveLength(0);
});

test("Ctrl+Q with staged edits asks first; the tabs stay for the next launch", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);
  await editCell(user, "2", "20");

  await user.keyboard("{Control>}q{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Descartar alterações?" });
  expect(dialog).toHaveTextContent(
    "Postgres dev · users tem 1 alteração pendente. Sair do Ordo descarta todas"
  );
  await user.click(within(dialog).getByRole("button", { name: "Voltar" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(callsTo(calls, "quit_app")).toHaveLength(0);
  expect(cell("20")).toHaveAttribute("data-edited", "true");

  await user.keyboard("{Control>}q{/Control}");
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", { name: "Descartar e sair" })
  );
  await waitFor(() => expect(callsTo(calls, "quit_app")).toHaveLength(1));
  // quitting closes no tab: they are persisted and reopen on the next launch
  expect(useTabs.getState().tabs).toMatchObject([{ kind: "table", table: "users" }]);
  expect(applied(calls)).toHaveLength(0);
});
