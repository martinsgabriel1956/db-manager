import { useEffect, useId, useState, type FocusEvent } from "react";
import type { Confirmation } from "@/bindings";
import { Button } from "@/components/ui/button";
import {
  ProdStrip,
  SHEET_CLASS,
  SheetConnection,
  SheetFooter,
  SheetHeader
} from "@/components/Sheet";
import { Dialog, DialogContent, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useConnections } from "@/features/connections/queries";
import type { CellDiff } from "@/features/table/staged";
import { useFocusReturn } from "@/features/tabs/focus";
import { cn } from "@/lib/utils";

type ConfirmDialogProps = {
  /** named on the form, so the user signs knowing where the command runs */
  connectionId: string;
  confirmation: Confirmation | null;
  confirmLabel: string;
  /** appended to each statement: ";" for SQL, nothing for Redis commands */
  statementSuffix?: string;
  /** a table save: each edited value with the one it replaces, so the change is signed, not only the SQL */
  changes?: CellDiff[];
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

/**
 * The exposure record: shows exactly what will run, so the user confirms the
 * command and not a vague warning. In production it works under the safelight.
 */
export function ConfirmDialog({
  connectionId,
  confirmation,
  confirmLabel,
  statementSuffix = ";",
  changes = [],
  pending = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const connection = useConnections().data?.find(c => c.id === connectionId);
  // in production, confirming always names where it runs, whichever screen asked
  const isProd = connection?.environment === "prod";
  const label = isProd ? "Executar em produção" : confirmLabel;
  // a destructive command on production asks for the connection's name, not one more click:
  // the same click every write gets would turn into a reflex by the tenth time
  const mustType = isProd && (confirmation?.destructive ?? false) && connection !== undefined;
  const [typed, setTyped] = useState("");
  const armed = !mustType || typed.trim() === connection?.name;
  const typeId = useId();
  useEffect(() => setTyped(""), [confirmation]);
  // opened by a shortcut or a save, not a trigger: give focus back to the editor or grid that asked
  const focusReturn = useFocusReturn();

  return (
    <Dialog open={confirmation !== null} onOpenChange={open => !open && onCancel()}>
      {/* an alertdialog: it interrupts to ask for a decision about a risky write */}
      <DialogContent
        {...focusReturn}
        role="alertdialog"
        showCloseButton={false}
        className={SHEET_CLASS}
      >
        <SheetHeader title="Confirmar execução" />
        {/* in a short window (the minimum one, or zoomed in) the record scrolls between the
            title and the buttons: "Executar em produção" never leaves the screen */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* the record's fields */}
          {/* the statements below speak for their own count */}
          <SheetConnection connection={connection} />
          <div className="border-b px-5 py-2.5">
            <p className="legend text-muted-foreground">Motivo</p>
            <DialogDescription className="mt-1.5 text-sm text-foreground">
              {confirmation?.reason}
            </DialogDescription>
          </div>
          {changes.length > 0 && (
            <div className="border-b px-5 py-2.5">
              <p className="legend text-muted-foreground">Antes → depois</p>
              {/* focusable so a long list scrolls from the keyboard */}
              <table
                tabIndex={0}
                onFocus={reveal}
                aria-label="Valores alterados"
                className="mt-1.5 block max-h-36 w-full overflow-auto font-mono text-xs outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--ring)]"
              >
                <tbody>
                  {changes.map(change => (
                    <tr key={`${change.key}:${change.column}`} className="align-baseline">
                      <th
                        scope="row"
                        className="py-0.5 pr-3 text-left font-normal whitespace-nowrap text-muted-foreground"
                      >
                        {change.key}
                      </th>
                      <td className="py-0.5 pr-3 font-semibold whitespace-nowrap">
                        {change.column}
                      </td>
                      <td className="py-0.5 break-all">
                        <DiffValue value={change.before} />
                        <span className="text-muted-foreground"> → </span>
                        <DiffValue value={change.after} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {/* focusable so a long command scrolls from the keyboard: WebKitGTK never focuses scrollers */}
          <pre
            tabIndex={0}
            onFocus={reveal}
            role="region"
            aria-label="Comando que será executado"
            className="mx-5 my-4 max-h-80 overflow-auto border border-foreground bg-background px-3.5 py-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--ring)] focus-visible:border-ring"
          >
            {confirmation && confirmation.marks?.length === confirmation.statements.length
              ? // a script: each command with its place, as the results list numbers it, and
                // the destructive one named in words and ruled in red. The marks are not
                // selectable, so what is copied is the command alone
                confirmation.statements.map((statement, index) => {
                  const mark = confirmation.marks[index];
                  return (
                    <span key={index} className="block not-first:mt-3">
                      <span className="mr-2 legend text-muted-foreground select-none">
                        {mark.number} de {mark.of}
                        <span className="sr-only">, </span>
                      </span>
                      {mark.destructive && (
                        <span className="mr-2 legend text-destructive shadow-[inset_0_-2px_0_var(--destructive)] select-none">
                          Destrutivo
                          <span className="sr-only">, </span>
                        </span>
                      )}
                      {`${statement}${statementSuffix}`}
                    </span>
                  );
                })
              : confirmation?.statements
                  .map(statement => `${statement}${statementSuffix}`)
                  .join("\n\n")}
          </pre>
          {isProd && <ProdStrip>este comando roda no banco de produção</ProdStrip>}
          {mustType && (
            <div className="px-5 pt-3 pb-4">
              <label htmlFor={typeId} className="text-sm">
                Para executar, digite o nome da conexão:{" "}
                <span className="font-mono font-semibold select-all">{connection?.name}</span>
              </label>
              <Input
                id={typeId}
                value={typed}
                autoComplete="off"
                spellCheck={false}
                onChange={event => setTyped(event.target.value)}
                onKeyDown={event => {
                  if (event.key === "Enter" && armed && !pending) {
                    event.preventDefault();
                    onConfirm();
                  }
                }}
                className="mt-2 font-mono"
              />
            </div>
          )}
        </div>
        {/* the footer says what the disabled button waits for, not the title again */}
        <SheetFooter
          hint={
            mustType && !armed
              ? "Digite o nome da conexão acima para liberar o botão."
              : "Nada roda no banco antes de você confirmar."
          }
        >
          <Button variant="outline" onClick={onCancel}>
            Cancelar
          </Button>
          <Button variant="destructive" disabled={pending || !armed} onClick={onConfirm}>
            {pending ? "Executando…" : label}
          </Button>
        </SheetFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Radix focuses without scrolling: in a short window (the minimum at 200% zoom) the command
 * would hold the focus below the record's fold. Focused, it comes into view, also when Tab
 * wraps back to it.
 */
function reveal(event: FocusEvent<HTMLElement>) {
  event.currentTarget.scrollIntoView?.({ block: "nearest" });
}

/** NULL reads as the marker it is, never as the text "NULL" */
function DiffValue({ value }: { value: string | null }) {
  return (
    <span className={cn(value === null && "text-muted-foreground italic")}>
      {value === null ? "NULL" : `'${value}'`}
    </span>
  );
}
