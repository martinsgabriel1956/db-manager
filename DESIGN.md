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
  safelight-foreground: "#ffffff"
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
  sidebar-width-narrow: "240px"
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
    textColor: "{colors.safelight-foreground}"
    rounded: "{rounded.none}"
    height: "32px"
    padding: "0 10px"
  env-tag-prod:
    backgroundColor: "{colors.safelight}"
    textColor: "{colors.safelight-foreground}"
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

O tema segue o sistema operacional (`prefers-color-scheme`) por padrão; o botão Tema no rodapé da lateral fixa claro ou escuro para quem precisa. O escuro é a câmara escura: a mesma escala de zonas lida do outro lado, não uma paleta paralela.

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

- **Luz de Segurança** (`safelight`): produção e destrutivo. Faixa de produção de 28px no topo da janela, anel interno de 4px em volta da janela, etiqueta PROD cheia, faixa da ficha de exposição em produção, botão destrutivo. Preenchimentos usam `--safelight` (igual nos dois temas), e o que vai sobre eles usa `--safelight-foreground` (papel branco, 5,7:1, também igual nos dois temas; nunca `text-white` solto); texto de erro usa `--destructive`, que no escuro sobe para `night-destructive-text`.
- **Estados** (`success`, `warning`, com versões `night-`): linha nova na grade (`success` a 10% + hachura), aviso salvo, ícones do histórico; também são as cores de string e número na sintaxe.

### Neutral

- **Escala de Zonas Z0..Z10**: Z0 é tinta (texto, botão primário, filetes principais, contagem Δ), Z10 é papel (fundo de trabalho, cartões, popovers), Z9 é o fundo da grade e de barras (`muted`, `secondary`, `accent`), Z8 é o filete comum (`border`), Z6 é o contorno de campo (`input`, 3:1 ou mais sobre papel e grade, WCAG 1.4.11), Z5 é texto secundário (`muted-foreground`); a barra de rolagem usa Z6, 3:1 ou mais sobre papel nos dois temas. No escuro, `night-z0..night-z10` ocupam os mesmos papéis pelo mesmo nome de zona.
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
- **Display Caps** (Saira 600, largura 60%, 0.05em, versal, utilitário `display-caps`): títulos que não são identificadores. "Confirmar execução" (2rem), estados vazios ("Nenhuma aba aberta", "Comece por uma conexão" e "Nada no histórico" 2.25rem; "Nenhuma chave aberta", "Executando…", "Aguardando confirmação…" e "Sem resultado" 1.875rem), "SQL" no cabeçalho da view (1.75rem), "Histórico" (1.25rem), "Legenda" (1.75rem), ORDO na marca.
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

Janela padrão 1200×800, mínimo 960×600. Lateral fixa de 288px (240px abaixo de 1100px, para a grade manter espaço na janela mínima) sobre a grade de construção visível, separada da área de trabalho por filete de tinta; cabeçalho da marca de 56px (quatro células da grade) em papel. A marca, o cabeçalho CONEXÕES e o rodapé de ferramentas (Ir para… Ctrl K, Histórico, Legenda; papel com filete de tinta no topo) ficam fixos; só o registro rola. Área de trabalho em Z10 limpa: barra de abas de 36px em Z9 com filete de tinta inferior, cabeçalho da view com filete de tinta (identificador à esquerda: tabela, coleção, db do Redis, "ER" em `display-caps` · schema, "SQL"; conexão e etiqueta de ambiente à direita, em toda view), barra de ferramentas, conteúdo. O cabeçalho da view e as barras de ferramentas quebram linha em vez de cortar: com o zoom do app (Ctrl+=, ligado de propósito) a 150% ou 200%, a conexão com a etiqueta de ambiente e as ações descem inteiras para a linha seguinte, alinhadas à direita; numa linha só o cabeçalho mantém os 48px (py-1 nele e no título). A etiqueta de ambiente nunca encolhe: o nome da conexão cede antes. Um link "Ir para a área de trabalho" aparece no foco antes de tudo. Faixa de ambiente de 28px sempre no topo da janela, para a troca entre produção e o resto nunca mover o layout sob o cursor: em produção, luz de segurança com PRODUÇÃO, o nome e o que vale ali, mais o anel interno de 4px desenhado acima dos painéis; nos outros ambientes, Z9 com filete, etiqueta de ambiente, nome e o que vale, em tinta; staging, cópia de produção, abre com uma casa hachurada de 32px e filete de tinta, a mesma hachura da sua etiqueta; sem conexão em uso, "Nenhuma conexão em uso"; numa aba sem conexão (Histórico), "Nenhuma conexão nesta aba", seguido de "produção aberta em outra aba" em tinta quando houver.

