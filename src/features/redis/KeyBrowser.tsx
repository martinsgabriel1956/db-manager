import { useState, type FormEvent } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KeyDetailView } from "@/features/redis/KeyDetailView";
import { KeyTreeView } from "@/features/redis/KeyTreeView";
import { NewKeyDialog } from "@/features/redis/NewKeyDialog";
import { buildKeyTree, uniqueKeys } from "@/features/redis/keyTree";
import { useKeyEdit, useKeyScan } from "@/features/redis/queries";
import { errorMessage } from "@/lib/errors";

type KeyBrowserProps = {
  connectionId: string;
  db: number;
  separator: string;
  readOnly: boolean;
};

export function KeyBrowser({ connectionId, db, separator, readOnly }: KeyBrowserProps) {
  const [draft, setDraft] = useState("");
  const [pattern, setPattern] = useState("*");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const scan = useKeyScan(connectionId, db, pattern);
  const editor = useKeyEdit(connectionId, db);

  const keys = uniqueKeys(scan.data?.pages.map(page => page.keys) ?? []);
  const tree = buildKeyTree(keys, separator);

  function search(event: FormEvent) {
    event.preventDefault();
    setPattern(draft.trim() === "" ? "*" : draft.trim());
  }

  return (
    <div className="flex h-full">
      <div className="flex w-80 shrink-0 flex-col border-r">
        <form onSubmit={search} className="flex gap-1 border-b p-2">
          <Input
            aria-label="Padrão de chaves"
            placeholder="user:* (SCAN MATCH)"
            className="h-7 font-mono text-xs"
            value={draft}
            onChange={event => setDraft(event.target.value)}
          />
          <Button type="submit" size="sm" variant="outline">
            Buscar
          </Button>
          <Button
            type="button"
            size="icon-sm"
            variant="ghost"
            aria-label="Recarregar chaves"
            onClick={() => scan.refetch()}
          >
            <RefreshCw />
          </Button>
        </form>
        <div className="flex items-center gap-2 border-b px-2 py-1 text-xs text-muted-foreground">
          <span>
            {keys.length} {keys.length === 1 ? "chave" : "chaves"}
            {scan.hasNextPage && " (busca incompleta)"}
          </span>
          {!readOnly && (
            <Button
              size="xs"
              variant="outline"
              className="ml-auto"
              onClick={() => setCreating(true)}
            >
              <Plus /> Nova chave
            </Button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1">
          {scan.isPending && <p className="p-2 text-xs text-muted-foreground">Buscando…</p>}
          {scan.isError && (
            <p role="alert" className="p-2 text-xs text-destructive">
              {errorMessage(scan.error)}
            </p>
          )}
          {scan.isSuccess && keys.length === 0 && !scan.hasNextPage && (
            <p className="p-2 text-xs text-muted-foreground">Nenhuma chave.</p>
          )}
          <KeyTreeView nodes={tree} selected={selected} onSelect={setSelected} />
          {scan.hasNextPage && (
            <Button
              size="xs"
              variant="outline"
              className="m-1"
              disabled={scan.isFetchingNextPage}
              onClick={() => scan.fetchNextPage()}
            >
              {scan.isFetchingNextPage ? "Buscando…" : "Carregar mais"}
            </Button>
          )}
        </div>
      </div>

      <div className="min-w-0 flex-1">
        {selected === null ? (
          <p className="p-4 text-sm text-muted-foreground">Selecione uma chave.</p>
        ) : (
          <KeyDetailView
            key={selected}
            connectionId={connectionId}
            db={db}
            keyName={selected}
            readOnly={readOnly}
            editor={editor}
            onRenamed={setSelected}
            onDeleted={() => setSelected(null)}
          />
        )}
      </div>

      {creating && (
        <NewKeyDialog
          pending={editor.isPending}
          error={editor.error}
          onCancel={() => {
            editor.clearError();
            setCreating(false);
          }}
          onCreate={(key, edits) =>
            editor.submit({
              key,
              edits,
              create: true,
              onDone: () => {
                setCreating(false);
                setSelected(key);
              }
            })
          }
        />
      )}
      <ConfirmDialog
        confirmation={editor.confirmation}
        confirmLabel="Executar em produção"
        statementSuffix=""
        pending={editor.isPending}
        onConfirm={editor.confirm}
        onCancel={editor.dismiss}
      />
    </div>
  );
}
