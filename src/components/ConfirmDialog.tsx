import type { Confirmation } from "@/bindings";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EnvTag } from "@/features/connections/EnvTag";
import { useConnections } from "@/features/connections/queries";

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
 * The custody form: shows exactly what will run, so the user signs for the command
 * and not for a vague warning. Confirming is breaking the seal.
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
  const count = confirmation?.statements.length ?? 0;
  const connection = useConnections().data?.find(c => c.id === connectionId);
  // in production, confirming always reads as breaking the seal, whichever screen asked
  const label =
    connection?.environment === "prod" && !confirmLabel.startsWith("Romper lacre")
      ? "Romper lacre e executar"
      : confirmLabel;

  return (
    <Dialog open={confirmation !== null} onOpenChange={open => !open && onCancel()}>
      <DialogContent
        showCloseButton={false}
        className="gap-0 overflow-hidden rounded-[3px] p-0 shadow-[0_20px_44px_-14px_rgb(0_0_0/0.5)] duration-[120ms] data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top-2 motion-reduce:animate-none sm:max-w-2xl"
      >
        <div className="border-b-2 border-foreground px-5 pt-4 pb-3">
          <DialogTitle className="text-[1.75rem] leading-none font-extrabold tracking-[0.05em] uppercase [font-stretch:66%]">
            Termo de custódia
          </DialogTitle>
        </div>
        {/* the printed fields of the form */}
        <dl className="grid grid-cols-[2fr_1fr_1fr] border-b">
          <div className="border-r px-5 py-2.5">
            <dt className="label-caps text-muted-foreground">Conexão</dt>
            <dd className="mt-1 truncate text-sm font-semibold">{connection?.name ?? "—"}</dd>
          </div>
          <div className="border-r px-4 py-2.5">
            <dt className="label-caps text-muted-foreground">Ambiente</dt>
            <dd className="mt-1">
              {connection ? <EnvTag environment={connection.environment} /> : "—"}
            </dd>
          </div>
          <div className="px-4 py-2.5">
            <dt className="label-caps text-muted-foreground">Comandos</dt>
            <dd className="mt-1 font-mono text-sm font-semibold">{count}</dd>
          </div>
        </dl>
        <div className="border-b px-5 py-2.5">
          <p className="label-caps text-muted-foreground">Motivo</p>
          <DialogDescription className="mt-1 text-sm text-foreground">
            {confirmation?.reason}
          </DialogDescription>
        </div>
        <pre className="mx-5 my-4 max-h-80 overflow-auto rounded-[2px] border bg-muted px-3.5 py-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap">
          {confirmation?.statements.map(statement => `${statement}${statementSuffix}`).join("\n\n")}
        </pre>
        <div
          aria-hidden
          className="flex h-6 items-center justify-center label-caps tracking-[0.14em] seal-tape"
        >
          Lacre · rompa só depois de conferir o comando · Lacre
        </div>
        <div className="flex flex-col-reverse gap-2 bg-muted px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground">
            Confira o comando exato antes de confirmar.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onCancel}>
              Cancelar
            </Button>
            <Button variant="destructive" disabled={pending} onClick={onConfirm}>
              {label}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
