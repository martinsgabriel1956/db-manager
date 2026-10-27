# PRD: Editar arrays e binários na grade

## Visão geral

Na grade SQL, colunas de array (Postgres) e de binário (`bytea` no Postgres, `BLOB`/`BINARY`/`VARBINARY` no MySQL, `BLOB` no SQLite) são somente leitura. A grade carrega só os primeiros bytes de um binário. Para trocar um elemento de array ou substituir um arquivo guardado no banco, o usuário escreve um `UPDATE` à mão, e no caso do binário ainda precisa montar o literal.

O público é o dev que corrige registros no dia a dia: arrays de tags e permissões, e pequenos binários (ícones, certificados, anexos).

## Objetivos

- Editar arrays elemento por elemento e binários por arquivo ou por hex, com o mesmo stage e a mesma transação das outras edições.
- Salvar em arquivo o binário completo gravado no banco.
- Como medir: nenhuma correção de array ou de binário pequeno exige escrever SQL. O valor relido do banco depois de salvar é idêntico ao editado.

## Histórias de usuário

- Como dev, quero adicionar uma tag ao array `tags` de uma linha sem escrever `array_append`.
- Como dev, quero distinguir na edição um array vazio de um array NULL e de um elemento NULL.
- Como dev, quero baixar o arquivo guardado numa coluna `bytea` para abrir no meu computador.
- Como dev, quero substituir esse binário por um arquivo local e salvar junto com as outras alterações pendentes.
- Como dev, quero corrigir alguns bytes de um valor binário pequeno direto em hex.

## Funcionalidades principais

### F1. Arrays (Postgres)

1. Selecionar uma célula de array abre o painel de valor com o array como lista editável. O usuário pode editar cada elemento, adicionar, remover, reordenar e marcar um elemento como NULL.
2. Array NULL, array vazio e elemento NULL são estados distintos e visíveis.
3. Elementos de tipo escalar editável (os mesmos que a grade já edita, inclusive enums) são editáveis, com a mesma validação da célula comum.
4. Array de tipo não modelado e array multidimensional continuam somente leitura, e o painel diz por quê.
5. A alteração entra como alteração pendente e é salva na mesma transação das outras, com as mesmas regras de hoje (cada comando afeta exatamente 1 linha).
6. Depois de salvar, a célula mostra o valor relido do banco.

### F2. Binários (Postgres, MySQL, SQLite)

7. Selecionar uma célula binária abre o painel de valor com o tamanho total e uma prévia em hex.
8. "Salvar em arquivo…" grava o valor completo que está no banco, não a prévia que a grade carregou.
9. "Substituir por arquivo…" coloca o conteúdo do arquivo como alteração pendente e mostra o tamanho novo.
10. Para valores pequenos, o hex é editável no painel. O limite exato é definido no techspec e aparece na tela. Acima dele, só arquivo.
11. Hex inválido (número ímpar de dígitos, caractere fora de 0–9/a–f) impede salvar, com o erro no próprio campo.
12. Um arquivo acima do tamanho máximo aceito é recusado com uma mensagem que diz o limite.
13. Definir NULL e voltar ao valor original funcionam como nas outras células.

### F3. Regras comuns

14. Só em tabela com chave primária editável, como hoje. Em tabela somente leitura ou em conexão somente leitura, o painel mostra o valor sem as ações de edição.
15. Em `prod`, salvar mostra o comando exato. Para um binário grande, o diálogo mostra o comando com o valor resumido (tamanho e começo), sem colar megabytes na tela.
16. Enquanto houver alteração pendente de array ou binário, paginação, ordenação e filtro travam, como já acontece hoje.

## Experiência do usuário

- O painel de valor que já abre para JSON e texto longo também abre para array e binário, no mesmo lugar.
- A lista do array é operável só pelo teclado: mover um elemento para cima e para baixo, remover e inserir têm atalhos e nomes acessíveis.
- "Salvar em arquivo" e "Substituir por arquivo" usam os diálogos nativos de abrir e salvar.
- Os elementos NULL aparecem com o mesmo estilo de NULL da grade.

## Restrições técnicas de alto nível

- Fidelidade: o binário salvo em arquivo é byte a byte o do banco, e o array editado é gravado com os tipos de elemento corretos.
- Binários grandes não podem ser carregados inteiros na grade só por estarem na página. O valor completo só é lido quando o usuário pede (painel ou salvar em arquivo).
- O app precisa de permissão para abrir arquivos escolhidos pelo usuário, além da de salvar que já tem.

## Fora de escopo

- Arrays no MySQL e no SQLite (que não têm o tipo; JSON já tem o painel próprio).
- Arrays multidimensionais e de tipos compostos.
- Prévia de imagem ou de outros formatos dentro do painel.
- Editar binários no Mongo e no Redis.
- Copiar como INSERT ou JSON incluindo binários grandes, que continua recusando o que a grade só mostra em parte.

## Histórico

**2026-10-27**. Documento criado.
