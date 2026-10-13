import type { ConnectionConfig } from "@/bindings";
import { DiscardDialog } from "@/components/DiscardDialog";
import { tabLabel } from "@/features/tabs/TabBar";
import { focusActiveTab } from "@/features/tabs/focus";
import { tableKey, useTabs } from "@/features/tabs/store";

type CloseTabDialogProps = { connections: ConnectionConfig[] };

/** Closing a tab with staged edits drops them: say how many, and default to keeping them. */
export function CloseTabDialog({ connections }: CloseTabDialogProps) {
  const { tabs, pending, closeRequest, close, cancelClose } = useTabs();
  const tab = tabs.find(candidate => candidate.id === closeRequest) ?? null;

  return (
    <DiscardDialog
      open={tab !== null}
      subject={tab ? tabLabel(tab, connections) : ""}
      count={tab?.kind === "table" ? (pending[tableKey(tab)] ?? 0) : 0}
      consequence="Fechar a aba descarta todas"
      confirmLabel="Descartar e fechar"
      onConfirm={() => tab && close(tab.id)}
      onCancel={cancelClose}
      // the tab that opened the dialog may be gone: land on whichever tab is active now
      onCloseAutoFocus={event => {
        event.preventDefault();
        focusActiveTab();
      }}
    />
  );
}
