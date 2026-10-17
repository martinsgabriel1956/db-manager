import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type {
  BrowseRequest,
  ColumnInfo,
  DiagramTable,
  ForeignKeyInfo,
  RowBatch,
  TableStructure
} from "@/bindings";
import {
  filterValue,
  incomingKeys,
  incomingLabel,
  keyOfColumn,
  matchFilters
} from "@/features/table/foreignKeys";
import { tableKey, useTabs } from "@/features/tabs/store";
import { callsTo, devPostgres, fakeBackend } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

function column(name: string, isPrimaryKey = false): ColumnInfo {
  return { name, dataType: "integer", nullable: true, default: null, isPrimaryKey, options: [] };
}

const teamKey: ForeignKeyInfo = {
  name: "orders_team_fkey",
  definition: "FOREIGN KEY (team_id, region) REFERENCES teams(id, region)",
  columns: ["team_id", "region"],
  referencedSchema: "public",
  referencedTable: "teams",
  referencedColumns: ["id", "region"]
};

const ordersStructure: TableStructure = {
  columns: [column("id", true), column("team_id"), column("region")],
  indexes: [],
  foreignKeys: [teamKey],
  constraints: []
};

const teamsStructure: TableStructure = {
  columns: [column("id", true), column("region", true)],
  indexes: [],
  foreignKeys: [],
  constraints: []
};

const ordersPage: RowBatch = {
  columns: [
    { name: "id", typeName: "int4", editable: true },
    { name: "team_id", typeName: "int4", editable: true },
    { name: "region", typeName: "text", editable: true }
  ],
  rows: [
    [
      { t: "int", v: "1" },
      { t: "int", v: "7" },
      { t: "text", v: "sul" }
    ],
    [{ t: "int", v: "2" }, { t: "null" }, { t: "text", v: "norte" }]
  ],
  hasMore: false
};

const teamsPage: RowBatch = {
  columns: [
    { name: "id", typeName: "int4", editable: true },
    { name: "region", typeName: "text", editable: true }
  ],
  rows: [
    [
      { t: "int", v: "7" },
      { t: "text", v: "sul" }
    ]
  ],
  hasMore: false
};

const schemaTables: DiagramTable[] = [
  { name: "orders", columns: ordersStructure.columns, foreignKeys: [teamKey] },
  { name: "teams", columns: teamsStructure.columns, foreignKeys: [] }
];

function backend(structures: Record<string, TableStructure> = {}) {
  const all: Record<string, TableStructure> = {
    orders: ordersStructure,
    teams: teamsStructure,
    ...structures
  };
  return fakeBackend([devPostgres], {
    list_schemas: () => [
      {
        name: "public",
        relations: [
          { name: "orders", kind: "table" },
          { name: "teams", kind: "table" }
        ]
      }
    ],
    table_structure: args => all[(args as { table: string }).table],
    browse_table: args =>
      (args as { request: BrowseRequest }).request.table === "teams" ? teamsPage : ordersPage,
    schema_diagram: () => schemaTables
  });
}

async function openTable(name: string) {
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(await screen.findByRole("treeitem", { name: /^Postgres dev/ }));
  await user.click(await screen.findByRole("treeitem", { name }));
  await screen.findAllByRole("gridcell");
  return user;
}

function browsed(calls: ReturnType<typeof fakeBackend>, table: string) {
  return (callsTo(calls, "browse_table") as { request: BrowseRequest }[])
    .map(args => args.request)
    .filter(request => request.table === table);
}

test("values become exact filter text; NULL and partial values lead nowhere", () => {
  expect(filterValue({ t: "int", v: "9007199254740993" })).toBe("9007199254740993");
  expect(filterValue({ t: "null" })).toBeNull();
  expect(filterValue({ t: "bytes", v: { len: 40, previewHex: "00" } })).toBeNull();
  const row = ordersPage.rows[0];
  expect(matchFilters(ordersPage.columns, row, ["team_id", "region"], ["id", "region"])).toEqual([
    { column: "id", op: "eq", value: "7" },
    { column: "region", op: "eq", value: "sul" }
  ]);
  // a composite key with one NULL references nothing
  expect(
    matchFilters(ordersPage.columns, ordersPage.rows[1], ["team_id", "region"], ["id", "region"])
  ).toBeNull();
  expect(matchFilters(ordersPage.columns, row, ["team_id"], [])).toBeNull();
  expect(keyOfColumn([teamKey], "region")).toBe(teamKey);
  expect(keyOfColumn([teamKey], "id")).toBeNull();
  const incoming = incomingKeys(schemaTables, "public", "teams");
  expect(incoming).toEqual([{ schema: "public", table: "orders", key: teamKey }]);
  expect(incomingLabel(incoming[0])).toBe("orders (team_id, region)");
  expect(incomingKeys(schemaTables, "other", "teams")).toEqual([]);
});

