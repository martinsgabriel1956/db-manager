import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prettyJson } from "@/features/results/format";
import { DocumentTree } from "@/features/mongo/DocumentTree";
import { parseDocument } from "@/features/mongo/ejson";

export type DocumentView = "tree" | "json";

type DocumentCardProps = {
  document: string;
  view: DocumentView;
  /** absent for read-only results (aggregations, read-only connections) */
  onEdit?: () => void;
  onDelete?: () => void;
};

export function DocumentCard({ document, view, onEdit, onDelete }: DocumentCardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  return (
    <article className="group relative rounded-md border bg-background p-3">
      {(onEdit || onDelete) && (
        <div className="absolute top-2 right-2 flex gap-1 opacity-60 group-hover:opacity-100">
          {onEdit && (
            <Button size="icon-xs" variant="ghost" aria-label="Editar documento" onClick={onEdit}>
              <Pencil />
            </Button>
          )}
          {onDelete &&
            (confirmingDelete ? (
              // focused so Enter confirms; leaving it or Escape disarms the delete
              <Button
                size="xs"
                variant="destructive"
                autoFocus
                onClick={onDelete}
                onBlur={() => setConfirmingDelete(false)}
                onKeyDown={event => event.key === "Escape" && setConfirmingDelete(false)}
              >
                Confirmar exclusão
              </Button>
            ) : (
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Excluir documento"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 />
              </Button>
            ))}
        </div>
      )}
      {view === "tree" ? (
        <DocumentTree document={parseDocument(document)} />
      ) : (
        <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap">
          {prettyJson(document)}
        </pre>
      )}
    </article>
  );
}
