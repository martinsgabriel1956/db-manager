import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { commands, type ConnectionConfig } from "@/bindings";
import { DiscardDialog } from "@/components/DiscardDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle
} from "@/components/ui/dialog";
import { tabLabel } from "@/features/tabs/TabBar";
import { useFocusReturn } from "@/features/tabs/focus";
import { heldEdits, tableKey, useTabs } from "@/features/tabs/store";
import { errorMessage } from "@/lib/errors";

type Offer = { current: string; version: string; installable: boolean };

type Step =
  | { kind: "checking" }
  | ({ kind: "offer" } & Offer)
  /** staged edits would die with the restart: asked first, like Ctrl+Q */
  | ({ kind: "discard" } & Offer)
  | { kind: "installing"; version: string }
  | { kind: "latest"; current: string }
  | { kind: "failed"; message: string; releasePage: boolean };

type UpdateDialogProps = { connections: ConnectionConfig[] };

/**
 * Checks GitHub Releases once at launch (quietly: offline is only logged, see
 * src-tauri/src/commands/update.rs) and again from the tray's "Procurar atualizações",
 * which also says when there is nothing new. Nothing installs without a yes here.
 */
export function UpdateDialog({ connections }: UpdateDialogProps) {
  const [step, setStep] = useState<Step | null>(null);
  const { tabs, pending } = useTabs();
  const focusReturn = useFocusReturn();
  const holders = heldEdits(tabs, pending);

  useEffect(() => {
    async function check(manual: boolean) {
      if (manual) {
        setStep({ kind: "checking" });
      }
      try {
        const { current, available, installable } = await commands.checkUpdate();
        if (available) {
          setStep({ kind: "offer", current, version: available, installable });
        } else if (manual) {
          setStep({ kind: "latest", current });
        }
      } catch (error) {
        if (manual) {
          setStep({ kind: "failed", message: errorMessage(error), releasePage: false });
        }
      }
    }
    void check(false);
    const stop = listen("check-updates", () => void check(true));
    return () => void stop.then(unlisten => unlisten());
  }, []);

  async function install(version: string) {
    setStep({ kind: "installing", version });
    try {
      // on success the app restarts and this never returns
      await commands.installUpdate();
    } catch (error) {
      setStep({ kind: "failed", message: errorMessage(error), releasePage: true });
    }
  }

  async function openReleasePage() {
    try {
      await commands.openReleasePage();
      setStep(null);
    } catch (error) {
      setStep({ kind: "failed", message: errorMessage(error), releasePage: false });
    }
  }

  const close = () => setStep(null);
  const releaseButton = (
    <Button onClick={() => void openReleasePage()}>Abrir página do release</Button>
  );

  return (
    <>
      <Dialog
        open={step !== null && step.kind !== "discard"}
        // a running install cannot be dismissed: it ends in a restart or an error
        onOpenChange={open => !open && step?.kind !== "installing" && close()}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-md" {...focusReturn}>
          {step?.kind === "checking" && (
            <>
              <DialogTitle>Procurando atualizações</DialogTitle>
              <DialogDescription>Consultando o GitHub Releases…</DialogDescription>
            </>
          )}
          {step?.kind === "offer" && (
            <>
              <DialogTitle>Ordo {step.version} disponível</DialogTitle>
              <DialogDescription>
                Você está na versão {step.current}.{" "}
                {step.installable
                  ? "Instalar baixa a versão nova, confere a assinatura e reinicia o Ordo."
                  : "Esta instalação não se atualiza sozinha: baixe o pacote na página do release."}
              </DialogDescription>
              <DialogFooter>
                <Button variant="outline" autoFocus onClick={close}>
                  Agora não
                </Button>
                {step.installable ? (
                  <Button
                    onClick={() =>
                      holders.length > 0
                        ? setStep({ ...step, kind: "discard" })
                        : void install(step.version)
                    }
                  >
                    Instalar e reiniciar
                  </Button>
                ) : (
                  releaseButton
                )}
              </DialogFooter>
            </>
          )}
          {step?.kind === "installing" && (
            <>
              <DialogTitle>Instalando o Ordo {step.version}</DialogTitle>
              <DialogDescription>
                Baixando e instalando; o Ordo reinicia sozinho ao terminar. Instalado pelo .deb, o
                sistema pede a senha de administrador.
              </DialogDescription>
            </>
          )}
          {step?.kind === "latest" && (
            <>
              <DialogTitle>O Ordo está atualizado</DialogTitle>
              <DialogDescription>A versão {step.current} é a mais recente.</DialogDescription>
              <DialogFooter>
                <Button autoFocus onClick={close}>
                  Fechar
                </Button>
              </DialogFooter>
            </>
          )}
          {step?.kind === "failed" && (
            <>
              <DialogTitle>
                {step.releasePage ? "A atualização não foi instalada" : "Falha na atualização"}
              </DialogTitle>
              <DialogDescription>
                {step.message}
                {step.releasePage &&
                  ". O Ordo continua na versão atual; o pacote novo está na página do release."}
              </DialogDescription>
              <DialogFooter>
                <Button variant="outline" autoFocus onClick={close}>
                  Fechar
                </Button>
                {step.releasePage && releaseButton}
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
      <DiscardDialog
        open={step?.kind === "discard"}
        subject={
          holders.length === 1 ? tabLabel(holders[0], connections) : `${holders.length} tabelas`
        }
        plural={holders.length > 1}
        count={holders.reduce((sum, tab) => sum + (pending[tableKey(tab)] ?? 0), 0)}
        consequence="Reiniciar para atualizar descarta todas"
        confirmLabel="Descartar e atualizar"
        onConfirm={() => step?.kind === "discard" && void install(step.version)}
        onCancel={() => step?.kind === "discard" && setStep({ ...step, kind: "offer" })}
      />
    </>
  );
}
