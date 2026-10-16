import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { ConnectionConfig, KeyDetail, KeyEditRequest } from "@/bindings";
import { callsTo, fakeBackend, localRedis } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

const moduleKeys: Record<string, KeyDetail> = {
  doc: {
    key: "doc",
    ttlSecs: null,
    length: 30,
    truncated: false,
    value: { kind: "json", json: '{"n":18446744073709551615,"l":[]}' }
  },
  bloom: {
    key: "bloom",
    ttlSecs: null,
    length: 0,
    truncated: false,
    value: { kind: "unsupported", typeName: "MBbloom--" }
  }
};

function withModuleKeys(connection: ConnectionConfig = localRedis) {
  return fakeBackend([connection], {
    scan_keys: () => ({
      keys: [
        { name: "doc", kind: "ReJSON-RL" },
        { name: "bloom", kind: "MBbloom--" }
      ],
      cursor: "0"
    }),
    read_key: args => moduleKeys[(args as { key: string }).key]
  });
}

async function openDb0(connection: ConnectionConfig = localRedis) {
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(
    await screen.findByRole("treeitem", { name: new RegExp(`^${connection.name}`) })
  );
  await user.click(await screen.findByRole("treeitem", { name: /^db0/ }));
  await screen.findByRole("list", { name: "Chaves" });
  return user;
}

test("the server panel lists the loaded modules, or says MODULE LIST is refused", async () => {
  fakeBackend([localRedis]);
  const user = await openDb0();
  await user.click(screen.getByRole("tab", { name: "Servidor" }));
  const modules = await screen.findByRole("region", { name: "Módulos" });
  expect(await within(modules).findByText("ReJSON")).toBeInTheDocument();
  expect(within(modules).getByText("versão 20609")).toBeInTheDocument();
});

test("a server that refuses MODULE LIST still shows INFO", async () => {
  fakeBackend([localRedis], {
    server_modules: () => Promise.reject({ kind: "database", message: "unknown command 'MODULE'" })
  });
  const user = await openDb0();
  await user.click(screen.getByRole("tab", { name: "Servidor" }));
  expect(await screen.findByText(/MODULE LIST indisponível/)).toBeInTheDocument();
  expect(screen.getByText("redis_version")).toBeInTheDocument();
});

test("module keys show their type; RedisJSON opens in the JSON editor and saves", async () => {
  const calls = withModuleKeys();
  const user = await openDb0();
  const tree = screen.getByRole("list", { name: "Chaves" });
  expect(await within(tree).findByRole("button", { name: "MBbloom--bloom" })).toBeVisible();

  await user.click(within(tree).getByRole("button", { name: "MBbloom--bloom" }));
  expect(await screen.findByText(/Tipo de módulo MBbloom--/)).toBeInTheDocument();

  await user.click(within(tree).getByRole("button", { name: "ReJSON-RLdoc" }));
  const editor = await screen.findByRole("textbox", { name: "Documento JSON" });
  // re-indented as text: the 64-bit number keeps every digit
  expect(editor).toHaveTextContent('"n": 18446744073709551615');
  const save = screen.getByRole("button", { name: "Salvar JSON" });
  expect(save).toBeDisabled();

  const view = EditorView.findFromDOM(editor)!;
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: "{bad" } }));
  await user.click(save);
  expect(await screen.findByText("JSON inválido")).toBeInTheDocument();
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '{"n": 1}' } }));
  await user.click(save);
  await waitFor(() => expect(callsTo(calls, "edit_key")).toHaveLength(1));
  const [edit] = callsTo(calls, "edit_key") as { request: KeyEditRequest }[];
  expect(edit.request.edits).toEqual([{ op: "jsonSet", json: '{"n": 1}' }]);
});

test("on read-only connections the JSON is shown, not edited", async () => {
  const readOnly = { ...localRedis, readOnly: true };
  withModuleKeys(readOnly);
  const user = await openDb0(readOnly);
  await user.click(await screen.findByRole("button", { name: "ReJSON-RLdoc" }));
  const editor = await screen.findByRole("textbox", { name: "Documento JSON" });
  expect(editor).toHaveAttribute("aria-readonly", "true");
  expect(screen.queryByRole("button", { name: "Salvar JSON" })).not.toBeInTheDocument();
});
