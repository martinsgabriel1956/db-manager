# PRD: Operações em massa e de coleção no MongoDB

## Visão geral

No MongoDB, o Ordo edita um documento por vez (`replaceOne` por `_id`), importa documentos e roda agregações. Não dá para apagar ou atualizar vários documentos por filtro, nem criar ou remover coleções e databases. Hoje, para limpar documentos de teste ou criar uma coleção nova, o usuário precisa do `mongosh`.

O público é o dev que usa o MongoDB no dia a dia e quer resolver essas operações com o mesmo cuidado que o Ordo já tem com destrutivos no SQL.

Esta feature muda uma decisão do M4 (`docs/decisions.md`): a UI do Mongo não tinha nenhum caminho destrutivo além de `$out`. Ela passa a ter, sempre atrás de confirmação, e o decisions.md precisa registrar isso quando a feature for implementada.

## Objetivos

- Rodar `deleteMany` e `updateMany` pelo filtro da coleção, sabendo antes quantos documentos serão afetados.
- Criar e remover coleções e databases pela árvore.
- Toda operação destrutiva mostra o comando exato e pede confirmação, e em `prod` toda escrita passa pelo diálogo.
- Como medir: as operações de manutenção comuns no Mongo não exigem o `mongosh`, e nenhuma operação em massa roda sem que o usuário tenha visto a contagem e o comando.

## Histórias de usuário

- Como dev, quero apagar todos os documentos que casam com o filtro atual, vendo quantos são antes.
- Como dev, quero aplicar um `$set` a todos os documentos de um filtro, para corrigir um campo em massa.
- Como dev, quero criar uma coleção com um validator de JSON schema.
- Como dev, quero criar uma coleção capped para logs.
- Como dev, quero remover uma coleção de testes, sabendo quantos documentos e índices vão junto.
- Como dev, quero criar um database novo e removê-lo depois, com a mesma proteção dos outros destrutivos.

## Funcionalidades principais

### F1. Apagar e atualizar por filtro

1. A tela da coleção ganha "Apagar documentos do filtro…" e "Atualizar documentos do filtro…", que usam o filtro aplicado no momento.
2. Antes de rodar, o app conta os documentos que casam com o filtro e mostra a contagem junto com o comando exato.
3. "Apagar documentos do filtro" é destrutivo: sempre pede confirmação. Em `prod`, pede o nome da conexão.
4. "Atualizar documentos do filtro" recebe o documento de atualização (operadores como `$set` e `$unset`, ou um pipeline de atualização) em Extended JSON, validado antes de habilitar a execução.
5. A atualização pede confirmação em `prod` (toda escrita) e, em qualquer ambiente, quando o filtro está vazio (todos os documentos da coleção), como `UPDATE` sem `WHERE` no SQL.
6. O resultado mostra os documentos encontrados, alterados e apagados, e a lista recarrega.
7. Uma operação longa pode ser cancelada. Como o Mongo não tem transação aqui, o resultado diz que parte dos documentos pode já ter sido alterada.
8. As duas operações entram no histórico.

### F2. Criar coleção

9. "Nova coleção…", no menu do database, pede o nome e as opções básicas: capped (tamanho máximo e número máximo de documentos) e validator (JSON schema em Extended JSON, com nível e ação de validação).
10. O comando aparece antes de rodar. Em `prod`, passa pelo diálogo de confirmação.
11. A árvore recarrega e a coleção nova abre numa aba.

### F3. Remover coleção

12. "Remover coleção…", no menu da coleção na árvore, mostra o comando, a contagem estimada de documentos e os índices que serão removidos junto.
13. É destrutivo: sempre pede confirmação. Em `prod`, pede o nome da conexão.
14. A aba da coleção, se estiver aberta, fecha, e a árvore recarrega.

### F4. Criar e remover database

15. "Novo database…", no menu da conexão, pede o nome do database e o da primeira coleção (no MongoDB, um database só existe com alguma coleção).
16. "Remover database…" mostra o comando e a lista de coleções que serão apagadas. Pede confirmação com o nome do database digitado, em todo ambiente, e em `prod` também com o nome da conexão.
17. Os databases de sistema (`admin`, `local`, `config`) não podem ser removidos pela UI.

### F5. Regras comuns

18. Em conexão somente leitura, nenhuma dessas opções aparece, e o backend recusa de novo.
19. Os nomes de coleção e de database são validados com as regras do MongoDB antes de enviar, com o erro no campo.

## Experiência do usuário

- As ações em massa ficam junto do filtro, para deixar claro que operam sobre ele. O filtro em uso aparece repetido no diálogo.
- A contagem é destacada no diálogo ("1 284 documentos serão apagados").
- O campo de nome digitado para confirmar compara exatamente, e o botão só habilita quando bate.
- Todos os diálogos funcionam só pelo teclado, e o foco inicial fica em "Cancelar" nas operações destrutivas.

## Restrições técnicas de alto nível

- Extended JSON obrigatório no filtro e na atualização, com o mesmo contrato de valores do resto do Mongo (Int64 em `$numberLong`).
- A contagem prévia é uma fotografia: documentos podem mudar entre a contagem e a execução, e a tela não pode prometer o contrário.
- O regime de segurança é o mesmo do SQL: destrutivo sempre confirma, `prod` confirma toda escrita, somente leitura recusa no app e no backend.

## Fora de escopo

- Console ou shell do Mongo.
- Renomear coleção.
- Coleções time series, clustered e views.
- Upsert em atualizações em massa.
- Transações com várias operações.

## Histórico

**2026-10-27**. Documento criado. Altera a decisão do M4 de não ter caminho destrutivo além de `$out`.
