---
name: Ordo
description: Cliente desktop de bancos (Postgres, MySQL, SQLite, MongoDB, Redis) desenhado como ampliação em andamento sobre uma grade de construção.
colors:
  z0: "#0f1011"
  z1: "#1d1f22"
  z2: "#2c2f33"
  z3: "#3e4247"
  z4: "#4f545a"
  z5: "#5c6269"
  z6: "#80868d"
  z7: "#b4b9bf"
  z8: "#dde0e5"
  z9: "#eef0f3"
  z10: "#f7f8fa"
  night-z0: "#f1f3f5"
  night-z1: "#e2e5e9"
  night-z2: "#c9cdd3"
  night-z3: "#b0b6bd"
  night-z4: "#9aa1a9"
  night-z5: "#8d949c"
  night-z6: "#6b737b"
  night-z7: "#4a5057"
  night-z8: "#2c3035"
  night-z9: "#1a1d20"
  night-z10: "#101113"
  grid: "#e3e9f2"
  night-grid: "#222a38"
  select: "#0057ff"
  select-foreground: "#ffffff"
  night-select: "#6f9bff"
  filter: "#c8137a"
  night-filter: "#ff5fae"
  safelight: "#c4291c"
  night-destructive-text: "#ff6a4d"
  success: "#0f7446"
  night-success: "#4cc98a"
  warning: "#8f5c00"
  night-warning: "#e0a640"
typography:
  display:
    fontFamily: "Saira Variable, sans-serif"
    fontSize: "1.75rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontVariation: "'wdth' 80"
  display-caps:
    fontFamily: "Saira Variable, sans-serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.05em"
    fontVariation: "'wdth' 60"
  legend:
    fontFamily: "Saira Variable, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.1em"
    fontVariation: "'wdth' 75"
  title:
    fontFamily: "Hanken Grotesk Variable, sans-serif"
    fontSize: "13px"
    fontWeight: 600
  body:
    fontFamily: "Hanken Grotesk Variable, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
    fontFeature: "'tnum'"
  data:
    fontFamily: "Spline Sans Mono Variable, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "28px"
    fontFeature: "'tnum'"
  data-meta:
    fontFamily: "Spline Sans Mono Variable, ui-monospace, monospace"
    fontSize: "11px"
    fontWeight: 400
rounded:
  none: "0px"
spacing:
  grid-cell: "14px"
  row: "28px"
  tag-height: "18px"
  engine-cell: "24px"
  control: "32px"
  control-sm: "28px"
  tab-bar: "36px"
  header: "56px"
  sidebar-width: "288px"
components:
  button-primary:
    backgroundColor: "{colors.z0}"
    textColor: "{colors.z10}"
    rounded: "{rounded.none}"
    height: "32px"
    padding: "0 10px"
  button-primary-hover:
    backgroundColor: "{colors.z5}"
  button-outline:
    backgroundColor: "{colors.z10}"
    textColor: "{colors.z0}"
    rounded: "{rounded.none}"
    height: "32px"
    padding: "0 10px"
  button-ghost:
    textColor: "{colors.z0}"
    rounded: "{rounded.none}"
    height: "32px"
    padding: "0 10px"
  button-safelight:
    backgroundColor: "{colors.safelight}"
    textColor: "#ffffff"
    rounded: "{rounded.none}"
    height: "32px"
    padding: "0 10px"
  env-tag-prod:
    backgroundColor: "{colors.safelight}"
    textColor: "#ffffff"
    typography: "{typography.legend}"
    rounded: "{rounded.none}"
    height: "18px"
    padding: "0 6px"
  filter-chip:
    backgroundColor: "{colors.filter}"
    textColor: "{colors.z10}"
    typography: "{typography.legend}"
    rounded: "{rounded.none}"
    height: "18px"
    padding: "0 6px"
  delta-count:
    backgroundColor: "{colors.z0}"
    textColor: "{colors.z10}"
    typography: "{typography.data-meta}"
    rounded: "{rounded.none}"
    height: "18px"
    padding: "0 4px"
  engine-code:
    typography: "{typography.legend}"
    rounded: "{rounded.none}"
    size: "24px"
  input:
    textColor: "{colors.z0}"
    rounded: "{rounded.none}"
    height: "32px"
    padding: "4px 10px"
  tree-row-active:
    backgroundColor: "{colors.select}"
    textColor: "{colors.select-foreground}"
    height: "28px"
    padding: "0 6px"
  grid-row:
    typography: "{typography.data}"
    height: "28px"
    padding: "0 8px"
