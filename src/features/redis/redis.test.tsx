import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { ConnectionConfig, KeyEditRequest } from "@/bindings";
import { callsTo, fakeBackend, localRedis } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

type EditArgs = { connectionId: string; request: KeyEditRequest; confirmed: boolean };
type CommandArgs = { db: number; command: string; confirmed: boolean };

async function openDb0(connection: ConnectionConfig = localRedis) {
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(await screen.findByRole("button", { name: new RegExp(`^${connection.name}`) }));
  await user.click(await screen.findByRole("button", { name: /^db0/ }));
  await screen.findByRole("list", { name: "Chaves" });
  return user;
}

function edits(calls: ReturnType<typeof fakeBackend>) {
  return callsTo(calls, "edit_key") as EditArgs[];
}

test("Redis lists databases and opens one in a tab, keys grouped by separator", async () => {
  fakeBackend([localRedis]);
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("button", { name: /^Cache/ }));
  const db0 = await screen.findByRole("button", { name: /^db0/ });
  expect(db0).toHaveTextContent("4");
  expect(screen.getByRole("button", { name: /^db1/ })).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Abrir editor SQL de Cache" })
  ).not.toBeInTheDocument();

  await user.click(db0);

  expect(await screen.findByRole("tab", { name: "Cache · db0" })).toBeInTheDocument();
  const tree = await screen.findByRole("list", { name: "Chaves" });
  expect(within(tree).getByRole("button", { name: /user/ })).toHaveTextContent("2");
  expect(within(tree).queryByText("1")).not.toBeInTheDocument();
  await user.click(within(tree).getByRole("button", { name: /user/ }));
  expect(within(tree).getByRole("button", { name: /hash\s*1/ })).toBeInTheDocument();
  expect(screen.getByText("4 chaves")).toBeInTheDocument();
});

test("searching uses SCAN MATCH and pages continue from the cursor", async () => {
  const calls = fakeBackend([localRedis], {
    scan_keys: args => {
      const { cursor } = args as { cursor: string };
      return cursor === "0"
        ? { keys: [{ name: "a", kind: "string" }], cursor: "42" }
        : { keys: [{ name: "b", kind: "string" }], cursor: "0" };
    }
  });
  const user = await openDb0();

  expect(screen.getByText(/busca incompleta/)).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Carregar mais" }));
  await screen.findByText("2 chaves");
  expect(screen.queryByRole("button", { name: "Carregar mais" })).not.toBeInTheDocument();

  await user.type(screen.getByLabelText("Padrão de chaves"), "user:*");
  await user.click(screen.getByRole("button", { name: "Buscar" }));

  await waitFor(() =>
    expect(callsTo(calls, "scan_keys")).toContainEqual({
      connectionId: "redis-1",
      db: 0,
      pattern: "user:*",
      cursor: "0"
    })
  );
  expect(callsTo(calls, "scan_keys")).toContainEqual(expect.objectContaining({ cursor: "42" }));
});

test("hash entries are edited, added and removed", async () => {
  const calls = fakeBackend([localRedis]);
  const user = await openDb0();
  await user.click(screen.getByRole("button", { name: /user/ }));
  await user.click(screen.getByRole("button", { name: /hash\s*1/ }));

  expect(await screen.findByText("São Paulo")).toBeInTheDocument();
  expect(screen.getByText(/expira em 120s/)).toBeInTheDocument();

  // renaming a field: the new one is set before the old one is deleted
  await user.click(screen.getByRole("button", { name: "Editar name" }));
  const field = screen.getByLabelText("Campo");
  await user.clear(field);
  await user.type(field, "full_name");
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(edits(calls)).toHaveLength(1));
  expect(edits(calls)[0]).toEqual({
    connectionId: "redis-1",
    request: {
      db: 0,
      key: "user:1",
      create: false,
      edits: [
        { op: "hashSet", field: "full_name", value: "Ana" },
        { op: "hashDelete", field: "name" }
      ]
    },
    confirmed: false
  });
  await waitFor(() => expect(screen.queryByLabelText("Campo")).not.toBeInTheDocument());

  await user.click(screen.getByRole("button", { name: "Adicionar" }));
  await user.type(screen.getByLabelText("Campo"), "age");
  await user.type(screen.getByLabelText("Valor"), "30");
  await user.click(screen.getByRole("button", { name: "Salvar" }));
  await waitFor(() => expect(edits(calls)).toHaveLength(2));
  expect(edits(calls)[1].request.edits).toEqual([{ op: "hashSet", field: "age", value: "30" }]);

  await user.click(screen.getByRole("button", { name: "Remover city" }));
  await user.click(screen.getByRole("button", { name: "Confirmar" }));
  await waitFor(() => expect(edits(calls)).toHaveLength(3));
  expect(edits(calls)[2].request.edits).toEqual([{ op: "hashDelete", field: "city" }]);
});

