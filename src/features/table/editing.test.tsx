import { act, screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
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

/** The CodeMirror view of the JSON editor inside `panel`. */
function jsonView(panel: HTMLElement): EditorView {
  return EditorView.findFromDOM(panel.querySelector<HTMLElement>(".cm-content")!)!;
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
    "Salve ou descarte as alterações para paginar, filtrar ou ordenar."
  );
  const sortId = screen.getByRole("button", { name: /^id/ });
  expect(sortId).toHaveAttribute("aria-disabled", "true");
  expect(sortId).toHaveAccessibleDescription(
    "Salve ou descarte as alterações para paginar, filtrar ou ordenar."
  );

  await user.click(screen.getByRole("button", { name: "Salvar (1 alteração pendente)" }));

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

test("an edited cell keeps the stored value in sight and Ctrl+Z puts it back", async () => {
  fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);

  await editCell(user, "2", "20");
  expect(cell("20")).toHaveAttribute("title", "Antes: 2");
  expect(cell("20")).toHaveTextContent("(alteração pendente, era 2)");

  await user.click(cell("20"));
  await user.keyboard("{Control>}z{/Control}");
  expect(cell("2")).not.toHaveAttribute("data-edited");
  expect(screen.queryByText(/alteração pendente/)).not.toBeInTheDocument();
});

test("the value panel edits JSON as stored, formats only on request and blocks invalid JSON", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);

  // a JSON cell opens the panel by itself, even NULL
  await user.click(cell("NULL"));
  const panel = screen.getByRole("complementary", { name: "Valor da célula" });
  expect(within(panel).getByText(/^Gravado como/)).toHaveTextContent("Gravado como NULL");
  const apply = within(panel).getByRole("button", { name: "Aplicar" });
  expect(apply).toBeDisabled();

  const view = jsonView(panel);
  act(() => view.dispatch({ changes: { from: 0, insert: '{"a": }' } }));
  expect(within(panel).getByText(/JSON inválido/)).toHaveTextContent(
    "JSON inválido na linha 1, coluna 7: valor inesperado: }"
  );
  expect(apply).toBeDisabled();

  const typed = '{"n": 9007199254740993, "d": 1.0}';
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: typed } }));
  expect(within(panel).queryByText(/JSON inválido/)).not.toBeInTheDocument();
  await user.click(apply);
  // staged exactly as typed: no reformat, no number rounding
  expect(cell(typed)).toHaveAttribute("data-edited", "true");

  // "Formatar" re-indents only on request, digits intact
  await user.click(within(panel).getByRole("button", { name: "Formatar" }));
  expect(jsonView(panel).state.doc.toString()).toBe('{\n  "n": 9007199254740993,\n  "d": 1.0\n}');
  await user.click(within(panel).getByRole("button", { name: "Aplicar" }));
  await user.click(screen.getByRole("button", { name: /^Salvar \(/ }));

  await waitFor(() => expect(applied(calls)).toHaveLength(1));
  expect(applied(calls)[0].changes.changes).toEqual([
    {
      kind: "update",
      key: [{ column: "id", value: { t: "int", v: "2" } }],
      values: [{ column: "profile", value: '{\n  "n": 9007199254740993,\n  "d": 1.0\n}' }]
    }
  ]);
});

test("typing invalid JSON in a json cell stages nothing and says where it breaks", async () => {
  fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);

  await user.dblClick(cell("NULL"));
  const input = screen.getByRole("textbox", { name: /^Editar / });
  await user.type(input, '{{"a": }{Enter}');

  // the text stays in the cell, nothing hatches, Salvar has no Δ
  expect(input).toBeInTheDocument();
  expect(screen.getByText(/^JSON inválido na linha 1, coluna 7/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Salvar \(/ })).not.toBeInTheDocument();

  await user.clear(input);
  await user.type(input, '{{"a": 1}{Enter}');
  expect(cell('{"a": 1}')).toHaveAttribute("data-edited", "true");
});

