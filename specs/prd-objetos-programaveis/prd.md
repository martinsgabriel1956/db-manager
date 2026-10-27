# PRD: Funções, procedures, triggers e sequences na árvore

## Visão geral

A árvore de uma conexão SQL mostra, por schema, tabelas, views, views materializadas e foreign tables. Funções, procedures, triggers e sequences não aparecem. Para ler o corpo de uma função ou descobrir que triggers existem numa tabela, o usuário precisa consultar o catálogo à mão ou abrir outra ferramenta.

O público é o dev que administra bancos existentes. Nesses bancos, a lógica costuma estar parte no código e parte em funções e triggers que ninguém lembra de onde vieram.

## Objetivos

- Achar, ler e copiar o código de qualquer função, procedure, trigger ou sequence de um schema sem sair do Ordo.
- Remover um desses objetos com o mesmo regime de segurança do resto do app.
- Como medir: nenhuma consulta ao catálogo escrita à mão para responder "o que essa função faz?" ou "essa tabela tem trigger?".

## Histórias de usuário

- Como dev, quero ver as funções de um schema e abrir o código de uma delas, para entender um comportamento do banco.
- Como dev, quero saber quais triggers uma tabela tem, a partir da própria tabela.
- Como dev, quero ver o valor atual de uma sequence e qual coluna a usa, para investigar um conflito de chave.
- Como dev, quero levar o código de uma função ao editor SQL para alterá-la por lá.
- Como dev, quero remover uma função que sobrou de uma migração, vendo o comando exato antes.
- Como dev numa conexão somente leitura, quero ler tudo isso sem ver nenhuma opção de escrita.

## Funcionalidades principais

### F1. Listar na árvore

1. Sob cada schema, a árvore ganha os grupos que a engine tem:
   - Postgres: Funções, Procedures, Triggers e Sequences.
   - MySQL: Funções, Procedures e Triggers. O MySQL não tem sequences.
   - SQLite: Triggers. O SQLite não tem funções nem procedures guardadas no banco.
2. Grupos vazios não aparecem.
3. Funções e procedures sobrecarregadas aparecem com a assinatura (os tipos dos argumentos), para distinguir uma da outra.
4. Cada trigger aparece com a tabela a que pertence.
5. No Postgres, as funções que pertencem a uma extensão ficam ocultas, para não encher a lista com dezenas de funções que o usuário não escreveu.
6. A paleta (Ctrl+K) encontra esses objetos como encontra tabelas, entre o que a árvore já carregou.

### F2. Ver o código

7. Abrir um objeto abre uma aba com o DDL que o próprio banco guarda e um botão de copiar, no mesmo padrão do DDL da tabela.
8. A aba da sequence mostra também o valor atual, o incremento, o mínimo e o máximo, e a coluna dona quando houver.
9. A aba Estrutura de uma tabela lista os triggers dela, e cada um abre a aba do trigger.
10. "Abrir no editor" coloca o DDL num editor SQL novo, para alterar por lá.

### F3. Remover

11. O menu de cada objeto tem "Remover…". Ela mostra o comando exato (com a assinatura, no caso de função e procedure) e sempre pede confirmação, porque é destrutivo. Em `prod`, o diálogo pede o nome da conexão, como nos outros destrutivos.
12. Em conexão somente leitura, "Remover…" não aparece, e o backend recusa de novo.
13. Depois de remover, a árvore recarrega e a aba do objeto, se estiver aberta, fecha.
14. Se o banco recusa a remoção (outro objeto depende deste), o erro do banco aparece como veio, e nada muda na árvore.
15. A remoção entra no histórico.

## Experiência do usuário

- Os grupos novos ficam abaixo de tabelas e views, na mesma ordem em todas as engines.
- O DDL usa o mesmo realce e o mesmo botão de copiar do DDL da tabela.
- Os ícones distinguem função, procedure, trigger e sequence, e o texto também diz o tipo (tooltip e nome acessível).
- A navegação por teclado na árvore funciona nos grupos novos como nos atuais.

## Restrições técnicas de alto nível

- O DDL mostrado é o que o banco guarda ou reconstrói, nunca um texto montado pelo app que possa divergir do real.
- Schemas com milhares de funções não podem deixar a árvore lenta para abrir. Os grupos novos carregam quando o usuário os expande, não junto com as tabelas.
- O regime de segurança é o atual: confirmação de destrutivos, nome da conexão em `prod` e recusa em somente leitura no banco e no app.

## Fora de escopo

- Criar ou alterar esses objetos por formulário. Isso continua pelo editor SQL.
- Executar uma função com um formulário de parâmetros.
- Depurador de funções.
- Eventos agendados do MySQL, tipos e domínios do Postgres e sequences do MariaDB.
- Funções de extensões (ficam ocultas). Mostrá-las é uma possível opção futura.

## Histórico

**2026-10-27**. Documento criado.
