import { useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import type { KeyDetail, KeyEdit, StreamEntry } from "@/bindings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DeleteStrip, keepArmedFocus } from "@/components/DeleteStrip";
import { Input } from "@/components/ui/input";
import { EntryTable, RedisTextView } from "@/features/redis/EntryTable";
import { entriesOf, isCollection, removeEdit, saveEdits } from "@/features/redis/entries";
import { useKey, type useKeyEdit } from "@/features/redis/queries";
import { errorMessage } from "@/lib/errors";

type KeyEditor = ReturnType<typeof useKeyEdit>;

/** what the backend loads of a key (docs/decisions.md, M5) */
const ELEMENT_LIMIT = 1000;
const STRING_LIMIT_BYTES = 1024 * 1024;

type KeyDetailViewProps = {
  connectionId: string;
  db: number;
  keyName: string;
  readOnly: boolean;
  editor: KeyEditor;
  onRenamed: (key: string) => void;
  onDeleted: () => void;
};

/** Mounted per key (keyed by name), so drafts reset when another key is selected. */
export function KeyDetailView({
  connectionId,
  db,
  keyName,
  readOnly,
  editor,
  onRenamed,
  onDeleted
}: KeyDetailViewProps) {
  const detail = useKey(connectionId, db, keyName);

  function submit(edits: KeyEdit[], onDone?: () => void) {
    editor.submit({ key: keyName, edits, onDone });
  }

  if (detail.isPending) {
    return <p className="p-4 text-sm text-muted-foreground">Carregando…</p>;
  }
  if (detail.isError) {
    return (
      <p role="alert" className="p-4 text-sm text-destructive">
        {errorMessage(detail.error)}
      </p>
    );
  }
  const { value } = detail.data;

  return (
    <div className="flex h-full flex-col">
      <KeyHeader
        detail={detail.data}
        readOnly={readOnly}
        pending={editor.isPending}
        onSubmit={submit}
        onRenamed={onRenamed}
        onDeleted={onDeleted}
      />
      {editor.error && (
        <p role="alert" className="border-b px-3 py-2 text-sm text-destructive">
          {editor.error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {detail.data.truncated && (
          <div className="mb-3 flex items-center gap-3 text-xs text-warning">
            {/* the budget on show: how much of the value fits the 1000-element / 1 MiB limit */}
            <span aria-hidden className="h-1.5 w-32 shrink-0 bg-border">
              <span
                className="block h-full bg-warning"
                style={{
                  width: `${Math.min(100, ((value.kind === "string" ? STRING_LIMIT_BYTES : ELEMENT_LIMIT) / Math.max(1, detail.data.length)) * 100)}%`
                }}
              />
            </span>
            <p>
              {value.kind === "string"
                ? "Valor grande: mostrando só o primeiro 1 MiB, edição desativada."
                : `Mostrando os primeiros ${ELEMENT_LIMIT} de ${detail.data.length} elementos.`}
            </p>
          </div>
        )}
        {value.kind === "string" && value.value.binary && (
          <p className="mb-3 flex items-center gap-2 text-xs text-muted-foreground">
            <Badge variant="held">Bin</Badge>
            Valor binário: bytes fora do UTF-8 aparecem escapados (\xff); somente leitura.
          </p>
        )}
        {value.kind === "string" && (
          <StringEditor
            key={value.value.text}
            initial={value.value.text}
            editable={!readOnly && !value.value.binary && !detail.data.truncated}
            pending={editor.isPending}
            onSave={text => submit([{ op: "setString", value: text }])}
          />
        )}
        {isCollection(value) && (
          <EntryTable
            kind={value.kind}
            entries={entriesOf(value)}
            readOnly={readOnly}
            pending={editor.isPending}
            onSave={(original, draft, done) => submit(saveEdits(value.kind, original, draft), done)}
            onRemove={entry => submit([removeEdit(value.kind, entry)])}
          />
        )}
        {value.kind === "stream" && <StreamTable entries={value.entries} />}
        {value.kind === "unsupported" && (
          <p className="text-sm text-muted-foreground">
            Tipo {value.typeName} (módulo) não é suportado; use o console.
          </p>
        )}
      </div>
    </div>
  );
}

type KeyHeaderProps = {
  detail: KeyDetail;
  readOnly: boolean;
  pending: boolean;
  onSubmit: (edits: KeyEdit[], onDone?: () => void) => void;
  onRenamed: (key: string) => void;
  onDeleted: () => void;
};

function KeyHeader({ detail, readOnly, pending, onSubmit, onRenamed, onDeleted }: KeyHeaderProps) {
  const [ttl, setTtl] = useState("");
  const [newName, setNewName] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const ttlSecs = Number(ttl);
  const validTtl = ttl !== "" && Number.isInteger(ttlSecs) && ttlSecs > 0;
  const unit =
    detail.value.kind === "string"
      ? detail.length === 1
        ? "byte"
        : "bytes"
      : detail.length === 1
        ? "elemento"
        : "elementos";

  return (
    <div className="grid gap-2 border-b bg-muted px-3 py-2">
      {/* the key is printed whole: the tree truncates, so this is where it is read in full */}
      <div className="flex items-baseline gap-2">
        <Badge variant="outline" className="self-center">
          {detail.value.kind}
        </Badge>
        <h3 className="min-w-0 font-mono text-sm font-semibold break-all">{detail.key}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          {detail.length} {unit} ·{" "}
          {detail.ttlSecs === null ? "sem expiração" : `expira em ${detail.ttlSecs}s`}
        </span>
      </div>
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="TTL em segundos"
            type="number"
            min={1}
            placeholder="TTL (s)"
            className="h-7 w-28 text-xs"
            value={ttl}
            onChange={event => setTtl(event.target.value)}
          />
          <Button
            size="xs"
            variant="outline"
            disabled={!validTtl || pending}
            onClick={() => onSubmit([{ op: "expire", ttlSecs }], () => setTtl(""))}
          >
            Definir TTL
          </Button>
          {detail.ttlSecs !== null && (
            <Button
              size="xs"
              variant="outline"
              disabled={pending}
              onClick={() => onSubmit([{ op: "expire", ttlSecs: null }])}
            >
              Remover TTL
            </Button>
          )}
          <span className="mx-1 h-4 border-l" />
          {newName === null ? (
            <Button size="xs" variant="outline" onClick={() => setNewName(detail.key)}>
              Renomear
            </Button>
          ) : (
            <>
              <Input
                aria-label="Novo nome"
                autoFocus
                className="h-7 w-56 font-mono text-xs"
                value={newName}
                onChange={event => setNewName(event.target.value)}
              />
              <Button
                size="xs"
                disabled={pending || newName === "" || newName === detail.key}
                onClick={() =>
                  onSubmit([{ op: "rename", newKey: newName }], () => onRenamed(newName))
                }
              >
                Salvar nome
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setNewName(null)}>
                Cancelar
              </Button>
            </>
          )}
          {/* stays put while armed: a second click disarms instead of confirming */}
          <Button
            size="xs"
            variant="outline"
            ref={deleteTriggerRef}
            className="ml-auto text-destructive"
            aria-expanded={confirmingDelete}
            onMouseDown={keepArmedFocus(confirmingDelete)}
            onClick={() => setConfirmingDelete(armed => !armed)}
          >
            <Trash2 /> Excluir chave
          </Button>
        </div>
      )}
      {!readOnly && confirmingDelete && (
        <DeleteStrip
          command={`DEL ${detail.key}`}
          pending={pending}
          onConfirm={() => onSubmit([{ op: "delete" }], onDeleted)}
          onDisarm={() => setConfirmingDelete(false)}
          triggerRef={deleteTriggerRef}
        />
      )}
    </div>
  );
}

type StringEditorProps = {
  initial: string;
  editable: boolean;
  pending: boolean;
  onSave: (text: string) => void;
};

function StringEditor({ initial, editable, pending, onSave }: StringEditorProps) {
  const [text, setText] = useState(initial);

  return (
    <div className="grid gap-2">
      <textarea
        aria-label="Valor"
        readOnly={!editable}
        className="min-h-48 w-full border border-input bg-transparent p-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:shadow-[inset_0_0_0_1px_var(--ring)] dark:bg-z9"
        value={text}
        onChange={event => setText(event.target.value)}
      />
      {editable && (
        <Button
          size="sm"
          className="w-fit"
          disabled={pending || text === initial}
          onClick={() => onSave(text)}
        >
          Salvar valor
        </Button>
      )}
    </div>
  );
}

function StreamTable({ entries }: { entries: StreamEntry[] }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="h-7 border-b text-left legend text-muted-foreground">
          <th className="px-2 py-1.5 font-medium">ID</th>
          <th className="px-2 py-1.5 font-medium">Campos</th>
        </tr>
      </thead>
      <tbody className="font-mono text-xs">
        {entries.map(entry => (
          <tr key={entry.id} className="h-7 border-b align-top">
            <td className="px-2 py-1 whitespace-nowrap">{entry.id}</td>
            <td className="px-2 py-1 break-all">
              {/* an entry's fields are fixed and may repeat a name: position is their identity */}
              {entry.fields.map(({ field, value }, position) => (
                <span key={`${position}:${field.text}`} className="mr-3 inline-block">
                  <RedisTextView value={field} />=<RedisTextView value={value} />
                </span>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
