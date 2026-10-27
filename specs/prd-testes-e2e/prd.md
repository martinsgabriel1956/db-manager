# PRD: Testes de ponta a ponta dos fluxos de segurança

## Visão geral

A promessa central do Ordo é segurança contra acidentes no nível do banco: etiqueta de ambiente, somente leitura imposto pelo próprio banco, confirmação de destrutivos e de toda escrita em `prod`, e fidelidade do valor gravado. Hoje cada parte dessa promessa é testada isoladamente: os adapters contra bancos reais, os casos de uso com um adapter falso e a interface com o backend simulado. Nenhum teste passa pelo app inteiro, da tela ao banco, então uma quebra na costura entre as partes passaria por todos os testes atuais.

O público é quem mantém o Ordo: hoje o autor e, depois de virar open source, os contribuidores, que precisam mexer no código sem medo de quebrar a proteção que define o produto.

## Objetivos

- Ter testes que abrem o app de verdade, operam a interface e conferem o resultado no banco real para os quatro fluxos que sustentam a promessa de segurança.
- Rodar tudo com um único comando, localmente, antes de um release.
- Como medir:
  - Os quatro fluxos ficam cobertos de ponta a ponta.
  - Uma regressão proposital em qualquer um deles (por exemplo, desligar a confirmação em `prod`) faz a suíte falhar.
  - A suíte inteira roda em poucos minutos numa máquina de desenvolvimento.

## Histórias de usuário

- Como mantenedor, quero rodar um comando antes de publicar uma versão e ter certeza de que a confirmação em `prod` continua funcionando de verdade.
- Como mantenedor, quero que uma falha mostre em que passo do fluxo quebrou, com captura de tela e logs.
- Como contribuidor, quero rodar os testes sem que eles toquem nas minhas conexões, senhas e histórico reais.

## Funcionalidades principais

### F1. Execução

1. Um único comando roda a suíte inteira localmente.
2. A suíte usa os bancos de demonstração do projeto (`dev/demo`) e diz claramente quando eles não estão disponíveis, em vez de falhar com um erro obscuro.
3. Uma falha informa o fluxo, o passo, uma captura de tela do momento e os logs do app.
4. Os testes nunca leem, alteram ou apagam as conexões, as senhas, o histórico ou o estado de interface reais do usuário.
5. Cada teste deixa os bancos de demonstração no estado em que os encontrou, ou recria esse estado antes de rodar.

### F2. Fluxo: confirmação em `prod`

6. Numa conexão marcada como `prod`, um `UPDATE` no editor abre o diálogo com o comando exato. Cancelar deixa o valor do banco inalterado, e confirmar o altera.
7. Salvar uma edição de célula em `prod` também abre o diálogo com o comando gerado.
8. Um comando destrutivo em `prod` exige digitar o nome da conexão, e o botão só habilita quando o nome bate.
9. Toda a interface marca a conexão `prod` (borda e faixa "Produção").

### F3. Fluxo: somente leitura

10. Numa conexão somente leitura, uma escrita pelo editor é recusada pelo próprio banco (Postgres, MySQL e SQLite), e o valor no banco não muda.
11. As ações de escrita (editar célula, importar, remover) não aparecem na interface.
12. No Mongo e no Redis, a escrita é recusada pelo app, e o valor não muda.

### F4. Fluxo: editar e salvar células

13. Ao abrir uma tabela com chave primária, editar duas células, adicionar uma linha e excluir outra, as quatro aparecem como alterações pendentes.
14. Salvar aplica tudo numa transação, e a grade mostra os valores relidos do banco, iguais aos editados.
15. Descartar desfaz as pendências sem tocar no banco.

### F5. Fluxo: cadastro de conexão

16. Criar uma conexão Postgres com senha, testar e salvar. A conexão aparece na árvore e conecta.
17. A senha não aparece no arquivo de conexões.
18. Depois de fechar e reabrir o app, a conexão continua lá e conecta sem pedir a senha de novo.

## Experiência do usuário

Não há experiência de usuário final: a feature é para quem mantém o código. A "experiência" é a do mantenedor:

- O comando e os pré-requisitos (Docker com os bancos de demonstração, Secret Service rodando) ficam documentados no README, junto com os outros comandos de teste.
- A saída diz o fluxo e o passo de forma legível, sem exigir abrir arquivos de log para entender a falha comum.

## Restrições técnicas de alto nível

- Só Linux, como a distribuição do app.
- Só local, por decisão: a suíte não roda no CI e não bloqueia merge.
- Precisa de um keychain que os testes possam usar sem misturar com as senhas reais do usuário.
- Os testes exercitam o app compilado como o usuário o usa, não a interface isolada no navegador.

## Fora de escopo

- Rodar no CI ou bloquear merge (decidido: só local, por ora).
- macOS e Windows.
- Testes visuais (comparação de screenshots).
- Cobrir todos os fluxos do app. Esta primeira versão cobre só os quatro de segurança e fidelidade.
- Testes de desempenho.

## Histórico

**2026-10-27**. Documento criado. Substitui o "sem E2E na v1" de `docs/decisions.md` (seção Testes).
