import { useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteStrip, keepArmedFocus } from "@/components/DeleteStrip";
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
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <article className="group grid gap-3 border border-foreground bg-background p-3">
      <div className="flex items-start gap-2">
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
            {onDelete && (
              // stays put while armed: a second click disarms instead of confirming
              <Button
                size="icon-xs"
                variant="ghost"
                ref={deleteTriggerRef}
                aria-label="Excluir documento"
                aria-expanded={confirmingDelete}
                onMouseDown={keepArmedFocus(confirmingDelete)}
                onClick={() => setConfirmingDelete(armed => !armed)}
              >
                <Trash2 />
              </Button>
            )}
          </div>
        )}
      </div>
      {onDelete && confirmingDelete && (
        <DeleteStrip
          className="border-t border-foreground pt-3"
          command={`deleteOne({"_id": ${idOf(document)}})`}
          onConfirm={onDelete}
          onDisarm={() => setConfirmingDelete(false)}
          triggerRef={deleteTriggerRef}
        />
      )}
    </article>
  );
}
