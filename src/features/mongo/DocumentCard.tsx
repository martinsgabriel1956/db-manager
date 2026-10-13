import { useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { prettyJson } from "@/features/results/format";
import { DocumentTree } from "@/features/mongo/DocumentTree";
import { idOf, parseDocument } from "@/features/mongo/ejson";

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
    <article className="group flex items-start gap-2 border border-foreground bg-background p-3">
      <div className="min-w-0 flex-1">
        {view === "tree" ? (
          <DocumentTree document={parseDocument(document)} />
        ) : (
          <pre className="overflow-x-auto font-mono text-xs whitespace-pre-wrap">
            {prettyJson(document)}
          </pre>
        )}
      </div>
      {/* beside the document, never over its first line */}
      {(onEdit || onDelete) && (
        <div className="-mt-1 -mr-1 flex shrink-0 items-center gap-1 text-muted-foreground">
          {onEdit && (
            <Button size="icon-xs" variant="ghost" aria-label="Editar documento" onClick={onEdit}>
              <Pencil />
            </Button>
          )}
          {onDelete &&
            (confirmingDelete ? (
              <>
                {/* the exact command before the click, as everywhere else */}
                <code className="max-w-72 truncate border border-foreground bg-background px-1.5 font-mono text-xs leading-6 text-foreground">
                  deleteOne({`{"_id": ${idOf(document)}}`})
                </code>
                {/* focused so Enter confirms; leaving it or Escape disarms the delete */}
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
              </>
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
    </article>
  );
}