test("a string is saved, its TTL set, then renamed and deleted", async () => {
  const calls = fakeBackend([localRedis]);
  const user = await openDb0();
  await user.click(screen.getByRole("button", { name: /user/ }));
  await user.click(screen.getByRole("button", { name: /string\s*2/ }));

  const value = await screen.findByLabelText("Valor");
  await user.clear(value);
  await user.type(value, "bye");
  await user.click(screen.getByRole("button", { name: "Salvar valor" }));
  await waitFor(() =>
    expect(edits(calls)[0]?.request.edits).toEqual([{ op: "setString", value: "bye" }])
  );

  await user.type(screen.getByLabelText("TTL em segundos"), "60");
  await user.click(screen.getByRole("button", { name: "Definir TTL" }));
  await waitFor(() =>
    expect(edits(calls)[1]?.request.edits).toEqual([{ op: "expire", ttlSecs: 60 }])
  );

  await user.click(screen.getByRole("button", { name: "Renomear" }));
  const name = screen.getByLabelText("Novo nome");
  await user.clear(name);
  await user.type(name, "events");
  await user.click(screen.getByRole("button", { name: "Salvar nome" }));
  await waitFor(() =>
    expect(edits(calls)[2]?.request.edits).toEqual([{ op: "rename", newKey: "events" }])
  );
  // the renamed key stays selected
  expect(await screen.findByRole("heading", { name: "events" })).toBeInTheDocument();
  expect(screen.getByText("kind=login")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Excluir chave" }));
  await user.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
  await waitFor(() => expect(edits(calls)[3]?.request.edits).toEqual([{ op: "delete" }]));
  expect(await screen.findByText("Selecione uma chave.")).toBeInTheDocument();
});

test("big and binary values are marked and binary items are read-only", async () => {
  fakeBackend([localRedis]);
  const user = await openDb0();
  await user.click(screen.getByRole("button", { name: /queue/ }));

  expect(
    await screen.findByText("Mostrando os primeiros 1000 de 1500 elementos.")
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Editar a" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Editar \\xff" })).not.toBeInTheDocument();
});

test("on prod an edit shows the Redis command and waits for confirmation", async () => {
  let asked = false;
  const calls = fakeBackend([{ ...localRedis, environment: "prod" }], {
    edit_key: args => {
      const { confirmed } = args as EditArgs;
      if (!confirmed && !asked) {
        asked = true;
        return {
          status: "needsConfirmation",
          confirmation: {
            reason: "Conexão de produção: confirme antes de escrever",
            statements: ["HSET user:1 name Bia"]
          }
        };
      }
      return { status: "applied" };
    }
  });
  const user = await openDb0();
  await user.click(screen.getByRole("button", { name: /user/ }));
  await user.click(screen.getByRole("button", { name: /hash\s*1/ }));
  await user.click(await screen.findByRole("button", { name: "Editar name" }));
  const valueInput = screen.getByLabelText("Valor");
  await user.clear(valueInput);
  await user.type(valueInput, "Bia");
  await user.click(screen.getByRole("button", { name: "Salvar" }));

  const dialog = await screen.findByRole("dialog");
  // no SQL terminator after a Redis command
  expect(within(dialog).getByText("HSET user:1 name Bia")).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Romper lacre e executar" }));

  await waitFor(() => expect(edits(calls).map(call => call.confirmed)).toEqual([false, true]));
  await waitFor(() => expect(screen.queryByLabelText("Campo")).not.toBeInTheDocument());
});

test("a new key is created with its first value and TTL", async () => {
  const calls = fakeBackend([localRedis], {
    edit_key: args =>
      (args as EditArgs).request.key === "taken"
        ? Promise.reject({ kind: "conflict", message: "a chave taken já existe" })
        : { status: "applied" }
  });
  const user = await openDb0();

  await user.click(screen.getByRole("button", { name: "Nova chave" }));
  const dialog = screen.getByRole("dialog");
  await user.type(within(dialog).getByLabelText("Nome da chave"), "taken");
  await user.selectOptions(within(dialog).getByLabelText("Tipo"), "zset");
  await user.type(within(dialog).getByLabelText("Membro"), "ana");
  await user.type(within(dialog).getByLabelText("Score"), "1.5");
  await user.type(within(dialog).getByLabelText("TTL em segundos (opcional)"), "60");
  await user.click(within(dialog).getByRole("button", { name: "Criar" }));

  expect(await within(dialog).findByText("a chave taken já existe")).toBeInTheDocument();

  const name = within(dialog).getByLabelText("Nome da chave");
  await user.clear(name);
  await user.type(name, "ranking");
  await user.click(within(dialog).getByRole("button", { name: "Criar" }));

  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(edits(calls)[1].request).toEqual({
    db: 0,
    key: "ranking",
    create: true,
    edits: [
      { op: "zsetAdd", member: "ana", score: "1.5" },
      { op: "expire", ttlSecs: 60 }
    ]
  });
});

