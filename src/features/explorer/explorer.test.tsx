import { screen, waitFor, within } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { AppError, BrowseRequest } from "@/bindings";
import {
  callsTo,
  devMongo,
  devPostgres,
  fakeBackend,
  prodPostgres,
  usersDdl
} from "@/test/fakeBackend";
import { useExplorer } from "@/features/explorer/store";
import { filterText } from "@/features/table/BrowseToolbar";
import { pageLabel } from "@/features/table/TableView";
import { renderWithClient, rowAction } from "@/test/render";

type BrowseArgs = { connectionId: string; request: BrowseRequest };

async function openUsers() {
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(await screen.findByRole("treeitem", { name: /^Postgres prod/ }));
  await user.click(await screen.findByRole("treeitem", { name: "users" }));
  await screen.findAllByRole("row");
  return user;
}

function lastBrowse(calls: ReturnType<typeof fakeBackend>) {
  const browses = callsTo(calls, "browse_table") as BrowseArgs[];
  return browses[browses.length - 1].request;
}

test("expanding a connection connects and lists schemas with public open", async () => {
  const calls = fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("treeitem", { name: /^Postgres prod/ }));

  expect(await screen.findByRole("treeitem", { name: "users" })).toBeInTheDocument();
  expect(screen.getByRole("treeitem", { name: "active_users, view" })).toBeInTheDocument();
  expect(screen.getByRole("treeitem", { name: /^audit/ })).toBeInTheDocument();
  expect(callsTo(calls, "connect_database")).toEqual([{ connectionId: "pg-1" }]);

  await user.click(screen.getByRole("treeitem", { name: /^audit/ }));
  expect(screen.getByText("Sem tabelas")).toBeInTheDocument();
});

test("a failed connection shows the error and can retry", async () => {
  const error: AppError = { kind: "database", message: "password authentication failed [28P01]" };
  let attempts = 0;
  fakeBackend([prodPostgres], {
    connect_database: () => (++attempts === 1 ? Promise.reject(error) : null)
  });
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("treeitem", { name: /^Postgres prod/ }));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(/^Não foi possível conectar a db:5432/);
  expect(alert).toHaveTextContent("password authentication failed");
  // a connection that failed offers no editor on it
  expect(screen.queryByRole("treeitem", { name: /^Nova query SQL/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Editar conexão" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Tentar de novo" }));
  expect(await screen.findByRole("treeitem", { name: "users" })).toBeInTheDocument();
});

test("disconnect closes the session and collapses the tree", async () => {
  const calls = fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("treeitem", { name: /^Postgres prod/ }));
  await screen.findByRole("treeitem", { name: "users" });
  await rowAction(user, "Postgres prod", "Desconectar");

  expect(callsTo(calls, "disconnect_database")).toEqual([{ connectionId: "pg-1" }]);
  expect(screen.queryByRole("treeitem", { name: "users" })).not.toBeInTheDocument();
});

test("opening a table browses its first page ordered by the backend default", async () => {
  const calls = fakeBackend([prodPostgres]);
  await openUsers();

  expect(screen.getByRole("heading", { name: "public.users" })).toBeInTheDocument();
  expect(lastBrowse(calls)).toEqual({
    schema: "public",
    table: "users",
    filters: [],
    sort: null,
    page: 0,
    pageSize: 100
  });
  const cells = screen.getAllByRole("gridcell");
  expect(cells.map(cell => cell.textContent)).toEqual([
    "1",
    '{"id": 9007199254740993}',
    "2",
    "NULL"
  ]);
  // prod connection in use: window ring
  expect(document.querySelector("[data-environment='prod']")).not.toBeNull();
});

test("header click cycles sort, pagination moves pages", async () => {
  const calls = fakeBackend([prodPostgres]);
  const user = await openUsers();

  await user.click(screen.getByRole("button", { name: /^id/ }));
  await waitFor(() => expect(lastBrowse(calls).sort).toEqual({ column: "id", direction: "asc" }));
  await user.click(screen.getByRole("button", { name: /^id/ }));
  await waitFor(() => expect(lastBrowse(calls).sort).toEqual({ column: "id", direction: "desc" }));
  expect(screen.getByLabelText("decrescente")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /^id/ }));
  await waitFor(() => expect(lastBrowse(calls).sort).toBeNull());

  await user.click(screen.getByRole("button", { name: "Próxima página" }));
  await waitFor(() => expect(lastBrowse(calls).page).toBe(1));
  expect(screen.getByText(/^Página 2 · linhas 101–/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Página anterior" }));
  await waitFor(() => expect(lastBrowse(calls).page).toBe(0));
});