Densidade compacta: controles de 32px (28px `sm`, 24px `xs`), etiquetas de 18px, casa da engine de 24px. Ritmo base de 4px.

**The 28px Row Rule.** Grade de resultados, linhas da árvore e tabelas de entradas usam 28px, exatamente duas células da grade.

**The Grid-Where-No-Data Rule.** A grade de construção aparece na lateral, nos estados vazios, no cabeçalho da ficha de exposição e no canvas do diagrama. Onde há dado (o registro de conexões, a grade, os cartões), o fundo é papel liso por cima da grade.

## Elevation & Depth

Plano. Profundidade vem de zona (Z10 sobre Z9), de filetes de 1px e do filete de tinta Z0 nas divisões principais. O overlay de diálogo é `black/30` liso (`black/60` no escuro, para a folha descolar de uma página quase preta), sem desfoque.

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

O ícone do app (`src-tauri/icons/icon.svg`) é o mesmo mundo: papel Z10 com grade, moldura em tinta #0f1011, um "O" quadrado de cantos cortados construído em células de 64px e o canto superior direito cortado em azul Crouwel, como a aba ativa. A bandeja do sistema (`src-tauri/icons/tray.svg`, rasterizado em `tray.png` 64×64) usa a mesma marca com o O maior no quadro (traço de 8 em 64) para continuar legível em 22px sobre painéis claros e escuros; o quadro em papel Z10 com moldura de tinta é o que garante contraste nos dois. A lateral recolhida desenha a marca nessas mesmas proporções da bandeja (em 32px, o canto do ícone do app teria 5px). O menu da bandeja abre com a contagem de sessões abertas ("2 conexões abertas"), atualizada a cada conexão que abre ou fecha.

## Components

### Buttons

Tinta sobre papel, reto.

- **Shape:** 0px, altura 32px (`sm` 28px, `xs` 24px), padding horizontal 10px, texto 0.875rem/500.
- **Primary:** fundo Z0, texto Z10; hover desce para Z5 (Z4 no escuro). Desabilitado, a tinta sai: contorno `input` sem fundo, a 50% (um preenchimento esmaecido ainda se lia como botão no escuro).
- **Outline:** contorno `input` (Z6), fundo papel (transparente no escuro); hover em Z9.
- **Ghost:** sem fundo; hover em Z9.
- **Destructive:** `--safelight` cheio, texto `--safelight-foreground` 600, hover a 90%. Reservado para confirmar escrita destrutiva ou em produção.
- **Focus:** contorno sólido de 2px em `--ring` com 2px de afastamento (no destrutivo, em `--safelight`). Active desce 1px.

### Chips

