import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Channel } from "@tauri-apps/api/core";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { ConnectionConfig, MonitorEvent } from "@/bindings";
import { callsTo, fakeBackend, localRedis } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

type MonitorArgs = {
  connectionId: string;
  sessionId: string;
  confirmed: boolean;
  onEvent: Channel<MonitorEvent>;
};

async function openMonitor(connection: ConnectionConfig = localRedis) {
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(
    await screen.findByRole("treeitem", { name: new RegExp(`^${connection.name}`) })
  );
  await user.click(await screen.findByRole("treeitem", { name: /^db0/ }));
  await user.click(await screen.findByRole("tab", { name: "Monitor" }));
  return user;
}

test("MONITOR warns, streams lines, and stops when leaving the section", async () => {
  const calls = fakeBackend([localRedis]);
  const user = await openMonitor();
  expect(screen.getByText(/pode reduzir bastante o desempenho/)).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Iniciar MONITOR" }));
  await screen.findByText("Monitorando");
  const [start] = callsTo(calls, "redis_monitor") as MonitorArgs[];
  expect(start).toMatchObject({ connectionId: "redis-1", confirmed: false });

  act(() =>
    start.onEvent.onmessage({ kind: "line", text: '1700000000.1 [0 127.0.0.1:5000] "GET" "k"' })
  );
  const log = screen.getByRole("log", { name: "Comandos monitorados" });
  expect(await within(log).findByText(/"GET" "k"/)).toBeInTheDocument();

  await user.click(screen.getByRole("tab", { name: "Chaves" }));
  await waitFor(() =>
    expect(callsTo(calls, "stop_redis_session")).toEqual([
      { connectionId: "redis-1", sessionId: start.sessionId }
    ])
  );
});

test("the limit ends MONITOR with the reason", async () => {
  const calls = fakeBackend([localRedis]);
  const user = await openMonitor();
  await user.click(screen.getByRole("button", { name: "Iniciar MONITOR" }));
  const [start] = callsTo(calls, "redis_monitor") as MonitorArgs[];
  act(() => start.onEvent.onmessage({ kind: "ended", reason: "parou sozinho após 60 s" }));
  expect(await screen.findByText("parou sozinho após 60 s")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Iniciar MONITOR" })).toBeEnabled();
});

test("on prod MONITOR asks before starting", async () => {
  const prod = { ...localRedis, environment: "prod" as const };
  const calls = fakeBackend([prod], {
    redis_monitor: args =>
      (args as MonitorArgs).confirmed
        ? { status: "started" }
        : {
            status: "needsConfirmation",
            confirmation: {
              reason: "Conexão de produção: MONITOR pesa no servidor",
              statements: ["MONITOR"],
              destructive: false
            }
          }
  });
  const user = await openMonitor(prod);

  await user.click(screen.getByRole("button", { name: "Iniciar MONITOR" }));
  const dialog = await screen.findByRole("alertdialog");
  expect(within(dialog).getByText("MONITOR")).toBeInTheDocument();
  expect(screen.queryByText("Monitorando")).not.toBeInTheDocument();
  await user.click(within(dialog).getByRole("button", { name: "Executar em produção" }));
  await screen.findByText("Monitorando");
  expect((callsTo(calls, "redis_monitor") as MonitorArgs[]).map(c => c.confirmed)).toEqual([
    false,
    true
  ]);
});
