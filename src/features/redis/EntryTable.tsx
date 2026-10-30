import { Fragment, useRef, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { RedisText } from "@/bindings";
import { DeleteStrip, keepArmedFocus } from "@/components/DeleteStrip";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  COLUMN_LABELS,
  isEditable,
  removeCommand,
  type CollectionKind,
  type Entry,
  type EntryDraft
} from "@/features/redis/entries";

type EntryTableProps = {
  kind: CollectionKind;
  /** the key the entries belong to, for the exact command in the delete strip */
  keyName: string;
  entries: Entry[];
  readOnly: boolean;
  pending: boolean;
  confirmsInSheet?: boolean;
  /** `done` closes the row editor once the backend applied the change */
  onSave: (original: Entry | null, draft: EntryDraft, done: () => void) => void;
  onRemove: (entry: Entry) => void;
};

/**
 * A value that is not UTF-8 shows its escaped preview behind the held mark, so
 * `\xff` the bytes never reads like the four-character string "\xff".
 */
export function RedisTextView({ value }: { value: RedisText }) {
  if (!value.binary) {
    return value.text;
  }
  return (
    <>
      <Badge variant="held" className="mr-1.5 align-middle">
        <span aria-hidden>Bin</span>
        <span className="sr-only">binário, prévia escapada:</span>
      </Badge>
      {value.text}
    </>
  );
}

/** null = not editing; "new" = adding an element */
type Editing = { id: string | "new"; draft: EntryDraft } | null;

export function EntryTable({
  kind,
  keyName,
  entries,
  readOnly,
  confirmsInSheet = false,
  pending,
  onSave,
  onRemove
}: EntryTableProps) {
  const [editing, setEditing] = useState<Editing>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const removeTriggerRef = useRef<HTMLButtonElement>(null);
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
          <tr className="h-7 border-b text-left legend text-muted-foreground">
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
              <Fragment key={entry.id}>
                <tr className="group h-7 border-b align-top">
                  {showIndex && <td className="px-2 py-1 text-muted-foreground">{entry.index}</td>}
                  <td className="px-2 py-1 break-all">
                    <RedisTextView value={entry.first} />
                  </td>
                  {secondLabel && (
                    <td className="px-2 py-1 break-all whitespace-pre-wrap">
                      {entry.second && <RedisTextView value={entry.second} />}
                    </td>
                  )}
                  <td className="px-2 py-1 whitespace-nowrap">
                    {!readOnly && isEditable(entry) && (
                      <span
                        className={`flex justify-end gap-1 group-focus-within:opacity-100 group-hover:opacity-100 ${
                          removingId === entry.id ? "" : "opacity-60"
                        }`}
                      >
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          aria-label={`Editar ${entry.first.text}`}
                          onClick={() => startEdit(entry)}
                        >
                          <Pencil />
                        </Button>
                        {/* stays put while armed: a second click disarms instead of confirming */}
                        <Button
                          size="icon-xs"
                          variant="ghost"
                          ref={removingId === entry.id ? removeTriggerRef : undefined}
                          aria-label={`Remover ${entry.first.text}`}
                          aria-expanded={confirmsInSheet ? undefined : removingId === entry.id}
                          onMouseDown={keepArmedFocus(removingId === entry.id)}
                          // on production the sheet confirms it, with the exact command
                          onClick={() =>
                            confirmsInSheet
                              ? onRemove(entry)
                              : setRemovingId(armed => (armed === entry.id ? null : entry.id))
                          }
                        >
                          <Trash2 />
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
                {removingId === entry.id && (
                  <tr className="border-b">
                    <td
                      colSpan={(showIndex ? 1 : 0) + (secondLabel ? 3 : 2)}
                      className="px-2 py-1 font-sans"
                    >
                      <DeleteStrip
                        command={removeCommand(kind, keyName, entry)}
                        pending={pending}
                        onConfirm={() => {
                          setRemovingId(null);
                          onRemove(entry);
                        }}
                        onDisarm={() => setRemovingId(null)}
                        triggerRef={removeTriggerRef}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          )}
        </tbody>
      </table>
    </div>
  );
}
