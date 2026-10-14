import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { HistoryEntry } from "@/bindings";
import { CloseTabDialog } from "@/features/tabs/CloseTabDialog";
import { tableKey, useTabs } from "@/features/tabs/store";
import { callsTo, devPostgres, fakeBackend, prodPostgres } from "@/test/fakeBackend";
import { renderWithClient, rowAction } from "@/test/render";

const entries: HistoryEntry[] = [
  {
    id: 2,
    connectionId: "pg-1",
    connectionName: "Postgres prod",
    sql: "SELECT count(*) FROM users",
    executedAt: "2026-10-11T12:00:00.000Z",
    durationMs: 8,
    success: true,
    error: null,
    starred: false
  },
  {
    id: 1,
    connectionId: "gone",
    connectionName: "Removida",
    sql: "DELETE FROM x",
    executedAt: "2026-10-11T11:00:00.000Z",
    durationMs: 3,
    success: false,
    error: 'relation "x" does not exist [42P01]',
    starred: true
  }
];

function tabNames() {
  return screen
    .getAllByRole("tab")
    .filter(tab => tab.closest("[aria-label='Abas abertas']"))
    .map(tab => tab.getAttribute("aria-label"));
}

test("tables and editors open as tabs; reopening a table focuses its tab", async () => {
  fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("treeitem", { name: /^Postgres prod/ }));
  await user.click(await screen.findByRole("treeitem", { name: "users" }));
  await user.click(screen.getByRole("treeitem", { name: "active_users" }));
  await rowAction(user, "Postgres prod", "Nova query SQL");
  await user.click(screen.getByRole("treeitem", { name: /^Nova query SQL/ }));
  await user.click(screen.getByRole("treeitem", { name: "users" }));

  // every tab names its connection, and a production one says so
  expect(tabNames()).toEqual([
    "Postgres prod · users · produção · somente leitura",
    "Postgres prod · active_users · produção · somente leitura",
    "Postgres prod · SQL 1 · produção · somente leitura",
    "Postgres prod · SQL 2 · produção · somente leitura"
  ]);
  expect(
    screen.getByRole("tab", {
      name: "Postgres prod · users · produção · somente leitura",
      selected: true
    })
  ).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Fechar aba Postgres prod · users" }));
  expect(tabNames()).toEqual([
    "Postgres prod · active_users · produção · somente leitura",
    "Postgres prod · SQL 1 · produção · somente leitura",
    "Postgres prod · SQL 2 · produção · somente leitura"
  ]);
});

test("tabs of one connection side by side name it once, on the first of the run", async () => {
  fakeBackend([prodPostgres, devPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("treeitem", { name: /^Postgres prod/ }));
  await user.click(await screen.findByRole("treeitem", { name: "users" }));
  await user.click(screen.getByRole("treeitem", { name: "active_users" }));
  await user.click(screen.getByRole("treeitem", { name: /^Postgres dev/ }));
  await user.click((await screen.findAllByRole("treeitem", { name: "users" }))[1]);

  const visible = screen.getAllByRole("tab").map(tab => tab.textContent);
  expect(visible.filter(text => text?.includes("Postgres prod ·"))).toHaveLength(1);
  expect(visible.filter(text => text?.includes("Postgres dev ·"))).toHaveLength(1);
  // the accessible names stay whole on every tab
  expect(tabNames()).toContain("Postgres prod · active_users · produção · somente leitura");
});

test("Ctrl+T opens an editor on the active tab's connection", async () => {
  fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  // no active connection yet: nothing opens
  await screen.findByRole("treeitem", { name: /^Postgres prod/ });
  await user.keyboard("{Control>}t{/Control}");
  expect(screen.queryAllByRole("tab")).toHaveLength(0);

  await user.click(screen.getByRole("treeitem", { name: /^Postgres prod/ }));
  await user.click(await screen.findByRole("treeitem", { name: "users" }));
  await user.keyboard("{Control>}t{/Control}");

  expect(tabNames()).toEqual([
    "Postgres prod · users · produção · somente leitura",
    "Postgres prod · SQL 1 · produção · somente leitura"
  ]);
  expect(
    screen.getByRole("tab", {
      name: "Postgres prod · SQL 1 · produção · somente leitura",
      selected: true
    })
  ).toBeInTheDocument();
});

test("open tabs move with the arrow keys and close with Delete", async () => {
  fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("treeitem", { name: /^Postgres prod/ }));
  await user.click(await screen.findByRole("treeitem", { name: "users" }));
  await user.click(screen.getByRole("treeitem", { name: "active_users" }));
  await user.click(screen.getByRole("tab", { name: /· users ·/ }));

  await user.keyboard("{ArrowRight}");
  const activeUsers = screen.getByRole("tab", { name: /· active_users ·/, selected: true });
  expect(activeUsers).toHaveFocus();
  expect(screen.getByRole("tabpanel", { name: /· active_users ·/ })).toBeInTheDocument();

  await user.keyboard("{Delete}");
  expect(tabNames()).toEqual(["Postgres prod · users · produção · somente leitura"]);
  await waitFor(() => expect(screen.getByRole("tab", { name: /· users ·/ })).toHaveFocus());
});