test("filters add up as ANDed chips, each one removable, and reset the page", async () => {
  const calls = fakeBackend([prodPostgres]);
  const user = await openUsers();

  await waitFor(() => expect(screen.getByLabelText("Coluna do filtro")).toHaveValue("id"));
  await user.selectOptions(screen.getByLabelText("Operador do filtro"), "gte");
  await user.type(screen.getByLabelText("Valor do filtro"), "42");
  await user.click(screen.getByRole("button", { name: "Aplicar" }));
  await waitFor(() =>
    expect(lastBrowse(calls).filters).toEqual([{ column: "id", op: "gte", value: "42" }])
  );

  await user.selectOptions(screen.getByLabelText("Coluna do filtro"), "profile");
  await user.selectOptions(screen.getByLabelText("Operador do filtro"), "isNull");
  expect(screen.queryByLabelText("Valor do filtro")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Aplicar" }));
  await waitFor(() =>
    expect(lastBrowse(calls).filters).toEqual([
      { column: "id", op: "gte", value: "42" },
      { column: "profile", op: "isNull", value: null }
    ])
  );

  // the applied value went to its chip: the next condition starts empty
  expect(screen.queryByLabelText("Valor do filtro")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Operador do filtro"), "eq");
  expect(screen.getByLabelText("Valor do filtro")).toHaveValue("");
  await user.selectOptions(screen.getByLabelText("Operador do filtro"), "isNull");

  await user.click(screen.getByRole("button", { name: "Remover filtro id >= 42" }));
  await waitFor(() =>
    expect(lastBrowse(calls).filters).toEqual([{ column: "profile", op: "isNull", value: null }])
  );
  // one condition left: nothing to clear all at once
  expect(screen.queryByRole("button", { name: "Limpar tudo" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("Coluna do filtro"), "id");
  await user.selectOptions(screen.getByLabelText("Operador do filtro"), "isNotNull");
  await user.click(screen.getByRole("button", { name: "Aplicar" }));
  await user.click(await screen.findByRole("button", { name: "Limpar tudo" }));
  await waitFor(() => expect(lastBrowse(calls).filters).toEqual([]));
});

test("a JSON cell opens its value formatted, big numbers intact; closed, Space brings it back", async () => {
  fakeBackend([prodPostgres]);
  const user = await openUsers();

  await user.click(screen.getByText('{"id": 9007199254740993}'));

  const panel = screen.getByRole("complementary", { name: "Valor da célula" });
  expect(within(panel).getByText("profile")).toBeInTheDocument();
  // read-only here: formatted for reading, in the JSON editor
  const content = panel.querySelector<HTMLElement>(".cm-content")!;
  expect(content).toHaveAttribute("aria-label", "Valor de profile (somente leitura)");
  expect(EditorView.findFromDOM(content)!.state.doc.toString()).toBe(
    '{\n  "id": 9007199254740993\n}'
  );
  await user.click(within(panel).getByRole("button", { name: "Fechar" }));
  expect(screen.queryByRole("complementary", { name: "Valor da célula" })).not.toBeInTheDocument();

  // closed by the user, it stays closed on the next JSON cell until asked for
  await user.click(screen.getAllByText("NULL")[0]);
  expect(screen.queryByRole("complementary", { name: "Valor da célula" })).not.toBeInTheDocument();
  await user.keyboard(" ");
  expect(screen.getByRole("complementary", { name: "Valor da célula" })).toHaveTextContent("NULL");
});

test("structure tab lists columns, indexes and foreign keys", async () => {
  fakeBackend([prodPostgres]);
  const user = await openUsers();

  await user.click(screen.getByRole("tab", { name: "Estrutura" }));

  const heading = await screen.findByRole("heading", { name: "Colunas" });
  // the data tab stays mounted (hidden) to keep staged edits: scope to the structure
  const structure = within(heading.closest("div.grid") as HTMLElement);
  expect(structure.getByText("jsonb")).toBeInTheDocument();
  expect(structure.getAllByText("PK")).toHaveLength(2); // header + the id column
  expect(structure.getByText("users_pkey")).toBeInTheDocument();
  // no foreign keys, no constraints
  expect(structure.getAllByText("Nenhuma.")).toHaveLength(2);

  // the DDL, said to be rebuilt on Postgres, copies whole
  const ddl = await structure.findByRole("region", { name: "DDL de users" });
  expect(ddl).toHaveTextContent('CREATE TABLE "public"."users"');
  expect(structure.getByText(/Reconstruído a partir do catálogo/)).toBeInTheDocument();
  await user.click(structure.getByRole("button", { name: "Copiar" }));
  expect(await structure.findByRole("status")).toHaveTextContent("DDL copiado");
  expect(await navigator.clipboard.readText()).toBe(usersDdl);
});

test("the DDL a database stores is not called rebuilt", async () => {
  fakeBackend([prodPostgres], {
    table_ddl: () => ({ sql: "CREATE TABLE users (id INTEGER PRIMARY KEY);", reconstructed: false })
  });
  const user = await openUsers();

  await user.click(screen.getByRole("tab", { name: "Estrutura" }));

  expect(
    await screen.findByText("CREATE TABLE users (id INTEGER PRIMARY KEY);")
  ).toBeInTheDocument();
  expect(screen.queryByText(/Reconstruído/)).not.toBeInTheDocument();
});

test("browse errors are shown", async () => {
  const error: AppError = {
    kind: "database",
    message: "permission denied for table users [42501]"
  };
  fakeBackend([prodPostgres], { browse_table: () => Promise.reject(error) });
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("treeitem", { name: /^Postgres prod/ }));
  await user.click(await screen.findByRole("treeitem", { name: "users" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("permission denied");
});

test("the page label gives the row range, and says when there is more", () => {
  expect(pageLabel(0, 100, true)).toBe("Página 1 · linhas 1–100, há mais");
  expect(pageLabel(1, 2, false)).toBe("Página 2 · linhas 101–102");
  expect(pageLabel(0, 0, false)).toBe("Página 1 · nenhuma linha");
});

test("the filter chip reads the applied condition as SQL", () => {
  expect(filterText({ column: "id", op: "eq", value: "42" })).toBe("id = 42");
  expect(filterText({ column: "email", op: "like", value: "%@x" })).toBe("email LIKE %@x");
  expect(filterText({ column: "deleted_at", op: "isNull", value: null })).toBe(
    "deleted_at IS NULL"
  );
  expect(filterText({ column: "id", op: "in", value: "1, 2" })).toBe("id IN (1, 2)");
});

test("copies the selected row as INSERT and the loaded rows as JSON, big numbers intact", async () => {
  const calls = fakeBackend([prodPostgres]);
  const user = await openUsers();

  await user.click(screen.getAllByRole("gridcell")[2]);
  await user.click(screen.getByRole("button", { name: "Copiar" }));
  await user.click(await screen.findByRole("menuitem", { name: "Linha selecionada como INSERT" }));

  expect(callsTo(calls, "copy_as_insert")).toEqual([
    {
      connectionId: "pg-1",
      schema: "public",
      table: "users",
      columns: ["id", "profile"],
      rows: [[{ t: "int", v: "2" }, { t: "null" }]]
    }
  ]);
  expect(await navigator.clipboard.readText()).toBe(
    'INSERT INTO "public"."users" ("id", "profile") VALUES (\'2\', NULL);\n'
  );
  expect(await screen.findByText("1 linha copiada como INSERT")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Copiar" }));
  await user.click(await screen.findByRole("menuitem", { name: "2 linhas carregadas como JSON" }));
  expect(await navigator.clipboard.readText()).toBe(
    '[\n  {"id": 1, "profile": {"id": 9007199254740993}},\n  {"id": 2, "profile": null}\n]'
  );
});

test("a copy the backend refuses says why", async () => {
  fakeBackend([prodPostgres], {
    copy_as_insert: () =>
      Promise.reject({
        kind: "validation",
        message: "a coluna foto tem um valor que a grade só mostra em parte"
      })
  });
  const user = await openUsers();

  await user.click(screen.getByRole("button", { name: "Copiar" }));
  await user.click(
    await screen.findByRole("menuitem", { name: "2 linhas carregadas como INSERT" })
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Não copiado: a coluna foto tem um valor que a grade só mostra em parte"
  );
});

test("groups fold into folders below the ungrouped connections, by keyboard too", async () => {
  fakeBackend([
    { ...devPostgres, group: "Clientes" },
    prodPostgres,
    { ...devMongo, group: "Clientes" }
  ]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  const group = await screen.findByRole("treeitem", { name: /^Clientes/ });
  expect(group).toHaveAccessibleName("Clientes · 2 conexões");
  const levels = screen.getAllByRole("treeitem").map(item => item.getAttribute("aria-level"));
  // Postgres prod (no group) first, then the folder and its two connections one level down
  expect(levels).toEqual(["1", "1", "2", "2"]);
  expect(screen.getAllByRole("treeitem")[0]).toHaveAccessibleName(/^Postgres prod/);
  expect(group).toHaveAttribute("aria-expanded", "true");

  // ← from a connection inside goes up to its folder, ← again folds it
  screen.getByRole("treeitem", { name: /^Postgres dev/ }).focus();
  await user.keyboard("{ArrowLeft}");
  expect(group).toHaveFocus();
  await user.keyboard("{ArrowLeft}");
  expect(group).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByRole("treeitem", { name: /^Postgres dev/ })).not.toBeInTheDocument();
  expect(useExplorer.getState().collapsedGroups).toEqual(["Clientes"]);

  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("treeitem", { name: /^Mongo dev/ })).toBeInTheDocument();
});
