import { useMemo, useRef, useState, type FormEvent } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { commands } from "@/bindings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connected } from "@/features/explorer/queries";
import { ExportButton } from "@/features/export/ExportButton";
import { KeyDetailView } from "@/features/redis/KeyDetailView";
import { KeyTreeView } from "@/features/redis/KeyTreeView";
import { NewKeyDialog } from "@/features/redis/NewKeyDialog";
import { buildKeyTree, uniqueKeys } from "@/features/redis/keyTree";
import { useKeyEdit, useKeyScan } from "@/features/redis/queries";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

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
  const keysScrollRef = useRef<HTMLDivElement>(null);
  const scan = useKeyScan(connectionId, db, pattern);
  const editor = useKeyEdit(connectionId, db);

  const pages = scan.data?.pages;
  // sorting thousands of keys must not rerun on every keystroke in the pattern input
  const { keys, tree } = useMemo(() => {
    const unique = uniqueKeys(pages?.map(page => page.keys) ?? []);
    return { keys: unique, tree: buildKeyTree(unique, separator) };
  }, [pages, separator]);

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
            placeholder="ex.: user:*"
            // a narrowed SCAN is filtration: the pattern field takes the magenta rule
            className={cn("h-7 font-mono text-xs", pattern !== "*" && "border-filter")}
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
          {/* every key matching the searched pattern, not only the pages loaded */}
          <span className="ml-auto">
            <ExportButton
              baseName={`db${db}`}
              formats={[
                {
                  id: "ndjson",
                  label: "NDJSON",
                  extension: "ndjson",
                  run: (path, runId) =>
                    connected(connectionId, () =>
                      commands.exportKeys(connectionId, runId, db, pattern, path)
                    )
                }
              ]}
            />
          </span>
          {!readOnly && (
            <Button size="xs" variant="outline" onClick={() => setCreating(true)}>
              <Plus /> Nova chave
            </Button>
          )}
        </div>
        {/* relative: the virtualized tree measures its offset inside this scroller */}
        <div ref={keysScrollRef} className="relative min-h-0 flex-1 overflow-auto p-1">
          {scan.isPending && <p className="p-2 text-xs text-muted-foreground">Buscando…</p>}
          {scan.isError && (
            <p role="alert" className="p-2 text-xs text-destructive">
              {errorMessage(scan.error)}
            </p>
          )}
          {scan.isSuccess && keys.length === 0 && !scan.hasNextPage && (
            <p className="p-2 text-xs text-muted-foreground">Nenhuma chave.</p>
          )}
          <KeyTreeView
            nodes={tree}
            selected={selected}
            onSelect={setSelected}
            scrollRef={keysScrollRef}
          />
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
          <div className="grid h-full content-center justify-items-start gap-2 px-8 grid-paper">
            <p aria-hidden className="display-caps text-3xl">
              Nenhuma chave aberta
            </p>
            <p className="max-w-[46ch] text-sm text-muted-foreground">
              Selecione uma chave na lista para ver o tipo, o valor e o TTL.
            </p>
          </div>
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
        connectionId={connectionId}
        confirmation={editor.confirmation}
        confirmLabel="Executar"
        statementSuffix=""
        pending={editor.isPending}
        onConfirm={editor.confirm}
        onCancel={editor.dismiss}
      />
    </div>
  );
}
