# PRD: Usuários e permissões (somente leitura)

## Visão geral

"Quem tem acesso a isso?" e "o que esse usuário pode fazer?" são perguntas frequentes em bancos compartilhados entre aplicação, jobs e pessoas. Cada engine responde de um jeito: catálogos de roles no Postgres, `SHOW GRANTS` no MySQL, `usersInfo` no MongoDB, `ACL` no Redis. O Ordo não mostra nada disso, então o usuário precisa lembrar a consulta certa de cada engine.

O público é o dev que administra bancos existentes e precisa auditar ou depurar acesso ("por que a aplicação recebe permission denied nessa tabela?").

## Objetivos

- Ver os usuários e roles de uma conexão, os atributos deles e os privilégios efetivos, nas quatro engines com servidor.
- Responder, a partir de uma tabela, quem pode o quê nela.
- Esta versão só lê. Conceder e revogar continuam pelo editor SQL.
- Como medir: nenhuma consulta ao catálogo escrita à mão para responder perguntas de acesso.

## Histórias de usuário

- Como dev, quero ver todas as roles do Postgres com os atributos (login, superuser, createdb) e de quem cada uma é membro.
- Como dev, quero ver os privilégios efetivos de um usuário, incluindo os herdados de roles, para entender um "permission denied".
- Como dev, quero ver, a partir da aba Estrutura de uma tabela, quem pode ler e escrever nela.
- Como dev, quero ver os usuários do MongoDB por database, com as roles de cada um.
- Como dev, quero ver as regras de ACL de cada usuário do Redis.
- Como dev, quero copiar o `GRANT` equivalente de um privilégio, para reproduzir em outro ambiente.

## Funcionalidades principais

### F1. Lista de usuários e roles

1. "Usuários e permissões", no menu da conexão (Postgres, MySQL, MongoDB e Redis; não existe para SQLite), abre uma aba por conexão.
2. A lista mostra os usuários ou roles com os atributos que a engine tem:
   - Postgres: pode fazer login, superuser, cria banco, cria role, replicação, ignora RLS, validade da senha, limite de conexões e roles de que é membro.
   - MySQL: `usuário@host`, conta bloqueada, senha expirada e roles concedidas.
   - MongoDB: `usuário@database` e roles, com o database de cada uma.
   - Redis: usuário, ligado ou desligado, e o resumo de comandos, chaves e canais permitidos.
3. O usuário da própria conexão aparece destacado.
4. Há busca por nome.

### F2. Detalhe de privilégios

5. Selecionar um usuário ou role mostra os privilégios efetivos:
   - Postgres: por database, schema, tabela, coluna, sequence e função, marcando o que é direto e o que é herdado (e de qual role), além dos privilégios padrão (default privileges).
   - MySQL: os grants como o servidor os reporta, globais, por banco, por tabela e por coluna.
   - MongoDB: as ações por recurso, resolvidas a partir das roles.
   - Redis: as regras de ACL completas.
6. Cada privilégio pode ser copiado como o comando que o concederia (`GRANT`, ou a regra de ACL no Redis).

### F3. Visão a partir da tabela (SQL)

7. A aba Estrutura de uma tabela (Postgres e MySQL) ganha "Acesso": quem tem quais privilégios nela, direto ou por role.

### F4. Regras

8. Nada é escrito no banco: não há criar, alterar, remover, conceder ou revogar.
9. Hashes e segredos de senha nunca aparecem, mesmo quando o servidor os devolve.
10. Quando o usuário da conexão não tem permissão para ler parte dessas informações, a tela mostra o que é visível e diz o que ficou de fora e por quê.
11. Funciona em conexão somente leitura e em `prod`.

## Experiência do usuário

- Lista à esquerda e detalhe à direita, no padrão de lista e detalhe já usado no app.
- Os atributos booleanos aparecem como texto ("pode fazer login"), não só como ícone.
- Privilégios herdados mostram a cadeia ("via role `app_rw`").
- Tabelas navegáveis por teclado, com cabeçalhos ordenáveis.

## Restrições técnicas de alto nível

- As informações vêm do próprio servidor. O app não guarda nem cruza dados entre conexões.
- Senhas e hashes são sensíveis e nunca podem chegar à interface nem ao histórico.
- Precisa lidar com as diferenças de versão (por exemplo, roles no MySQL só existem a partir da 8.0, e ACL no Redis a partir da 6).
- Em serviços gerenciados, parte dos catálogos costuma ser restrita, e isso não pode quebrar a tela.

## Fora de escopo

- Criar, alterar e remover usuários e roles.
- GRANT e REVOKE pela UI (decidido: esta versão só lê).
- Políticas de row level security do Postgres.
- Auditoria de quem acessou o quê.
- SQLite, que não tem usuários.

## Histórico

**2026-10-27**. Documento criado.