---

# Design System: Ordo

## Overview

**Creative North Star: "Ampliação em Grade"**

O banco é uma ampliação em andamento sobre uma grade de construção: a ficha de exposição do laboratório fotográfico fundida com o espécime tipográfico em grade de Wim Crouwel. Cada valor tem sua zona exata numa escala de 11 tons, a grade de construção aparece onde não há dado, cada alteração não salva é exposição a mais (hachura com contagem Δ) e produção trabalha sob luz de segurança.

O sistema é de operação: denso, cantos retos, filetes de 1px, filete de tinta (Z0) nas divisões principais, sem desfoque. Estado se lê em textura e em palavras antes de cor: hachura diagonal é alterado, cruzada é excluído ou em conflito, contorno pontilhado é retido (somente leitura). Recusa a lateral cinza com um azul de destaque típica da categoria e o escuro de IDE com neon.

O tema segue o sistema operacional (`prefers-color-scheme`), sem alternância no app. O escuro é a câmara escura: a mesma escala de zonas lida do outro lado, não uma paleta paralela.

**Key Characteristics:**

- Neutros só da escala de zonas Z0..Z10; nada de cinza avulso.
- Grade de construção de 14px (duas células por linha de 28px) na lateral, estados vazios, cabeçalho da ficha de exposição e canvas do diagrama; nunca atrás de dados.
- Três sinais com um papel cada: azul Crouwel (onde você está), magenta dicroico (filtração), luz de segurança (produção e destrutivo).
- Saira com eixo de largura para letreiros e identificadores, Hanken Grotesk para interface, Spline Sans Mono tabular para dado.
- O Δ de exposição: alterações em stage hachuradas, contadas no botão Salvar e na aba, reveladas ao salvar.
- Cantos de 0px em tudo.

## Colors

Uma escala de zonas quase acromática, uma grade azul-acinzentada e três sinais de alta carga, cada um preso a um único significado.

### Primary

- **Azul Crouwel** (`select`; `night-select` no escuro): onde você está. Tabela ativa na lateral (linha cheia em azul com texto `select-foreground`), chave aberta do Redis (idem), aba ativa (filete interno de 3px no topo + triângulo de canto), sublinhado de 2px das tabs internas, célula selecionada (contorno de 2px + fundo a 10%), anel de foco (`--ring`), cursor e `caret-color`, `accent-color`, `::selection` a 28%. Também é a cor da única diagonal do sistema (barra que fecha a marca ORDO/, cabeçalho da ficha de exposição) e do canto cortado (aba ativa, ícone do app).

### Secondary

- **Magenta Dicroico** (`filter`; `night-filter` no escuro): só filtração. Chip FILTRO ATIVO cheio, setas de ordenação e filete inferior de 2px no cabeçalho da coluna ordenada, contorno do campo de padrão SCAN do Redis quando difere de `*`.

### Tertiary

- **Luz de Segurança** (`safelight`): produção e destrutivo. Faixa de produção de 28px no topo da janela, anel interno de 4px em volta da janela, etiqueta PROD cheia, faixa da ficha de exposição em produção, botão destrutivo. Preenchimentos usam `--safelight` (igual nos dois temas); texto de erro usa `--destructive`, que no escuro sobe para `night-destructive-text`.
- **Estados** (`success`, `warning`, com versões `night-`): linha nova na grade (`success` a 10% + hachura), aviso salvo, ícones do histórico; também são as cores de string e número na sintaxe.

