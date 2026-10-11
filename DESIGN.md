---
name: DB Manager
description: Cliente desktop de bancos (Postgres, MySQL, SQLite, MongoDB, Redis) desenhado como bancada de laboratório com cadeia de custódia.
colors:
  ink: "#17191b"
  label-stock: "#fbfbf9"
  paper: "#f0f1ee"
  paper-deep: "#e8eae6"
  ink-muted: "#585e63"
  rule: "#dcdedb"
  input-rule: "#868c89"
  seal: "#c62828"
  seal-dark: "#a21f1f"
  select: "#2f63b8"
  success: "#1f7a4d"
  warning: "#8a6500"
  opened: "#fff3c4"
  opened-line: "#efd77c"
  bench: "#22272b"
  bench-raised: "#2c3237"
  bench-foreground: "#dfe3e6"
  bench-muted: "#a9b1b7"
  bench-border: "#3d454b"
  cap-postgres: "#6e4fa3"
  cap-mysql: "#c99700"
  cap-sqlite: "#7d848a"
  cap-mongo: "#1f7a4d"
  cap-redis: "#c2407a"
  syntax-keyword: "#6e4fa3"
  syntax-string: "#1f7a4d"
  syntax-number: "#a8336a"
  syntax-type: "#8a6500"
  night-workspace: "#1b1f22"
  night-card: "#23282c"
  night-ink: "#e6e8e6"
  night-ink-muted: "#a3abb1"
  night-rule: "#2e3439"
  night-bench: "#121517"
  night-bench-raised: "#1d2124"
  night-bench-border: "#2a3035"
  night-label: "#d9dcd6"
  night-label-muted: "#4c5257"
  night-select: "#7ea6ee"
  night-input-rule: "#6b747a"
  bench-select: "#7ea6ee"
  tag-select: "#2f63b8"
  night-destructive-text: "#ef6b6b"
  night-success: "#5cc493"
  night-warning: "#e0b84a"
  night-opened: "#3a3220"
  night-opened-line: "#5a4a22"
typography:
  display:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.05em"
    fontVariation: "'wdth' 66"
  title:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  body:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
    fontFeature: "'tnum'"
  label:
    fontFamily: "Archivo Variable, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.08em"
    fontVariation: "'wdth' 70"
  data:
    fontFamily: "Red Hat Mono Variable, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "28px"
  data-meta:
    fontFamily: "Red Hat Mono Variable, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.25
rounded:
  tag: "2px"
  sm: "3px"
  cap: "1px"
spacing:
  row: "28px"
  tag-height: "18px"
  control: "32px"
  control-sm: "28px"
  bench-width: "288px"
  cap-strip: "6px"
  cap-square: "8px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.label-stock}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 10px"
  button-outline:
    backgroundColor: "{colors.label-stock}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 10px"
  button-ghost:
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 10px"
  button-seal:
    backgroundColor: "{colors.seal}"
    textColor: "#ffffff"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "0 10px"
  env-tag-prod:
    backgroundColor: "{colors.seal}"
    textColor: "#ffffff"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    height: "18px"
    padding: "0 6px"
  env-tag-staging:
    backgroundColor: "{colors.warning}"
    textColor: "{colors.label-stock}"
    typography: "{typography.label}"
    rounded: "{rounded.tag}"
    height: "18px"
    padding: "0 6px"
  connection-label:
    backgroundColor: "{colors.label-stock}"
    textColor: "{colors.ink}"
    typography: "{typography.title}"
    rounded: "{rounded.sm}"
  input:
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    height: "32px"
    padding: "4px 10px"
  grid-row:
    typography: "{typography.data}"
    height: "28px"
    padding: "0 8px"
---

# Design System: DB Manager

## Overview

**Creative North Star: "A Bancada de Custódia"**

Cada conexão e cada registro é uma amostra etiquetada na bancada do laboratório. A lateral é epóxi preto de bancada nos dois temas; as conexões são etiquetas térmicas brancas presas nela, com a cor da tampa do tubo por engine, nome impresso em negrito e o ambiente impresso por extenso. A área de trabalho é papel e etiqueta: densa, em filetes de 1px, cantos de 3px, dados em mono numa grade de 28px. Produção fica sob lacre vermelho hachurado, e escrever nela é assinar um termo de custódia que mostra o comando exato.

