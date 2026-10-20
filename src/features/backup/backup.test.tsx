import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { App } from "@/App";
import type { AppError, ConnectionConfig } from "@/bindings";
import { BackupDialog, formatBytes } from "@/features/backup/BackupDialog";
import { callsTo, devPostgres, fakeBackend, prodPostgres } from "@/test/fakeBackend";
import { renderWithClient, rowAction } from "@/test/render";

const devMysql: ConnectionConfig = {
  ...devPostgres,
  id: "my-dev",
  name: "MySQL dev",
  engine: "mysql",
  target: { kind: "network", host: "db", port: 3306, database: "app", username: "me" }
};

const localSqlite: ConnectionConfig = {
  ...devPostgres,
  id: "lite",
  name: "Arquivo",
  engine: "sqlite",
  environment: "local",
  target: { kind: "file", path: "/home/me/app.sqlite" }
};

test("sizes read in the binary units the file manager uses", () => {
  expect(formatBytes(0)).toBe("0 B");
  expect(formatBytes(1536)).toBe("1,5 KB");
  expect(formatBytes(5 * 1024 ** 3)).toBe("5 GB");
});

test("the connection menu opens it, and a backup is saved where the user chose", async () => {
  const calls = fakeBackend([devPostgres], {
    "plugin:dialog|save": () => "/home/me/app.sql"
  });
  const user = userEvent.setup();
  renderWithClient(<App />);

  await rowAction(user, "Postgres dev", "Backup e restauração…");
  const dialog = await screen.findByRole("dialog", { name: "Backup e restauração" });
  await user.selectOptions(
    within(dialog).getByLabelText("Formato do backup"),
    "SQL em texto (pg_dump -Fp, volta pelo psql)"
  );
  await user.click(within(dialog).getByRole("button", { name: /Fazer backup/ }));

  expect(await within(dialog).findByText(/Backup gravado em app.sql · 1,5 KB/)).toBeInTheDocument();
  expect(callsTo(calls, "backup_database")[0]).toMatchObject({
    connectionId: "pg-dev",
    format: "sql",
    path: "/home/me/app.sql"
  });
  // the exact command, never the password
  expect(within(dialog).getByRole("region", { name: "Comando executado" })).toHaveTextContent(
    "pg_dump --host=db"
  );
});

test("a missing tool or a cancelled save says so; nothing runs without a file", async () => {
  const error: AppError = {
    kind: "validation",
    message: "mysqldump não foi encontrado no PATH: instale o cliente do MySQL"
  };
  let path: string | null = null;
  const calls = fakeBackend([devMysql], {
    "plugin:dialog|save": () => path,
    backup_database: () => Promise.reject(error)
  });
  const user = userEvent.setup();
  renderWithClient(<BackupDialog connection={devMysql} onClose={() => undefined} />);

  // one format: no select
  expect(screen.queryByLabelText("Formato do backup")).not.toBeInTheDocument();
  expect(screen.getByText("SQL (mysqldump)")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: /Fazer backup/ }));
  expect(callsTo(calls, "backup_database")).toHaveLength(0);

  path = "/home/me/app.sql";
  await user.click(screen.getByRole("button", { name: /Fazer backup/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("mysqldump não foi encontrado");
});

test("a running backup can be cancelled", async () => {
  const calls = fakeBackend([devPostgres], {
    "plugin:dialog|save": () => "/home/me/app.dump",
    backup_database: () => new Promise(() => undefined)
  });
  const user = userEvent.setup();
  renderWithClient(<BackupDialog connection={devPostgres} onClose={() => undefined} />);

  await user.click(screen.getByRole("button", { name: /Fazer backup/ }));
  expect(await screen.findByRole("status")).toHaveTextContent("Fazendo backup…");
  await user.click(screen.getByRole("button", { name: "Cancelar" }));

  const { runId } = callsTo(calls, "backup_database")[0] as { runId: string };
  expect(callsTo(calls, "cancel_run")).toEqual([{ runId }]);
});

test("a restore shows the exact command and runs only after it is confirmed", async () => {
  const calls = fakeBackend([devPostgres], {
    "plugin:dialog|open": () => "/home/me/app.dump"
  });
  const onClose = vi.fn();
  const user = userEvent.setup();
  renderWithClient(<BackupDialog connection={devPostgres} onClose={onClose} />);

  await user.click(screen.getByRole("button", { name: /Restaurar de um arquivo/ }));

  const confirm = await screen.findByRole("alertdialog");
  expect(
    within(confirm).getByRole("region", { name: "Comando que será executado" })
  ).toHaveTextContent(
    "pg_restore --host=db --port=5432 --username=me --dbname=app --no-password --clean"
  );
  expect(callsTo(calls, "restore_database")).toEqual([
    expect.objectContaining({ path: "/home/me/app.dump", confirmed: false })
  ]);
  await user.click(within(confirm).getByRole("button", { name: "Restaurar" }));

  expect(await screen.findByText(/Restaurado de app.dump · 90 ms/)).toBeInTheDocument();
  expect(callsTo(calls, "restore_database")[1]).toMatchObject({ confirmed: true });
  expect(onClose).not.toHaveBeenCalled();
});

test("production asks for the connection's name before a restore", async () => {
  const prodWritable = { ...prodPostgres, readOnly: false };
  const calls = fakeBackend([prodWritable], {
    "plugin:dialog|open": () => "/home/me/app.dump"
  });
  const user = userEvent.setup();
  renderWithClient(<BackupDialog connection={prodWritable} onClose={() => undefined} />);

  await user.click(screen.getByRole("button", { name: /Restaurar de um arquivo/ }));
  const confirm = await screen.findByRole("alertdialog");
  const run = await within(confirm).findByRole("button", { name: "Executar em produção" });
  expect(run).toBeDisabled();
  await user.type(within(confirm).getByLabelText(/digite o nome da conexão/), "Postgres prod");
  await user.click(run);

  await waitFor(() => expect(callsTo(calls, "restore_database")).toHaveLength(2));
});

test("read-only connections and SQLite say why there is no restore", () => {
  fakeBackend([prodPostgres, localSqlite]);
  const { unmount } = renderWithClient(
    <BackupDialog connection={prodPostgres} onClose={() => undefined} />
  );
  expect(screen.getByText(/somente leitura: restaurar está desligado/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Restaurar/ })).not.toBeInTheDocument();
  unmount();

  renderWithClient(<BackupDialog connection={localSqlite} onClose={() => undefined} />);
  expect(screen.getByText("Cópia do arquivo (VACUUM INTO)")).toBeInTheDocument();
  expect(screen.getByText(/copie o arquivo do backup no lugar do banco/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Restaurar/ })).not.toBeInTheDocument();
});

test("a production backup says so under the safelight, whatever tab is active", () => {
  const writable = { ...prodPostgres, readOnly: false };
  fakeBackend([writable]);
  renderWithClient(<BackupDialog connection={writable} onClose={() => undefined} />);

  const dialog = screen.getByRole("dialog", { name: "Backup e restauração" });
  expect(within(dialog).getByText("Postgres prod")).toBeInTheDocument();
  expect(within(dialog).getByText("Prod")).toBeInTheDocument();
  expect(within(dialog).getByText("restaurar escreve no banco de produção")).toBeInTheDocument();
});
