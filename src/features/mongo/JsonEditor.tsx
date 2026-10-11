import { useEffect, useRef } from "react";
import { basicSetup } from "codemirror";
import { json } from "@codemirror/lang-json";
import { EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { editorLabel, editorTheme } from "@/lib/codemirror";

type JsonEditorProps = {
  value: string;
  onChange: (value: string) => void;
  /** Mod-Enter (Ctrl, or Cmd on macOS) */
  onRun?: () => void;
  label: string;
};

/** CodeMirror with JSON syntax. Created once; later `value` changes replace the text. */
export function JsonEditor({ value, onChange, onRun, label }: JsonEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
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
          json(),
          Prec.highest(
            keymap.of([
              {
                key: "Mod-Enter",
                run: () => {
                  onRunRef.current?.();
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
          editorTheme,
          editorLabel(label)
        ]
      })
    });
    viewRef.current = view;
    return () => view.destroy();
    // created once on purpose; `value` changes flow through the effect below
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view && view.state.doc.toString() !== value) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div ref={hostRef} className="h-full overflow-hidden border border-input" />;
}
