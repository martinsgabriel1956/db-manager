import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { mockIPC } from "@tauri-apps/api/mocks";
import type { InvokeArgs } from "@tauri-apps/api/core";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { AppError, ConnectionConfig, KeychainOutcome } from "@/bindings";

type Call = { cmd: string; args: InvokeArgs | undefined };

const prodPostgres: ConnectionConfig = {
  id: "pg-1",
  name: "Postgres prod",
  engine: "postgres",
  environment: "prod",
  readOnly: true,
  timeoutSecs: 30,
  target: { kind: "network", host: "db", port: 5432, database: "app", username: "me" },
  tls: { mode: "require", caCertPath: null },
  keySeparator: null
};

/** Fake backend: keeps connections in memory, records every call. */
function fakeBackend(initial: ConnectionConfig[], overrides: Record<string, () => unknown> = {}) {
  let connections = [...initial];
  const calls: Call[] = [];
  const ok: KeychainOutcome = { keychainWarning: null };

  mockIPC((cmd, args) => {
    calls.push({ cmd, args });
    if (overrides[cmd]) {
      return overrides[cmd]();
    }
    if (cmd === "list_connections") {
      return connections;
    }
    if (cmd === "save_connection") {
      const { config } = args as { config: ConnectionConfig };
      connections = [...connections.filter(c => c.id !== config.id), config];
      return ok;
    }
    if (cmd === "delete_connection") {
      const { id } = args as { id: string };
      connections = connections.filter(c => c.id !== id);
      return ok;
    }
    throw new Error(`unexpected command ${cmd}`);
  });

  return calls;
}

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  );
}

test("lists connections with environment and read-only marker", async () => {
  fakeBackend([prodPostgres]);
  renderApp();

  const item = await screen.findByRole("button", { name: /Postgres prod/ });

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

  await waitFor(() => expect(calls.some(c => c.cmd === "save_connection")).toBe(true));
  const save = calls.find(c => c.cmd === "save_connection")!.args as {
    config: ConnectionConfig;
    secret: unknown;
  };
  expect(save.config).toMatchObject({
    name: "Local PG",
    engine: "postgres",
    target: { kind: "network", host: "localhost", port: 5432 }
  });
  expect(save.secret).toEqual({ action: "set", value: "s3cret" });
  expect(await screen.findByRole("button", { name: /Local PG/ })).toBeInTheDocument();
});

test("blocks submit and shows inline errors when the form is invalid", async () => {
  const calls = fakeBackend([]);
  const user = userEvent.setup();
  renderApp();

  await user.click(await screen.findByRole("button", { name: "Nova" }));
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  expect(screen.getByText("Informe um nome")).toBeInTheDocument();
  expect(screen.getByLabelText("Nome")).toHaveAttribute("aria-invalid", "true");
  expect(calls.some(c => c.cmd === "save_connection")).toBe(false);
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

test("selecting a prod connection marks the window and fills the form", async () => {
  fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  const { container } = renderApp();

  await user.click(await screen.findByRole("button", { name: /Postgres prod/ }));

  expect(container.firstChild).toHaveAttribute("data-environment", "prod");
  expect(screen.getByLabelText("Nome")).toHaveValue("Postgres prod");
  expect(screen.getByLabelText("Somente leitura")).toBeChecked();
});

test("editing with 'remove saved password' sends a clear secret change", async () => {
  const calls = fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderApp();

  await user.click(await screen.findByRole("button", { name: /Postgres prod/ }));
  await user.click(screen.getByLabelText("Remover senha salva"));
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  await waitFor(() => {
    const save = calls.find(c => c.cmd === "save_connection");
    expect(save?.args).toMatchObject({ secret: { action: "clear" } });
  });
});

test("delete asks for confirmation before calling the backend", async () => {
  const calls = fakeBackend([prodPostgres]);
  const user = userEvent.setup();
  renderApp();

  await user.click(await screen.findByRole("button", { name: /Postgres prod/ }));
  await user.click(screen.getByRole("button", { name: "Excluir" }));
  expect(calls.some(c => c.cmd === "delete_connection")).toBe(false);

  await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));

  await waitFor(() => expect(screen.getByText("Nenhuma conexão cadastrada.")).toBeInTheDocument());
  expect(calls.find(c => c.cmd === "delete_connection")?.args).toEqual({ id: "pg-1" });
});

test("shows the keychain warning after saving", async () => {
  fakeBackend([prodPostgres], {
    save_connection: () => ({ keychainWarning: "keychain indisponível: no secret service" })
  });
  const user = userEvent.setup();
  renderApp();

  await user.click(await screen.findByRole("button", { name: /Postgres prod/ }));
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

  await user.click(await screen.findByRole("button", { name: /Postgres prod/ }));
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("já existe uma conexão com esse nome");
});

test("shows an error when connections cannot be loaded", async () => {
  const error: AppError = { kind: "storage", message: "falha ao ler/gravar dados locais: boom" };
  fakeBackend([], { list_connections: () => Promise.reject(error) });
  renderApp();

  expect(await screen.findByRole("alert")).toHaveTextContent("boom");
});