### Neutral

- **Escala de Zonas Z0..Z10**: Z0 é tinta (texto, botão primário, filetes principais, contagem Δ), Z10 é papel (fundo de trabalho, cartões, popovers), Z9 é o fundo da grade e de barras (`muted`, `secondary`, `accent`), Z8 é o filete comum (`border`), Z6 é o contorno de campo (`input`, 3:1 ou mais sobre papel e grade, WCAG 1.4.11), Z5 é texto secundário (`muted-foreground`), Z7 é a barra de rolagem. No escuro, `night-z0..night-z10` ocupam os mesmos papéis pelo mesmo nome de zona.
- **Grade de Construção** (`grid`; `night-grid`): só o desenho da grade, em hairline de 1px.
- **Tinta da Hachura** (`--hatch`, Z0 a 38% no claro e 34% no escuro): derivada da zona, não é cor própria.

### Named Rules

**The Zone Rule.** Todo neutro sai da escala Z0..Z10. Um cinza fora da escala é um defeito.

**The Where-You-Are Rule.** O azul marca só onde você está (e desenha a diagonal da marca). Nenhum dado, ícone de tipo ou número de código é azul.

**The Filtration Rule.** Magenta só aparece quando algo filtra ou ordena as linhas. Sem filtro, sem magenta.

**The Safelight Rule.** Luz de segurança cheia só em produção e na confirmação destrutiva, sempre acompanhada de palavras ("Produção", "Executar em produção").

## Typography

**Display Font:** Saira Variable (eixo `wdth`; fallback sans-serif)
**Body Font:** Hanken Grotesk Variable (fallback sans-serif)
**Label/Mono Font:** Spline Sans Mono Variable (fallback ui-monospace, monospace)

**Character:** Saira condensada é o letreiro do espécime: versal espaçada para legendas e títulos, caixa preservada para identificadores. Hanken Grotesk carrega a interface sem chamar atenção; Spline Sans Mono é a voz do dado gravado. Números são tabulares no app inteiro (`font-variant-numeric: tabular-nums` no `html`).

### Hierarchy

- **Display** (Saira 600, largura 80%, -0.01em, caixa preservada, utilitário `display`): identificadores, que são dado. Nome da tabela, coleção ou db do Redis no cabeçalho da view (1.75rem), título de diálogos genéricos (1.25rem). A marca ORDO usa `display-caps` a 1.75rem com largura 75% e 0.14em, fechada pela diagonal azul.
- **Display Caps** (Saira 600, largura 60%, 0.05em, versal, utilitário `display-caps`): títulos que não são identificadores. "Confirmar execução" (2rem), estados vazios ("Nenhuma aba aberta" 3.75rem, "Nada no histórico" 2.25rem, "Sem resultado" 1.875rem), "Histórico" (1.25rem), "SQL" (1.125rem), MANAGER na marca.
- **Legend** (Saira 600, 0.6875rem, largura 75%, 0.1em, versal, utilitário `legend`): CONEXÕES, campos da ficha, `Label` de formulário, etiquetas de ambiente, badges, chip de filtro, código da engine (0.75rem), palavra "Produção" na faixa (0.75rem).
- **Title** (Hanken 600, 13px): nome da conexão no registro; linhas da árvore em 13px regular.
- **Body** (Hanken 400, 0.875rem; botões 500): interface geral e diálogos. Parágrafos de estado vazio limitados a 46ch.
- **Data** (Spline Sans Mono, 0.75rem, linha de 28px): células da grade, editores, comando exato na ficha.
- **Data Meta** (Spline Sans Mono, 11px): alvo da conexão, contagens na árvore, contagem Δ, tipo da coluna no cabeçalho.

### Named Rules

**The Identifier-Keeps-Case Rule.** Nome de tabela, coleção ou banco usa `display` com a caixa original; só títulos que não são dado usam `display-caps`.

**The Mono-Means-Data Rule.** Spline Sans Mono só para dado, código e quantidades; nunca para rótulos ou navegação.

