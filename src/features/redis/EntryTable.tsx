import { Fragment, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  COLUMN_LABELS,
  isEditable,
  type CollectionKind,
  type Entry,
  type EntryDraft
} from "@/features/redis/entries";
import { cn } from "@/lib/utils";

type EntryTableProps = {
  kind: CollectionKind;
  entries: Entry[];
  readOnly: boolean;
  pending: boolean;
  /** `done` closes the row editor once the backend applied the change */
  onSave: (original: Entry | null, draft: EntryDraft, done: () => void) => void;
  onRemove: (entry: Entry) => void;
};

/** null = not editing; "new" = adding an element */
type Editing = { id: string | "new"; draft: EntryDraft } | null;

export function EntryTable({
  kind,
  entries,
  readOnly,
  pending,
  onSave,
  onRemove
}: EntryTableProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [firstLabel, secondLabel] = COLUMN_LABELS[kind];
  const showIndex = kind === "list";

  function startEdit(entry: Entry) {
    setRemovingId(null);
    setEditing({
      id: entry.id,
      draft: { first: entry.first.text, second: entry.second?.text ?? "" }
    });
  }

  function save(original: Entry | null) {
    if (editing) {
      onSave(original, editing.draft, () => setEditing(null));
    }
  }

  function draftInputs(original: Entry | null) {
    if (!editing) {
      return null;
    }
    const setDraft = (patch: Partial<EntryDraft>) =>
      setEditing(prev => prev && { ...prev, draft: { ...prev.draft, ...patch } });
    return (
      <tr className="border-b bg-muted/40">
        {showIndex && (
          <td className="px-2 py-1 text-muted-foreground">{original ? original.index : "fim"}</td>
        )}
        <td className="px-2 py-1">
          <Input
            aria-label={firstLabel}
            className="h-7 font-mono text-xs"
            value={editing.draft.first}
            onChange={event => setDraft({ first: event.target.value })}
          />
        </td>
        {secondLabel && (
          <td className="px-2 py-1">
            <Input
              aria-label={secondLabel}
              className="h-7 font-mono text-xs"
              value={editing.draft.second}
              onChange={event => setDraft({ second: event.target.value })}
            />
          </td>
        )}
        <td className="px-2 py-1 whitespace-nowrap">
          <Button size="xs" disabled={pending} onClick={() => save(original)}>
            Salvar
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setEditing(null)}>
            Cancelar
          </Button>
        </td>
      </tr>
    );
  }

  return (
    <div className="grid gap-2">
      {!readOnly && (
        <Button
          size="xs"
          variant="outline"
          className="w-fit"
          disabled={editing?.id === "new"}
          onClick={() => setEditing({ id: "new", draft: { first: "", second: "" } })}
        >
          <Plus /> Adicionar
        </Button>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="h-7 border-b text-left label-caps text-muted-foreground">
            {showIndex && <th className="w-12 px-2 py-1.5 font-medium">#</th>}
            <th className="px-2 py-1.5 font-medium">{firstLabel}</th>
            {secondLabel && <th className="px-2 py-1.5 font-medium">{secondLabel}</th>}
            <th className="w-40 px-2 py-1.5" />
          </tr>
        </thead>
        <tbody className="font-mono text-xs">
          {editing?.id === "new" && draftInputs(null)}
          {entries.map(entry =>
            editing?.id === entry.id ? (
              <Fragment key={entry.id}>{draftInputs(entry)}</Fragment>
            ) : (
              <tr key={entry.id} className="group h-7 border-b align-top">
                {showIndex && <td className="px-2 py-1 text-muted-foreground">{entry.index}</td>}
                <td
                  className={cn("px-2 py-1 break-all", entry.first.binary && "text-syntax-keyword")}
                >
                  {entry.first.text}
                </td>
                {secondLabel && (
                  <td
                    className={cn(
                      "px-2 py-1 break-all whitespace-pre-wrap",
                      entry.second?.binary && "text-syntax-keyword"
                    )}
                  >
                    {entry.second?.text}
                  </td>
                )}
                <td className="px-2 py-1 whitespace-nowrap">
                  {!readOnly && isEditable(entry) && (
                    <span className="flex justify-end gap-1 opacity-60 group-hover:opacity-100">
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={`Editar ${entry.first.text}`}
                        onClick={() => startEdit(entry)}
                      >
                        <Pencil />
                      </Button>
                      {removingId === entry.id ? (
                        // focused so Enter confirms; leaving it or Escape disarms the removal
                        <Button
                          size="xs"
                          variant="destructive"
                          autoFocus
                          disabled={pending}
                          onClick={() => {
                            setRemovingId(null);
                            onRemove(entry);
                          }}
                          onBlur={() => setRemovingId(null)}
                          onKeyDown={event => event.key === "Escape" && setRemovingId(null)}
                        >
                          Confirmar
                        </Button>
                      ) : (
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Remover ${entry.first.text}`}
                          onClick={() => setRemovingId(entry.id)}
                        >
                          <Trash2 />
                        </Button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
