import { useState } from "react";
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { expect, test } from "vitest";
import type { Engine } from "@/bindings";
import { formatChange, formatSql } from "@/features/editor/format";
import { SqlWorkspace } from "@/features/editor/SqlWorkspace";
import { fakeBackend, prodPostgres } from "@/test/fakeBackend";
import { renderWithClient } from "@/test/render";

function Workspace({ initialSql, engine }: { initialSql: string; engine: Engine }) {
  const [text, setText] = useState(initialSql);
  return (
    <SqlWorkspace
      connectionId="pg-1"
      engine={engine}
      defaultSchema="public"
      sql={text}
      onSqlChange={setText}
    />
  );
}

function renderWorkspace(initialSql: string, engine: Engine = "postgres") {
  fakeBackend([prodPostgres]);
  return renderWithClient(<Workspace initialSql={initialSql} engine={engine} />);
}

function editorView(): EditorView {
  return EditorView.findFromDOM(document.querySelector(".cm-content") as HTMLElement)!;
}

const key = (init: KeyboardEventInit) => fireEvent.keyDown(editorView().contentDOM, init);

test("keeps keyword case, strings, quoted identifiers and comments in each dialect", () => {
  expect(
    formatSql(
      `select a, "Weird Col" from t -- note\nwhere b = 'x  ;  y' /* keep */ and c = $$ a  b $$`,
      "postgres"
    )
  ).toBe(
    [
      "select",
      "  a,",
      '  "Weird Col"',
      "from",
      "  t -- note",
      "where",
      "  b = 'x  ;  y' /* keep */",
      "  and c = $$ a  b $$"
    ].join("\n")
  );
  expect(formatSql("SELECT `a b` FROM t # hash\nWHERE x = 'it\\'s'", "mysql")).toBe(
    "SELECT\n  `a b`\nFROM\n  t # hash\nWHERE\n  x = 'it\\'s'"
  );
  expect(formatSql("SELECT [weird name] FROM t", "sqlite")).toBe(
    "SELECT\n  [weird name]\nFROM\n  t"
  );
});

test("refuses what it cannot format without changing the script", () => {
  // DELIMITER lines would be joined to the code around them
  expect(() =>
    formatSql("DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; END$$\nDELIMITER ;", "mysql")
  ).toThrow("o formatador não entende DELIMITER");
  expect(() => formatSql("SELECT 'unterminated", "postgres")).toThrow(
    /^o formatador não entendeu o SQL: Parse error: Unexpected "'untermina" at line 1 column 8\.$/
  );
});

test("formats the selection, or the whole document", () => {
  const doc = "select 1;\nselect a from t;";
  const whole = EditorState.create({ doc });
  const selected = EditorState.create({ doc, selection: EditorSelection.range(10, 26) });

  expect(formatChange(whole, "postgres")).toEqual({
    from: 0,
    to: 26,
    insert: "select\n  1;\n\nselect\n  a\nfrom\n  t;"
  });
  expect(formatChange(selected, "postgres")).toEqual({
    from: 10,
    to: 26,
    insert: "select\n  a\nfrom\n  t;"
  });
});

test("Ctrl+Shift+F formats the editor in one step that Ctrl+Z undoes", () => {
  renderWorkspace("select a from t");

  // CodeMirror finds Shift+letter bindings by keyCode
  key({ key: "F", keyCode: 70, ctrlKey: true, shiftKey: true });
  expect(editorView().state.doc.toString()).toBe("select\n  a\nfrom\n  t");

  key({ key: "z", keyCode: 90, ctrlKey: true });
  expect(editorView().state.doc.toString()).toBe("select a from t");
});

test("Formatar keeps a formatted selection selected", async () => {
  const user = userEvent.setup();
  renderWorkspace("SELECT 1;\nselect a from t;");

  act(() => editorView().dispatch({ selection: EditorSelection.range(10, 26) }));
  await user.click(screen.getByRole("button", { name: "Formatar" }));

  const { state } = editorView();
  expect(state.doc.toString()).toBe("SELECT 1;\nselect\n  a\nfrom\n  t;");
  expect(state.sliceDoc(state.selection.main.from, state.selection.main.to)).toBe(
    "select\n  a\nfrom\n  t;"
  );
});

test("a failed format says why and leaves the text alone until the next edit", async () => {
  const user = userEvent.setup();
  renderWorkspace("SELECT 'unterminated");

  await user.click(screen.getByRole("button", { name: "Formatar" }));

  expect(screen.getByRole("alert")).toHaveTextContent("Não formatado: o formatador não entendeu");
  expect(editorView().state.doc.toString()).toBe("SELECT 'unterminated");
  act(() => editorView().dispatch({ changes: { from: 20, insert: "'" } }));
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
});
