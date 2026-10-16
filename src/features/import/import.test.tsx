import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { CsvImport, DocumentImport, ImportResponse } from "@/bindings";
import { initialMapping } from "@/features/import/ImportCsvButton";
import { callsTo, devMongo, devPostgres, fakeBackend, prodPostgres } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

type ImportArgs = { connectionId: string; runId: string; request: CsvImport; confirmed: boolean };

async function openUsers(name = /^Postgres dev/) {
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(await screen.findByRole("treeitem", { name }));
  await user.click(await screen.findByRole("treeitem", { name: "users" }));
  await screen.findByRole("button", { name: /Exportar CSV/ });
  return user;
}

test("file columns map to table columns by name, ignoring case", () => {
  expect(initialMapping(["ID", "name", " Profile ", "extra"], ["id", "profile", "name"])).toEqual([
    "id",
    "name",
    "profile",
    ""
  ]);
});

test("a CSV is previewed, mapped, reviewed with its INSERT and imported", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openUsers();

  await user.click(await screen.findByRole("button", { name: /Importar CSV/ }));
  const dialog = await screen.findByRole("dialog", { name: "Importar users.csv" });
  expect(dialog).toHaveTextContent("Separador: ponto e vírgula");
  // the preview shows NULL as the marker, not as text
  const preview = within(dialog).getByRole("region", { name: "Primeiras linhas do arquivo" });
  expect(within(preview).getByText("NULL")).toHaveClass("italic");
  expect(within(dialog).getByLabelText("Destino de ID")).toHaveValue("id");
  await user.selectOptions(within(dialog).getByLabelText("Destino de perfil"), "");
  await user.click(within(dialog).getByRole("button", { name: "Revisar importação" }));

  const confirm = await screen.findByRole("alertdialog");
  expect(confirm).toHaveTextContent("Importar 1200 linhas");
  expect(
    within(confirm).getByRole("region", { name: "Comando que será executado" })
  ).toHaveTextContent('INSERT INTO "public"."users"');
  await user.click(within(confirm).getByRole("button", { name: "Importar" }));

  expect(await screen.findByText("1.200 linhas importadas")).toBeInTheDocument();
  const [review, run] = callsTo(calls, "import_csv") as ImportArgs[];
  expect(review).toMatchObject({
    confirmed: false,
    request: {
      schema: "public",
      table: "users",
      path: "/tmp/users.csv",
      mapping: [{ source: 0, column: "id" }]
    }
  });
  expect(run).toMatchObject({ confirmed: true, request: review.request });
  // the grid reloads
  await waitFor(() => expect(callsTo(calls, "browse_table").length).toBeGreaterThan(1));
});

test("a refused file keeps the mapping open with the line that is wrong", async () => {
  fakeBackend([devPostgres], {
    import_csv: () =>
      Promise.reject({ kind: "validation", message: "linha 3: 1 campos, mas o cabeçalho tem 2" })
  });
  const user = await openUsers();

  await user.click(await screen.findByRole("button", { name: /Importar CSV/ }));
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "Revisar importação" }));

  expect(await within(dialog).findByRole("alert")).toHaveTextContent("linha 3");
});

