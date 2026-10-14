import { Button } from "@/components/ui/button";
import { ConnectionContext } from "@/features/connections/ConnectionContext";
import { useTabs } from "@/features/tabs/store";

type ReceiptProps = {
  connectionId: string;
  confirmed: boolean;
  text: string | null;
  /** what happened in the database: "executado" for a run, "salvo" for a table save */
  verb?: string;
};

/**
 * The receipt of a confirmed write: where it ran, then the result, then where it was recorded.
 * The confirmation was the ritual; this closes it, in the editor and in the table alike.
 */
export function Receipt({ connectionId, confirmed, text, verb = "executado" }: ReceiptProps) {
  const openHistory = useTabs(state => state.openHistory);
  if (!confirmed) {
    return <span>{text}</span>;
  }
  return (
    <>
      {/* the same legend that marks a cancelled run: the ritual ends in a mark, not in fine print */}
      <span className="shrink-0">
        <span className="legend text-[0.75rem]">Confirmado</span>
        {/* a narrow bar keeps the mark and where it ran */}
        <span className="hidden @min-[52rem]:inline"> e {verb}</span> em
      </span>{" "}
      {/* never narrower than its environment tag: the name truncates, PROD stays whole */}
      <ConnectionContext connectionId={connectionId} className="min-w-min" />{" "}
      {/* the count never wraps: in a narrow bar the connection name truncates first */}
      <span className="shrink-0 whitespace-nowrap text-muted-foreground">· {text} ·</span>{" "}
      {/* one text for the live region either way; a narrow bar shows only "histórico" */}
      <Button
        size="xs"
        variant="link"
        aria-label="Ver no histórico"
        className="h-auto px-0 underline"
        onClick={openHistory}
      >
        {/* one inline run, so the underline is one line and not one per word */}
        <span>
          <span className="hidden @min-[52rem]:inline">Ver no </span>histórico
        </span>
      </Button>
    </>
  );
}
