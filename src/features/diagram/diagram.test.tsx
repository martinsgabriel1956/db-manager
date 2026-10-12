import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import { layoutDiagram, nodeHeight } from "@/features/diagram/layout";
import { callsTo, devMongo, devPostgres, diagram, fakeBackend } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

test("foreign keys inside the schema become edges, the rest is listed on the table", async () => {
  const { nodes, edges } = await layoutDiagram("public", diagram);

  expect(edges).toEqual([
    { id: "users:users_team_id_fkey", source: "users", target: "teams", label: "team_id" }
  ]);
  const users = nodes.find(node => node.id === "users")!;
  const teams = nodes.find(node => node.id === "teams")!;
  expect(users.data.external).toEqual(["billing.tenants"]);
  expect(users.data.foreignKeyColumns).toContain("team_id");
  // layered left to right: the referencing table comes first
  expect(users.position.x).toBeLessThan(teams.position.x);
  expect(nodeHeight(users.data)).toBeGreaterThan(nodeHeight(teams.data));
});

test("a SQL schema opens its ER diagram; double click opens a table", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(await screen.findByRole("button", { name: /^Postgres dev/ }));

  await user.click(await screen.findByRole("button", { name: "Diagrama ER de public" }));

  expect(await screen.findByRole("tab", { name: "Postgres dev · ER public" })).toBeInTheDocument();
  expect(await screen.findByText(/2 tabelas · 1 chave estrangeira/)).toBeInTheDocument();
  const users = screen.getByLabelText("Tabela users");
  expect(within(users).getByText("team_id")).toBeInTheDocument();
  expect(within(users).getByText("→ billing.tenants")).toBeInTheDocument();
  expect(within(users).getByLabelText("chave primária")).toBeInTheDocument();
  expect(within(users).getByLabelText("chave estrangeira")).toBeInTheDocument();
  expect(callsTo(calls, "schema_diagram")).toEqual([{ connectionId: "pg-dev", schema: "public" }]);

  // fireEvent: user-event's mousedown has no `view`, which React Flow's drag handler reads
  fireEvent.doubleClick(users);
  await waitFor(() =>
    expect(
      screen.getByRole("tab", { name: "Postgres dev · users", selected: true })
    ).toBeInTheDocument()
  );
});

test("an empty schema says so, and MongoDB has no diagram", async () => {
  fakeBackend([devPostgres, devMongo], { schema_diagram: () => [] });
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(await screen.findByRole("button", { name: /^Postgres dev/ }));
  await user.click(await screen.findByRole("button", { name: "Diagrama ER de audit" }));
  expect(await screen.findByText("O schema audit não tem tabelas.")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: /^Mongo dev/ }));
  await screen.findAllByRole("button", { name: /^public/ });
  expect(screen.getAllByRole("button", { name: /^Diagrama ER/ })).toHaveLength(2);
});