**The 11px Floor Rule.** Texto funcional nunca abaixo de 11px.

## Layout

Janela padrão 1200×800, mínimo 960×600. Lateral fixa de 288px sobre a grade de construção visível, separada da área de trabalho por filete de tinta; cabeçalho da marca de 56px (quatro células da grade) em papel. Área de trabalho em Z10 limpa: barra de abas de 36px em Z9 com filete de tinta inferior, cabeçalho da view com filete de tinta, barra de ferramentas, conteúdo. Em produção, faixa de 28px no topo da janela inteira e anel interno de 4px desenhado acima dos painéis.

Densidade compacta: controles de 32px (28px `sm`, 24px `xs`), etiquetas de 18px, casa da engine de 24px. Ritmo base de 4px.

**The 28px Row Rule.** Grade de resultados, linhas da árvore e tabelas de entradas usam 28px, exatamente duas células da grade.

**The Grid-Where-No-Data Rule.** A grade de construção aparece na lateral, nos estados vazios, no cabeçalho da ficha de exposição e no canvas do diagrama. Onde há dado (o registro de conexões, a grade, os cartões), o fundo é papel liso por cima da grade.

## Elevation & Depth

Plano. Profundidade vem de zona (Z10 sobre Z9), de filetes de 1px e do filete de tinta Z0 nas divisões principais. O overlay de diálogo é `black/30` liso, sem desfoque.

### Shadow Vocabulary

- **Folha sobre a mesa** (`box-shadow: 0 18px 40px -16px rgb(0 0 0 / 0.45)`, com anel de 1px em tinta): a única sombra projetada, em todo diálogo.
- **Marcadores internos** (`inset 0 3px 0 var(--select)` na aba ativa; `inset 0 -2px 0 var(--filter)` na coluna ordenada; `inset 0 -2px 0 var(--foreground)` na célula editada; `inset 0 0 0 1px var(--ring)` em campo focado; `inset 0 2px 0 var(--ring)` no console Redis focado): não são elevação, são filetes de estado.

### Named Rules

**The No-Blur Rule.** Sem `backdrop-filter` e sem sombras decorativas; a folha do diálogo é a única sombra.

## Shapes

Cantos de 0px em tudo (`--radius: 0px`, todas as escalas de raio zeradas). Filetes de 1px; em tinta nas divisões principais, Z8 nas internas. A única diagonal é a linha azul que fecha a marca, repetida no cabeçalho da ficha de exposição; o triângulo azul de canto da aba ativa e do ícone é o corte dessa diagonal.

Texturas de estado, todas em `--hatch`:

- **Hachura** (`hatch`, 135°, 1px a cada 6px): alterado/em stage; também a casa hachurada da etiqueta STAGING.
- **Hachura cruzada** (`cross-hatch`, 135° + 45°): excluído ou em conflito.
- **Banda de hachura** (`hatch-band` / `cross-hatch-band`, 7px na base da célula, 1px a cada 5px): na grade a hachura fica numa banda sob o valor, nunca atrás dos dígitos.
- **Pontilhado** (`border-dotted`): retido. Etiqueta LOCAL, badge "Somente leitura", cadeado da conexão somente leitura.

O ícone do app (`src-tauri/icons/icon.svg`) é o mesmo mundo: papel Z10 com grade, moldura em tinta #0f1011, um "O" quadrado de cantos cortados construído em células de 64px e o canto superior direito cortado em azul Crouwel, como a aba ativa. A bandeja do sistema (`src-tauri/icons/tray.svg`, rasterizado em `tray.png` 64×64) usa a mesma marca com o O maior no quadro (traço de 8 em 64) para continuar legível em 22px sobre painéis claros e escuros; o quadro em papel Z10 com moldura de tinta é o que garante contraste nos dois.

## Components

### Buttons

Tinta sobre papel, reto.

