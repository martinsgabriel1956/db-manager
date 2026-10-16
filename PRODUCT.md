# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Hoje:** um único usuário, o próprio autor, um dev fullstack que administra bancos existentes (locais, de dev, staging e produção) no dia a dia: navega dados, roda queries, corrige registros, inspeciona chaves e documentos.
- **Depois:** o projeto deve poder virar open source e ser usado por outros devs. Primeira execução, estados vazios e textos precisam se explicar sem o autor ao lado; nada pode depender de conhecimento que só ele tem.
- Quem usa conhece SQL, MongoDB e Redis. O produto não ensina banco de dados; ele evita erro e mostra o dado exato.

## Product Purpose

Cliente desktop para gerenciar bancos que já existem (na linha de TablePlus/DBeaver), com cinco engines num só app: **Postgres, MySQL, SQLite, MongoDB e Redis (standalone)**. Três modelos de interface, um por modelo de dados: grade relacional (SQL), documentos (Mongo) e chave-valor (Redis).

Sucesso: trocar de banco e de ambiente sem trocar de ferramenta, sem nunca executar sem querer um comando destrutivo, e sem ver um valor diferente do que está gravado.

## Positioning

O que um vizinho não pode copiar de forma honesta, e que o design futuro precisa proteger:

1. **Segurança contra acidentes no nível do banco, não só da UI.** Etiqueta de ambiente por conexão (`local/dev/staging/prod`); somente leitura imposto pelo próprio banco (PG `default_transaction_read_only`, MySQL `SESSION TRANSACTION READ ONLY`, SQLite `mode=ro`, allowlist no Rust para Mongo/Redis); destrutivos detectados por parser (`sqlparser`), não regex; em `prod`, **toda escrita** pede confirmação mostrando o comando exato que vai rodar.
2. **Fidelidade dos dados.** Protocolo texto no Postgres/MySQL, Int64 sempre em `$numberLong`, Extended JSON preservado byte a byte na ida e volta, números grandes nunca passam por `JSON.parse` com perda, tipo não modelado aparece como `Unknown` e não é editável.
3. **Leve e nativo no Linux.** Tauri + Rust, sem JVM, AppImage e `.deb`.
4. **Um app para cinco engines**, cada uma com a UI do seu modelo de dados em vez de forçar tudo numa grade.

## Operating Context

- App desktop Tauri; a interface roda num webview (WebKitGTK no Linux). Janela padrão 1200×800, mínimo 960×600. Tema claro/escuro segue o sistema operacional.
- Layout de trabalho: árvore de conexões na lateral (conexão → schema/database → tabelas/coleções, ou databases 0–15 no Redis) e abas persistidas na área principal (tabelas, editores SQL, coleções, databases Redis, diagramas ER, histórico).
- Fluxos centrais: cadastrar conexão (senha/URI no keychain do SO, túnel SSH opcional); navegar tabela paginada com filtro e ordenação; editar células em stage e salvar numa transação; rodar SQL com autocomplete, cancelamento real e timeout; CRUD de documentos e pipeline de agregação no Mongo; navegar chaves por `SCAN`, editar por tipo, TTL, renomear, console e pub/sub no Redis; histórico pesquisável; export em streaming (CSV, NDJSON, JSON); diagrama ER somente leitura.
- Ritual de segurança: a conexão `prod` marca a janela inteira (borda e faixa "Produção") e toda escrita passa pelo diálogo que mostra o comando.
- Bancos de demonstração locais em `dev/demo` (Docker Compose + SQLite gerado) para desenvolver e demonstrar.

## Capabilities and Constraints