- **Etiquetas de ambiente:** 18px, `legend`, notação que se lê sem cor: LOCAL contorno pontilhado, DEV contorno sólido, STAGING contorno com uma casa hachurada de 8px antes da palavra, PROD `--safelight` cheio com texto `--safelight-foreground`.
- **Badge retido:** contorno pontilhado `currentColor`, "Somente leitura". O mesmo badge com "Bin" marca um valor binário do Redis antes da prévia escapada (`\xff`), para que nunca se leia como texto.
- **Chip de filtro:** `--filter` cheio com texto papel, só enquanto algo filtra ou ordena: um chip por condição, todas somadas com AND: o primeiro diz FILTRO e os seguintes E, em `legend`, seguidos da condição em mono 11px como se lê no SQL ("id >= 42", "id IN (1, 2)") e um × ("Remover filtro id >= 42"); aplicar de novo a mesma coluna e operador troca a condição; ORDENADO com a coluna, a seta e um × ("Remover ordenação"). No MongoDB, FILTRO e ORDENADO levam o JSON aplicado, truncado. Os chips ficam numa linha própria logo abaixo da barra de filtro, que quebra linha em vez de cortar: na janela mínima nenhuma condição se reduz a "FILTRO"; com duas ou mais, "Limpar" fecha a linha. Campos que não batem mais com o aplicado tornam o Aplicar primário; não há texto extra.
- **Contagem Δ:** 18px, fundo Z0, texto Z10, mono 11px ("Δ 2").

### Cards / Containers

- **Registro de conexões:** um único livro-razão pautado, papel sobre a grade, contorno de tinta, conexões separadas por filete Z8 (filete de tinta quando expandida). Cada linha: casa quadrada de 24px com o código da engine (PG, MY, SL, MG, RD) em `legend`, nome 13px/600, etiqueta de ambiente à direita, segunda linha em mono 11px com o alvo e cadeado pontilhado se somente leitura. Nomes (grupo, conexão, schema, tabela) quebram linha em vez de truncar, porque são dado e nenhum hover alcança o teclado: "Postgres staging-eu" e "-us" nunca se leem iguais na lateral de 240px; as linhas têm 28px como mínimo, não como altura fixa. O alvo fica numa linha só, truncado, com o endereço inteiro no hover e no nome acessível (quebrado nos hifens, ocupava três). As ações da linha ficam num "⋯" discreto (60%, cheio no hover) no canto inferior direito, sobre a linha do alvo, que reserva o espaço; nunca cobre o nome nem a etiqueta. O "⋯" usa `muted-foreground` cheio (5:1), sem opacidade. O menu (Nova query SQL, Editar conexão, Duplicar e, separado dos outros por filete de tinta para não ser clicado no caminho, Desconectar; no schema, Abrir diagrama ER) é uma folha de papel com contorno de tinta, sem sombra, itens de 28px, item realçado em azul. Abre também com Shift+F10, tecla de menu ou clique direito na linha; o "⋯" é a cópia do mouse e fica fora da árvore acessível. Todo menu do app (contexto da aba, Todas as abas, Copiar) é essa mesma folha.
- **Árvore:** sob a conexão expandida, recuo com filete esquerdo de tinta (tracejado em luz de segurança numa conexão de produção, textura e não só cor, com o filete inferior da linha dela em luz de segurança, para que produção continue legível quando o cabeçalho rola para fora); linhas de 28px, 13px, hover Z9; a tabela ativa é preenchida em azul.

### Formulário de conexão

Tipo de banco primeiro (redesenha o resto), depois Nome e Grupo, e logo abaixo deles a Proteção, antes do endereço e do túnel SSH: a escolha que define toda a proteção nunca fica abaixo da dobra. O título nomeia a conexão editada ("EDITAR CONEXÃO" em `display-caps` + o nome em `display`), e a linha dela na lateral leva o filete azul de 3px à esquerda. Proteção (entre filetes de tinta): Ambiente sem valor padrão ("Escolha o ambiente"; salvar sem ele marca o campo), com o que ele muda e Somente leitura com como o banco o impõe, lado a lado. Avançado recolhido num `details` (TLS, certificado CA, timeout), aberto sozinho quando um campo dele tem erro. "Testar conexão" tenta o rascunho como está, sem salvar nem tocar no keychain; o resultado some quando um campo muda.

### Inputs / Fields