test("read-only connections show values without editing controls", async () => {
  fakeBackend([{ ...localRedis, readOnly: true }]);
  const user = await openDb0({ ...localRedis, readOnly: true });

  expect(screen.queryByRole("button", { name: "Nova chave" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /user/ }));
  await user.click(screen.getByRole("button", { name: /hash\s*1/ }));
  expect(await screen.findByText("São Paulo")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Editar name" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Excluir chave" })).not.toBeInTheDocument();
});

test("the console runs commands, prints errors, confirms and recalls history", async () => {
  const calls = fakeBackend([localRedis], {
    run_redis_command: args => {
      const { command, confirmed } = args as CommandArgs;
      if (command === "NOPE") {
        return Promise.reject({ kind: "database", message: "ERR unknown command 'NOPE'" });
      }
      if (command === "FLUSHDB" && !confirmed) {
        return {
          status: "needsConfirmation",
          confirmation: {
            reason: "Comando destrutivo: apaga todas as chaves do database",
            statements: ["FLUSHDB"]
          }
        };
      }
      return { status: "executed", outcome: { output: `1) "${command}"`, durationMs: 2 } };
    }
  });
  const user = await openDb0();
  await user.click(screen.getByRole("tab", { name: "Console" }));
  const input = screen.getByLabelText("Comando Redis");
  const log = screen.getByRole("log", { name: "Saída do console" });

  await user.type(input, "GET user:2{Enter}");
  expect(await within(log).findByText('1) "GET user:2"')).toBeInTheDocument();
  expect(input).toHaveValue("");

  await user.type(input, "NOPE{Enter}");
  expect(await within(log).findByText("(error) ERR unknown command 'NOPE'")).toBeInTheDocument();

  await user.type(input, "FLUSHDB{Enter}");
  const dialog = await screen.findByRole("dialog");
  expect(within(dialog).getByText(/apaga todas as chaves/)).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Executar" }));
  expect(await within(log).findByText('1) "FLUSHDB"')).toBeInTheDocument();
  expect(callsTo(calls, "run_redis_command")).toContainEqual({
    connectionId: "redis-1",
    db: 0,
    command: "FLUSHDB",
    confirmed: true
  });

  // ↑ walks back through what was typed, ↓ returns to an empty line
  await user.type(input, "{ArrowUp}");
  expect(input).toHaveValue("FLUSHDB");
  await user.type(input, "{ArrowUp}");
  expect(input).toHaveValue("NOPE");
  await user.type(input, "{ArrowUp}{ArrowUp}");
  expect(input).toHaveValue("GET user:2");
  await user.type(input, "{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}");
  expect(input).toHaveValue("");

  await user.click(screen.getByRole("button", { name: "Limpar" }));
  expect(within(log).queryByText(/GET user:2/)).not.toBeInTheDocument();
});

test("INFO is shown by section and can be filtered", async () => {
  fakeBackend([localRedis]);
  const user = await openDb0();
  await user.click(screen.getByRole("tab", { name: "Servidor" }));

  expect(await screen.findByRole("region", { name: "Server" })).toHaveTextContent("7.4.0");
  await user.type(screen.getByLabelText("Filtrar INFO"), "memory");
  expect(screen.queryByRole("region", { name: "Server" })).not.toBeInTheDocument();
  expect(screen.getByRole("region", { name: "Memory" })).toHaveTextContent("1.2M");
});

test("history offers the SQL editor only for SQL connections", async () => {
  fakeBackend([localRedis], {
    search_history: () => [
      {
        id: 1,
        connectionId: "redis-1",
        connectionName: "Cache",
        sql: "SELECT 0\nGET k",
        executedAt: "2026-10-11T10:00:00Z",
        durationMs: 1,
        success: true,
        error: null
      }
    ]
  });
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(await screen.findByRole("button", { name: /Histórico/ }));

  expect(await screen.findByText(/GET k/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Abrir no editor/ })).not.toBeInTheDocument();
});
