import type { Confirmation } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EnvTag } from "@/features/connections/EnvTag";
import { useConnections } from "@/features/connections/queries";
import { useFocusReturn } from "@/features/tabs/focus";

type ConfirmDialogProps = {
  /** named on the form, so the user signs knowing where the command runs */
  connectionId: string;
  confirmation: Confirmation | null;
  confirmLabel: string;
  /** appended to each statement: ";" for SQL, nothing for Redis commands */
  statementSuffix?: string;
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
  pending = false,
  onConfirm,
  onCancel
}: ConfirmDialogProps) {
  const connection = useConnections().data?.find(c => c.id === connectionId);
  // in production, confirming always names where it runs, whichever screen asked
  const isProd = connection?.environment === "prod";
  const label = isProd ? "Executar em produção" : confirmLabel;
  // opened by a shortcut or a save, not a trigger: give focus back to the editor or grid that asked
  const focusReturn = useFocusReturn();

  return (
    <Dialog open={confirmation !== null} onOpenChange={open => !open && onCancel()}>
      <DialogContent
        {...focusReturn}
        showCloseButton={false}
        className="gap-0 overflow-hidden p-0 duration-[160ms] ease-out data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top-3 motion-reduce:animate-none sm:max-w-2xl"
      >
        <div className="flex items-end justify-between gap-4 border-b border-foreground px-5 pt-6 pb-3 grid-paper">
          <DialogTitle className="display-caps text-[2rem]">Confirmar execução</DialogTitle>
          <svg aria-hidden viewBox="0 0 16 24" className="mb-0.5 h-8 w-5 text-select">
            <line x1="2" y1="23" x2="14" y2="1" stroke="currentColor" strokeWidth="2.5" />
          </svg>
        </div>
        {/* the record's fields */}
        {/* the statements below speak for their own count */}
        <dl className="grid grid-cols-[2fr_1fr] border-b">
          <div className="border-r px-5 py-2.5">
            <dt className="legend text-muted-foreground">Conexão</dt>
            <dd className="mt-1.5 truncate text-sm font-semibold">{connection?.name ?? "—"}</dd>
          </div>
          <div className="px-4 py-2.5">
            <dt className="legend text-muted-foreground">Ambiente</dt>
            <dd className="mt-1.5">
              {connection ? <EnvTag environment={connection.environment} /> : "—"}
            </dd>
          </div>
        </dl>
        <div className="border-b px-5 py-2.5">
          <p className="legend text-muted-foreground">Motivo</p>
          <DialogDescription className="mt-1.5 text-sm text-foreground">
            {confirmation?.reason}
          </DialogDescription>
        </div>
        {/* focusable so a long command scrolls from the keyboard: WebKitGTK never focuses scrollers */}
        <pre
          tabIndex={0}
          role="region"
          aria-label="Comando que será executado"
          className="mx-5 my-4 max-h-80 overflow-auto border border-foreground bg-background px-3.5 py-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap outline-none focus-visible:shadow-[inset_0_0_0_1px_var(--ring)] focus-visible:border-ring"
        >
          {confirmation?.statements.map(statement => `${statement}${statementSuffix}`).join("\n\n")}
        </pre>
        {isProd && (
          <p className="flex h-7 items-center gap-2 bg-safelight px-5 text-xs text-white">
            <span className="legend text-[0.75rem]">Produção</span>
            <span>este comando roda no banco de produção</span>
          </p>
        )}
        <div className="flex flex-col-reverse gap-2 border-t border-foreground bg-muted px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Confira o comando exato antes de confirmar.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={pending} onClick={onConfirm}>
              {pending ? "Executando…" : label}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
