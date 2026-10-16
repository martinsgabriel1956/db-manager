import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { emit } from "@tauri-apps/api/event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { AppError } from "@/bindings";
import { callsTo, fakeBackend } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

const offline: AppError = { kind: "validation", message: "falha ao buscar a atualização: dns" };

test("a new version at launch is offered with its number; installing waits for a yes", async () => {
  const calls = fakeBackend([], {
    check_update: () => ({ current: "0.3.0", available: "0.4.0", installable: true }),
    install_update: () => null
  });
  const user = userEvent.setup();
  renderWithClient(<App />);

  const dialog = await screen.findByRole("dialog", { name: "Ordo 0.4.0 disponível" });
  expect(dialog).toHaveTextContent("Você está na versão 0.3.0");
  // declining is the default
  expect(screen.getByRole("button", { name: "Agora não" })).toHaveFocus();
  expect(callsTo(calls, "install_update")).toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "Instalar e reiniciar" }));
  await waitFor(() => expect(callsTo(calls, "install_update")).toHaveLength(1));
  expect(await screen.findByRole("dialog", { name: "Instalando o Ordo 0.4.0" })).toBeVisible();
});

test("offline at launch says nothing; the tray check says what happened", async () => {
  let fail = true;
  fakeBackend([], {
    check_update: () => {
      if (fail) {
        throw offline;
      }
      return { current: "0.3.0", available: null, installable: true };
    }
  });
  const user = userEvent.setup();
  renderWithClient(<App />);
  await screen.findByText("Nenhuma conexão cadastrada.");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

  await emit("check-updates");
  expect(await screen.findByRole("dialog", { name: "Falha na atualização" })).toHaveTextContent(
    "falha ao buscar a atualização: dns"
  );
  await user.click(screen.getByRole("button", { name: "Fechar" }));

  fail = false;
  await emit("check-updates");
  expect(await screen.findByRole("dialog", { name: "O Ordo está atualizado" })).toHaveTextContent(
    "A versão 0.3.0 é a mais recente."
  );
});

test("an install the updater cannot replace points to the release page", async () => {
  const calls = fakeBackend([], {
    check_update: () => ({ current: "0.3.0", available: "0.4.0", installable: false }),
    open_release_page: () => null
  });
  const user = userEvent.setup();
  renderWithClient(<App />);

  const dialog = await screen.findByRole("dialog", { name: "Ordo 0.4.0 disponível" });
  expect(dialog).toHaveTextContent("não se atualiza sozinha");
  expect(screen.queryByRole("button", { name: "Instalar e reiniciar" })).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Abrir página do release" }));
  await waitFor(() => expect(callsTo(calls, "open_release_page")).toHaveLength(1));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
});

test("a failed install keeps the current version and points to the release page", async () => {
  const calls = fakeBackend([], {
    check_update: () => ({ current: "0.3.0", available: "0.4.0", installable: true }),
    install_update: () => {
      throw { kind: "validation", message: "falha ao buscar a atualização: assinatura inválida" };
    },
    open_release_page: () => null
  });
  const user = userEvent.setup();
  renderWithClient(<App />);

  await user.click(await screen.findByRole("button", { name: "Instalar e reiniciar" }));
  const dialog = await screen.findByRole("dialog", { name: "A atualização não foi instalada" });
  expect(dialog).toHaveTextContent("assinatura inválida. O Ordo continua na versão atual");
  await user.click(screen.getByRole("button", { name: "Abrir página do release" }));
  await waitFor(() => expect(callsTo(calls, "open_release_page")).toHaveLength(1));
});
