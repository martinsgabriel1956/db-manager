import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { commands, type Confirmation, type IndexKind, type NewIndex } from "@/bindings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { connected } from "@/features/explorer/queries";
import { JsonEditor } from "@/features/mongo/JsonEditor";
import { useIndexes } from "@/features/mongo/queries";
import { errorMessage } from "@/lib/errors";

type IndexesPanelProps = {
  connectionId: string;
  database: string;
  collection: string;
  readOnly: boolean;
};

type IndexChange = { kind: "create"; index: NewIndex } | { kind: "drop"; name: string };

const KIND_LABEL: Record<IndexKind, string> = {
  asc: "1 (crescente)",
  desc: "-1 (decrescente)",
  text: "text",
  hashed: "hashed",
  "2dsphere": "2dsphere",
  "2d": "2d"
};

/**
 * Creates or drops one index. Dropping always comes back asking for confirmation,
 * creating only on prod; `confirm` re-sends the same change confirmed.
 */
function useIndexChange(connectionId: string, database: string, collection: string) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<{ change: IndexChange; onDone: () => void } | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const mutation = useMutation({
    mutationFn: ({ change, confirmed }: { change: IndexChange; confirmed: boolean }) =>
      connected(connectionId, () =>
        change.kind === "create"
          ? commands.createIndex(connectionId, change.index, confirmed)
          : commands.dropIndex(connectionId, database, collection, change.name, confirmed)
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["history"] })
  });

  async function send(next: { change: IndexChange; onDone: () => void }, confirmed: boolean) {
    setPending(next);
    try {
      const response = await mutation.mutateAsync({ change: next.change, confirmed });
      if (response.status === "needsConfirmation") {
        setConfirmation(response.confirmation);
        return;
      }
      setConfirmation(null);
      setPending(null);
      queryClient.invalidateQueries({ queryKey: ["indexes", connectionId, database, collection] });
      next.onDone();
    } catch {
      setConfirmation(null);
    }
  }

  return {
    submit: (change: IndexChange, onDone: () => void = () => undefined) =>
      send({ change, onDone }, false),
    confirmation,
    confirm: () => pending && send(pending, true),
    dismiss: () => {
      setConfirmation(null);
      setPending(null);
    },
    reset: () => mutation.reset(),
    isPending: mutation.isPending,
    error: mutation.error ? errorMessage(mutation.error) : null
  };
}

