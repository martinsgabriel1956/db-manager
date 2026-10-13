import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands } from "@/bindings";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle
} from "@/components/ui/dialog";
import { useFocusReturn } from "@/features/tabs/focus";

const SEEN_KEY = "tray-notice-seen";

type CloseWindowDialogProps = {
  /** quits like Ctrl+Q: staged edits are asked about first */
  onQuit: () => void;
};

/**
 * The window's X hides Ordo in the tray (see src-tauri/src/lib.rs). It looks like
 * quitting, so the first time it says what really happens before hiding; afterwards
 * it hides at once. Esc keeps the window.
 */
export function CloseWindowDialog({ onQuit }: CloseWindowDialogProps) {
  const [open, setOpen] = useState(false);
  const focusReturn = useFocusReturn();

  useEffect(() => {
    const stop = listen("close-requested", () => {
      if (localStorage.getItem(SEEN_KEY) === "1") {
        void commands.hideWindow();
      } else {
        setOpen(true);
      }
    });
    return () => void stop.then(unlisten => unlisten());
  }, []);

  function answer(then: () => void) {
    localStorage.setItem(SEEN_KEY, "1");
    setOpen(false);
    then();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent showCloseButton={false} className="sm:max-w-md" {...focusReturn}>
        <DialogTitle>O Ordo continua na bandeja</DialogTitle>
        <DialogDescription>
          Fechar a janela não encerra o app. As conexões de produção são encerradas agora e reabrem
          quando você voltar a usá-las; as demais continuam abertas.
        </DialogDescription>
        <p className="text-sm text-muted-foreground">
          Para sair de vez: <span className="text-foreground">Sair</span>, no menu da bandeja, ou{" "}
          <kbd className="font-mono text-[11px] text-foreground">Ctrl Q</kbd>. Este aviso aparece só
          desta vez.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={() => answer(onQuit)}>
            Sair do Ordo
          </Button>
          <Button autoFocus onClick={() => answer(() => void commands.hideWindow())}>
            Esconder na bandeja
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