- **Shape:** 0px, altura 32px (`sm` 28px, `xs` 24px), padding horizontal 10px, texto 0.875rem/500.
- **Primary:** fundo Z0, texto Z10; hover desce para Z5 (Z4 no escuro).
- **Outline:** contorno `input` (Z6), fundo papel (transparente no escuro); hover em Z9.
- **Ghost:** sem fundo; hover em Z9.
- **Destructive:** `--safelight` cheio, texto branco 600, hover a 90%. Reservado para confirmar escrita destrutiva ou em produção.
- **Focus:** contorno sólido de 2px em `--ring` com 2px de afastamento (no destrutivo, em `--safelight`). Active desce 1px.

### Chips

- **Etiquetas de ambiente:** 18px, `legend`, notação que se lê sem cor: LOCAL contorno pontilhado, DEV contorno sólido, STAGING contorno com uma casa hachurada de 8px antes da palavra, PROD `--safelight` cheio com texto branco.
- **Badge retido:** contorno pontilhado `currentColor`, "Somente leitura". O mesmo badge com "Bin" marca um valor binário do Redis antes da prévia escapada (`\xff`), para que nunca se leia como texto.
- **Chip de filtro:** FILTRO ATIVO em `--filter` cheio com texto papel, só enquanto um filtro está aplicado.
- **Contagem Δ:** 18px, fundo Z0, texto Z10, mono 11px ("Δ 2").

### Cards / Containers

- **Registro de conexões:** um único livro-razão pautado, papel sobre a grade, contorno de tinta, conexões separadas por filete Z8 (filete de tinta quando expandida). Cada linha: casa quadrada de 24px com o código da engine (PG, MY, SL, MG, RD) em `legend`, nome 13px/600, etiqueta de ambiente à direita, segunda linha em mono 11px com o alvo e cadeado pontilhado se somente leitura. As ações de hover/foco sobrepõem só a linha do alvo, no canto inferior direito, sobre papel; nunca cobrem o nome nem a etiqueta.
- **Árvore:** sob a conexão expandida, recuo com filete esquerdo de tinta; linhas de 28px, 13px, hover Z9; a tabela ativa é preenchida em azul.

### Inputs / Fields

- **Style:** 32px, 0px, contorno `input` (Z6), fundo transparente (Z9 no escuro). Select nativo idêntico.
- **Focus:** borda `--ring` + filete interno de 1px em `--ring` (contorno de 2px no total).
- **Error / Disabled:** borda `--destructive` + anel a 20%; desabilitado em Z9 a 50%.
- **Label:** `legend` em `muted-foreground`.

### Navigation

- **Abas de trabalho:** barra Z9 com filete de tinta, abas separadas por filete; cada aba leva o código da engine em `legend`, ícone, o nome da conexão (cede espaço primeiro) e o rótulo; em produção, a etiqueta PROD na própria aba; se houver alterações em stage, a contagem Δ. Duas abas `users` de conexões diferentes nunca se leem iguais. Ativa em papel, 600, filete interno azul de 3px no topo e triângulo azul de 10px no canto superior direito.
- **Tabs internas:** sublinhado de 2px em `--select` no ativo, 600.
- **Árvore de chaves do Redis:** linhas de 28px; a chave aberta é preenchida em azul como a tabela ativa.

### Grade de resultados

Mono 0.75rem, linhas de 28px, colunas com filete direito, cabeçalho fixo em Z9 com filete de tinta (nome 600 + tipo em `muted-foreground`). Números à direita; `null` em itálico secundário; coluna ordenada com seta e filete inferior magenta; linha nova `success` a 10% com banda de hachura e filete inferior de 2px em `success` (a hachura sozinha fica abaixo de 3:1); excluída com banda cruzada, texto secundário riscado; editada com banda de hachura e filete inferior de tinta de 2px; selecionada com contorno azul de 2px e fundo azul a 10%.

### O Δ de exposição (assinatura)

