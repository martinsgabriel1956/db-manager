import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { HistoryEntry } from "@/bindings";
import { useTabs } from "@/features/tabs/store";
import { callsTo, devPostgres, fakeBackend, prodPostgres } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

const entries: HistoryEntry[] = [
  {
    id: 2,
    connectionId: "pg-1",
    connectionName: "Postgres prod",
    sql: "SELECT count(*) FROM users",
    executedAt: "2026-10-11T12:00:00.000Z",
    durationMs: 8,
    success: true,
    error: null
  },
  {
    id: 1,
    connectionId: "gone",
    connectionName: "Removida",
    sql: "DELETE FROM x",
    executedAt: "2026-10-11T11:00:00.000Z",
    durationMs: 3,
    success: false,
    error: 'relation "x" does not exist [42P01]'
  }
];

function tabNames() {
  return screen
    .getAllByRole("tab")
    .filter(tab => tab.closest("[aria-label='Abas abertas']"))
    .map(tab => tab.textContent);
}

test("tables and editors open as tabs; reopening a table focuses its tab", async () => {
  fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("button", { name: /^Postgres prod/ }));
  await user.click(await screen.findByRole("button", { name: "users" }));
  await user.click(screen.getByRole("button", { name: "active_users" }));
  await user.click(screen.getByRole("button", { name: "Abrir editor SQL de Postgres prod" }));
  await user.click(screen.getByRole("button", { name: "Abrir editor SQL de Postgres prod" }));
  await user.click(screen.getByRole("button", { name: "users" }));

  expect(tabNames()).toEqual([
    "users",
    "active_users",
    "Postgres prod · SQL 1",
    "Postgres prod · SQL 2"
  ]);
  expect(screen.getByRole("tab", { name: "users", selected: true })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Fechar aba users" }));
  expect(tabNames()).toEqual(["active_users", "Postgres prod · SQL 1", "Postgres prod · SQL 2"]);
});

test("open tabs move with the arrow keys and close with Delete", async () => {
  fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("button", { name: /^Postgres prod/ }));
  await user.click(await screen.findByRole("button", { name: "users" }));
  await user.click(screen.getByRole("button", { name: "active_users" }));
  await user.click(screen.getByRole("tab", { name: "users" }));

  await user.keyboard("{ArrowRight}");
  const activeUsers = screen.getByRole("tab", { name: "active_users", selected: true });
  expect(activeUsers).toHaveFocus();
  expect(screen.getByRole("tabpanel", { name: "active_users" })).toBeInTheDocument();

  await user.keyboard("{Delete}");
  expect(tabNames()).toEqual(["users"]);
  await waitFor(() => expect(screen.getByRole("tab", { name: "users" })).toHaveFocus());
});

test("editing a connection hides the tabs and returns to them", async () => {
  fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("button", { name: /^Postgres prod/ }));
  await user.click(await screen.findByRole("button", { name: "users" }));
  await user.click(screen.getByRole("button", { name: "Editar Postgres prod" }));
  expect(screen.getByRole("heading", { name: "Editar conexão" })).toBeInTheDocument();
  expect(screen.queryByRole("tablist", { name: "Abas abertas" })).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "users" }));
  expect(screen.getByRole("tablist", { name: "Abas abertas" })).toBeInTheDocument();
});

test("history lists runs, filters them and reopens SQL in an editor", async () => {
  const calls = fakeBackend([prodPostgres, devPostgres], { search_history: () => entries });
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("button", { name: "Histórico" }));

  expect(await screen.findByText("SELECT count(*) FROM users")).toBeInTheDocument();
  expect(screen.getByText('relation "x" does not exist [42P01]')).toBeInTheDocument();
  expect(screen.getByLabelText("erro")).toBeInTheDocument();
  // the removed connection's entry cannot be reopened
  expect(screen.getAllByRole("button", { name: "Abrir no editor" })).toHaveLength(1);

  await user.type(screen.getByLabelText("Buscar no histórico"), "users");
  await user.selectOptions(screen.getByLabelText("Filtrar por conexão"), "pg-1");
  await waitFor(() =>
    expect(callsTo(calls, "search_history")).toContainEqual({ text: "users", connectionId: "pg-1" })
  );

  await user.click(screen.getByRole("button", { name: "Abrir no editor" }));
  const editor = useTabs.getState().tabs.find(tab => tab.kind === "editor");
  expect(editor).toMatchObject({ connectionId: "pg-1", sql: "SELECT count(*) FROM users" });
  expect(
    screen.getByRole("tab", { name: "Postgres prod · SQL 1", selected: true })
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
