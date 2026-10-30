import type { ReactNode } from "react";
import type { ConnectionConfig } from "@/bindings";
import { DialogTitle } from "@/components/ui/dialog";
import { EnvTag } from "@/features/connections/EnvTag";
import { cn } from "@/lib/utils";

/**
 * The exposure record's parts, shared by every sheet that acts on a database (confirmation,
 * parameters, backup): the header on the construction grid closed by the blue diagonal, the
 * ruled connection and environment fields, the safelight strip and the footer.
 */
export function SheetHeader({ title }: { title: string }) {
  return (
    <div className="flex shrink-0 items-end justify-between gap-4 border-b border-foreground px-5 pt-6 pb-3 grid-paper">
      <DialogTitle className="display-caps text-[2rem]">{title}</DialogTitle>
      <svg aria-hidden viewBox="0 0 16 24" className="mb-0.5 h-8 w-5 text-select">
        <line x1="2" y1="23" x2="14" y2="1" stroke="currentColor" strokeWidth="2.5" />
      </svg>
    </div>
  );
}

/** Where the sheet acts, read before anything else on it. */
export function SheetConnection({ connection }: { connection: ConnectionConfig | undefined }) {
  return (
    <dl className="grid grid-cols-[2fr_1fr] border-b">
      <div className="border-r px-5 py-2.5">
        <dt className="legend text-muted-foreground">Conexão</dt>
        <dd className="mt-1.5 truncate text-sm font-semibold">{connection?.name ?? "—"}</dd>
      </div>
      <div className="px-4 py-2.5">
        <dt className="legend text-muted-foreground">Ambiente</dt>
        <dd className="mt-1.5">
          {connection ? <EnvTag environment={connection.environment} labelled /> : "—"}
        </dd>
      </div>
    </dl>
  );
}

/** Production only, always in words: what runs here runs on the production database. */
export function ProdStrip({ children }: { children: ReactNode }) {
  return (
    <p className="flex min-h-7 items-center gap-2 bg-safelight px-5 py-1 text-xs text-safelight-foreground">
      <span className="legend text-[0.75rem]">Produção</span>
      <span>{children}</span>
    </p>
  );
}

type SheetFooterProps = { hint: ReactNode; children: ReactNode; className?: string };

export function SheetFooter({ hint, children, className }: SheetFooterProps) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-col-reverse gap-2 border-t border-foreground bg-muted px-5 py-3 sm:flex-row sm:items-center sm:justify-between",
        className
      )}
    >
      {/* a div: the hint may be the dialog's own description, itself a paragraph */}
      <div className="text-xs text-muted-foreground">{hint}</div>
      <div className="flex justify-end gap-2">{children}</div>
    </div>
  );
}

/** The sheet itself: no padding, the record between header and footer scrolls. */
export const SHEET_CLASS =
  "flex flex-col gap-0 overflow-hidden p-0 duration-[160ms] ease-out motion-safe:data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-top-3 sm:max-w-2xl";
