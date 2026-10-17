import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { ConnectionConfig, KillAction, SessionList } from "@/bindings";
import { actionLabel, duration } from "@/features/sessions/SessionsView";
import { callsTo, devPostgres, fakeBackend, localRedis, prodPostgres } from "@/test/fakeBackend";
import { renderWithClient, rowAction } from "@/test/render";

type KillArgs = { sessionId: string; action: KillAction; confirmed: boolean };

async function openSessions(connection: ConnectionConfig) {
  const user = userEvent.setup();
  renderWithClient(<App />);
  await rowAction(user, connection.name, "Sessões ativas");
  await screen.findByRole("heading", { name: "Sessões" });
  return user;
}

test("durations and action names read in the engine's words", () => {
  expect(duration(null)).toBe("—");
  expect(duration(45)).toBe("45 s");
  expect(duration(180)).toBe("3 min");
  expect(duration(7200)).toBe("2 h");
  expect(duration(3725)).toBe("1 h 2 min");
  expect(actionLabel("postgres", "cancelQuery")).toBe("Cancelar query");
  expect(actionLabel("mysql", "endSession")).toBe("Encerrar sessão");
  expect(actionLabel("mongo", "cancelQuery")).toBe("Encerrar operação");
  expect(actionLabel("redis", "endSession")).toBe("Encerrar conexão");
});

test("sessions are listed with the app's own marked, and a query is cancelled", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openSessions(devPostgres);

  const table = await screen.findByRole("table", { name: "Sessões de Postgres dev" });
  expect(within(table).getByText("UPDATE jobs SET done = true")).toBeInTheDocument();
  expect(within(table).getByText("1 h 2 min")).toBeInTheDocument();
  expect(within(table).getByText("Este app")).toBeInTheDocument();
  // the listing's own session cannot be ended from here
  expect(screen.getByRole("button", { name: "Cancelar query 101" })).toBeDisabled();
  // the query that produced the list is on the screen
  expect(screen.getByText(/Lido com/)).toHaveTextContent("FROM pg_stat_activity");

  await user.click(screen.getByRole("button", { name: "Cancelar query 202" }));

  expect(await screen.findByRole("status")).toHaveTextContent(
    "Cancelar query: comando enviado a 202"
  );
  expect(callsTo(calls, "kill_session")).toEqual([
    { connectionId: "pg-dev", sessionId: "202", action: "cancelQuery", confirmed: false }
  ]);
  // the list is read again after ending something
  await waitFor(() => expect(callsTo(calls, "list_sessions")).toHaveLength(2));
});

test("refreshing is manual until an interval is picked", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openSessions(devPostgres);
  await screen.findByRole("table");
  expect(callsTo(calls, "list_sessions")).toHaveLength(1);

  await user.click(screen.getByRole("button", { name: "Atualizar" }));
  await waitFor(() => expect(callsTo(calls, "list_sessions")).toHaveLength(2));

  const auto = screen.getByLabelText("Atualização automática");
  expect(auto).toHaveValue("0");
  await user.selectOptions(auto, "a cada 5 s");
  expect(auto).toHaveValue("5000");
});

test("on production ending a session shows the exact command before it runs", async () => {
  const prodWritable = { ...prodPostgres, readOnly: false };
  const calls = fakeBackend([prodWritable], {
    kill_session: args =>
      (args as KillArgs).confirmed
        ? { status: "done" }
        : {
            status: "needsConfirmation",
            confirmation: {
              reason: "Conexão de produção: confirme antes de encerrar",
              statements: ["SELECT pg_terminate_backend(202)"],
              destructive: false
            }
          }
  });
  const user = await openSessions(prodWritable);

  await user.click(await screen.findByRole("button", { name: "Encerrar sessão 202" }));

  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText(/SELECT pg_terminate_backend\(202\)/)).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Executar em produção" }));

  await waitFor(() =>
    expect((callsTo(calls, "kill_session") as KillArgs[]).map(args => args.confirmed)).toEqual([
      false,
      true
    ])
  );
  expect(await screen.findByRole("status")).toHaveTextContent("Encerrar sessão");
});

test("a refused kill says why", async () => {
  fakeBackend([devPostgres], {
    kill_session: () =>
      Promise.reject({ kind: "notFound", message: "não encontrado: sessão 202 (já terminou?)" })
  });
  const user = await openSessions(devPostgres);

  await user.click(await screen.findByRole("button", { name: "Encerrar sessão 202" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("sessão 202 (já terminou?)");
});

test("a read-only connection lists sessions but offers no way to end them", async () => {
  fakeBackend([prodPostgres]);
  await openSessions(prodPostgres);

  await screen.findByRole("table");
  expect(screen.queryByRole("button", { name: /Encerrar sessão|Cancelar query/ })).toBeNull();
  expect(screen.getByText(/encerrar query ou sessão está desligado/)).toBeInTheDocument();
});

test("Redis lists its clients and the slowlog, and closes a connection", async () => {
  const redisList: SessionList = {
    statement: "CLIENT LIST\nSLOWLOG GET 128",
    actions: ["endSession"],
    sessions: [
      {
        id: "7",
        user: "default",
        database: "0",
        state: "N",
        seconds: 4,
        client: "127.0.0.1:5000",
        query: "blpop",
        own: false
      }
    ],
    slowLog: [
      {
        id: "1",
        startedAt: 1_700_000_000,
        durationUs: 15000,
        command: "KEYS *",
        client: null
      }
    ]
  };
  const calls = fakeBackend([localRedis], { list_sessions: () => redisList });
  const user = await openSessions(localRedis);

  const slow = await screen.findByRole("region", { name: "Comandos lentos" });
  expect(within(slow).getByText("KEYS *")).toBeInTheDocument();
  expect(within(slow).getByText("2023-11-14 22:13:20")).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Último comando" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Cancelar/ })).toBeNull();

  await user.click(screen.getByRole("button", { name: "Encerrar conexão 7" }));
  await waitFor(() =>
    expect(callsTo(calls, "kill_session")).toEqual([
      { connectionId: "redis-1", sessionId: "7", action: "endSession", confirmed: false }
    ])
  );
});

test("a SQLite file has no sessions to list", async () => {
  const sqlite: ConnectionConfig = {
    ...devPostgres,
    id: "lite",
    name: "Arquivo local",
    engine: "sqlite",
    target: { kind: "file", path: "/tmp/app.db" }
  };
  fakeBackend([sqlite, devPostgres]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByLabelText("Ações de Arquivo local", { selector: "button" }));
  expect(await screen.findByRole("menuitem", { name: "Editar conexão" })).toBeInTheDocument();
  expect(screen.queryByRole("menuitem", { name: "Sessões ativas" })).toBeNull();
});
