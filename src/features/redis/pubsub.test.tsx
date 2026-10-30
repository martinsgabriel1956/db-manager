import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Channel } from "@tauri-apps/api/core";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { PubSubEvent } from "@/bindings";
import { callsTo, fakeBackend, localRedis } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

type SubscribeArgs = {
  connectionId: string;
  sessionId: string;
  channels: string[];
  patterns: string[];
  onEvent: Channel<PubSubEvent>;
};

async function openPubSub(connection = localRedis) {
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(
    await screen.findByRole("treeitem", { name: new RegExp(`^${connection.name}`) })
  );
  await user.click(await screen.findByRole("treeitem", { name: /^db0/ }));
  await user.click(await screen.findByRole("tab", { name: "Pub/sub" }));
  return user;
}

function message(channel: string, payload: string, pattern: string | null = null): PubSubEvent {
  const text = (value: string) => ({ text: value, binary: false });
  return {
    kind: "message",
    channel: text(channel),
    pattern: pattern === null ? null : text(pattern),
    payload: text(payload)
  };
}

test("pub/sub lists messages live, pauses, and ends the session with the tab", async () => {
  const calls = fakeBackend([localRedis]);
  const user = await openPubSub();

  await user.type(screen.getByRole("textbox", { name: "Canais" }), "news  alerts");
  await user.type(screen.getByRole("textbox", { name: "Padrões" }), "user:*");
  await user.click(screen.getByRole("button", { name: "Assinar" }));
  await screen.findByText("Assinando");
  const [subscribe] = callsTo(calls, "redis_subscribe") as SubscribeArgs[];
  expect(subscribe).toMatchObject({
    connectionId: "redis-1",
    channels: ["news", "alerts"],
    patterns: ["user:*"]
  });

  const log = screen.getByRole("log", { name: "Mensagens recebidas" });
  act(() => subscribe.onEvent.onmessage(message("user:1", "olá", "user:*")));
  expect(await within(log).findByText("olá")).toBeInTheDocument();
  expect(within(log).getByText("user:*")).toBeInTheDocument();

  // paused, the view freezes; what arrives shows up on resume
  await user.click(screen.getByRole("button", { name: "Pausar" }));
  act(() => subscribe.onEvent.onmessage(message("news", "segunda")));
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(within(log).queryByText("segunda")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Retomar" }));
  expect(await within(log).findByText("segunda")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Limpar mensagens" }));
  expect(within(log).queryByText("segunda")).not.toBeInTheDocument();

  // switching sections keeps it; closing the tab ends it
  await user.click(screen.getByRole("tab", { name: "Chaves" }));
  expect(callsTo(calls, "stop_redis_session")).toHaveLength(0);
  await user.click(screen.getByLabelText("Fechar aba Cache · db0"));
  await waitFor(() =>
    expect(callsTo(calls, "stop_redis_session")).toEqual([
      { connectionId: "redis-1", sessionId: subscribe.sessionId }
    ])
  );
});

test("the server ending the subscription shows why; Parar stops it", async () => {
  const calls = fakeBackend([localRedis]);
  const user = await openPubSub();

  await user.type(screen.getByRole("textbox", { name: "Canais" }), "news");
  await user.click(screen.getByRole("button", { name: "Assinar" }));
  const [first] = callsTo(calls, "redis_subscribe") as SubscribeArgs[];
  act(() => first.onEvent.onmessage({ kind: "ended", reason: "o servidor encerrou a conexão" }));
  expect(await screen.findByText("o servidor encerrou a conexão")).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Assinar" }));
  await user.click(await screen.findByRole("button", { name: "Parar" }));
  const second = (callsTo(calls, "redis_subscribe") as SubscribeArgs[])[1];
  expect(callsTo(calls, "stop_redis_session")).toContainEqual({
    connectionId: "redis-1",
    sessionId: second.sessionId
  });
  // a late message from the stopped session is ignored
  act(() => second.onEvent.onmessage(message("news", "tarde")));
  await new Promise(resolve => setTimeout(resolve, 300));
  expect(screen.queryByText("tarde")).not.toBeInTheDocument();
});

test("PUBLISH confirms on prod and is off on read-only connections", async () => {
  const prod = { ...localRedis, environment: "prod" as const };
  const calls = fakeBackend([prod], {
    redis_publish: args =>
      (args as { confirmed: boolean }).confirmed
        ? { status: "executed", outcome: { output: "(integer) 2", durationMs: 1 } }
        : {
            status: "needsConfirmation",
            confirmation: {
              reason: "Conexão de produção: confirme antes de escrever",
              statements: ['PUBLISH news "a b"'],
              destructive: false
            }
          }
  });
  const user = await openPubSub(prod);

  await user.type(screen.getByRole("textbox", { name: "Canal para publicar" }), "news");
  await user.type(screen.getByRole("textbox", { name: "Mensagem" }), "a b");
  await user.click(screen.getByRole("button", { name: "Publicar" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText('PUBLISH news "a b"')).toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Executar em produção" }));
  expect(await screen.findByText("Entregue a 2 assinante(s)")).toBeInTheDocument();
  expect(callsTo(calls, "redis_publish")).toEqual([
    { connectionId: "redis-1", db: 0, channel: "news", message: "a b", confirmed: false },
    { connectionId: "redis-1", db: 0, channel: "news", message: "a b", confirmed: true }
  ]);
});

test("read-only connections subscribe but cannot publish", async () => {
  const readOnly = { ...localRedis, readOnly: true };
  fakeBackend([readOnly]);
  await openPubSub(readOnly);
  expect(screen.getByText(/PUBLISH é escrita e está desativado/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Publicar" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Assinar" })).toBeEnabled();
});
