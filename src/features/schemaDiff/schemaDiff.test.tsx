import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { SchemaDiff } from "@/bindings";
import { callsTo, devMongo, devPostgres, fakeBackend, prodPostgres } from "@/test/fakeBackend";
import { renderWithClient, rowAction } from "@/test/render";

const diff: SchemaDiff = {
  onlyInSource: ["invoices"],
  onlyInTarget: ["legacy"],
  changed: [
    {
      table: "users",
      items: [
        {
          kind: "column",
          name: "email",
          source: "text NOT NULL",
          target: null
        },
        {
          kind: "index",
          name: "users_name_idx",
          source: "CREATE INDEX users_name_idx ON public.users USING btree (name)",
          target: "CREATE INDEX users_name_idx ON public.users USING btree (lower(name))"
        }
      ]
    }
  ],
  equal: 4,
  ddl: 'ALTER TABLE "public"."users" ADD COLUMN "email" text NOT NULL;\nDROP TABLE "public"."legacy";'
};

async function openComparison() {
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(await screen.findByRole("treeitem", { name: /^Postgres dev/ }));
  await rowAction(user, "public", "Comparar com outro schema…");
  await screen.findByRole("heading", { name: "Comparar schema" });
  return user;
}

test("a schema is compared with another connection of the same engine", async () => {
  const calls = fakeBackend([devPostgres, prodPostgres, devMongo], {
    compare_schemas: () => diff
  });
  const user = await openComparison();

  // the source is where it was opened from; the target, another Postgres
  expect(screen.getByLabelText("Conexão de origem")).toHaveValue("pg-dev");
  const target = screen.getByLabelText("Conexão de destino");
  expect(target).toHaveValue("pg-1");
  // a Mongo connection cannot be the other side
  expect(within(target).queryByText(/Mongo dev/)).toBeNull();
  expect(screen.getByText(/nunca é executado por esta tela/)).toBeInTheDocument();
  expect(callsTo(calls, "compare_schemas")).toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "Comparar" }));

  expect(
    await screen.findByText(/1 com diferenças · 1 só na origem · 1 só no destino · 4 iguais/)
  ).toBeInTheDocument();
  expect(callsTo(calls, "compare_schemas")).toEqual([
    {
      sourceConnectionId: "pg-dev",
      sourceSchema: "public",
      targetConnectionId: "pg-1",
      targetSchema: "public"
    }
  ]);
  // both sides are connected before comparing
  expect(callsTo(calls, "connect_database")).toEqual(
    expect.arrayContaining([{ connectionId: "pg-dev" }, { connectionId: "pg-1" }])
  );
  expect(
    within(screen.getByRole("region", { name: "Só na origem (Postgres dev · public)" })).getByText(
      "invoices"
    )
  ).toBeInTheDocument();
  expect(
    within(
      screen.getByRole("region", { name: "Só no destino (Postgres prod · public)" })
    ).getByText("legacy")
  ).toBeInTheDocument();
  const users = screen.getByRole("region", { name: "Diferenças em users" });
  expect(within(users).getByText("— (não existe)")).toBeInTheDocument();
  expect(within(users).getByText("Índice")).toBeInTheDocument();

  const ddl = screen.getByRole("region", { name: "DDL sugerido" });
  expect(within(ddl).getByText(/DROP TABLE "public"."legacy";/)).toBeInTheDocument();
  await user.click(within(ddl).getByRole("button", { name: "Copiar DDL" }));
  expect(await within(ddl).findByRole("status")).toHaveTextContent("DDL copiado");
  expect(await navigator.clipboard.readText()).toBe(diff.ddl);
});

test("the target schema can be another one, and a failure says why", async () => {
  const calls = fakeBackend([devPostgres, prodPostgres], {
    compare_schemas: () =>
      Promise.reject({ kind: "notFound", message: "não encontrado: schema audit" })
  });
  const user = await openComparison();

  await user.selectOptions(await screen.findByLabelText("Schema de destino"), "audit");
  await user.click(screen.getByRole("button", { name: "Comparar" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("não encontrado: schema audit");
  expect(callsTo(calls, "compare_schemas")[0]).toMatchObject({ targetSchema: "audit" });
});

test("without a DDL generator (MySQL, SQLite) the screen says so instead of hiding it", async () => {
  fakeBackend([devPostgres], { compare_schemas: () => ({ ...diff, ddl: null }) });
  const user = await openComparison();

  await user.click(screen.getByRole("button", { name: "Comparar" }));

  expect(await screen.findByText(/DDL sugerido só existe para Postgres/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Copiar DDL" })).toBeNull();
});

test("equal schemas leave nothing to change", async () => {
  fakeBackend([devPostgres], {
    compare_schemas: () => ({
      onlyInSource: [],
      onlyInTarget: [],
      changed: [],
      equal: 2,
      ddl: ""
    })
  });
  const user = await openComparison();

  await user.click(screen.getByRole("button", { name: "Comparar" }));

  expect(await screen.findByText("Nenhuma diferença: 2 tabelas iguais.")).toBeInTheDocument();
  expect(screen.getByText("Nada a alterar no destino.")).toBeInTheDocument();
  await waitFor(() => expect(screen.getAllByText("Nenhuma.")).toHaveLength(2));
});