test("undoing an edit of a NULL JSON cell puts the panel back on NULL, not on invalid JSON", async () => {
  fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);

  await user.click(cell("NULL"));
  const panel = screen.getByRole("complementary", { name: "Valor da célula" });
  const view = jsonView(panel);
  act(() => view.dispatch({ changes: { from: 0, insert: '{"a": 1}' } }));
  await user.click(within(panel).getByRole("button", { name: "Aplicar" }));
  await user.click(within(panel).getByRole("button", { name: "Desfazer alteração" }));

  expect(within(panel).getByText(/^Gravado como/)).toHaveTextContent("Gravado como NULL");
  expect(within(panel).queryByText(/JSON inválido/)).not.toBeInTheDocument();
});

test("rows can be added, deleted, restored and set to NULL", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);

  // NULL through the detail panel, opened from the results bar
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
  await user.click(screen.getByRole("button", { name: /^Salvar \(/ }));

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

test("opening a NULL cell and leaving it untouched stages nothing; Ctrl+Shift+N sets NULL", async () => {
  fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);

  await user.dblClick(cell("NULL"));
  const input = screen.getByRole("textbox", { name: /^Editar / });
  expect(input).toHaveValue("");
  expect(input).toHaveAttribute("placeholder", "NULL");
  await user.keyboard("{Enter}");
  expect(screen.queryByText(/alteração pendente/)).not.toBeInTheDocument();

  // from the selected cell, without opening the editor
  await user.click(cell("1"));
  await user.keyboard("{ArrowRight}{Control>}{Shift>}N{/Shift}{/Control}");
  expect(screen.getByText("1 alteração pendente")).toBeInTheDocument();
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
              destructive: false,
              reason: "Conexão de produção: confira as alterações antes de salvar",
              statements: [`UPDATE "public"."users" SET "id" = '20' WHERE "id" = '2'`]
            }
          }
  });
  const user = await openUsers(prodWritable);

  await editCell(user, "2", "20");
  await user.click(screen.getByRole("button", { name: /^Salvar \(/ }));

  const dialog = await screen.findByRole("alertdialog");
  expect(dialog).toHaveTextContent(`UPDATE "public"."users" SET "id" = '20' WHERE "id" = '2';`);
  // the change is signed with what it replaces, not only as SQL
  expect(within(dialog).getByRole("table", { name: "Valores alterados" })).toHaveTextContent(
    "id = 2id'2' → '20'"
  );
  // app shortcuts stay quiet while the confirmation owns the keyboard
  await user.keyboard("{Control>}w{/Control}");
  expect(screen.queryByRole("dialog", { name: "Descartar alterações?" })).not.toBeInTheDocument();
  // cancelling says nothing ran and keeps the edits
  await user.click(within(dialog).getByRole("button", { name: "Cancelar" }));
  expect(await screen.findByText(/nada rodou no banco/)).toBeInTheDocument();
  expect(cell("20")).toHaveAttribute("data-edited", "true");

  await user.click(screen.getByRole("button", { name: /^Salvar \(/ }));
  await user.click(await screen.findByRole("button", { name: "Executar em produção" }));

  // the confirmed save ends in the same receipt as the editor: where it ran, then the count
  await waitFor(() =>
    expect(
      screen.getAllByRole("status").find(element => /Confirmado/.test(element.textContent ?? ""))
    ).toHaveTextContent(
      /^Confirmado e salvo em Postgres prod.* · 1 alteração salva · Ver no histórico$/
    )
  );
  expect(applied(calls).map(call => call.confirmed)).toEqual([false, false, true]);
});

