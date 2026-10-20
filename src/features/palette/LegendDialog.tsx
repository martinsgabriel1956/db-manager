import type { ReactNode } from "react";
import { Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { EngineCode, EnvTag } from "@/features/connections/EnvTag";
import { ENGINE_LABEL, ENGINES } from "@/features/connections/options";
import { useFocusReturn } from "@/features/tabs/focus";
import { RUN_SHORTCUT, SIDEBAR_SHORTCUT } from "@/lib/platform";
import { cn } from "@/lib/utils";

type LegendDialogProps = { open: boolean; onOpenChange: (open: boolean) => void };

/** `narrow`: the mark is a short tag (environment, engine), so the meaning gets the width */
type RowProps = { mark: ReactNode; children: ReactNode; narrow?: boolean };

type SectionProps = { title: string; children: ReactNode };

/** The type code before each suggestion in the SQL editor's autocomplete. */
const COMPLETION_CODES = [
  ["KW", "palavra-chave"],
  ["SC", "schema"],
  ["TB", "tabela ou view"],
  ["CL", "coluna"],
  ["TY", "tipo de dado"],
  ["FN", "função"]
] as const;

const ENVIRONMENT_MEANING = [
  ["local", "Banco na sua máquina."],
  ["dev", "Banco de desenvolvimento compartilhado."],
  ["staging", "Cópia de produção para testes."],
  [
    "prod",
    "Faixa vermelha na janela; toda escrita mostra o comando exato e pede confirmação. Comando destrutivo pede também o nome da conexão."
  ]
] as const;

/** Grouped by where the keys work: twenty in one list read as a wall. */
const SHORTCUT_GROUPS = [
  [
    "Janela e abas",
    [
      ["Ctrl+K ou Ctrl+P", "Ir para tabela, coleção ou ação"],
      ["Ctrl+T", "Nova query SQL na conexão da aba ativa"],
      ["Ctrl+W", "Fechar a aba ativa"],
      ["Ctrl+Shift+T", "Reabrir a última aba fechada, com o texto do editor"],
      ["Ctrl+Tab", "Próxima aba (com Shift, a anterior)"],
      ["Delete", "Fechar a aba focada"],
      ["F6", "Pular entre lateral, abas e área de trabalho"],
      [SIDEBAR_SHORTCUT, "Recolher ou expandir a lateral"],
      ["Shift+F10", "Ações da linha na lateral"],
      [
        "Ctrl+Q",
        "Sair do Ordo. Fechar a janela deixa o app na bandeja e encerra as conexões de produção"
      ]
    ]
  ],
  [
    "Na grade",
    [
      ["↑ ↓ ← →", "Andar pela lateral e pela grade"],
      ["Enter / F2", "Editar a célula selecionada"],
      ["Ctrl+Shift+N", "Definir a célula como NULL"],
      ["Ctrl+Z", "Desfazer a alteração da célula"],
      ["Ctrl+S", "Salvar as alterações da tabela"],
      ["Espaço", "Mostrar o valor inteiro da célula"],
      ["Alt+← →", "Estreitar ou alargar a coluna"],
      ["Alt+Enter", "Abrir a linha apontada pela chave estrangeira da célula"],
      ["Alt+Shift+Enter", "Tabelas com linhas que apontam para a linha selecionada"]
    ]
  ],
  [
    "No editor",
    [
      [RUN_SHORTCUT, "Executar a seleção ou o editor inteiro"],
      ["Esc", "Fechar painel, diálogo ou edição"]
    ]
  ]
] as const;

function Row({ mark, children, narrow = false }: RowProps) {
  return (
    <li
      className={cn(
        "grid min-h-7 items-center gap-3 text-[13px]",
        narrow ? "grid-cols-[5.5rem_1fr]" : "grid-cols-[8rem_1fr]"
      )}
    >
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
      <DialogContent className="sm:max-w-3xl lg:max-w-6xl" {...focusReturn}>
        <DialogTitle className="display-caps text-[1.75rem]">Legenda</DialogTitle>
        <DialogDescription>
          Estado nunca depende só de cor: cada marca tem textura ou palavra.
        </DialogDescription>
        {/* three columns where the window allows, the shortcuts widest so their lines do not wrap:
            the whole card reads without scrolling at 800px */}
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-[0.95fr_0.85fr_1.5fr]">
          <div className="grid content-start gap-6">
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
                  <span aria-hidden className="text-[13px] text-muted-foreground">
                    public <span className="font-mono text-[11px]">2</span>
                  </span>
                }
              >
                Na lateral, quantas tabelas e views (ou coleções) o schema tem
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
            <section className="grid content-start gap-2">
              <h3 className="border-b border-foreground pb-1.5 legend text-muted-foreground">
                No autocompletar
              </h3>
              {/* two to a line: six short codes would otherwise take the height of a column */}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[13px]">
                {COMPLETION_CODES.map(([code, meaning]) => (
                  <div key={code} className="flex min-h-6 items-center gap-2">
                    <dt className="w-6 legend text-foreground">{code}</dt>
                    <dd className="text-muted-foreground">{meaning}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
          <div className="grid content-start gap-6">
            <Section title="Ambientes">
              {ENVIRONMENT_MEANING.map(([environment, meaning]) => (
                <Row key={environment} narrow mark={<EnvTag environment={environment} />}>
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
                <Row key={engine} narrow mark={<EngineCode engine={engine} />}>
                  {ENGINE_LABEL[engine]}
                </Row>
              ))}
            </Section>
          </div>
          <section className="grid content-start gap-2 lg:row-span-2">
            <h3 className="border-b border-foreground pb-1.5 legend text-muted-foreground">
              Atalhos
            </h3>
            {SHORTCUT_GROUPS.map(([group, shortcuts]) => (
              <div key={group} className="grid gap-0.5">
                <h4 className="pt-1 text-xs font-semibold">{group}</h4>
                <ul className="grid">
                  {shortcuts.map(([keys, action]) => (
                    <li
                      key={keys}
                      className="grid min-h-6 grid-cols-[8rem_1fr] items-center gap-3 text-[13px]"
                    >
                      <kbd className="legend">{keys}</kbd>
                      <span className="text-muted-foreground">{action}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>
          {/* plain text, selectable: a link would open inside the app's own window;
              from lg it sits under the two shorter columns, not under the shortcuts */}
          <p className="self-end border-t pt-3 text-xs text-muted-foreground sm:col-span-2">
            Instalação, keychain e bancos de demonstração no README:{" "}
            <span className="font-mono whitespace-nowrap text-foreground select-all">
              github.com/martinsgabriel1956/db-manager
            </span>
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
