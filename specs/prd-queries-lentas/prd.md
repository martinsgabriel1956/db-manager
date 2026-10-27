# PRD: Queries lentas (Postgres e MySQL)

## Visão geral

A aba Sessões ativas mostra o que roda agora. No Redis, ela já mostra também os comandos mais lentos (`SLOWLOG`). No Postgres e no MySQL falta a visão acumulada: quais queries, somadas ao longo do tempo, mais pesam no servidor. Hoje isso exige consultar `pg_stat_statements` ou o `performance_schema` à mão e lembrar quais colunas importam.

O público é o dev que cuida de bancos de dev, staging e produção e precisa responder rápido "o que está deixando esse banco lento?".

## Objetivos

- Ver as queries que mais consomem tempo no servidor, com chamadas, tempo total e tempo médio, sem escrever consulta.
- Quando a fonte de estatísticas não está ligada, dizer exatamente o que configurar, sem executar nada.
- Como medir: nenhuma consulta escrita à mão às tabelas de estatística para achar o gargalo de um banco.

## Histórias de usuário

- Como dev, quero ver as 50 queries com maior tempo total num banco de produção, para decidir onde criar um índice.
- Como dev, quero ordenar por tempo médio, para achar a query que é lenta mesmo rodando pouco.
- Como dev, quero filtrar por banco e por usuário, para separar o tráfego da aplicação do de jobs.
- Como dev, quero copiar o texto completo de uma query ou levá-la ao editor, para investigar.
- Como dev num servidor sem `pg_stat_statements`, quero saber o que falta configurar, em vez de ver um erro.

## Funcionalidades principais

### F1. Lista de queries

1. A aba Sessões ativas de conexões Postgres e MySQL ganha a seção "Queries lentas", como o Redis já tem "Comandos lentos".
2. Cada linha é uma query normalizada pelo servidor (com os valores trocados por marcadores) e mostra chamadas, tempo total, tempo médio, linhas e a porcentagem do tempo total. Quando o servidor informa, mostra também o tempo máximo, o banco e o usuário.
3. A lista pode ser ordenada por qualquer coluna. O padrão é o tempo total, decrescente.
4. Há filtro por texto da query, por banco e por usuário.
5. "Atualizar" relê as estatísticas. A seção mostra desde quando elas valem, quando o servidor informa (último reset).
6. A seção mostra as primeiras queries, até um número definido no techspec, e diz quando há mais.

### F2. Detalhe da query

7. Selecionar uma linha mostra o texto completo, com botão de copiar.
8. "Abrir no editor" coloca o texto num editor SQL novo, sem executar. Os marcadores do servidor ficam como vieram.

### F3. Quando a fonte não está disponível

9. No Postgres sem a extensão `pg_stat_statements`, a seção explica o que falta e mostra, para copiar, o `CREATE EXTENSION` e o ajuste de `shared_preload_libraries` (avisando que o ajuste exige reiniciar o servidor). O app nunca executa esses comandos.
10. No MySQL com o `performance_schema` desligado ou sem a coleta por digest, a seção explica a configuração necessária, também só para copiar.
11. Quando o usuário da conexão não tem permissão para ver o texto das queries de outros usuários, a seção mostra o que o servidor devolve e diz que o texto está oculto por permissão.

### F4. Regras

12. A seção só lê. Funciona em conexão somente leitura e em `prod`, sem confirmação.
13. Não existe ação de zerar as estatísticas.
14. Abrir a seção não entra no histórico, como consultar sessões.

## Experiência do usuário

- O layout repete o das sessões: tabela densa, cabeçalhos ordenáveis por clique e por teclado, e a ordenação ativa anunciada.
- Os tempos aparecem com unidade adequada (ms, s, min) e alinhados à direita.
- O texto da query na lista é cortado numa linha, e o completo fica no detalhe.
- A mensagem de fonte indisponível é um estado vazio que se explica, não um erro vermelho.

## Restrições técnicas de alto nível

- Os dados vêm das estatísticas do próprio servidor. O app não coleta nem guarda histórico próprio.
- A consulta às estatísticas precisa ser leve, para poder rodar em produção sem preocupação.
- Precisa lidar com as diferenças entre versões do Postgres (colunas renomeadas ao longo das versões) e do MySQL.

## Fora de escopo

- Zerar as estatísticas (é uma escrita que afeta todos os usuários do servidor).
- Gráficos de tendência e coleta periódica feita pelo app.
- `EXPLAIN` direto a partir da lista (a query vem com marcadores e precisa de valores).
- Profiler do Mongo. O `SLOWLOG` do Redis já existe.
- SQLite, que não tem servidor.

## Histórico

**2026-10-27**. Documento criado.
