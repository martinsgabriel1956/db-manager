import { useRef, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DeleteStrip, keepArmedFocus } from "@/components/DeleteStrip";
import { prettyJson } from "@/features/results/format";
import { DocumentTree } from "@/features/mongo/DocumentTree";
import { describeWrapper, idOf, parseDocument } from "@/features/mongo/ejson";

export type DocumentView = "tree" | "json";

type DocumentCardProps = {
  document: string;
  view: DocumentView;
  /** absent for read-only results (aggregations, read-only connections) */
  onEdit?: () => void;
  onDelete?: () => void;
  /**
   * production: every write already stops at the confirmation sheet with the exact command,
   * so the trigger goes straight there instead of arming a strip first (one confirmation)
   */
  confirmsInSheet?: boolean;
};

/**
 * `_id ObjectId("…")`, as the tree shows it: every card's actions are told apart by it.
 * Null when the document has no _id (some aggregation output).
 */
export function documentName(document: string): string | null {
  const id = parseDocument(document)._id;
  return id === undefined ? null : `_id ${describeWrapper(id) ?? JSON.stringify(id)}`;
}

export function DocumentCard({
  document,
  view,
  onEdit,
  onDelete,
  confirmsInSheet = false
}: DocumentCardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const deleteTriggerRef = useRef<HTMLButtonElement>(null);
  const name = documentName(document);

  return (
    <article
      aria-label={name ? `Documento ${name}` : undefined}
      className="group grid gap-3 border border-foreground bg-background p-3"
    >
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
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={name ? `Editar documento ${name}` : "Editar documento"}
                onClick={onEdit}
              >
                <Pencil />
              </Button>
            )}
            {onDelete && (
              // stays put while armed: a second click disarms instead of confirming
              <Button
                size="icon-xs"
                variant="ghost"
                ref={deleteTriggerRef}
                aria-label={name ? `Excluir documento ${name}` : "Excluir documento"}
                aria-expanded={confirmsInSheet ? undefined : confirmingDelete}
                onMouseDown={keepArmedFocus(confirmingDelete)}
                onClick={confirmsInSheet ? onDelete : () => setConfirmingDelete(armed => !armed)}
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