- **Style:** 32px, 0px, contorno `input` (Z6), fundo transparente (Z9 no escuro). Select nativo idêntico.
- **Focus:** borda `--ring` + filete interno de 1px em `--ring` (contorno de 2px no total).
- **Error / Disabled:** borda `--destructive` + anel a 20%; desabilitado em Z9 a 50%.
- **Label:** `legend` em `muted-foreground`.

### Navigation

- **Abas de trabalho:** barra Z9 com filete de tinta, abas separadas por filete; cada aba leva o código da engine em `legend`, ícone, o nome da conexão (cede espaço primeiro) e o rótulo; em produção, a etiqueta PROD na própria aba; se houver alterações em stage, a contagem Δ. Duas abas `users` de conexões diferentes nunca se leem iguais; com uma conexão só entre as abas, o prefixo sai (o cabeçalho da view já a nomeia). Abas vizinhas da mesma conexão formam uma sequência: só a primeira leva o nome da conexão (aba até 256px); as seguintes levam só o rótulo (até 192px). Toda aba de produção leva a etiqueta PROD, a primeira da sequência pode sair da faixa; e um filete de luz de segurança de 2px na base. Editores SQL são numerados no app inteiro (SQL 1, SQL 2…), nunca dois "SQL 1"; a aba ativa sempre rola para a vista. Fechar uma aba com alterações em stage (Delete, ×, clique do meio, Ctrl+W) abre "Descartar alterações?" com o foco em Voltar. Ativa em papel, 600, filete interno azul de 3px no topo e triângulo azul de 10px no canto superior direito; a aba inteira (Δ e × incluídos) rola para a vista, também quando o Δ aparece. Clique direito: "Fechar aba users" (nomeia a aba como ela se lê na faixa, com a conexão quando há mais de uma), "Fechar outras abas", "Fechar todas as abas (N)" e "Reabrir aba fechada" (Ctrl+Shift+T, até 20, com o texto do editor); a aba clicada fica em papel com contorno de tinta enquanto o menu está aberto.
- **Tabs internas:** sublinhado de 2px em `--select` no ativo, 600.
- **Árvore de chaves do Redis:** linhas de 28px; a chave aberta é preenchida em azul como a tabela ativa.
- **Árvore de conexões no teclado:** `role="tree"` com `treeitem` e `aria-level`; um único ponto de Tab (a última linha focada, senão a da aba ativa). ↑↓ andam pelas linhas visíveis, → expande ou entra, ← recolhe ou sobe, Home/End nos extremos, Shift+F10 abre as ações. Conexão SQL aberta começa por uma linha visível "Nova query SQL".
- **Regiões e atalhos:** F6/Shift+F6 alternam lateral, abas e área de trabalho; a área de trabalho entra pela superfície principal da view (a grade, o editor), ou pelo painel da view, nunca pela faixa de abas em volta; Ctrl+Tab/Ctrl+Shift+Tab trocam de aba; Ctrl+S salva as alterações da tabela com o foco nela; Ctrl+W fecha a aba. Diálogos sem gatilho (Ir para, Legenda) devolvem o foco a quem o tinha; uma escolha no Ir para leva o foco à superfície principal da view que abriu (a grade, quando as linhas chegam; o editor), como o F6. Os painéis das abas internas não são paradas de Tab: começam com controles.
- **Faixa de abas cheia:** quando as abas passam da borda, "Todas as abas (N)" fecha a faixa à direita, com filete de tinta, e lista todas num menu com as mesmas marcas da faixa (ícone, conexão, PROD, Δ; a ativa com o filete azul de 3px à esquerda); a aba ativa rola para a vista de novo quando ele aparece. A faixa encaixa na borda de uma aba inteira (scroll-snap); com abas escondidas à esquerda, a borda esquerda esmaece em 32px, para a primeira aba visível não se ler cortada no meio da palavra. Com várias conexões abertas, a aba mostra o nome da conexão (até 96px, para "Postgres prod" e "Postgres dev" não se lerem iguais; o nome inteiro no hover) e não o código da engine.
- **Ir para (Ctrl+K):** folha de 576px a 12vh do topo, campo com filete de tinta, opções de 32px com casa da engine, nome, tipo em palavras, conexão e etiqueta de ambiente; a opção ativa é preenchida em azul como a tabela ativa. Tabelas só das conexões já abertas, e diz quantas ("2 de 6"); nunca conecta sozinha. Sem consulta, abre por RECENTES (as outras abas abertas, das mais novas, e as recém-fechadas); as letras digitadas em ordem também acham o nome ("usr" → users), depois de toda correspondência exata. As conexões entram como ações explícitas: "Abrir conexão" (conecta e foca a linha na lateral), "Editar conexão", "Diagrama ER" dos schemas listados. Sem conexão aberta, o estado vazio oferece "Abrir uma conexão", que abre a folha já filtrada. A mesma tabela em várias conexões ordena a conexão da aba ativa primeiro e produção por último: o Enter na primeira opção nunca cai em produção por acaso.
- **Legenda:** folha em três colunas pautadas a partir de `lg` (Na grade e No autocompletar; Ambientes e Bancos; Atalhos), duas abaixo, cada marca desenhada como na interface ao lado do significado; cabe sem rolagem numa janela de 800px.
- **Lateral recolhida (Ctrl+B):** 48px com a marca, o botão de expandir e as ferramentas como ícones nomeados (Ir para, Nova conexão, Histórico, Legenda); F6 entra pela primeira delas.
- **Histórico:** cada entrada leva a etiqueta de ambiente da conexão ao lado do nome, como toda outra tela; "Abrir no editor de produção" diz onde reabre, e os botões de cada entrada se nomeiam com a conexão e a hora.
- **Erro de conexão na lateral:** manchete em pt-BR ("Não foi possível conectar a host:porta"), a mensagem do driver abaixo em mono 11px como dado, a orientação e as duas saídas que ela cita (Tentar de novo, Editar conexão), que quebram linha na lateral estreita; a conexão que falhou não oferece "Nova query SQL".
- **Fechar a janela:** o × esconde o Ordo na bandeja e encerra as sessões de produção (reabrem no próximo uso). Na primeira vez, uma folha diz isso antes ("O Ordo continua na bandeja", Esconder na bandeja focado, Sair do Ordo); Esc mantém a janela.