- Decisões e escopo de cada marco (M0–M6) em `docs/decisions.md`; é a fonte de verdade técnica.
- **Fora da v1:** builder visual de agregação, inferência de schema, gestão de índices, change streams, MONITOR, módulos, Redis cluster/sentinel, export no Redis. Cluster e builder de agregação estão previstos para v2+. Assinatura e auto-update saíram desta lista: as atualizações são assinadas e o app se atualiza com o consentimento do usuário (ver docs/decisions.md). Edição de schema também saiu (abaixo).
- **Edição de schema (SQL), depois da v1:** criar tabela, adicionar, renomear e remover coluna, mudar tipo, default e NULL, criar e remover índice. A UI gera o DDL e sempre mostra o comando exato antes de rodar; remover coluna ou índice é destrutivo; o que a engine não faz (o SQLite não altera coluna sem recriar a tabela) é dito na tela, não escondido.
- Edição inline só em tabela com chave primária editável; senão a tabela é somente leitura. Mongo e Redis editam na hora, sem stage.
- Redis: sempre `SCAN`, nunca `KEYS`. Sem cancelamento no Redis e no SQLite (só timeout).
- Distribuição só Linux (AppImage + `.deb`) via GitHub Releases; sem builds de macOS/Windows por enquanto.
- Linux sem Secret Service: aviso claro na UI, nunca senha em texto puro silencioso.
- Contrato Rust ↔ TS gerado (`src/bindings.ts` via `tauri-specta`); não editar à mão.
- Terminologia da UI: "conexão", "ambiente", "somente leitura", "alterações pendentes", "confirmar execução", "agregação", "chaves", "console", "servidor".

## Brand Commitments

- Nome: **Ordo** ("ordem" em latim: uma ordem só para cinco engines). Antes se chamava DB Manager; o identificador `dev.nemomartins.dbmanager` e o serviço do keychain `db-manager` mantêm o nome antigo de propósito, porque trocá-los apagaria conexões e senhas salvas.
- Idioma da interface: **português do Brasil**, direto e técnico. Comandos e nomes do banco aparecem como são (SQL, `SCAN`, `$numberLong`), sem tradução.
- Marca: um "O" quadrado de cantos cortados construído na grade, com o canto superior direito cortado em azul (`src-tauri/icons/icon.svg`); a bandeja do sistema usa a mesma marca ampliada no quadro (`src-tauri/icons/tray.svg`). Na interface, a marca escrita é ORDO/ fechada pela diagonal azul.

## Evidence on Hand

- `README.md` (setup, comandos, onde ficam os dados) e `docs/decisions.md` (decisões de produto e notas de implementação por marco).
- Seeds de demonstração em `dev/demo` (Postgres, MySQL, SQLite, MongoDB, Redis).
- Fake backend dos testes em `src/test/fakeBackend.ts`, útil para mostrar a UI sem bancos reais.
- **Não existem:** usuários externos, depoimentos, métricas de uso, benchmarks de desempenho contra TablePlus/DBeaver, site ou screenshots oficiais. Trabalho futuro não deve inventar nenhum deles.

## Product Principles

1. **O comando exato antes do clique.** Toda ação arriscada mostra o que vai rodar no banco; aviso vago não conta como confirmação.
2. **O valor gravado, não uma aproximação.** Na dúvida, mostrar como texto e bloquear a edição em vez de converter com perda.
3. **O ambiente nunca é ambíguo.** Saber se está em produção não pode depender só de cor nem de lembrar qual aba está aberta.
4. **Cada modelo de dados com a sua forma.** Tabela é grade, documento é árvore/JSON, chave é tipo; não forçar uma metáfora sobre a outra.
5. **Explicável para quem chega depois.** Pensado para um usuário hoje, mas sem atalhos de conhecimento implícito que travariam a abertura do projeto.

## Accessibility & Inclusion

- WCAG 2.2 AA: contraste mínimo 4,5:1 em texto (3:1 em controles e ícones), nos temas claro e escuro.
- Tudo operável pelo teclado, incluindo a grade de resultados, abas, árvore, diálogos de confirmação e diagrama.
- Estado (ambiente, somente leitura, alterações pendentes, sucesso/erro) nunca comunicado só por cor; nomes acessíveis em português.
