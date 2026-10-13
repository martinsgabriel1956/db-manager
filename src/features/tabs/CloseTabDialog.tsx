import type { ConnectionConfig } from "@/bindings";
import { DiscardDialog } from "@/components/DiscardDialog";
import { tabLabel } from "@/features/tabs/TabBar";
import { focusActiveTab } from "@/features/tabs/focus";
import { tableKey, useTabs, type TableTab } from "@/features/tabs/store";

type CloseTabDialogProps = { connections: ConnectionConfig[] };

/** Closing tabs with staged edits drops them: say how many, and default to keeping them. */
export function CloseTabDialog({ connections }: CloseTabDialogProps) {
  const { tabs, pending, closeRequest, closeTabs, cancelClose } = useTabs();
  const requested = tabs.filter(tab => closeRequest?.includes(tab.id));
  const staged = (tab: TableTab) => pending[tableKey(tab)] ?? 0;
  // only tables hold staged edits: the dialog names those, not every tab being closed
  const holders = requested.filter(
    (tab): tab is TableTab => tab.kind === "table" && staged(tab) > 0
  );

  return (
    <DiscardDialog
      open={holders.length > 0}
      subject={
        holders.length === 1 ? tabLabel(holders[0], connections) : `${holders.length} tabelas`
      }
      plural={holders.length > 1}
      count={holders.reduce((sum, tab) => sum + staged(tab), 0)}
      consequence={
        requested.length === 1 ? "Fechar a aba descarta todas" : "Fechar as abas descarta todas"
      }
      confirmLabel="Descartar e fechar"
      onConfirm={() => closeTabs(requested.map(tab => tab.id))}
      onCancel={cancelClose}
      // the tab that opened the dialog may be gone: land on whichever tab is active now
      onCloseAutoFocus={event => {
        event.preventDefault();
        focusActiveTab();
      }}
    />
  );
}