### Grade de resultados

Mono 0.75rem, linhas de 28px, colunas com filete direito, cabeçalho fixo em Z9 com filete de tinta (nome 600 + tipo em `muted-foreground`). Números à direita; `null` em itálico secundário; coluna ordenada com seta e filete inferior magenta; linha nova `success` a 10% com banda de hachura e filete inferior de 2px em `success` (a hachura sozinha fica abaixo de 3:1); excluída com banda cruzada, texto secundário riscado; editada com banda de hachura e filete inferior de tinta de 2px; selecionada com contorno azul de 2px e fundo azul a 10%; com uma célula selecionada, esse contorno é a marca de foco (a grade inteira só ganha anel de foco sem seleção).

Abaixo da grade, uma única barra de status em Z9: paginação compacta (‹ "Página 2 · linhas 101–200, há mais" ›), depois as ações de edição (Adicionar e Excluir/Restaurar linha) e à direita a contagem, Descartar (pergunta antes, como fechar a aba) e "Salvar | Δ n". Com alterações em stage, a paginação encolhe para "Página N" e a barra diz por que está travada: "Salve ou descarte para paginar, filtrar ou ordenar" a partir de 60rem, "Salve ou descarte para paginar" abaixo, sempre em tinta, com a frase inteira para leitor de tela; os botões travados (‹ › e Aplicar) apontam para ela com `aria-describedby`, e a dica "Duplo clique" sai enquanto há alterações. O aviso de salvo e o de cópia falam das linhas na tela: somem na próxima página, filtro ou ordem. Depois de salvar, o foco volta à grade. A célula editada guarda o valor gravado: "Antes: …" no hover e para leitor de tela, uma faixa ANTES com "Desfazer alteração" no painel Valor, e Ctrl+Z na célula a devolve. O painel Valor rola por inteiro numa janela baixa; suas partes nunca se sobrepõem (o editor de JSON tem piso de 6rem e rola por dentro). Numa célula editável o painel Valor é o editor do valor inteiro (texto longo, JSON; jsonb indentado), num campo com contorno como os outros: vira alteração pendente ao sair do campo ou com Ctrl+Enter, só se o texto mudou; Esc desfaz o rascunho antes de fechar o painel. NULL é dito acima do campo ("Gravado como NULL"), que fica vazio com "Digite para substituir NULL". Colunas de lista fixa (enum, boolean) seguem escolhidas na própria célula. A ficha de um salvamento confirmado lista ANTES → DEPOIS por chave e coluna antes do SQL. A barra é um container: mede a própria largura (a lateral leva 240–288px), não a janela. Uma escala só para os dois estados, medida pelo mais cheio (com alterações, Descartar e Salvar na barra), para começar a editar nunca mudar a forma dos botões sob o cursor; sem alterações, a dica ocupa o lugar deles. As palavras cedem nesta ordem, cada controle mantendo ícone e nome (lido e no hover): a dica ("Enter edita a célula" a partir de 68,5rem, "Duplo clique ou Enter edita a célula" a partir de 73rem), Adicionar (66rem), Excluir (62rem), Valor (56rem), Referências (54rem), Copiar (50rem), a estimativa de linhas (47rem; 58,5rem em produção), a contagem pendente em palavras (75,5rem; antes disso só para leitor de tela). As ferramentas da linha falam antes das de escrita porque + e a lixeira se leem sozinhos e Valor, Referências e Copiar não: na janela padrão (1200px, lateral de 288px) elas têm nome. Referências usa o ícone de vínculo, nunca um glifo de Enter. Em produção Excluir mantém a palavra em qualquer largura e Adicionar só a solta na janela mínima ou com alterações. Descartar e Salvar nunca encolhem e nunca são cortados: se ainda faltar espaço (produção, com alterações, na janela mínima), o grupo de escrita desce inteiro para uma segunda linha. A janela do app nunca rola na horizontal (`overflow-clip`). Editar uma célula que não aceita edição diz o porquê numa região viva que também aparece no canto inferior da grade, em contorno pontilhado de "retido", até a seleção mudar.

