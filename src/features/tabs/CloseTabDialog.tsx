import { useShallow } from "zustand/react/shallow";
import { commands, type ConnectionConfig } from "@/bindings";
import { DiscardDialog } from "@/components/DiscardDialog";
import { tabLabel } from "@/features/tabs/TabBar";
import { focusActiveTab } from "@/features/tabs/focus";
import { heldEdits, tableKey, useTabs, useTabShapes } from "@/features/tabs/store";

type CloseTabDialogProps = { connections: ConnectionConfig[] };

/**
 * Closing tabs (or quitting) with staged edits drops them: say how many, and default
 * to keeping them.
 */
export function CloseTabDialog({ connections }: CloseTabDialogProps) {
  const tabs = useTabShapes();
  const { pending, closeRequest, closeTabs, cancelClose, quitRequest, cancelQuit } = useTabs(
    useShallow(state => ({
      pending: state.pending,
      closeRequest: state.closeRequest,
      closeTabs: state.closeTabs,
      cancelClose: state.cancelClose,
      quitRequest: state.quitRequest,
      cancelQuit: state.cancelQuit
    }))
  );
  const requested = quitRequest ? tabs : tabs.filter(tab => closeRequest?.includes(tab.id));
  // only tables hold staged edits: the dialog names those, not every tab being closed
  const holders = heldEdits(requested, pending);

  return (
    <DiscardDialog
      open={holders.length > 0}
      subject={
        holders.length === 1 ? tabLabel(holders[0], connections) : `${holders.length} tabelas`
      }
      plural={holders.length > 1}
      count={holders.reduce((sum, tab) => sum + (pending[tableKey(tab)] ?? 0), 0)}
      consequence={
        quitRequest
          ? "Sair do Ordo descarta todas"
          : requested.length === 1
            ? "Fechar a aba descarta todas"
            : "Fechar as abas descarta todas"
      }
      confirmLabel={quitRequest ? "Descartar e sair" : "Descartar e fechar"}
      onConfirm={() => (quitRequest ? commands.quitApp() : closeTabs(requested.map(tab => tab.id)))}
      onCancel={quitRequest ? cancelQuit : cancelClose}
      // the tab that opened the dialog may be gone: land on whichever tab is active now
      onCloseAutoFocus={event => {
        event.preventDefault();
        focusActiveTab();
      }}
    />
  );
}
