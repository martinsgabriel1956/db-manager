---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/index.css"]
---

# Superfície: app desktop inteiro (shell, árvore, abas, grade, editores, Mongo, Redis, diagrama, histórico, formulários) + ícone do app

Modo: Operate. Público: dev que administra bancos reais (local → prod) no dia a dia; o produto pode virar open source.
Restrições do pedido: identidade nova (redesign da Bancada de Custódia, recusada por falta de personalidade), algo autoral, densidade compacta, evitar clone de IDE, enterprise datado, brinquedo e estética hacker/terminal. pt-BR, WCAG AA nos dois temas, tema segue o SO.
Escolha do usuário (fixada por ele, acima do sorteio): fusão de Ficha de Ampliação (registro de exposição de câmara escura) com Grade de Crouwel (espécime de tipo em grade).
Cena física: um dev na mesa, de dia no escritório (claro = mesa de luz) e à noite em casa (escuro = câmara escura); o SO decide.

## Direction contract

THESIS: O banco é uma ampliação em andamento sobre uma grade de construção: cada valor tem sua zona exata, cada alteração não salva é exposição a mais (hachura com Δ), e produção trabalha sob luz de segurança. Recusa a lateral cinza com um azul de destaque da categoria e o escuro de IDE com neon.

OWN-WORLD: Neutros só numa escala de 11 zonas (Z0 #0f1011 a Z10 #f7f8fa; no escuro a mesma escala lida ao contrário); grade de construção visível (#e3e9f2, células de 14px, duas por linha de 28px) na lateral, estados vazios, cabeçalhos de diálogo e canvas do diagrama, nunca atrás de dados. Azul Crouwel #0057ff só para "onde você está" (seleção, foco, aba ativa, tabela ativa) e a única diagonal do sistema; magenta dicroico #c8137a só para filtração (filtros, ordenação, padrão SCAN); luz de segurança #c4291c para produção e destrutivo. Saira (eixo de largura) em versal condensada espaçada para letreiros e títulos (identificadores como nomes de tabela mantêm a caixa: são dado); Hanken Grotesk para interface; Spline Sans Mono tabular para dados e quantidades. Cantos retos, filetes de 1px, filete de tinta Z0 nas divisões principais. Estado por hachura: Δ+ diagonal = alterado, cruzada = excluído/conflito, contorno pontilhado = retido (somente leitura), zona mais funda = selecionado.

STORY: O dev sabe de relance a conexão, o ambiente e o que está filtrado; vê cada alteração pendente como exposição a mais com contagem Δ; antes de qualquer escrita arriscada lê o comando exato numa ficha de exposição e confirma. Nada depende só de cor.

FIRST VIEWPORT: Lateral de 288px em papel de grade visível com a marca ORDO/ em Saira condensada e a diagonal azul; CONEXÕES em letreiro; cada conexão como linha de registro (código da engine em versal condensada numa casa quadrada, nome, alvo em mono, etiqueta de ambiente: LOCAL pontilhada, DEV contorno, STAGING hachurada, PROD luz de segurança cheia); tabelas em linhas de 28px, ativa em azul com marcador. Área de trabalho em Z10 limpa: abas retas com a ativa marcada por filete azul e corte diagonal; cabeçalho da tabela com nome em Saira; barra de filtro com chips magenta quando há filtro; grade densa de 28px em mono tabular; à direita o botão primário em tinta com segmento Δ ("Salvar | Δ 3"). Em produção, faixa de luz de segurança no topo e anel vermelho na janela.

FORM: Fusão escolhida pelo usuário de dois desafiantes do sorteio (operate-b-exposure-record-zone-sheets + crouwel-grid-specimen), fora da minha lista ordenada. Seed key 559d8207 (re-roll 2). Interação assinatura: o Δ de exposição — cada alteração em stage hachura a célula e soma no segmento Δ do botão Salvar e da aba; ao salvar, a hachura "revela" em dois passos (steps(2), 120ms) e some. Movimento: só a revelação, a faixa de produção e a ficha de exposição (entra com leve deslize de folha, 160ms), tudo com motion-reduce.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
