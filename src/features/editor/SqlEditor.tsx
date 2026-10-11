import { useEffect, useRef, type RefObject } from "react";
import { basicSetup } from "codemirror";
import { MySQL, PostgreSQL, sql, SQLite, type SQLNamespace } from "@codemirror/lang-sql";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import type { CompletionTable, Engine } from "@/bindings";

type SqlEditorProps = {
  value: string;
  onChange: (value: string) => void;
  /** receives the selection, or the whole document when nothing is selected */
  onRun: (sql: string) => void;
  completion: CompletionTable[] | undefined;
  engine: Engine;
  defaultSchema: string;
  /** lets the Run button apply the same selection-or-all rule as Ctrl+Enter */
  apiRef: RefObject<SqlEditorApi | null>;
};

export type SqlEditorApi = { textToRun: () => string };

/** `{ schema: { table: [columns] } }` for CodeMirror's schema-aware autocomplete. */
export function toNamespace(tables: CompletionTable[]): SQLNamespace {
  const namespace: Record<string, Record<string, string[]>> = {};
  for (const { schema, table, columns } of tables) {
    namespace[schema] ??= {};
    namespace[schema][table] = columns;
  }
  return namespace;
}

export function textToRun(state: EditorState): string {
  const { from, to } = state.selection.main;
  return from === to ? state.doc.toString() : state.sliceDoc(from, to);
}

const DIALECT = { postgres: PostgreSQL, mysql: MySQL, sqlite: SQLite };

type LanguageOptions = Pick<SqlEditorProps, "completion" | "engine" | "defaultSchema">;

function sqlLanguage({ completion, engine, defaultSchema }: LanguageOptions) {
  return sql({
    dialect: engine === "mysql" || engine === "sqlite" ? DIALECT[engine] : DIALECT.postgres,
    schema: toNamespace(completion ?? []),
    defaultSchema,
    upperCaseKeywords: true
  });
}

export function SqlEditor({
  value,
  onChange,
  onRun,
  completion,
  engine,
  defaultSchema,
  apiRef
}: SqlEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageRef = useRef(new Compartment());
  // the editor is created once; callbacks are read through refs to stay current
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);

  useEffect(() => {
    onChangeRef.current = onChange;
    onRunRef.current = onRun;
  }, [onChange, onRun]);

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          languageRef.current.of(sqlLanguage({ completion, engine, defaultSchema })),
          Prec.highest(
            keymap.of([
              {
                key: "Mod-Enter",
                run: editor => {
                  onRunRef.current(textToRun(editor.state));
                  return true;
                }
              }
            ])
          ),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": { fontFamily: "ui-monospace, monospace" }
          })
        ]
      })
    });
    viewRef.current = view;
    apiRef.current = { textToRun: () => textToRun(view.state) };
    return () => {
      apiRef.current = null;
      view.destroy();
    };
    // created once per mount on purpose; `value` changes flow through the effect below
  }, []);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: languageRef.current.reconfigure(sqlLanguage({ completion, engine, defaultSchema }))
    });
  }, [completion, engine, defaultSchema]);

  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={hostRef} aria-label="Editor SQL" className="h-full overflow-hidden" />;
}