test("the connection form opens as a tab over the open tabs and parks its draft", async () => {
  fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("treeitem", { name: /^Postgres prod/ }));
  await user.click(await screen.findByRole("treeitem", { name: "users" }));
  await rowAction(user, "Postgres prod", "Editar conexão");
  expect(screen.getByRole("heading", { name: /^Editar conexão/ })).toBeInTheDocument();
  // the open tabs stay in view; the form is the selected one
  const tablist = screen.getByRole("tablist", { name: "Abas abertas" });
  expect(within(tablist).getByRole("tab", { name: /Editar Postgres prod/ })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  expect(within(tablist).getByRole("tab", { name: /users/ })).toHaveAttribute(
    "aria-selected",
    "false"
  );

  // typing, leaving for a table and coming back keeps what was typed
  const name = screen.getByLabelText("Nome");
  await user.clear(name);
  await user.type(name, "Rascunho");
  await user.click(screen.getByRole("treeitem", { name: "users" }));
  expect(screen.queryByRole("heading", { name: /^Editar conexão/ })).not.toBeInTheDocument();
  expect(within(tablist).getByRole("tab", { name: /users/ })).toHaveAttribute(
    "aria-selected",
    "true"
  );
  await user.click(within(tablist).getByRole("tab", { name: "Editar Postgres prod · rascunho" }));
  expect(screen.getByLabelText("Nome")).toHaveValue("Rascunho");
});

test("a typed draft is never replaced by another form", async () => {
  fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click((await screen.findAllByRole("button", { name: "Nova conexão" }))[0]);
  await user.type(screen.getByLabelText("Nome"), "Rascunho");
  await rowAction(user, "Postgres prod", "Editar conexão");

  // the draft comes back with the reason, instead of the other form taking its place
  expect(screen.getByRole("status")).toHaveTextContent(
    "Nova conexão tem um rascunho não salvo: salve ou cancele antes de abrir outro formulário."
  );
  expect(screen.getByLabelText("Nome")).toHaveValue("Rascunho");
});

test("history lists runs, filters them and reopens SQL in an editor", async () => {
  const calls = fakeBackend([prodPostgres, devPostgres], { search_history: () => entries });
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("button", { name: "Histórico" }));

  expect(await screen.findByText("SELECT count(*) FROM users")).toBeInTheDocument();
  expect(screen.getByText('relation "x" does not exist [42P01]')).toBeInTheDocument();
  expect(screen.getByLabelText("erro")).toBeInTheDocument();
  // the removed connection's entry cannot be reopened; the other says where it opens
  const open = screen.getAllByRole("button", { name: /^Abrir no editor/ });
  expect(open).toHaveLength(1);
  expect(open[0]).toHaveAccessibleName(/^Abrir no editor de Postgres prod, produção: /);
  expect(open[0]).toHaveTextContent("Abrir no editor de produção");

  await user.type(screen.getByLabelText("Buscar no histórico"), "users");
  await user.selectOptions(screen.getByLabelText("Filtrar por conexão"), "pg-1");
  await waitFor(() =>
    expect(callsTo(calls, "search_history")).toContainEqual({
      text: "users",
      connectionId: "pg-1",
      starredOnly: false
    })
  );

  await user.click(screen.getByRole("button", { name: /^Abrir no editor/ }));
  const editor = useTabs.getState().tabs.find(tab => tab.kind === "editor");
  expect(editor).toMatchObject({ connectionId: "pg-1", sql: "SELECT count(*) FROM users" });
  expect(
    screen.getByRole("tab", {
      name: "Postgres prod · SQL 1 · produção · somente leitura",
      selected: true
    })
  ).toBeInTheDocument();
});

test("tabs of connections that no longer exist are dropped on load", async () => {
  useTabs.setState({
    tabs: [
      { id: "a", kind: "table", connectionId: "gone", schema: "public", table: "x" },
      { id: "b", kind: "table", connectionId: "pg-1", schema: "public", table: "users" }
    ],
    activeId: "a"
  });
  fakeBackend([prodPostgres]);
  renderWithClient(<App />);

  await waitFor(() => expect(useTabs.getState().tabs.map(tab => tab.id)).toEqual(["b"]));
  expect(useTabs.getState().activeId).toBe("b");
});

