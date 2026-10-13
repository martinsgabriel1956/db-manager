import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { ConnectionConfig, FindRequest, WriteRequest } from "@/bindings";
import { invalidQueryFields } from "@/features/mongo/DocumentsPanel";
import { callsTo, devMongo, fakeBackend } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

type BrowseArgs = { connectionId: string; request: FindRequest };
type WriteArgs = { connectionId: string; request: WriteRequest; confirmed: boolean };

const schemas = [
  { name: "analytics", relations: [{ name: "events", kind: "table" }] },
  {
    name: "shop",
    relations: [
      { name: "customers", kind: "table" },
      { name: "vip", kind: "view" }
    ]
  }
];

async function openCustomers(connection: ConnectionConfig = devMongo) {
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(
    await screen.findByRole("treeitem", { name: new RegExp(`^${connection.name}`) })
  );
  await user.click(await screen.findByRole("treeitem", { name: "customers" }));
  await screen.findByText('ObjectId("65a1b2c3d4e5f60718293a4b")');
  return user;
}

function editorIn(container: HTMLElement): EditorView {
  return EditorView.findFromDOM(container.querySelector(".cm-content") as HTMLElement)!;
}

function lastBrowse(calls: ReturnType<typeof fakeBackend>) {
  const browses = callsTo(calls, "browse_collection") as BrowseArgs[];
  return browses[browses.length - 1].request;
}

test("query fields must be JSON or empty", () => {
  expect(invalidQueryFields({ filter: "", sort: "  ", projection: '{"a": 1}' })).toEqual([]);
  expect(invalidQueryFields({ filter: "{a: 1}", sort: "", projection: "[" })).toEqual([
    "filter",
    "projection"
  ]);
});

test("MongoDB opens databases and collections without a SQL editor", async () => {
  fakeBackend([devMongo], { list_schemas: () => schemas });
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("treeitem", { name: /^Mongo dev/ }));

  // the connection's database opens by default
  expect(await screen.findByRole("treeitem", { name: "customers" })).toBeInTheDocument();
  expect(screen.queryByRole("treeitem", { name: "events" })).not.toBeInTheDocument();
  expect(screen.queryByRole("treeitem", { name: /^Nova query SQL/ })).not.toBeInTheDocument();
});

test("documents show typed values, switch to JSON, filter and page", async () => {
  const calls = fakeBackend([devMongo], { list_schemas: () => schemas });
  const user = await openCustomers();

  expect(screen.getByRole("heading", { name: "shop.customers" })).toBeInTheDocument();
  expect(screen.getByText("NumberLong(9007199254740993)")).toBeInTheDocument();
  expect(lastBrowse(calls)).toEqual({
    database: "shop",
    collection: "customers",
    filter: "",
    sort: "",
    projection: "",
    page: 0,
    pageSize: 20
  });

  await user.click(screen.getByRole("button", { name: "JSON" }));
  expect(screen.getByText(/"\$numberLong": "9007199254740993"/)).toBeInTheDocument();

  await user.type(screen.getByLabelText("Filtro"), '{{"name": "Ana"}');
  await user.type(screen.getByLabelText("Ordenação"), '{{"_id": -1}');
  await user.click(screen.getByRole("button", { name: "Aplicar" }));
  await waitFor(() =>
    expect(lastBrowse(calls)).toMatchObject({ filter: '{"name": "Ana"}', sort: '{"_id": -1}' })
  );

  await user.click(screen.getByRole("button", { name: "Próxima página" }));
  await waitFor(() => expect(lastBrowse(calls).page).toBe(1));
});

