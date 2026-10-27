# Specs

Uma linha por feature: PRD → techspec → tasks → review.

- [Resultado de cada comando do script](prd-resultados-por-comando/prd.md): uma aba por resultado e um resumo da execução no editor SQL. Status: implementado (branch `feat/resultados-por-comando`, PR a abrir)
- [Funções, procedures, triggers e sequences na árvore](prd-objetos-programaveis/prd.md): listar, ver o DDL e remover os objetos programáveis do SQL. Status: em prd
- [Importar e exportar conexões](prd-importar-conexoes/prd.md): trazer conexões do `.pgpass`, do `.my.cnf`, do DBeaver e de um arquivo do Ordo (sem senhas). Status: em prd
- [Editar arrays e binários na grade](prd-editar-arrays-binarios/prd.md): arrays elemento por elemento e binários por arquivo ou hex, no stage. Status: em prd
- [Queries lentas (Postgres e MySQL)](prd-queries-lentas/prd.md): estatísticas acumuladas do servidor na aba Sessões ativas. Status: em prd
- [Análise de memória e chaves grandes no Redis](prd-redis-memoria/prd.md): maiores chaves e prefixos por memória, por `SCAN` com ritmo limitado. Status: em prd
- [Usuários e permissões (somente leitura)](prd-usuarios-permissoes/prd.md): usuários, roles e privilégios efetivos no Postgres, MySQL, MongoDB e Redis. Status: em prd
- [Operações em massa e de coleção no MongoDB](prd-mongo-operacoes-colecao/prd.md): deleteMany e updateMany por filtro, e criar e remover coleção e database. Status: em prd
- [Retenção do histórico](prd-retencao-historico/prd.md): apagar entradas com mais de N dias (padrão 90), sem nunca apagar as favoritas. Status: em prd
- [Testes de ponta a ponta dos fluxos de segurança](prd-testes-e2e/prd.md): confirmação em prod, somente leitura, edição e cadastro, rodando localmente. Status: em prd
