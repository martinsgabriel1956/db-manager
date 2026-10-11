import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { isValidJson } from "@/features/mongo/ejson";
import { JsonEditor } from "@/features/mongo/JsonEditor";

type DocumentEditorDialogProps = {
  title: string;
  initial: string;
  pending: boolean;
  /** from the backend (invalid Extended JSON, conflict, …) */
  error: string | null;
  onSave: (document: string) => void;
  onCancel: () => void;
};

/** Mounted only while open, so each edit starts from `initial`. */
export function DocumentEditorDialog({
  title,
  initial,
  pending,
  error,
  onSave,
  onCancel
}: DocumentEditorDialogProps) {
  const [text, setText] = useState(initial);
  const [syntaxError, setSyntaxError] = useState(false);

  function save() {
    if (!isValidJson(text)) {
      setSyntaxError(true);
      return;
    }
    setSyntaxError(false);
    onSave(text);
  }

  return (
    <Dialog open onOpenChange={open => !open && onCancel()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Extended JSON: ObjectId, datas e números longos ficam nos seus wrappers ($oid, $date,
            $numberLong) para manter o tipo ao salvar.
          </DialogDescription>
        </DialogHeader>
        <div className="h-96">
          <JsonEditor label="Documento" value={text} onChange={setText} onRun={save} />
        </div>
        {(syntaxError || error) && (
          <p role="alert" className="text-sm text-destructive">
            {syntaxError ? "JSON inválido" : error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button disabled={pending} onClick={save}>
            Salvar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
