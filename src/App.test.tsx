import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { AppError, ConnectionConfig } from "@/bindings";
import { callsTo, fakeBackend, localRedis, prodPostgres } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

function renderApp() {
  return renderWithClient(<App />);
}

async function editConnection(user: ReturnType<typeof userEvent.setup>, name: string) {
  await user.click(await screen.findByRole("button", { name: `Editar ${name}` }));
}

test("lists connections with engine and read-only marker", async () => {
  fakeBackend([prodPostgres]);
  renderApp();

  const item = await screen.findByRole("button", { name: /^Postgres prod/ });

  expect(item).toHaveTextContent("PostgreSQL");
  expect(item).toHaveTextContent("RO");
});

test("shows an empty state when there are no connections", async () => {
  fakeBackend([]);
  renderApp();

  expect(await screen.findByText("Nenhuma conexão cadastrada.")).toBeInTheDocument();
});

test("creates a connection and sends the password as a secret change", async () => {
  const calls = fakeBackend([]);
  const user = userEvent.setup();
  renderApp();

  await user.click(await screen.findByRole("button", { name: "Nova" }));
  await user.type(screen.getByLabelText("Nome"), "Local PG");
  await user.type(screen.getByLabelText("Senha"), "s3cret");
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
  expect(await screen.findByRole("button", { name: /^Local PG/ })).toBeInTheDocument();
});

test("blocks submit and shows inline errors when the form is invalid", async () => {
  const calls = fakeBackend([]);
  const user = userEvent.setup();
  renderApp();

  await user.click(await screen.findByRole("button", { name: "Nova" }));
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  expect(screen.getByText("Informe um nome")).toBeInTheDocument();
  expect(screen.getByLabelText("Nome")).toHaveAttribute("aria-invalid", "true");
  expect(callsTo(calls, "save_connection")).toHaveLength(0);
});

test("switching to sqlite swaps network fields for a file path", async () => {
  fakeBackend([]);
  const user = userEvent.setup();
  renderApp();

  await user.click(await screen.findByRole("button", { name: "Nova" }));
  await user.selectOptions(screen.getByLabelText("Banco"), "sqlite");

  expect(screen.getByLabelText("Arquivo")).toBeInTheDocument();
  expect(screen.queryByLabelText("Host")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("TLS")).not.toBeInTheDocument();
});

test("redis shows the key separator field", async () => {
  fakeBackend([]);
  const user = userEvent.setup();
  renderApp();

  await user.click(await screen.findByRole("button", { name: "Nova" }));
  await user.selectOptions(screen.getByLabelText("Banco"), "redis");

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

  await user.click(await screen.findByRole("button", { name: /^Postgres prod/ }));
  expect(await screen.findByRole("button", { name: "users" })).toBeInTheDocument();
  await editConnection(user, "Postgres prod");
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  // the tree stays expanded and refetches: the backend closed the old session
  await waitFor(() => expect(callsTo(calls, "list_schemas")).toHaveLength(2));
});

test("non-postgres engines say navigation comes later", async () => {
  fakeBackend([localRedis]);
  const user = userEvent.setup();
  renderApp();

  await user.click(await screen.findByRole("button", { name: /^Cache/ }));

  expect(screen.getByText(/Navegação para Redis chega em um próximo marco/)).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Abrir editor SQL de Cache" })
  ).not.toBeInTheDocument();
});