test("closing the file dialog imports nothing", async () => {
  const calls = fakeBackend([devPostgres], { "plugin:dialog|open": () => null });
  const user = await openUsers();

  await user.click(await screen.findByRole("button", { name: /Importar CSV/ }));
  await waitFor(() => expect(callsTo(calls, "plugin:dialog|open")).toHaveLength(1));
  expect(callsTo(calls, "preview_csv")).toHaveLength(0);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("a running import can be cancelled; nothing was written", async () => {
  let fail: (reason: unknown) => void = () => undefined;
  const calls = fakeBackend([devPostgres], {
    import_csv: args =>
      (args as ImportArgs).confirmed
        ? new Promise<ImportResponse>((_, reject) => {
            fail = reject;
          })
        : {
            status: "needsConfirmation",
            confirmation: { reason: "Importar", statements: ["INSERT"], destructive: false }
          },
    cancel_run: () => {
      fail({ kind: "cancelled", message: "importação cancelada: nada foi gravado" });
      return null;
    }
  });
  const user = await openUsers();

  await user.click(await screen.findByRole("button", { name: /Importar CSV/ }));
  await user.selectOptions(await screen.findByLabelText("Destino de perfil"), "");
  await user.click(screen.getByRole("button", { name: "Revisar importação" }));
  await user.click(
    within(await screen.findByRole("alertdialog")).getByRole("button", { name: "Importar" })
  );
  await user.click(await screen.findByRole("button", { name: "Cancelar importação" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("nada foi gravado");
  const run = (callsTo(calls, "import_csv") as ImportArgs[])[1];
  expect(callsTo(calls, "cancel_run")).toEqual([{ runId: run.runId }]);
});

test("production confirms under its own label", async () => {
  fakeBackend([{ ...prodPostgres, readOnly: false }]);
  const user = await openUsers(/^Postgres prod/);
  await user.click(await screen.findByRole("button", { name: /Importar CSV/ }));
  await user.click(await screen.findByRole("button", { name: "Revisar importação" }));
  const confirm = await screen.findByRole("alertdialog");
  expect(within(confirm).getByRole("button", { name: "Executar em produção" })).toBeInTheDocument();
});

test("a somente leitura connection shows no import", async () => {
  fakeBackend([prodPostgres]);
  await openUsers(/^Postgres prod/);
  expect(screen.queryByRole("button", { name: /Importar CSV/ })).not.toBeInTheDocument();
});

type DocumentImportArgs = {
  connectionId: string;
  runId: string;
  request: DocumentImport;
  confirmed: boolean;
};

async function openCustomers(
  connection = devMongo,
  overrides: Parameters<typeof fakeBackend>[1] = {}
) {
  const calls = fakeBackend([connection], {
    list_schemas: () => [{ name: "shop", relations: [{ name: "customers", kind: "table" }] }],
    "plugin:dialog|open": () => "/tmp/customers.ndjson",
    ...overrides
  });
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(await screen.findByRole("treeitem", { name: /^Mongo dev/ }));
  await user.click(await screen.findByRole("treeitem", { name: "customers" }));
  return { calls, user };
}

test("documents are reviewed with the first one as stored, then inserted", async () => {
  const { calls, user } = await openCustomers();

  await user.click(await screen.findByRole("button", { name: /^Importar$/ }));
  const confirm = await screen.findByRole("alertdialog");
  expect(confirm).toHaveTextContent("Importar 2 documentos");
  expect(
    within(confirm).getByRole("region", { name: "Comando que será executado" })
  ).toHaveTextContent('"$numberLong":"9007199254740993"');
  await user.click(within(confirm).getByRole("button", { name: "Importar" }));

  expect(await screen.findByText("2 documentos importados")).toBeInTheDocument();
  const [review, run] = callsTo(calls, "import_documents") as DocumentImportArgs[];
  expect(review).toMatchObject({
    connectionId: "mongo-1",
    confirmed: false,
    request: { database: "shop", collection: "customers", path: "/tmp/customers.ndjson" }
  });
  expect(run).toMatchObject({ confirmed: true, request: review.request });
  await waitFor(() => expect(callsTo(calls, "browse_collection").length).toBeGreaterThan(1));
});

test("a refused file says which line, and nothing runs", async () => {
  const { user } = await openCustomers(devMongo, {
    import_documents: () =>
      Promise.reject({ kind: "validation", message: "linha 3: JSON inválido" })
  });

  await user.click(await screen.findByRole("button", { name: /^Importar$/ }));

  expect(await screen.findByRole("alert")).toHaveTextContent("linha 3: JSON inválido");
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});

test("a somente leitura collection shows no import", async () => {
  await openCustomers({ ...devMongo, readOnly: true });
  await screen.findByRole("button", { name: /Exportar/ });
  expect(screen.queryByRole("button", { name: /^Importar$/ })).not.toBeInTheDocument();
});
