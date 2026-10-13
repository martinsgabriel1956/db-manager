import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EngineCode, EnvTag } from "@/features/connections/EnvTag";
import { ENGINE_LABEL, ENGINES } from "@/features/connections/options";
import { useFocusReturn } from "@/features/tabs/focus";
import { RUN_SHORTCUT } from "@/lib/platform";

type LegendDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

type RowProps = { mark: ReactNode; children: ReactNode };

type SectionProps = { title: string; children: ReactNode };

const ENVIRONMENT_MEANING = [
  ["local", "Banco na sua máquina."],
  ["dev", "Banco de desenvolvimento compartilhado."],
  ["staging", "Cópia de produção para testes."],
  ["prod", "Faixa vermelha na janela; toda escrita mostra o comando exato e pede confirmação."]
] as const;

const SHORTCUTS = [
  ["Ctrl+K ou Ctrl+P", "Ir para tabela, coleção ou ação"],
  ["Ctrl+W", "Fechar a aba ativa"],
  ["Ctrl+Tab", "Próxima aba (com Shift, a anterior)"],
  ["Ctrl+S", "Salvar as alterações da tabela"],
  ["F6", "Pular entre lateral, abas e área de trabalho"],
  ["Shift+F10", "Ações da linha na lateral"],
  [RUN_SHORTCUT, "Executar a seleção ou o editor inteiro"],
  ["↑ ↓ ← →", "Andar pela lateral e pela grade"],
  ["Enter / F2", "Editar a célula selecionada"],
  ["Delete", "Fechar a aba focada"],
  ["Esc", "Fechar painel, diálogo ou edição"]
] as const;

function Row({ mark, children }: RowProps) {
  return (
    <li className="grid min-h-7 grid-cols-[8rem_1fr] items-center gap-3 text-[13px]">
      <span className="flex items-center">{mark}</span>
      <span className="text-muted-foreground">{children}</span>
    </li>
  );
}

function Section({ title, children }: SectionProps) {
  return (
    <section className="grid content-start gap-2">
      <h3 className="border-b border-foreground pb-1.5 legend text-muted-foreground">{title}</h3>
      <ul className="grid gap-1">{children}</ul>
    </section>
  );
}

/** What the marks mean, for whoever opens Ordo without its author next to them. */
export function LegendDialog({ open, onOpenChange }: LegendDialogProps) {
  const focusReturn = useFocusReturn();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-3xl lg:max-w-6xl"
        {...focusReturn}
      >
        <DialogTitle className="display-caps text-[1.75rem]">Legenda</DialogTitle>
        <DialogDescription>
          Estado nunca depende só de cor: cada marca tem textura ou palavra.
        </DialogDescription>
        {/* three columns where the window allows: the whole card reads without scrolling at 800px */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Section title="Na grade">
            <Row mark={<span aria-hidden className="h-5 w-16 bg-select" />}>
              Onde você está: tabela aberta, aba ativa, célula selecionada
            </Row>
            <Row
              mark={
                <span
                  aria-hidden
                  className="h-5 w-16 border border-border shadow-[inset_0_-2px_0_var(--foreground)] hatch-band"
                />
              }
            >
              Célula alterada, ainda não salva
            </Row>
            <Row
              mark={
                <span
                  aria-hidden
                  className="h-5 w-16 border border-border bg-success/10 shadow-[inset_0_-2px_0_var(--success)] hatch-band"
                />
              }
            >
              Linha nova, ainda não salva
            </Row>
            <Row
              mark={
                <span
                  aria-hidden
                  className="h-5 w-16 border border-border px-1.5 font-mono text-xs leading-5 text-muted-foreground line-through decoration-foreground/70 decoration-[1.5px] cross-hatch-band"
                >
                  42
                </span>
              }
            >
              Linha marcada para exclusão
            </Row>
            <Row
              mark={
                <span className="h-[18px] bg-foreground px-1 font-mono text-[11px] leading-[18px] text-background">
                  Δ 3
                </span>
              }
            >
              Alterações pendentes, no botão Salvar e na aba
            </Row>
            <Row mark={<Badge variant="held">Somente leitura</Badge>}>
              Imposto pelo próprio banco; na lateral, o cadeado pontilhado{" "}
              <span className="inline-block border border-dotted border-current p-px align-middle">
                <Lock aria-hidden className="size-3" />
              </span>
            </Row>
            <Row
              mark={
                <span className="inline-flex h-[18px] items-center gap-1 bg-filter px-1.5 text-background">
                  <span className="legend">Filtro</span>
                  <span className="font-mono text-[11px]">id = 42</span>
                </span>
              }
            >
              Filtro ou ordenação limitando as linhas (Ordenado tem o mesmo chip)
            </Row>
          </Section>
          <div className="grid content-start gap-6">
            <Section title="Ambientes">
              {ENVIRONMENT_MEANING.map(([environment, meaning]) => (
                <Row key={environment} mark={<EnvTag environment={environment} />}>
                  {meaning}
                </Row>
              ))}
              <li className="pt-1 text-xs text-muted-foreground">
                Em qualquer ambiente, comandos destrutivos (DROP, TRUNCATE, DELETE sem WHERE) pedem
                confirmação.
              </li>
            </Section>
            <Section title="Bancos">
              {ENGINES.map(engine => (
                <Row key={engine} mark={<EngineCode engine={engine} />}>
                  {ENGINE_LABEL[engine]}
                </Row>
              ))}
            </Section>
          </div>
          <Section title="Atalhos">
            {SHORTCUTS.map(([keys, action]) => (
              <Row key={keys} mark={<kbd className="font-mono text-xs">{keys}</kbd>}>
                {action}
              </Row>
            ))}
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