export function IndexesPanel({ connectionId, database, collection, readOnly }: IndexesPanelProps) {
  const indexes = useIndexes(connectionId, database, collection);
  const change = useIndexChange(connectionId, database, collection);
  const [creating, setCreating] = useState(false);

  function closeCreate() {
    setCreating(false);
    change.reset();
  }

  return (
    <div className="p-4">
      {!readOnly && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            change.reset();
            setCreating(true);
          }}
        >
          <Plus /> Novo índice
        </Button>
      )}
      {indexes.isPending && <p className="text-sm text-muted-foreground">Carregando índices…</p>}
      {indexes.isError && (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(indexes.error)}
        </p>
      )}
      {change.error && !creating && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {change.error}
        </p>
      )}
      {indexes.data && (
        <table className="mt-3 border-collapse text-sm">
          <thead>
            <tr className="h-7 border-b text-left legend text-muted-foreground">
              <th className="py-1.5 pr-6 font-medium">Nome</th>
              <th className="py-1.5 pr-6 font-medium">Chaves</th>
              {!readOnly && (
                <th className="py-1.5 font-medium">
                  <span className="sr-only">Ações</span>
                </th>
              )}
            </tr>
          </thead>
          <tbody className="font-mono text-xs">
            {indexes.data.map(index => (
              <tr key={index.name} className="h-7 border-b">
                <td className="py-1.5 pr-6 font-semibold">{index.name}</td>
                <td className="py-1.5 pr-6">{index.definition}</td>
                {!readOnly && (
                  <td className="py-1.5">
                    {/* _id_ always exists: the server refuses to drop it */}
                    {index.name !== "_id_" && (
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remover índice ${index.name}`}
                        disabled={change.isPending}
                        onClick={() => change.submit({ kind: "drop", name: index.name })}
                      >
                        <Trash2 />
                      </Button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {creating && (
        <CreateIndexDialog
          database={database}
          collection={collection}
          pending={change.isPending}
          error={change.error}
          onCancel={closeCreate}
          onCreate={index => change.submit({ kind: "create", index }, closeCreate)}
        />
      )}
      <ConfirmDialog
        connectionId={connectionId}
        confirmation={change.confirmation}
        confirmLabel="Executar"
        statementSuffix=""
        pending={change.isPending}
        onConfirm={change.confirm}
        onCancel={change.dismiss}
      />
    </div>
  );
}

type CreateIndexDialogProps = {
  database: string;
  collection: string;
  pending: boolean;
  /** from the backend (server refused the index, …) */
  error: string | null;
  onCreate: (index: NewIndex) => void;
  onCancel: () => void;
};

function CreateIndexDialog({
  database,
  collection,
  pending,
  error,
  onCreate,
  onCancel
}: CreateIndexDialogProps) {
  const [keys, setKeys] = useState<{ field: string; kind: IndexKind }[]>([
    { field: "", kind: "asc" }
  ]);
  const [name, setName] = useState("");
  const [unique, setUnique] = useState(false);
  const [sparse, setSparse] = useState(false);
  const [ttl, setTtl] = useState("");
  const [partialFilter, setPartialFilter] = useState("");
  const ttlValid = /^\d*$/.test(ttl.trim());
  const index: NewIndex = {
    database,
    collection,
    keys,
    name,
    unique,
    sparse,
    expireAfterSeconds: ttl.trim() === "" ? null : Number(ttl),
    partialFilter
  };
  // the backend builds the command, so what is shown is exactly what runs
  const statement = useQuery({
    queryKey: ["index-statement", index],
    queryFn: () => commands.indexStatement(index),
    enabled: ttlValid,
    retry: false
  });
  const ready = ttlValid && statement.isSuccess && !statement.isFetching;

  function setKey(position: number, patch: Partial<(typeof keys)[number]>) {
    setKeys(prev => prev.map((key, i) => (i === position ? { ...key, ...patch } : key)));
  }

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Novo índice</DialogTitle>
          <DialogDescription>
            Em {database}.{collection}. A ordem das chaves importa num índice composto.
          </DialogDescription>
        </DialogHeader>
        <form
          id="new-index"
          className="grid gap-3"
          onSubmit={event => {
            event.preventDefault();
            if (ready) {
              onCreate(index);
            }
          }}
        >
          <fieldset className="grid gap-2">
            <legend className="mb-1 legend text-muted-foreground">Chaves</legend>
            {keys.map((key, position) => (
              <div key={position} className="flex items-center gap-2">
                <Input
                  aria-label={`Campo da chave ${position + 1}`}
                  value={key.field}
                  placeholder="campo"
                  spellCheck={false}
                  className="font-mono"
                  onChange={event => setKey(position, { field: event.target.value })}
                />
                <NativeSelect
                  aria-label={`Tipo da chave ${position + 1}`}
                  value={key.kind}
                  onChange={event => setKey(position, { kind: event.target.value as IndexKind })}
                >
                  {(Object.keys(KIND_LABEL) as IndexKind[]).map(kind => (
                    <option key={kind} value={kind}>
                      {KIND_LABEL[kind]}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remover chave ${position + 1}`}
                  disabled={keys.length === 1}
                  onClick={() => setKeys(prev => prev.filter((_, i) => i !== position))}
                >
                  <X />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="justify-self-start"
              onClick={() => setKeys(prev => [...prev, { field: "", kind: "asc" }])}
            >
              <Plus /> Adicionar chave
            </Button>
          </fieldset>
          <label className="grid gap-1 text-sm">
            <span className="legend text-muted-foreground">Nome (opcional)</span>
            <Input
              value={name}
              placeholder="gerado das chaves, como campo_1"
              spellCheck={false}
              className="font-mono"
              onChange={event => setName(event.target.value)}
            />
          </label>
          <div className="flex flex-wrap gap-5">
            <label className="flex min-h-6 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={unique}
                onChange={event => setUnique(event.target.checked)}
              />
              unique
            </label>
            <label className="flex min-h-6 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sparse}
                onChange={event => setSparse(event.target.checked)}
              />
              sparse
            </label>
          </div>
          <label className="grid gap-1 text-sm">
            <span className="legend text-muted-foreground">
              TTL: <span className="font-mono normal-case">expireAfterSeconds</span> (opcional)
            </span>
            <Input
              inputMode="numeric"
              value={ttl}
              aria-invalid={ttlValid ? undefined : true}
              className="w-40 font-mono"
              onChange={event => setTtl(event.target.value)}
            />
          </label>
          <div className="grid gap-1">
            <span className="legend text-muted-foreground">
              <span className="font-mono normal-case">partialFilterExpression</span> (opcional,
              Extended JSON)
            </span>
            <div className="h-24">
              <JsonEditor
                label="partialFilterExpression"
                value={partialFilter}
                onChange={setPartialFilter}
              />
            </div>
          </div>
        </form>
        <div className="grid gap-1">
          <p className="legend text-muted-foreground">Comando</p>
          {/* focusable so a long command scrolls from the keyboard */}
          <pre
            tabIndex={0}
            role="region"
            aria-label="Comando que será executado"
            className="max-h-32 overflow-auto border bg-muted px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap outline-none focus-visible:border-ring"
          >
            {!ttlValid
              ? "expireAfterSeconds deve ser um número inteiro de segundos"
              : statement.isError
                ? errorMessage(statement.error)
                : (statement.data ?? "…")}
          </pre>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button type="submit" form="new-index" disabled={pending || !ready}>
            Criar índice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
