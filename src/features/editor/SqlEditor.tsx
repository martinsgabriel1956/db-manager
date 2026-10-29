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
import {
  Compartment,
  EditorSelection,
  EditorState,
  Prec,
  StateEffect,
  StateField
} from "@codemirror/state";
import { Decoration, EditorView, keymap, placeholder, type DecorationSet } from "@codemirror/view";
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
  /** whether text is selected: the Run button then says it runs the selection */
  onSelectionChange?: (selected: boolean) => void;
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
  /**
   * Finds `text` (what ran) in the document and marks [from, to) of it, without touching
   * the selection (what Run runs); false when it is not there anymore (edited since, or
   * the text had its `:name` values filled in). The mark goes with the next edit or click.
   */
  mark: (text: string, from: number, to: number, kind: StepMark) => boolean;
};

/** "picked": where a statement chosen in a script's summary is; "failed": where the script stopped. */
export type StepMark = "picked" | "failed";

const setStepMark = StateEffect.define<{ from: number; to: number; kind: StepMark } | null>();

/** A script step shown in the editor: a mark, never the selection, so Run keeps its meaning. */
const stepMark = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(marks, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setStepMark)) {
        const mark = effect.value;
        return mark
          ? Decoration.set(
              Decoration.mark({ class: `cm-step-${mark.kind}` }).range(mark.from, mark.to)
            )
          : Decoration.none;
      }
    }
    return tr.docChanged || tr.isUserEvent("select") ? Decoration.none : marks;
  },
  provide: field => EditorView.decorations.from(field)
});

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
  onSelectionChange,
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
  const onSelectionChangeRef = useRef(onSelectionChange);

  useEffect(() => {
    onChangeRef.current = onChange;
    onRunRef.current = onRun;
    onExplainRef.current = onExplain;
    onFormattedRef.current = onFormatted;
    onSelectionChangeRef.current = onSelectionChange;
    engineRef.current = engine;
  }, [onChange, onRun, onExplain, onFormatted, onSelectionChange, engine]);

  useEffect(() => {
    // one transaction, so Ctrl+Z brings the text back; a formatted selection stays selected
    const format = (editor: EditorView) => {
      const before = editor.state;
      formatChange(before, engineRef.current).then(
        change => {
          // typed over while the formatter loaded: the change would land on other text
          if (editor.state.doc !== before.doc) {
            return;
          }
          const selected = !before.selection.main.empty;
          editor.dispatch({
            changes: change,
            selection: selected
              ? EditorSelection.range(change.from, change.from + change.insert.length)
              : undefined
          });
          onFormattedRef.current(null);
        },
        error => onFormattedRef.current(errorMessage(error))
      );
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
            if (update.selectionSet) {
              onSelectionChangeRef.current?.(!update.state.selection.main.empty);
            }
          }),
          stepMark,
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
      format: () => format(view),
      mark: (text, from, to, kind) => {
        // ponytail: first occurrence; a selection run whose text repeats earlier in the
        // document marks that earlier copy
        const origin = view.state.doc.toString().indexOf(text);
        if (origin < 0) {
          view.dispatch({ effects: setStepMark.of(null) });
          return false;
        }
        view.dispatch({
          effects: [
            setStepMark.of({ from: origin + from, to: origin + to, kind }),
            EditorView.scrollIntoView(origin + from, { y: "center" })
          ]
        });
        return true;
      }
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