Cada alteração em stage hachura a célula e soma no segmento Δ do botão Salvar ("Salvar | Δ 3", segmento mono separado por filete a 40%) e na contagem Δ da aba. Ao salvar, a célula revela em dois passos: a banda de hachura na base, sobre um fundo Z0 a 12%, some em 120ms `steps(2)` (`developed`); o aviso de salvo usa a mesma revelação. Sem animação com `prefers-reduced-motion`.

### Ficha de exposição: "Confirmar execução" (assinatura)

O diálogo de confirmação (máx. 672px). Cabeçalho sobre a grade de construção com título `display-caps` 2rem e a diagonal azul, filete de tinta. Campos pautados em grade 2fr/1fr/1fr (Conexão, Ambiente com etiqueta, Comandos em mono), Motivo, o comando exato em mono com contorno de tinta, e em produção a faixa de luz de segurança "Produção · este comando roda no banco de produção". Rodapé em Z9 com filete de tinta, Cancelar (outline) e o botão destrutivo; em produção ele sempre diz "Executar em produção". Entra em 160ms com fade e deslize curto do topo, como uma folha, com `motion-reduce`.

### Faixa de produção

28px no topo da janela, `--safelight` cheio, ícone de alerta, "Produção" em `legend`, nome da conexão e o regime (somente leitura imposta pelo banco, ou escrita com confirmação do comando exato). Entra em 120ms com fade e deslize de 4px, com `motion-reduce`. Acompanhada do anel interno de 4px.

### Editor (CodeMirror)

Fundo papel, gutter Z9 com filete, linha ativa Z9 a 60%, cursor azul de 2px, seleção em `--ring` a 40%, foco com contorno de 2px em `--ring`, painel de autocompletar com contorno de tinta e item ativo em azul. Sintaxe: palavras-chave em Z0, strings `success`, números `warning`, tipos Z5, propriedades em tinta 600.

## Do's and Don'ts

### Do:

- **Do** tirar todo neutro da escala Z0..Z10 e trocar de tema só pelo nome da zona.
- **Do** mostrar a grade de construção (14px, `grid`) só onde não há dado: lateral, estados vazios, cabeçalho da ficha, canvas do diagrama.
- **Do** reservar o azul para onde você está e para a diagonal da marca; o magenta para filtração; a luz de segurança para produção e destrutivo.
- **Do** imprimir o ambiente em palavras na notação LOCAL pontilhado, DEV contorno, STAGING casa hachurada, PROD luz de segurança cheia.
- **Do** marcar somente leitura com o contorno pontilhado de "retido".
- **Do** marcar estado por textura: hachura para alterado, cruzada para excluído, sempre em banda sob o valor na grade.
- **Do** levar a contagem Δ no botão Salvar e na aba enquanto houver alterações em stage.
- **Do** usar `display` com a caixa original para identificadores e `display-caps` para os demais títulos.
- **Do** manter linhas de 28px, cantos de 0px e texto funcional em 11px ou mais.
- **Do** limitar o movimento à faixa de produção (120ms), à ficha de exposição (160ms) e à revelação (120ms `steps(2)`), todos com `prefers-reduced-motion`.

### Don't:

- **Don't** pôr grade ou hachura atrás de dígitos ou de dado.
- **Don't** usar azul em dado, ícone de tipo ou número de código.
- **Don't** usar magenta sem filtro ou ordenação ativos.
- **Don't** usar luz de segurança cheia para ações comuns.
- **Don't** indicar ambiente, produção ou estado só por cor.
- **Don't** arredondar cantos.
- **Don't** usar `backdrop-filter` nem sombras além da folha do diálogo.
- **Don't** usar mono fora de dado, código e quantidades.
- **Don't** adicionar alternância de tema no app.

---

Revisão de acabamento: disposição "fix". Após o lote de correções, o veredito pontuou 7 de 8 correções resolvidas e 1 parcial, mais 2 regressões (hachura e tempo do keyframe de revelação; ações de hover truncando a conexão de produção). As duas foram corrigidas no código (a revelação usa a banda inferior em 120ms; as ações de hover sobrepõem só a linha do alvo) e conferidas visualmente pelo construtor, sem nova pontuação do revisor.
