import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { AppError, ConnectionConfig } from "@/bindings";
import { callsTo, fakeBackend, prodPostgres } from "@/test/fakeBackend";
import { renderWithClient, rowAction } from "@/test/render";

function renderApp() {
  return renderWithClient(<App />);
}

async function editConnection(user: ReturnType<typeof userEvent.setup>, name: string) {
  await rowAction(user, name, "Editar conexão");
}

test("lists connections with engine and read-only marker", async () => {
  fakeBackend([prodPostgres]);
  renderApp();

  const item = await screen.findByRole("treeitem", { name: /^Postgres prod/ });

  expect(item).toHaveTextContent("PostgreSQL");
  expect(item).toHaveTextContent("somente leitura");
  // prod is named in words, not only by the dot's color
  expect(item).toHaveTextContent("Prod");
});

test("Ctrl+B collapses and expands the sidebar", async () => {
  fakeBackend([]);
  const user = userEvent.setup();
  renderApp();

  await screen.findByText("Nenhuma conexão cadastrada.");
  await user.keyboard("{Control>}b{/Control}");
  expect(screen.getByRole("button", { name: "Expandir lateral" })).toHaveAttribute(
    "aria-expanded",
    "false"
  );

  // collapsed, the brand is the mark; expanded, the full name
  expect(screen.getByRole("img", { name: "Ordo" })).toBeInTheDocument();
  expect(screen.queryByText("Ordo")).not.toBeInTheDocument();

  // collapsed, the tools are still there as named icons, and F6 lands on the first
  expect(screen.getByRole("button", { name: "Histórico" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Legenda" })).toBeInTheDocument();
  await user.keyboard("{F6}");
  expect(screen.getByRole("button", { name: "Ir para tabela… (Ctrl K)" })).toHaveFocus();

  await user.keyboard("{Control>}b{/Control}");
  expect(screen.getByRole("button", { name: "Recolher lateral" })).toBeInTheDocument();
  expect(screen.queryByRole("img", { name: "Ordo" })).not.toBeInTheDocument();
  expect(screen.getByText("Ordo")).toBeInTheDocument();
});

test("shows an empty state when there are no connections, with a way to create one", async () => {
  fakeBackend([]);
  const user = userEvent.setup();
  renderApp();

  expect(await screen.findByText("Nenhuma conexão cadastrada.")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Comece por uma conexão" })).toBeInTheDocument();
  await user.click(screen.getAllByRole("button", { name: "Nova conexão" })[0]);
  expect(screen.getByRole("heading", { name: "Nova conexão" })).toBeInTheDocument();

  // Cancelar leaves the form without saving
  await user.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.queryByRole("heading", { name: "Nova conexão" })).not.toBeInTheDocument();
});

test("cancelling a form with typed values asks once before dropping them", async () => {
  fakeBackend([]);
  const user = userEvent.setup();
  renderApp();

  await user.click((await screen.findAllByRole("button", { name: "Nova conexão" }))[0]);
  await user.type(screen.getByLabelText("Nome"), "Local PG");
  await user.click(screen.getByRole("button", { name: "Cancelar" }));
  expect(screen.getByRole("heading", { name: "Nova conexão" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Descartar o que foi digitado" }));
  expect(screen.queryByRole("heading", { name: "Nova conexão" })).not.toBeInTheDocument();
});

test("Testar conexão tries the typed draft without saving it, and a later edit retires the result", async () => {
  const calls = fakeBackend([], {
    test_connection: () => {
      throw { kind: "database", message: "password authentication failed" } satisfies AppError;
    }
  });
  const user = userEvent.setup();
  renderApp();

  await user.click((await screen.findAllByRole("button", { name: "Nova conexão" }))[0]);
  // the engine reshapes the form, so it comes first; prod says what it changes where it is chosen
  const fields = screen.getAllByRole("combobox").map(field => field.getAttribute("id"));
  expect(fields[0]).toBe("engine");
  await user.selectOptions(screen.getByLabelText("Ambiente"), "prod");
  expect(screen.getByLabelText("Ambiente")).toHaveAccessibleDescription(
    /toda escrita mostra o comando exato/
  );
  await user.type(screen.getByLabelText("Senha"), "wrong");
  // no name yet: it never reaches the database, so the draft can still be tested
  await user.click(screen.getByRole("button", { name: "Testar conexão" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Não conectou: password authentication failed"
  );
  const tested = callsTo(calls, "test_connection")[0] as {
    config: ConnectionConfig;
    secret: unknown;
  };
  expect(tested.config).toMatchObject({ engine: "postgres", environment: "prod" });
  expect(tested.secret).toEqual({ action: "set", value: "wrong" });
  expect(callsTo(calls, "save_connection")).toHaveLength(0);

  await user.type(screen.getByLabelText("Senha"), "!");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("creates a connection and sends the password as a secret change", async () => {
  const calls = fakeBackend([]);
  const user = userEvent.setup();
  renderApp();

  await user.click((await screen.findAllByRole("button", { name: "Nova conexão" }))[0]);
  await user.type(screen.getByLabelText("Nome"), "Local PG");
  await user.type(screen.getByLabelText("Senha"), "s3cret");
  // no environment yet: saving asks for one instead of defaulting to Local
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  expect(screen.getByLabelText("Ambiente")).toHaveAttribute("aria-invalid", "true");
  expect(callsTo(calls, "save_connection")).toHaveLength(0);
  await user.selectOptions(screen.getByLabelText("Ambiente"), "local");
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(callsTo(calls, "save_connection")).toHaveLength(1));
  const save = callsTo(calls, "save_connection")[0] as {
    config: ConnectionConfig;
    secret: unknown;
  };
  expect(save.config).toMatchObject({
    name: "Local PG",
    engine: "postgres",
    target: { kind: "network", host: "localhost", port: 5432 }
  });
  expect(save.secret).toEqual({ action: "set", value: "s3cret" });
  expect(await screen.findByRole("treeitem", { name: /^Local PG/ })).toBeInTheDocument();
});

test("blocks submit and shows inline errors when the form is invalid", async () => {
  const calls = fakeBackend([]);
  const user = userEvent.setup();
  renderApp();

  await user.click((await screen.findAllByRole("button", { name: "Nova conexão" }))[0]);
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  expect(screen.getByText("Informe um nome")).toBeInTheDocument();
  expect(screen.getByLabelText("Nome")).toHaveAttribute("aria-invalid", "true");
  expect(callsTo(calls, "save_connection")).toHaveLength(0);
});

test("switching to sqlite swaps network fields for a file path", async () => {
  fakeBackend([]);
  const user = userEvent.setup();
  renderApp();

  await user.click((await screen.findAllByRole("button", { name: "Nova conexão" }))[0]);
  await user.selectOptions(screen.getByLabelText("Tipo de banco"), "sqlite");

  expect(screen.getByLabelText("Arquivo")).toBeInTheDocument();
  expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("TLS")).not.toBeInTheDocument();
});

test("redis shows the key separator field", async () => {
  fakeBackend([]);
  const user = userEvent.setup();
  renderApp();

  await user.click((await screen.findAllByRole("button", { name: "Nova conexão" }))[0]);
  await user.selectOptions(screen.getByLabelText("Tipo de banco"), "redis");

  expect(screen.getByLabelText("Separador de chaves")).toHaveValue(":");
  expect(screen.getByLabelText("Porta")).toHaveValue(6379);
});

test("editing a prod connection marks the window and fills the form", async () => {
  fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  const { container } = renderApp();

  await editConnection(user, "Postgres prod");

  expect(container.firstChild).toHaveAttribute("data-environment", "prod");
  expect(screen.getByLabelText("Nome")).toHaveValue("Postgres prod");
  expect(screen.getByLabelText("Somente leitura")).toBeChecked();
});

test("editing with 'remove saved password' sends a clear secret change", async () => {
  const calls = fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderApp();

  await editConnection(user, "Postgres prod");
  await user.click(screen.getByLabelText("Remover senha salva"));
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  await waitFor(() =>
    expect(callsTo(calls, "save_connection")[0]).toMatchObject({ secret: { action: "clear" } })
  );
});

test("delete asks for confirmation before calling the backend", async () => {
  const calls = fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderApp();

  await editConnection(user, "Postgres prod");
  await user.click(screen.getByRole("button", { name: "Excluir" }));
  expect(callsTo(calls, "delete_connection")).toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

  await waitFor(() => expect(screen.getByText("Nenhuma conexão cadastrada.")).toBeInTheDocument());
  expect(callsTo(calls, "delete_connection")).toEqual([{ id: "pg-1" }]);
});

test("shows the keychain warning after saving", async () => {
  fakeBackend([prodPostgres], {
    save_connection: () => ({ keychainWarning: "keychain indisponível: no secret service" })
  });
  const user = userEvent.setup();
  renderApp();

  await editConnection(user, "Postgres prod");
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Conexão salva, mas a senha não foi guardada: keychain indisponível: no secret service"
  );
});

test("shows the backend validation error", async () => {
  const error: AppError = { kind: "validation", message: "já existe uma conexão com esse nome" };
  fakeBackend([prodPostgres], { save_connection: () => Promise.reject(error) });
  const user = userEvent.setup();
  renderApp();

  await editConnection(user, "Postgres prod");
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("já existe uma conexão com esse nome");
});

test("shows an error when connections cannot be loaded", async () => {
  const error: AppError = { kind: "storage", message: "falha ao ler/gravar dados locais: boom" };
  fakeBackend([], { list_connections: () => Promise.reject(error) });
  renderApp();

  expect(await screen.findByRole("alert")).toHaveTextContent("boom");
});

test("saving a connection drops its cached session data", async () => {
  const calls = fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderApp();

  await user.click(await screen.findByRole("treeitem", { name: /^Postgres prod/ }));
  expect(await screen.findByRole("treeitem", { name: "users" })).toBeInTheDocument();
  await editConnection(user, "Postgres prod");
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  // the tree stays expanded and refetches: the backend closed the old session
  await waitFor(() => expect(callsTo(calls, "list_schemas")).toHaveLength(2));
});

test("a MongoDB connection can be saved with a connection string", async () => {
  const calls = fakeBackend([]);
  const user = userEvent.setup();
  renderApp();

  await user.click((await screen.findAllByRole("button", { name: "Nova conexão" }))[0]);
  await user.type(screen.getByLabelText("Nome"), "Atlas");
  await user.selectOptions(screen.getByLabelText("Ambiente"), "dev");
  await user.selectOptions(screen.getByLabelText("Tipo de banco"), "mongo");
  await user.click(screen.getByLabelText("URI de conexão"));
  expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
  await user.type(screen.getByRole("textbox", { name: /Banco padrão/ }), "shop");
  await user.type(
    screen.getByLabelText("URI de conexão", { selector: "input#uri" }),
    "mongodb+srv://me:pw@c.example.net/"
  );
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  await waitFor(() => expect(callsTo(calls, "save_connection")).toHaveLength(1));
  expect(callsTo(calls, "save_connection")[0]).toMatchObject({
    config: { engine: "mongo", target: { kind: "uri", database: "shop" } },
    secret: { action: "set", value: "mongodb+srv://me:pw@c.example.net/" }
  });
});

test("the window's X says once that Ordo stays in the tray, then hides at once", async () => {
  localStorage.removeItem("tray-notice-seen");
  const calls = fakeBackend([]);
  const user = userEvent.setup();
  renderApp();
  await screen.findByText("Nenhuma conexão cadastrada.");

  await emit("close-requested");
  const dialog = await screen.findByRole("dialog", { name: "O Ordo continua na bandeja" });
  expect(dialog).toHaveTextContent("conexões de produção são encerradas");
  // hiding is the default: Enter on the focused button
  expect(screen.getByRole("button", { name: "Esconder na bandeja" })).toHaveFocus();
  await user.keyboard("{Enter}");
  await waitFor(() => expect(callsTo(calls, "hide_window")).toHaveLength(1));

  await emit("close-requested");
  await waitFor(() => expect(callsTo(calls, "hide_window")).toHaveLength(2));
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  localStorage.removeItem("tray-notice-seen");
});

test("the tray notice can quit instead of hiding", async () => {
  localStorage.removeItem("tray-notice-seen");
  const calls = fakeBackend([]);
  const user = userEvent.setup();
  renderApp();
  await screen.findByText("Nenhuma conexão cadastrada.");

  await emit("close-requested");
  await user.click(await screen.findByRole("button", { name: "Sair do Ordo" }));
  await waitFor(() => expect(callsTo(calls, "quit_app")).toHaveLength(1));
  expect(callsTo(calls, "hide_window")).toHaveLength(0);
  localStorage.removeItem("tray-notice-seen");
});

test("Ctrl+Q quits at once when nothing is staged", async () => {
  const calls = fakeBackend([]);
  const user = userEvent.setup();
  renderApp();

  await screen.findByText("Nenhuma conexão cadastrada.");
  await user.keyboard("{Control>}q{/Control}");
  await waitFor(() => expect(callsTo(calls, "quit_app")).toHaveLength(1));
});
