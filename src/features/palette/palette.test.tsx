import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import { useTabs } from "@/features/tabs/store";
import { callsTo, devPostgres, fakeBackend, prodPostgres } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

test("Ctrl+K goes to a table of an open connection and never connects on its own", async () => {
  const calls = fakeBackend([prodPostgres, devPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  // only the prod connection is opened in the sidebar
  await user.click(await screen.findByRole("treeitem", { name: /^Postgres prod/ }));
  await screen.findByRole("treeitem", { name: "users" });
  const connectsBefore = callsTo(calls, "connect_database").length;

  await user.keyboard("{Control>}k{/Control}");
  const dialog = await screen.findByRole("dialog", { name: "Ir para" });
  expect(within(dialog).getByText(/conexões abertas \(1 de 2\)/)).toBeInTheDocument();

  await user.keyboard("active");
  const options = within(dialog).getAllByRole("option");
  expect(options[0]).toHaveTextContent("public.active_users");
  expect(options[0]).toHaveAttribute("aria-selected", "true");
  await user.keyboard("{Enter}");

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(
    screen.getByRole("tab", {
      name: "Postgres prod · active_users · produção · somente leitura",
      selected: true
    })
  ).toBeInTheDocument();
  expect(callsTo(calls, "connect_database").length).toBeGreaterThanOrEqual(connectsBefore);
  expect(callsTo(calls, "list_schemas")).not.toContainEqual({ connectionId: "pg-dev" });
});

test("the palette moves with the arrows, opens actions and says when nothing matches", async () => {
  fakeBackend([devPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("button", { name: /^Ir para…/ }));
  const input = await screen.findByRole("combobox");
  await user.type(input, "zzz");
  expect(screen.getByText("Nada encontrado para “zzz”.")).toBeInTheDocument();

  await user.clear(input);
  await user.type(input, "query");
  await user.keyboard("{ArrowDown}{ArrowUp}{Enter}");
  await waitFor(() =>
    expect(useTabs.getState().tabs).toMatchObject([{ kind: "editor", connectionId: "pg-dev" }])
  );

  await user.keyboard("{Control>}k{/Control}");
  await user.type(await screen.findByRole("combobox"), "legenda");
  await user.click(screen.getByRole("option", { name: /Legenda e atalhos/ }));
  expect(await screen.findByRole("dialog", { name: "Legenda" })).toHaveTextContent("Ctrl+W");
});

test("Ctrl+P opens the same palette as Ctrl+K", async () => {
  fakeBackend([devPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await screen.findByRole("treeitem", { name: /^Postgres dev/ });
  await user.keyboard("{Control>}p{/Control}");
  expect(await screen.findByRole("dialog", { name: "Ir para" })).toBeInTheDocument();
});

test("Ctrl+W closes the active tab", async () => {
  fakeBackend([devPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("treeitem", { name: /^Postgres dev/ }));
  await user.click(await screen.findByRole("treeitem", { name: "users" }));
  expect(useTabs.getState().tabs).toHaveLength(1);

  await user.keyboard("{Control>}w{/Control}");
  expect(useTabs.getState().tabs).toHaveLength(0);
  expect(screen.getByRole("heading", { name: "Nenhuma aba aberta" })).toBeInTheDocument();
});

test("the tree moves with the arrow keys", async () => {
  fakeBackend([devPostgres, prodPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  const dev = await screen.findByRole("treeitem", { name: /^Postgres dev/ });
  dev.focus();
  await user.keyboard("{ArrowRight}");
  expect(dev).toHaveAttribute("aria-expanded", "true");
  await screen.findByRole("treeitem", { name: "users" });

  await user.keyboard("{ArrowRight}");
  expect(screen.getByRole("treeitem", { name: /^Nova query SQL/ })).toHaveFocus();
  await user.keyboard("{ArrowDown}{ArrowDown}");
  expect(screen.getByRole("treeitem", { name: "users" })).toHaveFocus();
  await user.keyboard("{ArrowLeft}");
  expect(screen.getByRole("treeitem", { name: /^public/ })).toHaveFocus();
  await user.keyboard("{End}");
  expect(screen.getByRole("treeitem", { name: /^Postgres prod/ })).toHaveFocus();
  await user.keyboard("{Home}{ArrowLeft}");
  expect(dev).toHaveAttribute("aria-expanded", "false");
});

test("the tree is one tab stop; Shift+F10 opens the row's actions and Esc returns to the row", async () => {
  fakeBackend([devPostgres, prodPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  const dev = await screen.findByRole("treeitem", { name: /^Postgres dev/ });
  const prod = screen.getByRole("treeitem", { name: /^Postgres prod/ });
  expect(dev).toHaveAttribute("tabindex", "0");
  expect(prod).toHaveAttribute("tabindex", "-1");

  dev.focus();
  await user.keyboard("{ArrowDown}");
  expect(prod).toHaveFocus();
  expect(prod).toHaveAttribute("tabindex", "0");
  expect(dev).toHaveAttribute("tabindex", "-1");

  await user.keyboard("{Shift>}{F10}{/Shift}");
  const menu = await screen.findByRole("menu", { name: "Ações de Postgres prod" });
  expect(within(menu).getByRole("menuitem", { name: /^Editar conexão/ })).toBeInTheDocument();
  await user.keyboard("{Escape}");
  await waitFor(() => expect(prod).toHaveFocus());
});

test("Esc on the palette gives focus back; picking “Abrir conexão” connects and focuses the row", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  const dev = await screen.findByRole("treeitem", { name: /^Postgres dev/ });
  dev.focus();
  await user.keyboard("{Control>}k{/Control}");
  await screen.findByRole("dialog", { name: "Ir para" });
  await user.keyboard("{Escape}");
  await waitFor(() => expect(dev).toHaveFocus());
  expect(callsTo(calls, "list_schemas")).toHaveLength(0);

  // with nothing open, the empty state offers to open a connection through the palette
  await user.click(screen.getByRole("button", { name: /^Abrir uma conexão/ }));
  expect(screen.getByRole("combobox")).toHaveValue("abrir conexão");
  await user.keyboard("{Enter}");

  await waitFor(() => expect(dev).toHaveAttribute("aria-expanded", "true"));
  await waitFor(() => expect(dev).toHaveFocus());
  expect(await screen.findByRole("treeitem", { name: "users" })).toBeInTheDocument();
});

test("F6 cycles tree, tabs and view; Ctrl+Tab moves between tabs; Ctrl+S saves staged edits", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("treeitem", { name: /^Postgres dev/ }));
  await user.click(await screen.findByRole("treeitem", { name: "users" }));
  await user.click(screen.getByRole("treeitem", { name: "active_users" }));
  const usersRow = screen.getByRole("treeitem", { name: "users" });
  usersRow.focus();

  await user.keyboard("{F6}");
  expect(screen.getByRole("tab", { name: /· active_users/, selected: true })).toHaveFocus();
  // the view is entered at its grid, not at the strip around it
  await user.keyboard("{F6}");
  expect(
    within(screen.getByRole("tabpanel", { name: /· active_users/ })).getByRole("grid")
  ).toHaveFocus();
  await user.keyboard("{Shift>}{F6}{/Shift}");
  expect(screen.getByRole("tab", { name: /· active_users/ })).toHaveFocus();

  await user.keyboard("{Control>}{Tab}{/Control}");
  await waitFor(() => expect(screen.getByRole("tab", { name: /· users/ })).toHaveFocus());
  expect(screen.getByRole("tab", { name: /· users/ })).toHaveAttribute("aria-selected", "true");

  // stage an edit in users, then save from the grid with Ctrl+S
  const panel = screen.getByRole("tabpanel", { name: /· users/ });
  const grid = await within(panel).findByRole("grid");
  const cell = within(grid)
    .getAllByRole("gridcell")
    .find(element => element.firstChild?.textContent === "2")!;
  await user.dblClick(cell);
  const input = screen.getByRole("textbox", { name: /^Editar / });
  await user.clear(input);
  await user.type(input, "20{Enter}");
  grid.focus();
  await user.keyboard("{Control>}s{/Control}");
  await waitFor(() => expect(callsTo(calls, "apply_changes")).toHaveLength(1));
});