### O Δ de exposição (assinatura)

Cada alteração em stage hachura a célula e soma no segmento Δ do botão Salvar ("Salvar | Δ 3", segmento mono separado por filete a 40%) e na contagem Δ da aba. Ao salvar, a célula revela em dois passos: a banda de hachura na base, sobre um fundo Z0 a 12%, some em 120ms `steps(2)` (`developed`); o aviso de salvo usa a mesma revelação. Sem animação com `prefers-reduced-motion`.

### Ficha de exposição: "Confirmar execução" (assinatura)

O diálogo de confirmação (máx. 672px). Numa janela baixa (a mínima, ou com zoom) o registro entre o título e o rodapé rola: os botões nunca saem da tela, e o Tab até o campo do nome o traz para a vista. Todo diálogo é no máximo a altura da janela menos 2rem e rola por inteiro; só a ficha fixa o rodapé. Cabeçalho sobre a grade de construção com título `display-caps` 2rem e a diagonal azul, filete de tinta. Campos pautados em grade 2fr/1fr (Conexão, Ambiente com etiqueta), Motivo, o comando exato em mono com contorno de tinta, e em produção a faixa de luz de segurança "Produção · este comando roda no banco de produção". Rodapé em Z9 com filete de tinta, Cancelar (outline) e o botão destrutivo; em produção ele sempre diz "Executar em produção". Entra em 160ms com fade e deslize curto do topo, como uma folha, com `motion-reduce`. É um `alertdialog`. No editor SQL, cancelar a ficha não apaga nada: uma linha com filete de tinta diz EXECUÇÃO CANCELADA em `legend` e "Nada rodou no banco." em 0.875rem, e embaixo fica o resultado anterior, rebaixado a "Resultado anterior · …" em `muted-foreground` e sem o recibo de confirmação, que é só da execução que acabou de rodar. Uma execução confirmada fecha o ritual com o recibo "Confirmado e executado em <conexão> <etiqueta> · resultado · Ver no histórico".

