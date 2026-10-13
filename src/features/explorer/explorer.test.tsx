import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { AppError, BrowseRequest } from "@/bindings";
import { callsTo, fakeBackend, prodPostgres } from "@/test/fakeBackend";
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
  expect(screen.getByRole("treeitem", { name: "active_users" })).toBeInTheDocument();
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
  expect(await screen.findByRole("alert")).toHaveTextContent("password authentication failed");

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

test("filters are applied from the toolbar and reset the page", async () => {
  const calls = fakeBackend([prodPostgres]);
  const user = await openUsers();

  await waitFor(() => expect(screen.getByLabelText("Coluna do filtro")).toHaveValue("id"));
  await user.type(screen.getByLabelText("Valor do filtro"), "42");
  await user.click(screen.getByRole("button", { name: "Aplicar" }));
  await waitFor(() =>
    expect(lastBrowse(calls).filters).toEqual([{ column: "id", op: "eq", value: "42" }])
  );

  await user.selectOptions(screen.getByLabelText("Coluna do filtro"), "profile");
  await user.selectOptions(screen.getByLabelText("Operador do filtro"), "isNull");
  expect(screen.queryByLabelText("Valor do filtro")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Aplicar" }));
  await waitFor(() =>
    expect(lastBrowse(calls).filters).toEqual([{ column: "profile", op: "isNull", value: null }])
  );

  await user.click(screen.getByRole("button", { name: "Limpar filtro" }));
  await waitFor(() => expect(lastBrowse(calls).filters).toEqual([]));
});

test("clicking a cell shows its full value, json pretty-printed with big numbers intact", async () => {
  fakeBackend([prodPostgres]);
  const user = await openUsers();

  await user.click(screen.getByText('{"id": 9007199254740993}'));

  const panel = screen.getByRole("complementary", { name: "Valor da célula" });
  expect(within(panel).getByText("profile")).toBeInTheDocument();
  expect(panel.querySelector("pre")?.textContent).toBe('{\n  "id": 9007199254740993\n}');
  await user.click(within(panel).getByRole("button", { name: "Fechar" }));
  expect(screen.queryByRole("complementary", { name: "Valor da célula" })).not.toBeInTheDocument();
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
  expect(structure.getByText("Nenhum.")).toBeInTheDocument();
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
});