test("a foreign key cell opens the referenced table filtered by the whole key", async () => {
  const calls = backend();
  const user = await openTable("orders");

  // the NULL row's key points nowhere: no link in it
  expect(
    screen.getAllByRole("button", { name: "Abrir teams filtrada por team_id, region" })
  ).toHaveLength(2);
  await user.click(
    screen.getAllByRole("button", { name: "Abrir teams filtrada por team_id, region" })[0]
  );

  await waitFor(() => expect(browsed(calls, "teams")).not.toHaveLength(0));
  expect(browsed(calls, "teams")[0].filters).toEqual([
    { column: "id", op: "eq", value: "7" },
    { column: "region", op: "eq", value: "sul" }
  ]);
  const tab = useTabs.getState().tabs.find(open => open.kind === "table" && open.table === "teams");
  expect(useTabs.getState().activeId).toBe(tab?.id);
});

test("Alt+Enter follows the selected cell, and says why when there is nothing to follow", async () => {
  const calls = backend();
  const user = await openTable("orders");
  const grid = screen.getByRole("grid", { name: "Linhas de orders" });
  expect(grid).toHaveAttribute("aria-keyshortcuts", expect.stringContaining("Alt+Enter"));

  // second row, team_id: NULL
  await user.click(within(grid).getAllByRole("gridcell")[4]);
  fireEvent.keyDown(grid, { key: "Enter", altKey: true });
  expect(await screen.findByText(/Nada a seguir/)).toBeInTheDocument();
  expect(browsed(calls, "teams")).toHaveLength(0);

  await user.click(within(grid).getAllByRole("gridcell")[1]);
  fireEvent.keyDown(grid, { key: "Enter", altKey: true });
  await waitFor(() => expect(browsed(calls, "teams")).toHaveLength(1));
});

test("the referenced table holding staged edits is not refiltered under them", async () => {
  const calls = backend();
  const user = await openTable("orders");
  useTabs
    .getState()
    .setPending(tableKey({ connectionId: "pg-dev", schema: "public", table: "teams" }), 2);

  await user.click(
    screen.getAllByRole("button", { name: "Abrir teams filtrada por team_id, region" })[0]
  );

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "teams tem alterações pendentes: salve ou descarte lá antes de abrir com filtro."
  );
  expect(browsed(calls, "teams")).toHaveLength(0);
});

test("from a row, the tables that reference it open filtered by the key", async () => {
  const calls = backend();
  const user = await openTable("teams");
  const references = screen.getByRole("button", { name: /Referências/ });
  expect(references).toBeDisabled();

  const grid = screen.getByRole("grid", { name: "Linhas de teams" });
  await user.click(within(grid).getAllByRole("gridcell")[0]);
  // the keyboard opens the same menu from the grid
  fireEvent.keyDown(grid, { key: "Enter", altKey: true, shiftKey: true });
  const menu = await screen.findByRole("menu");
  expect(within(menu).getByText(/schema public que apontam para teams/)).toBeInTheDocument();
  await user.click(await within(menu).findByRole("menuitem", { name: "orders (team_id, region)" }));

  await waitFor(() => expect(browsed(calls, "orders")).not.toHaveLength(0));
  expect(browsed(calls, "orders")[0].filters).toEqual([
    { column: "team_id", op: "eq", value: "7" },
    { column: "region", op: "eq", value: "sul" }
  ]);
});

test("a key that leaves the referenced columns implicit (SQLite) uses that table's primary key", async () => {
  const implicit: ForeignKeyInfo = { ...teamKey, referencedColumns: [] };
  const calls = backend({ orders: { ...ordersStructure, foreignKeys: [implicit] } });
  const user = await openTable("orders");

  await user.click(
    screen.getAllByRole("button", { name: "Abrir teams filtrada por team_id, region" })[0]
  );

  await waitFor(() => expect(browsed(calls, "teams")).not.toHaveLength(0));
  expect(browsed(calls, "teams")[0].filters.map(filter => filter.column)).toEqual(["id", "region"]);
});