test("a failed save keeps the staged edits and shows why", async () => {
  const conflict: AppError = {
    kind: "conflict",
    message: "uma das linhas foi alterada ou removida por outra sessão; nada foi salvo"
  };
  fakeBackend([devPostgres], { apply_changes: () => Promise.reject(conflict) });
  const user = await openUsers(devPostgres);

  await editCell(user, "2", "20");
  await user.click(screen.getByRole("button", { name: /^Salvar \(/ }));

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

test("a column with a fixed set of values is edited by picking one", async () => {
  const withOptions: TableStructure = {
    ...usersStructure,
    columns: usersStructure.columns.map(column =>
      column.name === "profile" ? { ...column, options: ["true", "false"] } : column
    )
  };
  const calls = fakeBackend([devPostgres], { table_structure: () => withOptions });
  const user = await openUsers(devPostgres);

  await user.dblClick(cell("NULL"));
  const select = screen.getByRole("combobox", { name: "Editar profile" });
  expect(
    within(select)
      .getAllByRole("option")
      .map(option => option.textContent)
  ).toEqual(["NULL", "true", "false"]);
  await user.selectOptions(select, "false");
  await user.keyboard("{Enter}");
  await user.click(screen.getByRole("button", { name: "Salvar (1 alteração pendente)" }));

  await waitFor(() => expect(applied(calls)).toHaveLength(1));
  expect(applied(calls)[0].changes.changes).toEqual([
    {
      kind: "update",
      key: [{ column: "id", value: { t: "int", v: "2" } }],
      values: [{ column: "profile", value: "false" }]
    }
  ]);
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
  const grid = screen.getByRole("grid", { name: "Linhas de users" });

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

  await user.click(screen.getByLabelText("Fechar aba Postgres dev · users"));
  await user.click(
    within(await screen.findByRole("dialog")).getByRole("button", { name: "Descartar e fechar" })
  );
  await waitFor(() =>
    expect(screen.queryByRole("tab", { name: /· users/ })).not.toBeInTheDocument()
  );
  // discarding never touches the database
  expect(applied(calls)).toHaveLength(0);
});

test("Escape in the grid closes the cell detail first, then clears the selection", async () => {
  fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);

  await user.click(cell("2"));
  await user.keyboard(" ");
  expect(screen.getByRole("complementary", { name: "Valor da célula" })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("complementary", { name: "Valor da célula" })).not.toBeInTheDocument();
  expect(cell("2")).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Escape}");
  expect(cell("2")).toHaveAttribute("aria-selected", "false");
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

test("Alt+O sorts by the selected cell's column; the headers are not Tab stops", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openUsers(devPostgres);

  expect(screen.getByRole("button", { name: /^id/ })).toHaveAttribute("tabindex", "-1");
  await user.click(cell("2"));
  await user.keyboard("{Alt>}o{/Alt}");
  expect(screen.getByText("Ordenado")).toBeInTheDocument();
  const browses = callsTo(calls, "browse_table") as { request: { sort: unknown } }[];
  expect(browses.at(-1)?.request.sort).toMatchObject({ column: "id" });
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

test("installing an update with staged edits asks first, like Ctrl+Q", async () => {
  // nothing new at launch; the tray check finds 0.4.0
  let available: string | null = null;
  const calls = fakeBackend([devPostgres], {
    check_update: () => ({ current: "0.3.0", available, installable: true }),
    install_update: () => null
  });
  const user = await openUsers(devPostgres);
  await editCell(user, "2", "20");
  available = "0.4.0";

  await emit("check-updates");
  await user.click(await screen.findByRole("button", { name: "Instalar e reiniciar" }));
  const dialog = await screen.findByRole("dialog", { name: "Descartar alterações?" });
  expect(dialog).toHaveTextContent(
    "Postgres dev · users tem 1 alteração pendente. Reiniciar para atualizar descarta todas"
  );
  await user.click(within(dialog).getByRole("button", { name: "Voltar" }));
  // back to the offer, nothing installed
  await screen.findByRole("dialog", { name: "Ordo 0.4.0 disponível" });
  expect(callsTo(calls, "install_update")).toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "Instalar e reiniciar" }));
  await user.click(await screen.findByRole("button", { name: "Descartar e atualizar" }));
  await waitFor(() => expect(callsTo(calls, "install_update")).toHaveLength(1));
});
