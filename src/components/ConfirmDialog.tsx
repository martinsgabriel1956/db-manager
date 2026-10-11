import type { Confirmation } from "@/bindings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";

type ConfirmDialogProps = {
  confirmation: Confirmation | null;
  confirmLabel: string;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Shows exactly what will run, so the user confirms the SQL and not a vague warning. */
export function ConfirmDialog({
  confirmation,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  return (
    <Dialog open={confirmation !== null} onOpenChange={open => !open && onCancel()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Confirmar execução</DialogTitle>
          <DialogDescription>{confirmation?.reason}</DialogDescription>
        </DialogHeader>
        <pre className="max-h-80 overflow-auto rounded-md border bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
          {confirmation?.statements.map(statement => `${statement};`).join("\n\n")}
        </pre>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
