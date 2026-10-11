---
version: 1
slug: "src-app-tsx"
primary_target: "src/App.tsx"
related_targets: ["src/index.css"]
---

# Superfície: app desktop inteiro (shell, árvore, abas, grade, editores, Mongo, Redis, diagrama, histórico, formulários) + ícone do app

Modo: Operate. Público: dev que administra bancos reais (local → prod) no dia a dia; o produto pode virar open source.
Restrições do pedido: identidade nova (redesign), densidade compacta, evitar clone de IDE, enterprise datado, brinquedo/marketing e estética hacker/terminal. pt-BR, WCAG AA nos dois temas, tema segue o SO.
Cena física: um dev na mesa de trabalho, de dia no escritório e à noite em casa, alternando com a IDE; claro e escuro existem, decididos pelo SO.

## Direction contract

THESIS: Cada conexão e cada registro é uma amostra etiquetada na bancada do laboratório: identificação impressa, cor da tampa por engine, e produção sob lacre que só se rompe assinando o comando exato. Recusa o arranjo padrão da categoria (lateral cinza, abas neutras, um azul de destaque) e o tema escuro de IDE.

OWN-WORLD: Lateral em epóxi preto de bancada (#22272b; no tema escuro desce para #121517 para continuar mais escura que a área de trabalho #1b1f22 e ler como bancada) com etiquetas térmicas brancas (#fbfbf9; no escuro baixam para #d9dcd6, a etiqueta sob a luz noturna, sem ofuscar); faixa de cor de tampa de tubo por engine (Postgres lavanda, MySQL ouro, SQLite cinza, MongoDB verde, Redis rosa); tinta térmica #17191b; papel #f2f3f1; lacre vermelho #c62828 em faixa hachurada; azul de marcador reservado para "onde você está" (seleção, foco, aba ativa); nenhum dado (tipos do Redis, números no código, ícones) usa azul. Uma só grotesca (Archivo, eixo de largura: condensada em versalete para rótulos impressos) e Red Hat Mono só para dados e código. Cantos de 3px, filetes de 1px, sem sombras decorativas. Célula editada = amostra aberta (hachura âmbar). Raises: uma só grotesca (Anuário de Design); duração desenhada em escala no histórico (Labanotação); mesma altura de linha de 28px em todas as tabelas (Fólio Botânico); limites reais visíveis como medida preenchida (Capa de Fita K7).

STORY: O dev reconhece de relance em qual conexão e ambiente está, lê o valor gravado exato e, antes de qualquer escrita arriscada, assina um termo de custódia que mostra o comando que vai rodar. Confia porque o perigo nunca depende só de cor.

FIRST VIEWPORT: Lateral de 288px em epóxi preto com o título CONEXÕES em versalete e as conexões como etiquetas brancas (faixa de tampa à esquerda, nome em negrito, engine e alvo na segunda linha, etiqueta impressa de ambiente à direita; PROD em vermelho cheio); filhos (schemas, tabelas) em texto osso sobre a bancada, tabela ativa como fatia de etiqueta com marcador azul. Área de trabalho em papel/etiqueta: abas com o quadradinho da tampa, cabeçalho da tabela, filtros, grade densa de 28px em mono. Em produção, faixa de lacre hachurada no topo da janela e borda vermelha. A ação primária (Salvar/Executar) é botão de tinta preta à direita da barra.

FORM: Cadeia de custódia de laboratório (etiqueta de amostra, termo de custódia, fita de lacre), 4º da minha lista ordenada na rodada 1. Seed key 559d8207 (re-roll 1). Interação assinatura: o diálogo de confirmação vira Termo de Custódia (campos impressos, comando exato, fita de lacre, botão "romper lacre"); movimento: só a faixa de lacre e o termo entram, com fade/slide curto de 120 ms, nada mais anima.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
