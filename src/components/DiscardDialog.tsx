import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle
} from "@/components/ui/dialog";

type DiscardDialogProps = {
  open: boolean;
  /** what holds the edits: "Postgres dev · users" */
  subject: string;
  /** the subject is several things: "2 tabelas têm…" */
  plural?: boolean;
  count: number;
  /** what confirming does, said before the reassurance that nothing reached the database */
  consequence: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  onCloseAutoFocus?: (event: Event) => void;
};

/** Dropping staged edits says how many, and the safe choice holds focus. */
export function DiscardDialog({
  open,
  subject,
  plural = false,
  count,
  consequence,
  confirmLabel,
  onConfirm,
  onCancel,
  onCloseAutoFocus
}: DiscardDialogProps) {
  const changes = count === 1 ? "1 alteração pendente" : `${count} alterações pendentes`;
  return (
    <Dialog open={open} onOpenChange={next => !next && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogTitle>Descartar alterações?</DialogTitle>
        <DialogDescription>
          <span className="font-semibold text-foreground">{subject}</span> {plural ? "têm" : "tem"}{" "}
          {changes}. {consequence}; nada foi gravado no banco.
        </DialogDescription>
        <DialogFooter>
          <Button variant="outline" autoFocus onClick={onCancel}>
            Voltar
          </Button>
          <Button onClick={onConfirm}>{confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
