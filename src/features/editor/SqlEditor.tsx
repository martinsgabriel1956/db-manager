import { useEffect, useRef, type RefObject } from "react";
import {
  closeCompletion,
  type CompletionResult,
  type CompletionSource
} from "@codemirror/autocomplete";
import { basicSetup } from "codemirror";
import {
  MySQL,
  PostgreSQL,
  schemaCompletionSource,
  sql,
  SQLite,
  type SQLNamespace
} from "@codemirror/lang-sql";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { Compartment, EditorSelection, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import type { CompletionTable, Engine } from "@/bindings";
import { formatChange } from "@/features/editor/format";
import { editorLabel, editorTheme } from "@/lib/codemirror";
import { errorMessage } from "@/lib/errors";
import { RUN_SHORTCUT } from "@/lib/platform";

type SqlEditorProps = {
  value: string;
  onChange: (value: string) => void;
  /** receives the selection, or the whole document when nothing is selected */
  onRun: (sql: string) => void;
  /** after each format: null when it worked, otherwise why nothing changed */
  onFormatted: (error: string | null) => void;
  /** receives the selection, or the statement under the cursor */
  onExplain: (sql: string) => void;
  completion: CompletionTable[] | undefined;
  engine: Engine;
  defaultSchema: string;
  /** lets the Run button apply the same selection-or-all rule as Ctrl+Enter */
  apiRef: RefObject<SqlEditorApi | null>;
  /** read once, at creation */
  autoFocus?: boolean;
};

/**
 * `prepareRun` closes a completion left open and returns what to run, as Mod-Enter does;
 * `prepareExplain` does the same for what to explain, as Mod-Shift-E does; `format` formats
 * the selection or everything, as Mod-Shift-F does.
 */
export type SqlEditorApi = {
  prepareRun: () => string;
  prepareExplain: () => string;
  format: () => void;
};

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

/**
 * The selection, or the statement under the cursor: the last one starting at or before it
 * (a cursor on the blank line after a statement still means that statement).
 */
export function statementAt(state: EditorState): string {
  const { from, to, head } = state.selection.main;
  if (from !== to) {
    return state.sliceDoc(from, to);
  }
  const tree = ensureSyntaxTree(state, state.doc.length, 200) ?? syntaxTree(state);
  let statement: { from: number; to: number } | null = null;
  for (let node = tree.topNode.firstChild; node; node = node.nextSibling) {
    if (node.name !== "Statement") {
      continue;
    }
    if (node.from > head && statement) {
      break;
    }
    statement = { from: node.from, to: node.to };
  }
  return statement ? state.sliceDoc(statement.from, statement.to) : "";
}

const DIALECT = { postgres: PostgreSQL, mysql: MySQL, sqlite: SQLite };

/** The lang-sql dialect the editor parses `engine` with. */
export function sqlDialect(engine: Engine) {
  return engine === "mysql" || engine === "sqlite" ? DIALECT[engine] : DIALECT.postgres;
}

type LanguageOptions = Pick<SqlEditorProps, "completion" | "engine" | "defaultSchema">;

/**
 * lang-sql tags schema and table names "type", the same as data types: a table read as
 * TY. Its schema source only offers names, columns and aliases, so there "type" is a
 * schema (SC) or a table (TB); real data types keep TY from the keyword source.
 */
export function tagNames(source: CompletionSource, schemas: Set<string>): CompletionSource {
  const tag = (result: CompletionResult | null) =>
    result && {
      ...result,
      options: result.options.map(option =>
        option.type === "type"
          ? { ...option, type: schemas.has(option.label) ? "namespace" : "class" }
          : option
      )
    };
  return context => {
    const result = source(context);
    return result instanceof Promise ? result.then(tag) : tag(result);
  };
}

function sqlLanguage({ completion, engine, defaultSchema }: LanguageOptions) {
  const dialect = sqlDialect(engine);
  const tables = completion ?? [];
  const schemaSource = schemaCompletionSource({
    dialect,
    schema: toNamespace(tables),
    defaultSchema
  });
  // keywords and types from sql(); schema names through tagNames
  return [
    sql({ dialect, upperCaseKeywords: true }),
    dialect.language.data.of({
      autocomplete: tagNames(schemaSource, new Set(tables.map(table => table.schema)))
    })
  ];
}

export function SqlEditor({
  value,
  onChange,
  onRun,
  onFormatted,
  onExplain,
  completion,
  engine,
  defaultSchema,
  apiRef,
  autoFocus = false
}: SqlEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const languageRef = useRef(new Compartment());
  // the editor is created once; callbacks are read through refs to stay current
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const onFormattedRef = useRef(onFormatted);
  const engineRef = useRef(engine);
  const onExplainRef = useRef(onExplain);

  useEffect(() => {
    onChangeRef.current = onChange;
    onRunRef.current = onRun;
    onExplainRef.current = onExplain;
    onFormattedRef.current = onFormatted;
    engineRef.current = engine;
  }, [onChange, onRun, onExplain, onFormatted, engine]);

  useEffect(() => {
    // one transaction, so Ctrl+Z brings the text back; a formatted selection stays selected
    const format = (editor: EditorView) => {
      try {
        const change = formatChange(editor.state, engineRef.current);
        const selected = !editor.state.selection.main.empty;
        editor.dispatch({
          changes: change,
          selection: selected
            ? EditorSelection.range(change.from, change.from + change.insert.length)
            : undefined
        });
        onFormattedRef.current(null);
      } catch (error) {
        onFormattedRef.current(errorMessage(error));
      }
      return true;
    };
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
                  // a completion left open would float over the result and the confirmation
                  closeCompletion(editor);
                  onRunRef.current(textToRun(editor.state));
                  return true;
                }
              },
              {
                key: "Mod-Shift-e",
                run: editor => {
                  closeCompletion(editor);
                  onExplainRef.current(statementAt(editor.state));
                  return true;
                }
              },
              { key: "Mod-Shift-f", run: format }
            ])
          ),
          EditorView.updateListener.of(update => {
            if (update.docChanged) {
              onChangeRef.current(update.state.doc.toString());
            }
          }),
          editorTheme,
          editorLabel("Editor SQL"),
          // an empty editor says what goes there and how it runs, instead of a blank pane
          placeholder(`Escreva SQL aqui. ${RUN_SHORTCUT} executa a seleção ou o editor inteiro.`)
        ]
      })
    });
    viewRef.current = view;
    // a frame later: the menu or palette that opened this editor still traps focus while it
    // unmounts, and would pull an immediate focus back into itself
    const focusFrame = autoFocus ? requestAnimationFrame(() => view.focus()) : 0;
    apiRef.current = {
      prepareRun: () => {
        closeCompletion(view);
        return textToRun(view.state);
      },
      prepareExplain: () => {
        closeCompletion(view);
        return statementAt(view.state);
      },
      format: () => format(view)
    };
    return () => {
      cancelAnimationFrame(focusFrame);
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

  return <div ref={hostRef} className="h-full overflow-hidden" />;
}