test("an invalid filter is caught before reaching the server", async () => {
  const calls = fakeBackend([devMongo], { list_schemas: () => schemas });
  const user = await openCustomers();
  const before = callsTo(calls, "browse_collection").length;

  await user.type(screen.getByLabelText("Filtro"), "{{name: 1}");

  expect(screen.getByText("JSON inválido em: Filtro")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Aplicar" })).toBeDisabled();
  expect(callsTo(calls, "browse_collection")).toHaveLength(before);
});

test("editing replaces the document by _id with the edited Extended JSON", async () => {
  const calls = fakeBackend([devMongo], { list_schemas: () => schemas });
  const user = await openCustomers();

  await user.click(screen.getAllByRole("button", { name: "Editar documento" })[0]);
  const dialog = screen.getByRole("dialog");
  const view = editorIn(dialog);
  const text = view.state.doc.toString();
  expect(text).toContain('"$numberLong": "9007199254740993"');
  act(() =>
    view.dispatch({
      changes: { from: 0, to: text.length, insert: text.replace('"Ana"', '"Ana Paula"') }
    })
  );
  await user.click(within(dialog).getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  const write = (callsTo(calls, "write_document") as WriteArgs[])[0];
  expect(write.request).toMatchObject({
    database: "shop",
    collection: "customers",
    write: { kind: "replace", id: '{"$oid":"65a1b2c3d4e5f60718293a4b"}' }
  });
  const sent = (write.request.write as { document: string }).document;
  expect(sent).toContain('"name": "Ana Paula"');
  expect(sent).toContain('"$numberLong": "9007199254740993"');
});

test("invalid JSON in the editor is not sent", async () => {
  const calls = fakeBackend([devMongo], { list_schemas: () => schemas });
  const user = await openCustomers();

  await user.click(screen.getByRole("button", { name: "Novo documento" }));
  const dialog = screen.getByRole("dialog");
  act(() => editorIn(dialog).dispatch({ changes: { from: 0, insert: "nope " } }));
  await user.click(within(dialog).getByRole("button", { name: "Salvar" }));

  expect(within(dialog).getByRole("alert")).toHaveTextContent("JSON inválido");
  expect(callsTo(calls, "write_document")).toHaveLength(0);
});

test("backend errors stay in the editor so the edit is not lost", async () => {
  fakeBackend([devMongo], {
    list_schemas: () => schemas,
    write_document: () =>
      Promise.reject({ kind: "validation", message: "o _id de um documento não pode mudar" })
  });
  const user = await openCustomers();

  await user.click(screen.getAllByRole("button", { name: "Editar documento" })[0]);
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Salvar" }));

  expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveTextContent(
    "não pode mudar"
  );
});

test("delete asks first; on prod the statement is confirmed", async () => {
  const prodMongo = { ...devMongo, environment: "prod" as const };
  const calls = fakeBackend([prodMongo], {
    list_schemas: () => schemas,
    write_document: args =>
      (args as WriteArgs).confirmed
        ? { status: "written", id: '{"$oid":"65a1b2c3d4e5f60718293a4c"}' }
        : {
            status: "needsConfirmation",
            confirmation: {
              reason: "Conexão de produção: confirme antes de escrever",
              statements: ['shop.customers.deleteOne({"_id": {"$oid":"65a1b2c3d4e5f60718293a4c"}})']
            }
          }
  });
  const user = await openCustomers(prodMongo);

  await user.click(screen.getAllByRole("button", { name: "Excluir documento" })[1]);
  expect(
    screen.getByText('deleteOne({"_id": {"$oid":"65a1b2c3d4e5f60718293a4c"}})')
  ).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("deleteOne");
  await user.click(screen.getByRole("button", { name: "Executar em produção" }));

  await waitFor(() => expect(callsTo(calls, "write_document")).toHaveLength(2));
  const writes = callsTo(calls, "write_document") as WriteArgs[];
  expect(writes.map(w => w.confirmed)).toEqual([false, true]);
  expect(writes[1].request.write).toEqual({
    kind: "delete",
    id: '{"$oid":"65a1b2c3d4e5f60718293a4c"}'
  });
});

test("read-only connections cannot write documents", async () => {
  fakeBackend([{ ...devMongo, readOnly: true }], { list_schemas: () => schemas });
  await openCustomers();

  expect(screen.getByText("Somente leitura")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Novo documento" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Editar documento" })).not.toBeInTheDocument();
});