### Folhas da mesma família: Parâmetros e Backup

Toda folha que age sobre um banco é a ficha de exposição, montada pelas mesmas peças (`src/components/Sheet.tsx`): cabeçalho sobre a grade com título `display-caps` 2rem e a diagonal azul, campos pautados Conexão e Ambiente (com a etiqueta), corpo que rola entre cabeçalho e rodapé, rodapé em Z9 com filete de tinta. **Parâmetros** traz uma linha pautada por `:nome` (nome em mono, campo, tipo) e o "Comando que vai rodar" em mono com contorno de tinta, preenchido pelo backend enquanto se digita (as aspas do dialeto, nunca uma aproximação); um valor recusado diz o porquê ali mesmo. **Backup e restauração** nomeia a conexão e o ambiente da linha que a abriu, não da aba ativa; em produção acende a faixa de luz de segurança ("restaurar escreve no banco de produção"). Fechar é um botão do rodapé, travado enquanto um backup ou restore roda.

### Comparar schema

Cabeçalho de view como as outras (título à esquerda; conexão e etiqueta à direita). Cada lado mostra a etiqueta de ambiente da conexão escolhida ao lado do select; o destino padrão é outra conexão da mesma engine que não seja produção (sem ela, a própria origem): apontar o DDL sugerido para produção é escolha de quem usa. Uma falha tem manchete em pt-BR ("Não foi possível comparar …") e a mensagem do driver abaixo em mono 11px.

### Faixa de produção

28px no topo da janela, `--safelight` cheio, ícone de alerta, "Produção" em `legend`, nome da conexão e o regime (somente leitura imposta pelo banco, ou escrita com confirmação do comando exato). Entra em 120ms com fade e deslize de 4px, com `motion-reduce`. Acompanhada do anel interno de 4px.

### Editor (CodeMirror)

Fundo papel, gutter Z9 com filete, linha ativa Z9 a 60%, cursor azul de 2px, seleção em `--ring` a 40%, foco com contorno de 2px em `--ring`, painel de autocompletar com contorno de tinta e item ativo em azul. Sintaxe: palavras-chave em Z0, strings `success`, números `warning`, tipos Z5, propriedades em tinta 600. O autocompletar fica abaixo da camada de diálogos (z 40), com opções de 4px de respiro vertical, e fecha ao executar, pelo atalho ou pelo botão Executar; o tipo de cada sugestão é um código em `legend` (KW, TB, CL, TY, FN, SC), não emoji; tabela é TB e schema é SC (o lang-sql marca os dois como `type`, então a fonte de schema é reetiquetada), TY fica só para tipo de dado.

O botão do cabeçalho diz "Executar seleção" quando há texto selecionado, porque é o que ele vai rodar. Numa janela baixa (a mínima com zoom de 200%), Formatar, Explicar e Executar ficam só com o ícone e mantêm o nome para leitor de tela, para o cabeçalho caber numa linha e o editor manter altura. O divisor entre editor e resultados tem 1px e área de 25px; duplo clique alterna entre a altura padrão e um editor alto (o divisor do painel Valor faz o mesmo com a largura).

### Resultado de cada comando