O sistema é de operação, não de vitrine: compacto, legível de relance, sem sombras decorativas e sem movimento além do lacre e do termo. O perigo nunca depende só de cor; ambiente, estado editado e lacre sempre se dizem em palavras ou em textura. Recusa a lateral cinza com um azul de destaque típica da categoria e o tema escuro de IDE: o azul existe, mas só marca onde você está.

O tema segue o sistema operacional (`prefers-color-scheme`), sem alternância no app. O escuro não é inversão: é a mesma bancada à noite.

**Key Characteristics:**

- Bancada preta (lateral de 288px) com etiquetas claras; papel na área de trabalho.
- Uma grotesca (Archivo Variable) com versalete condensado para rótulos impressos; Red Hat Mono só para dados e código.
- Linhas de 28px em grades, tabelas e árvore da bancada.
- Lacre vermelho hachurado como único sinal forte de produção, sempre acompanhado de texto.
- Azul só para "onde você está".
- Cantos de 3px (etiquetas de ambiente 2px), filetes de 1px, sem blur.

## Colors

Neutros quase sem croma (tinta, papel, etiqueta, epóxi) com três sinais de alta carga: lacre vermelho, azul de marcador e as cores de tampa por engine.

### Primary

- **Tinta Térmica** (`ink`): texto, ação primária (Salvar/Executar é botão de tinta preta) e o filete grosso do Termo de custódia.
- **Lacre Vermelho** (`seal`, com `seal-dark` nas listras): faixa de lacre de produção, anel interno de 4px da janela em produção, etiqueta PROD e o botão destrutivo. Texto de erro usa `--destructive` (mesmo valor no claro, `night-destructive-text` no escuro); preenchimentos usam `--seal`, que não muda entre temas.

### Secondary