test("aggregations run, confirm $out and can be cancelled", async () => {
  let release: (value: unknown) => void = () => undefined;
  const calls = fakeBackend([devMongo], {
    list_schemas: () => schemas,
    run_aggregation: args => {
      const { pipeline, confirmed } = args as { pipeline: string; confirmed: boolean };
      if (pipeline.includes("$out") && !confirmed) {
        return {
          status: "needsConfirmation",
          confirmation: {
            reason: "Comando destrutivo: $out substitui a coleção de destino",
            statements: [`shop.customers.aggregate(${pipeline})`]
          }
        };
      }
      if (pipeline.includes("slow")) {
        return new Promise(resolve => {
          release = resolve;
        });
      }
      return {
        status: "executed",
        outcome: { documents: ['{"_id":"even","total":110}'], truncated: true, durationMs: 4 }
      };
    }
  });
  const user = await openCustomers();
  await user.click(screen.getByRole("tab", { name: "Agregação" }));
  const panel = screen.getByLabelText("Pipeline").closest("div.flex.h-full") as HTMLElement;
  const setPipeline = (text: string) => {
    const view = editorIn(panel);
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }));
  };

  await user.click(within(panel).getByRole("button", { name: "Executar" }));
  expect(await within(panel).findByRole("status")).toHaveTextContent(
    "1+ documentos (mostrando os primeiros) · 4 ms"
  );
  expect(within(panel).getByText('"even"')).toBeInTheDocument();

  setPipeline('[{"$out": "copy"}]');
  await user.click(within(panel).getByRole("button", { name: "Executar" }));
  expect(await screen.findByRole("dialog")).toHaveTextContent("$out substitui a coleção");
  await user.click(screen.getByRole("button", { name: "Executar mesmo assim" }));
  await waitFor(() =>
    expect(
      (callsTo(calls, "run_aggregation") as { confirmed: boolean }[]).map(c => c.confirmed)
    ).toEqual([false, false, true])
  );

  setPipeline('[{"$match": {"slow": true}}]');
  await user.click(within(panel).getByRole("button", { name: "Executar" }));
  await user.click(await within(panel).findByRole("button", { name: "Cancelar" }));
  const runId = (callsTo(calls, "run_aggregation").at(-1) as { runId: string }).runId;
  expect(callsTo(calls, "cancel_run")).toEqual([{ runId }]);
  act(() =>
    release({ status: "executed", outcome: { documents: [], truncated: false, durationMs: 1 } })
  );
});

test("indexes are listed", async () => {
  fakeBackend([devMongo], { list_schemas: () => schemas });
  const user = await openCustomers();

  await user.click(screen.getByRole("tab", { name: "Índices" }));

  expect(await screen.findByText("_id_")).toBeInTheDocument();
  expect(screen.getByText('{"_id":1}')).toBeInTheDocument();
});

test("an applied filter lights the magenta chip with the query; edits not yet applied promote Aplicar", async () => {
  const calls = fakeBackend([devMongo], { list_schemas: () => schemas });
  const user = await openCustomers();
  expect(screen.queryByRole("button", { name: "Limpar consulta" })).not.toBeInTheDocument();

  await user.type(screen.getByRole("textbox", { name: "Filtro" }), '{{"name": "Ana"}');
  expect(screen.getByRole("button", { name: "Aplicar" })).toHaveAttribute(
    "data-variant",
    "default"
  );
  await user.click(screen.getByRole("button", { name: "Aplicar" }));
  expect(await screen.findByText('{"name": "Ana"}')).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Aplicar" })).toHaveAttribute(
    "data-variant",
    "outline"
  );

  await user.click(screen.getByRole("button", { name: "Limpar consulta" }));
  expect(screen.queryByText('{"name": "Ana"}')).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Filtro" })).toHaveValue("");
  await waitFor(() => expect(lastBrowse(calls).filter).toBe(""));
});
