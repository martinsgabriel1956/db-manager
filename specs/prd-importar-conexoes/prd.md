# PRD: Importar e exportar conexões

## Visão geral

Quem chega ao Ordo vindo de outra ferramenta, ou monta uma máquina nova, recadastra cada conexão à mão. Colar uma URL `postgres://`, `mysql://` ou `redis://` no formulário já preenche uma conexão por vez. O que falta é trazer várias de uma vez, das fontes onde elas já estão.

O público hoje é o autor trocando de máquina. Depois, é qualquer dev que experimenta o Ordo com dezenas de conexões já cadastradas em outro lugar. A primeira impressão de quem vem de outra ferramenta depende disso.

## Objetivos

- Trazer em lote as conexões do `~/.pgpass`, do `~/.my.cnf`, do DBeaver e de um arquivo exportado pelo próprio Ordo.
- Levar as conexões de uma máquina para outra sem que nenhuma senha saia do keychain.
- Nunca criar uma conexão com o ambiente (`local/dev/staging/prod`) escolhido em silêncio.
- Como medir: migrar de máquina leva só o tempo de redigitar as senhas. Ninguém recadastra host, porta, banco, usuário, TLS, túnel ou grupo.

## Histórias de usuário

- Como dev que usa o DBeaver, quero importar as conexões dele, com as pastas virando grupos, para testar o Ordo sem recadastrar tudo.
- Como dev, quero importar as entradas do meu `~/.pgpass` já com as senhas, porque elas já estão lá.
- Como dev, quero importar o `~/.my.cnf` como uma conexão MySQL.
- Como dev trocando de máquina, quero exportar as minhas conexões num arquivo e importar na máquina nova.
- Como dev, quero ver a lista do que vai entrar e escolher o ambiente de cada conexão antes de importar.
- Como dev, quero que conexões que eu já tenho não sejam duplicadas sem eu perceber.

## Funcionalidades principais

### F1. Fluxo comum de importação

1. "Importar conexões…", no menu da lateral, pede a fonte: `~/.pgpass`, `~/.my.cnf`, DBeaver ou um arquivo do Ordo.
2. O app lê a fonte e mostra uma prévia com cada conexão encontrada: nome, engine, host, porta, banco, usuário, se há senha e grupo.
3. Nada é gravado antes de o usuário confirmar a importação.
4. Na prévia, o usuário marca o que importar, edita o nome e o grupo e escolhe o ambiente. É possível aplicar um ambiente a todas as marcadas de uma vez.
5. Nenhuma conexão é importada sem ambiente escolhido. A exceção é o arquivo do Ordo, que traz o ambiente original: ele aparece na prévia, visível e editável.
6. Uma conexão que já existe (mesma engine, host, porta, banco e usuário) aparece marcada como "já cadastrada" e vem desmarcada.
7. Entradas que não dá para importar aparecem na prévia com o motivo e não podem ser marcadas. Exemplos: engine que o Ordo não suporta, host com curinga no `.pgpass`.
8. As senhas encontradas vão para o keychain do sistema, nunca para o arquivo de conexões. Sem Secret Service, vale o mesmo aviso de hoje, e nenhuma senha é gravada em texto puro em silêncio.
9. Ao fim, o app diz quantas conexões foram importadas e quantas ficaram sem senha.

### F2. `~/.pgpass`

10. O app lê o arquivo padrão, ou o que a variável `PGPASSFILE` indica, se existir.
11. Cada linha sem curinga vira uma conexão Postgres com a senha.
12. Uma linha com curinga (`*`) no host ou na porta não vira conexão. Uma linha com curinga no banco ou no usuário vira conexão com esse campo vazio, para o usuário preencher na prévia.

### F3. `~/.my.cnf`

13. O app lê as seções de cliente (`[client]`, `[mysql]` e variações com sufixo). Cada seção com host ou socket vira uma conexão MySQL, com usuário, senha, porta e banco quando presentes.

### F4. DBeaver

14. O app lê as conexões do workspace padrão do DBeaver.
15. As conexões de engines que o Ordo suporta entram. As outras aparecem como não suportadas.
16. As pastas do DBeaver viram grupos.
17. Senhas salvas pelo DBeaver entram quando é possível lê-las. Quando não é, a conexão entra sem senha, e a prévia avisa.
18. As configurações de TLS e de túnel SSH do DBeaver entram quando têm equivalente no Ordo. As que não têm são listadas como ignoradas.

### F5. Arquivo do Ordo (exportar e importar)

19. "Exportar conexões…" deixa escolher quais conexões (ou todas) e grava um arquivo com nome, engine, alvo, ambiente, grupo, TLS, túnel e somente leitura.
20. O arquivo nunca leva senhas: nem a do banco, nem a do túnel, nem a connection string do Mongo, que é guardada inteira como segredo.
21. Na importação, uma conexão Mongo por connection string chega sem a string, e a prévia avisa que ela precisa ser preenchida.
22. Um arquivo de uma versão mais nova do Ordo, com campos desconhecidos, importa o que entende e avisa o que ignorou.

## Experiência do usuário

- A prévia é uma tabela navegável por teclado, com marcar e desmarcar por espaço, e cada linha diz por que não pode ser importada, quando for o caso.
- Escolher o ambiente usa os mesmos rótulos e as mesmas cores do formulário de conexão.
- Uma fonte que não existe na máquina (sem `.pgpass`, sem DBeaver) aparece com essa explicação, sem erro técnico.

## Restrições técnicas de alto nível

- Senha só no keychain, sempre. O arquivo exportado não pode conter segredo algum.
- O ambiente nunca é herdado em silêncio, como já vale para "Duplicar conexão".
- Os arquivos de outras ferramentas são só lidos, nunca alterados.
- O formato do arquivo do Ordo precisa continuar importável por versões futuras.

## Fora de escopo

- TablePlus, DataGrip, pgAdmin e outras fontes. Ficam para quando alguém pedir.
- Exportar com senhas, mesmo cifradas (decidido: sem senhas).
- Atualizar uma conexão existente com os dados importados (mesclar). A duplicada só é sinalizada.
- Sincronizar conexões entre máquinas pela nuvem.

## Histórico

**2026-10-27**. Documento criado. Colar URL no formulário já existia e não faz parte deste escopo.
