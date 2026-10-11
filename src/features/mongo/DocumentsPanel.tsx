import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { commands } from "@/bindings";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { connected } from "@/features/explorer/queries";
import { ExportButton, type ExportFormat } from "@/features/export/ExportButton";
import { prettyJson } from "@/features/results/format";
import { DocumentCard, type DocumentView } from "@/features/mongo/DocumentCard";
import { DocumentEditorDialog } from "@/features/mongo/DocumentEditorDialog";
import { idOf, isValidJson } from "@/features/mongo/ejson";
import { useDocuments, useDocumentWrite } from "@/features/mongo/queries";
import { errorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

type DocumentsPanelProps = {
  connectionId: string;
  database: string;
  collection: string;
  readOnly: boolean;
};

type Query = { filter: string; sort: string; projection: string };

type Editing = { mode: "insert" } | { mode: "edit"; document: string };

export const DOCUMENTS_PAGE_SIZE = 20;

const EMPTY_QUERY: Query = { filter: "", sort: "", projection: "" };

/** Fields of the query that are not valid JSON (empty means "none"). */
export function invalidQueryFields(query: Query): (keyof Query)[] {
  return (Object.keys(query) as (keyof Query)[]).filter(
    field => query[field].trim() !== "" && !isValidJson(query[field])
  );
}

const FIELD_LABEL: Record<keyof Query, string> = {
  filter: "Filtro",
  sort: "Ordenação",
  projection: "Projeção"
};

const PLACEHOLDER: Record<keyof Query, string> = {
  filter: '{"status": "paid"}',
  sort: '{"_id": -1}',
  projection: '{"name": 1}'
};

export function DocumentsPanel({
  connectionId,
  database,
  collection,
  readOnly
}: DocumentsPanelProps) {
  const [draft, setDraft] = useState<Query>(EMPTY_QUERY);
  const [applied, setApplied] = useState<Query>(EMPTY_QUERY);
  const [page, setPage] = useState(0);
  const [view, setView] = useState<DocumentView>("tree");
  const [editing, setEditing] = useState<Editing | null>(null);
  const invalid = invalidQueryFields(draft);

  const documents = useDocuments(connectionId, {
    database,
    collection,
    ...applied,
    page,
    pageSize: DOCUMENTS_PAGE_SIZE
  });
  const writer = useDocumentWrite(connectionId, database, collection);

  // what the list shows (applied filter, sort and projection), every page
  const exportFormats: ExportFormat[] = (
    [
      ["ndjson", "NDJSON", "ndjson"],
      ["jsonArray", "JSON", "json"]
    ] as const
  ).map(([format, label, extension]) => ({
    id: format,
    label,
    extension,
    run: (path, runId) =>
      connected(connectionId, () =>
        commands.exportCollection(
          connectionId,
          runId,
          { database, collection, ...applied, page: 0, pageSize: DOCUMENTS_PAGE_SIZE },
          format,
          path
        )
      )
  }));

  function apply(event: FormEvent) {
    event.preventDefault();
    if (invalid.length === 0) {
      setApplied(draft);
      setPage(0);
    }
  }

  function closeEditor() {
    writer.reset();
    setEditing(null);
  }

  return (
    <div className="flex h-full flex-col">
      <form onSubmit={apply} className="grid gap-2 border-b px-3 py-2">
        <div className="grid grid-cols-[2fr_1fr_1fr_auto] items-end gap-2">
          {(Object.keys(FIELD_LABEL) as (keyof Query)[]).map(field => (
            <label key={field} className="grid gap-1 text-xs text-muted-foreground">
              {FIELD_LABEL[field]}
              <Input
                aria-label={FIELD_LABEL[field]}
                aria-invalid={invalid.includes(field) || undefined}
                className="h-7 font-mono text-xs"
                placeholder={PLACEHOLDER[field]}
                value={draft[field]}
                onChange={event => setDraft(prev => ({ ...prev, [field]: event.target.value }))}
              />
            </label>
          ))}
          <Button type="submit" size="sm" variant="outline" disabled={invalid.length > 0}>
            Aplicar
          </Button>
        </div>
        {invalid.length > 0 && (
          <p className="text-xs text-destructive">
            JSON inválido em: {invalid.map(field => FIELD_LABEL[field]).join(", ")}
          </p>
        )}
      </form>

      <div className="flex items-center gap-2 border-b px-3 py-1.5 text-sm">
        <div role="tablist" aria-label="Visualização" className="flex rounded-md border">
          {(["tree", "json"] as const).map(option => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={view === option}
              onClick={() => setView(option)}
              className={cn("px-2 py-0.5 text-xs", view === option && "bg-muted font-medium")}
            >
              {option === "tree" ? "Árvore" : "JSON"}
            </button>
          ))}
        </div>
        {!readOnly && (
          <Button size="sm" variant="outline" onClick={() => setEditing({ mode: "insert" })}>
            <Plus /> Novo documento
          </Button>
        )}
        {documents.isFetching && (
          <span className="text-xs text-muted-foreground">atualizando…</span>
        )}
        <div className="ml-auto">
          <ExportButton baseName={collection} formats={exportFormats} />
        </div>
      </div>

      {documents.isError && (
        <p role="alert" className="px-3 py-2 text-sm text-destructive">
          {errorMessage(documents.error)}
        </p>
      )}
      {writer.error && !editing && (
        <p role="alert" className="px-3 py-2 text-sm text-destructive">
          {writer.error}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto bg-muted/30 p-3">
        {documents.data?.documents.length === 0 && (
          <p className="text-sm text-muted-foreground">Nenhum documento.</p>
        )}
        <div className="grid gap-2">
          {documents.data?.documents.map(document => (
            <DocumentCard
              key={idOf(document)}
              document={document}
              view={view}
              onEdit={readOnly ? undefined : () => setEditing({ mode: "edit", document })}
              onDelete={
                readOnly
                  ? undefined
                  : () => writer.submit({ kind: "delete", id: idOf(document) }, () => undefined)
              }
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 border-t px-3 py-1.5 text-sm">
        <Button
          size="sm"
          variant="outline"
          disabled={page === 0 || documents.isFetching}
          onClick={() => setPage(prev => prev - 1)}
        >
          Anterior
        </Button>
        <span className="text-muted-foreground">Página {page + 1}</span>
        <Button
          size="sm"
          variant="outline"
          disabled={!documents.data?.hasMore || documents.isFetching}
          onClick={() => setPage(prev => prev + 1)}
        >
          Próxima
        </Button>
      </div>

      {editing && (
        <DocumentEditorDialog
          title={editing.mode === "insert" ? "Novo documento" : "Editar documento"}
          initial={editing.mode === "insert" ? "{\n  \n}" : prettyJson(editing.document)}
          pending={writer.isPending}
          error={writer.error}
          onCancel={closeEditor}
          onSave={text =>
            writer.submit(
              editing.mode === "insert"
                ? { kind: "insert", document: text }
                : { kind: "replace", id: idOf(editing.document), document: text },
              closeEditor
            )
          }
        />
      )}
      <ConfirmDialog
        confirmation={writer.confirmation}
        confirmLabel="Executar em produção"
        pending={writer.isPending}
        onConfirm={writer.confirm}
        onCancel={writer.dismiss}
      />
    </div>
  );
}