Um script com mais de um comando abre abas internas: Execução, depois uma aba por comando que devolveu linhas ("1 · SELECT…", o número antes do texto, "comando 1 de 4" no nome acessível). Comando sem linhas não ganha aba (a Legenda diz isso junto do atalho); a partir de 1100px a faixa lembra "Alt+PageDown/PageUp troca de resultado" e cede espaço às abas. Alt+PageDown/PageUp troca de resultado de dentro dos resultados e também do editor, sem tirar o foco do texto; dentro dos resultados o foco segue a aba.

Execução é um registro pautado: cabeçalho em `legend` sobre filete de tinta (Nº, Comando, Status, Linhas, Tempo), linhas de 28px com o SQL truncado em mono e as contagens à direita. Status em palavras e em textura: "erro" e "cancelado" em `--destructive` 600 sobre banda de hachura cruzada; "não executado" com contorno pontilhado de retido e a linha em `muted-foreground`. A lista é uma parada de Tab só, com setas, Home e End entre os comandos. O recibo de Execução fala do script ("4 comandos · 42 ms", ou "Parou no comando 3 de 4"); o de cada aba fala do seu comando ("Comando 1 de 4 · 1000 de 4210 linhas · 12 ms").

Escolher um comando é "onde você está", nunca uma seleção: a linha ganha o filete azul de 3px à esquerda e fundo azul a 10%, e o trecho no editor ganha fundo azul a 14% com filete inferior azul de 2px, que some na próxima edição ou clique. Executar continua rodando o que rodaria. Rodar um comando sozinho é uma ação nomeada, "Rodar só este comando", numa faixa sob o recibo junto com "Comando N de M marcado no editor." (ou que o editor mudou e não o mostra mais) e, quando a aba guardou só o primeiro lote, "Mostrando as primeiras N de M linhas.". Quando o script para, o comando que falhou já abre marcado no editor com hachura cruzada e filete inferior em `--destructive`.

Exportar uma aba reexecuta os comandos até ela; se algum deles escreve, o botão fica `aria-disabled` e o clique diz o motivo antes de pedir o arquivo.

### Exclusões inline (Redis, MongoDB)

Armar a exclusão abre uma faixa longe do gatilho: no MongoDB sob o documento, com filete de tinta; no Redis sob a barra da chave. A faixa traz o comando exato inteiro, quebrando linha, em mono com contorno de tinta (`DEL chave`, `deleteOne({"_id": …})`), e o botão "Confirmar exclusão" à esquerda da faixa, longe dos gatilhos à direita, que vem focado e é descrito pelo comando (`aria-describedby`). O gatilho (lixeira ou "Excluir chave") fica onde estava, marcado como aberto (`aria-expanded`), e um segundo clique nele desarma: um duplo clique nunca cai na confirmação. Esc desarma e devolve o foco ao gatilho; sair do botão também desarma. "Excluir chave" é um botão outline com ícone, texto em `--destructive`.

### Diagrama ER

Chave primária em tinta (não âmbar), estrangeira em `muted-foreground`. Minimapa em papel com contorno de tinta, tabelas em Z6 (3:1 ou mais), recorte da vista em azul; controles numa coluna com contorno de tinta. O nó focado leva o anel de foco de 2px em `--ring`, afastado 2px. As arestas só se desenham, então o nome de cada nó diz para onde apontam as chaves ("Tabela pedidos, cliente_id aponta para clientes") e o ícone de vínculo diz o destino. O tema segue a escolha do app, não só a do sistema. O layout (ELK) roda num Web Worker.

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

---

Revisão de acabamento: disposição "fix". Após o lote de correções, o veredito pontuou 7 de 8 correções resolvidas e 1 parcial, mais 2 regressões (hachura e tempo do keyframe de revelação; ações de hover truncando a conexão de produção). As duas foram corrigidas no código (a revelação usa a banda inferior em 120ms; as ações de hover sobrepõem só a linha do alvo) e conferidas visualmente pelo construtor, sem nova pontuação do revisor.