- **Azul de Marcador** (`select`; `night-select` no escuro): seleção, anel de foco (`--ring` tem o mesmo valor), aba ativa (filete superior de 2px), tabela ativa na bancada (filete esquerdo de 3px), célula selecionada (contorno de 2px + fundo a 10%), `accent-color` e `::selection` a 30%. O anel de foco é sempre sólido, 2px, sem alfa: a 50% ele caía para ~2:1. Duas superfícies trocam o `--ring` por escopo, porque o azul do papel não lê nelas: a bancada usa `bench-select` (#7ea6ee, 6,2:1 sobre o epóxi claro) e a etiqueta usa `tag-select` (#2f63b8, 4,2:1 sobre a etiqueta noturna), nos dois temas.

### Tertiary

- **Tampas de Tubo** (`cap-postgres` lavanda, `cap-mysql` ouro, `cap-sqlite` cinza, `cap-mongo` verde, `cap-redis` rosa): faixa de 6px à esquerda da etiqueta de conexão e quadradinho de 8px na aba. Também no ícone do app (faixa lavanda).
- **Amostra Aberta** (`opened` + `opened-line`; `night-opened` + `night-opened-line`): célula editada e ainda não salva, sempre hachurada.
- **Sintaxe** (`syntax-keyword`, `syntax-string`, `syntax-number`, `syntax-type`): CodeMirror e árvore de documentos Mongo. Números em magenta, nunca azul.
- **Estados** (`success`, `warning`): ícones de sucesso no histórico, linha nova na grade a 10%, etiqueta STAGING e medidor de limite do Redis.

### Neutral

- **Etiqueta Térmica** (`label-stock`): fundo da área de trabalho, cartões, popovers e as etiquetas da bancada (`--tag`).
- **Papel** (`paper`): barras de ferramentas, cabeçalhos de grade, gutter do editor, rodapé do termo. Diverge do contrato (#f2f3f1); vale o valor do build.
- **Papel Fundo** (`paper-deep`): secondary e accent.
- **Grafite** (`ink-muted`): texto secundário e segunda linha das etiquetas.
- **Filete** (`rule`) e **Filete de Campo** (`input-rule`; `night-input-rule` no escuro): bordas de 1px e contorno de campos. O filete é decorativo; o de campo é o único limite de um campo transparente e fica em 3:1 ou mais sobre etiqueta e papel (WCAG 1.4.11).
- **Epóxi** (`bench`, `bench-raised`, `bench-border`, `bench-foreground`, `bench-muted`): a lateral, sempre com `color-scheme: dark`.

### Tema escuro: a bancada à noite

- **Área de trabalho** `night-workspace`, cartões e popovers `night-card`, tinta `night-ink`, texto secundário `night-ink-muted`, filetes `night-rule`.
- **A bancada desce para `night-bench` (#121517)**, com `night-bench-raised` e `night-bench-border`, para continuar mais escura que a área de trabalho (#1b1f22) e ainda ler como bancada. Se mantivesse #22272b, ficaria mais clara que o trabalho e a hierarquia se inverteria.
- **As etiquetas baixam para `night-label` (#d9dcd6)**, a etiqueta sob a luz noturna, em vez do #fbfbf9 que ofuscaria sobre o epóxi escuro. A tinta da etiqueta continua `ink` (#17191b) e o texto secundário dela vira `night-label-muted`.
- Azul, sucesso, aviso e sintaxe sobem de luminosidade (`night-select`, `night-success`, `night-warning`, tons claros de sintaxe) para manter AA.

### Named Rules

**The Where-You-Are Rule.** O azul (`--select`) marca só onde você está: seleção, anel de foco, aba ativa, tabela ativa. Nenhum dado usa azul: nem tipos do Redis, nem números no código, nem ícones.

**The Printed Environment Rule.** O ambiente é sempre impresso em palavras numa etiqueta: PROD em `--seal` cheio, STAGING em fundo `--warning`, DEV em contorno sólido, LOCAL em contorno tracejado. Nunca só cor.

**The Tube-Cap Rule.** Cor de engine aparece só como faixa ou quadradinho (`--cap-*`), nunca como cor de texto.

**The Opened-Sample Rule.** Célula editada e não salva leva a hachura âmbar (`opened-hatch`), para que o estado nunca dependa só de cor.

## Typography

**Display/Body Font:** Archivo Variable (com eixo de largura; fallback sans-serif)
**Data/Code Font:** Red Hat Mono Variable (fallback ui-monospace, monospace)

**Character:** Uma só grotesca com dois registros: texto corrido normal e letreiro impresso de etiqueta (versalete condensado). O mono é a voz do dado gravado e só aparece onde há dado ou código. Números são tabulares no app inteiro (`font-variant-numeric: tabular-nums` no `html`).

### Hierarchy

- **Display** (800, 1.75rem, largura 66%, versalete, 0.05em): só o título "Termo de custódia".
- **Title** (600, 13px): nome da conexão na etiqueta; linhas da bancada em 13px regular.
- **Body** (400, 0.875rem): interface geral, botões (500), diálogos. Títulos de diálogo genéricos em 1rem/600.
- **Label** (700, 0.6875rem, largura 70%, 0.08em, versalete, utilitário `label-caps`): rótulos impressos: CONEXÕES, campos do termo, etiquetas de ambiente, badges, `Label` de formulário, cabeçalho de seção como HISTÓRICO.
- **Data** (Red Hat Mono, 0.75rem, linha de 28px): células da grade, editores, comando no termo.
- **Data Meta** (Red Hat Mono, 11px): segunda linha da etiqueta (engine e alvo), contagens na bancada.

### Named Rules

**The One Grotesque Rule.** Archivo é a única família de interface; o registro de display é o versalete condensado de `label-caps`, não uma segunda fonte.

**The Mono-Means-Data Rule.** Red Hat Mono só para dado e código; nunca para rótulos ou navegação.

**The 11px Floor Rule.** Texto funcional nunca abaixo de 11px.

## Layout

Janela padrão 1200×800, mínimo 960×600. Lateral fixa de 288px (`w-72`) em epóxi, área de trabalho com barra de abas, barra de ferramentas em papel e conteúdo. Em produção, a faixa de lacre (28px de altura) ocupa o topo da janela inteira e um anel interno de 4px em `--seal` contorna tudo, desenhado acima dos painéis.

Densidade compacta: controles de 32px (28px no tamanho `sm`, 24px no `xs`), etiqueta de ambiente de 18px. Ritmo base de 4px (gaps de 4, 6, 8, 12, 16px).

**The 28px Row Rule.** Grade de resultados, tabelas de entradas e linhas da bancada usam a mesma altura de 28px.

Escalas de medida preenchida: barras de duração no histórico (até 96px, proporcionais à maior duração, mínimo 2px, `foreground` a 60%) e o medidor de limite do Redis (128×6px, trilho `--border`, preenchimento `--warning`) mostram limites reais como medida, sempre acompanhados do número ou da frase.

## Elevation & Depth

Plano por padrão; profundidade por tom (bancada escura, etiqueta clara, papel) e por filetes de 1px. Não há desfoque de fundo; o overlay de diálogo é `black/30` liso.

### Shadow Vocabulary

- **Borda de etiqueta** (`box-shadow: 0 1px 0 rgb(0 0 0 / 0.4)`): a etiqueta de conexão colada na bancada. Nos nós do diagrama ER, `0 1px 0 rgb(0 0 0 / 0.25)`.
- **Termo de custódia** (`box-shadow: 0 20px 44px -14px rgb(0 0 0 / 0.5)`): a única sombra projetada, o formulário sobre a bancada.
- **Marcadores internos** (`inset 0 2px 0 var(--select)` na aba ativa, `inset 3px 0 0 var(--select)` na tabela ativa): não são elevação, são o azul de "onde você está".

### Named Rules

**The No-Blur Rule.** Sem `backdrop-filter`. Diálogos genéricos usam anel de 1px (`foreground` a 15%) e não animam.

## Shapes

Cantos de 3px (`--radius: 0.1875rem`; botões, campos, diálogos, etiquetas de conexão), 2px nas etiquetas de ambiente, badges e linhas da bancada, 1px nos quadradinhos de tampa e nas barras de duração. Filetes de 1px; o único filete grosso é o de 2px sob o título do termo. Duas texturas recorrentes, ambas listras a 135°: a fita de lacre (`seal-tape`, 22px de `--seal` + 4px de `--seal-dark`, texto branco) e a amostra aberta (`opened-hatch`, 6px de `--opened` + 1px de `--opened-line`).

O ícone do app (`src-tauri/icons/icon.svg`) repete o mundo: fundo `bench`, etiqueta `label-stock` com faixa lavanda de Postgres, linhas em `ink` e `ink-muted`, fita de lacre na base.

## Components

### Buttons

Tinta sobre papel, sem enfeite.

- **Shape:** 3px, altura 32px (sm 28px, xs 24px), padding horizontal 10px, texto 0.875rem/500.
- **Primary:** fundo `ink`, texto `label-stock`; hover a 85%.
- **Outline:** contorno `input-rule`, fundo de etiqueta (transparente no escuro); hover em papel.
- **Ghost:** sem fundo; hover em papel. Na bancada, outline e ghost trocam para `bench-border`/`bench-raised`.
- **Destructive (romper lacre):** `--seal` cheio, texto branco 600. Reservado para confirmar escrita destrutiva ou em produção.
- **Focus:** borda `--ring` + anel de 3px em `--ring` a 50% (no destrutivo, `--seal` a 40%). Active desce 1px.

### Chips (etiquetas de ambiente e badges)

- **Style:** 18px de altura, 2px de canto, `label-caps`. PROD `--seal` + branco; STAGING `--warning` + `primary-foreground`; DEV contorno sólido `currentColor`; LOCAL contorno tracejado `currentColor`.
- **State:** estáticos; o texto é o significado.

### Cards / Containers

- **Etiqueta de conexão:** 3px, `--tag` sobre a bancada, faixa de tampa de 6px à esquerda, nome 13px/600, segunda linha mono 11px em `--tag-muted`, etiqueta de ambiente à direita, cadeado para somente leitura. Ações aparecem no hover/focus-within.
- **Linhas da bancada:** 28px, 13px, texto `bench-muted`/`bench-foreground`; hover `bench-raised`; ativa vira fatia de etiqueta (`--tag`, 600) com marcador azul de 3px.

### Inputs / Fields

- **Style:** 32px, 3px, contorno `input-rule`, fundo transparente (no escuro `input` a 30%). Select nativo idêntico.
- **Focus:** borda `--ring` + anel de 3px a 50%.
- **Error / Disabled:** borda `--destructive` + anel a 20%; desabilitado a 50% de opacidade.
- **Label:** `label-caps` em `muted-foreground`.

### Navigation

- **Abas de trabalho:** barra em papel a 40%, cada aba separada por filete; ativa em `background`, 500, filete azul superior de 2px; quadradinho de tampa de 8px antes do ícone.
- **Tabs internas:** sublinhado de 2px em `--select` no ativo, 600.
- **Árvore de chaves do Redis:** lista de botões com `aria-expanded` nas pastas (não `role="tree"`), linhas de 28px, cantos de 2px; a chave aberta leva `--select` a 10% e marcador de 3px, como a tabela ativa.

### Grade de resultados

Mono 0.75rem, linhas de 28px, colunas com filete direito, cabeçalho fixo em papel (nome 600 + tipo em `muted-foreground`). Números à direita; `null` em itálico secundário; linha nova `success` a 10%; excluída `destructive` a 10% riscada; editada com `opened-hatch`; selecionada com contorno azul de 2px.

### Termo de custódia (assinatura)

O diálogo de confirmação. Título em display, filete de 2px em tinta, campos impressos (Conexão, Ambiente com etiqueta, Comandos) em grade 2fr/1fr/1fr, Motivo, o comando exato em mono sobre papel, fita de lacre ("Lacre · rompa só depois de conferir o comando · Lacre") e rodapé em papel com Cancelar (outline) e o botão destrutivo. Em produção o botão sempre diz "Romper lacre e …". Entra em 120ms com fade e slide curto, protegido por `motion-reduce`.

### Faixa de lacre de produção

28px no topo da janela, `seal-tape`, ícone de alerta, "LACRE DE PRODUÇÃO" em `label-caps`, nome da conexão e o regime (somente leitura ou confirmação de escrita). Entra em 120ms com `motion-reduce` guardado. Acompanhada do anel de 4px em `--seal`.

### Editor (CodeMirror)

Fundo `background`, gutter em papel com filete, linha ativa em papel a 60%, seleção em `--ring` a 40%, foco com contorno de 2px em `--ring` a 50%, cores de sintaxe pelos tokens `--syntax-*`.

## Do's and Don'ts

### Do:

- **Do** reservar `--select` para seleção, anel de foco, aba ativa e tabela ativa.
- **Do** imprimir o ambiente em palavras numa etiqueta: PROD `--seal` cheio, STAGING fundo `--warning`, DEV contorno sólido, LOCAL contorno tracejado.
- **Do** usar a cor de tampa (`--cap-postgres/mysql/sqlite/mongo/redis`) só como faixa ou quadradinho.
- **Do** usar o botão destrutivo (`--seal` cheio) só para confirmar escrita destrutiva ou em produção; em produção o botão do ConfirmDialog sempre diz "Romper lacre e …".
- **Do** usar Archivo Variable para toda a interface, `label-caps` para rótulos impressos, Red Hat Mono só para dado e código.
- **Do** manter linhas de 28px em grades e tabelas e texto funcional em 11px ou mais.
- **Do** manter a bancada mais escura que a área de trabalho nos dois temas (#121517 contra #1b1f22 no escuro) e as etiquetas em #d9dcd6 à noite.
- **Do** seguir o tema do SO (`prefers-color-scheme`).

### Don't:

- **Don't** usar azul em dado: tipos do Redis, números no código, ícones.
- **Don't** indicar ambiente, produção ou estado editado só por cor.
- **Don't** pintar texto com cor de engine.
- **Don't** usar `--seal` cheio para ações comuns.
- **Don't** introduzir segunda família de interface nem mono fora de dado/código.
- **Don't** animar nada além da faixa de lacre e do Termo de custódia (120ms, `motion-reduce`); diálogos genéricos não animam.
- **Don't** usar `backdrop-filter`/blur nem sombras decorativas.
- **Don't** adicionar alternância de tema no app.

---

Revisão de acabamento: disposição "ship" após uma rodada de correções (8 correções pontuadas como resolvidas).
