import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { App } from "@/App";
import type { AppError, BrowseRequest } from "@/bindings";
import { rowsLabel } from "@/features/table/RowCount";
import { callsTo, devPostgres, fakeBackend } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

async function openUsers() {
  const user = userEvent.setup();
  renderWithClient(<App />);
  await user.click(await screen.findByRole("treeitem", { name: /^Postgres dev/ }));
  await user.click(await screen.findByRole("treeitem", { name: "users" }));
  await screen.findAllByRole("gridcell");
  return user;
}

test("counts are formatted from their exact text", () => {
  expect(rowsLabel("1")).toBe("1 linha");
  expect(rowsLabel("9007199254740993")).toBe("9.007.199.254.740.993 linhas");
});

test("the table opens with the estimate and counts exactly only on demand", async () => {
  const calls = fakeBackend([devPostgres]);
  const user = await openUsers();

  expect(await screen.findByText("12.345 linhas")).toBeInTheDocument();
  expect(screen.getByText("cerca de")).toBeInTheDocument();
  expect(callsTo(calls, "count_rows")).toHaveLength(0);

  await user.click(screen.getByRole("button", { name: "Contar linhas" }));

  expect(await screen.findByText("12.346 linhas")).toBeInTheDocument();
  expect(screen.queryByText("cerca de")).not.toBeInTheDocument();
  const [args] = callsTo(calls, "count_rows") as { request: BrowseRequest }[];
  expect(args.request.filters).toEqual([]);

  // a filter makes the count speak of other rows: it starts over, and the estimate (of the
  // whole table) gives way to counting what the filter keeps
  await user.selectOptions(screen.getByLabelText("Operador do filtro"), "isNull");
  await user.click(screen.getByRole("button", { name: "Aplicar" }));
  await waitFor(() => expect(screen.queryByText("12.346 linhas")).not.toBeInTheDocument());
  expect(screen.queryByText("12.345 linhas")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Contar linhas com o filtro" }));
  expect(await screen.findByText(/12\.346 linhas\s*com o filtro/)).toBeInTheDocument();
  const filtered = callsTo(calls, "count_rows") as { request: BrowseRequest }[];
  expect(filtered[1].request.filters).toHaveLength(1);
});

test("a running count can be cancelled, and says so", async () => {
  let reject: (error: AppError) => void = () => {};
  const calls = fakeBackend([devPostgres], {
    estimate_rows: () => null,
    count_rows: () => new Promise((_, fail) => (reject = fail)),
    cancel_run: () => {
      reject({ kind: "cancelled", message: "query cancelada" });
      return null;
    }
  });
  const user = await openUsers();

  await user.click(screen.getByRole("button", { name: "Contar linhas" }));
  expect(await screen.findByText("Contando…")).toBeInTheDocument();
  const cancel = screen.getByRole("button", { name: "Cancelar contagem" });
  // the same button: focus does not drop to the page while counting
  expect(cancel).toHaveFocus();
  await user.click(cancel);

  expect(await screen.findByRole("alert")).toHaveTextContent("Contagem cancelada");
  const [count] = callsTo(calls, "count_rows") as { runId: string }[];
  expect(callsTo(calls, "cancel_run")).toEqual([{ runId: count.runId }]);
});