test("a search with no match is not reported as an empty history", async () => {
  fakeBackend([prodPostgres], { search_history: () => [] });
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("button", { name: "Histórico" }));
  expect(await screen.findByText("Nada no histórico")).toBeInTheDocument();

  await user.type(screen.getByLabelText("Buscar no histórico"), "orders");
  expect(await screen.findByText("Nenhum resultado")).toBeInTheDocument();
  expect(screen.getByText(/corresponde a “orders”/)).toBeInTheDocument();
});

test("history entries are starred and the favourites filter asks for starred only", async () => {
  const calls = fakeBackend([prodPostgres], {
    search_history: () => entries,
    star_history: () => null
  });
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("button", { name: "Histórico" }));
  await screen.findByText("SELECT count(*) FROM users");
  const stars = screen.getAllByRole("button", { name: /^Favorita: / });
  expect(stars[0]).toHaveAccessibleName(/^Favorita: Postgres prod, /);
  expect(stars.map(star => star.getAttribute("aria-pressed"))).toEqual(["false", "true"]);

  await user.click(stars[0]);
  await user.click(stars[1]);
  expect(callsTo(calls, "star_history")).toEqual([
    { id: 2, starred: true },
    { id: 1, starred: false }
  ]);

  await user.click(screen.getByRole("button", { name: "Favoritas" }));
  await waitFor(() =>
    expect(callsTo(calls, "search_history")).toContainEqual({
      text: "",
      connectionId: null,
      starredOnly: true
    })
  );
});

test("favourites with nothing starred say how to star", async () => {
  fakeBackend([prodPostgres], { search_history: () => [] });
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("button", { name: "Histórico" }));
  await user.click(await screen.findByRole("button", { name: "Favoritas" }));
  expect(await screen.findByText("Nenhuma favorita")).toBeInTheDocument();
});

test("right click on a tab closes it, the others or every tab, and Ctrl+Shift+T reopens", async () => {
  fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("treeitem", { name: /^Postgres prod/ }));
  await user.click(await screen.findByRole("treeitem", { name: "users" }));
  await user.click(screen.getByRole("treeitem", { name: "active_users" }));
  await user.click(screen.getByRole("button", { name: "Histórico" }));
  expect(tabNames()).toHaveLength(3);

  await user.pointer({
    keys: "[MouseRight]",
    target: screen.getByRole("tab", { name: "Postgres prod · users · produção · somente leitura" })
  });
  // the menu names the tab it acts on
  await user.click(
    await screen.findByRole("menuitem", { name: "Fechar aba Postgres prod · users" })
  );
  expect(tabNames()).toEqual([
    "Postgres prod · active_users · produção · somente leitura",
    "Histórico"
  ]);

  await user.keyboard("{Control>}{Shift>}t{/Shift}{/Control}");
  expect(tabNames()).toEqual([
    "Postgres prod · active_users · produção · somente leitura",
    "Histórico",
    "Postgres prod · users · produção · somente leitura"
  ]);

  await user.pointer({
    keys: "[MouseRight]",
    target: screen.getByRole("tab", { name: "Histórico" })
  });
  await user.click(await screen.findByRole("menuitem", { name: "Fechar outras abas" }));
  expect(tabNames()).toEqual(["Histórico"]);

  await user.pointer({
    keys: "[MouseRight]",
    target: screen.getByRole("tab", { name: "Histórico" })
  });
  await user.click(await screen.findByRole("menuitem", { name: "Fechar todas as abas (1)" }));
  expect(
    screen.queryAllByRole("tab").filter(tab => tab.closest("[aria-label='Abas abertas']"))
  ).toEqual([]);
  expect(await screen.findByText("Nenhuma aba aberta")).toBeInTheDocument();

  // nothing is lost for good: the menu's way back is there too
  await user.keyboard("{Control>}{Shift>}t{/Shift}{/Control}");
  expect(tabNames()).toEqual(["Histórico"]);
});

test("discarding edits in several tables names how many hold them", async () => {
  const users = { connectionId: "pg-1", schema: "public", table: "users" };
  const orders = { connectionId: "pg-1", schema: "public", table: "orders" };
  useTabs.setState({
    tabs: [
      { id: "a", kind: "table", ...users },
      { id: "b", kind: "table", ...orders },
      { id: "history", kind: "history" }
    ],
    activeId: "a",
    pending: { [tableKey(users)]: 2, [tableKey(orders)]: 1 },
    closeRequest: ["a", "b", "history"]
  });
  renderWithClient(<CloseTabDialog connections={[prodPostgres]} />);

  expect(await screen.findByRole("dialog")).toHaveTextContent(
    "2 tabelas têm 3 alterações pendentes. Fechar as abas descarta todas"
  );
});
