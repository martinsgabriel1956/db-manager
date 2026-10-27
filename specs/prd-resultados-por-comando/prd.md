# PRD: Resultado de cada comando do script

## Visão geral

O editor SQL roda um script com vários comandos na mesma sessão, mas mostra só o resultado do último. Para ver o resultado de um comando do meio, o usuário precisa selecionar e rodar esse comando sozinho. E num script de correção (um `UPDATE`, depois um `SELECT` de conferência) ele não vê quantas linhas cada comando afetou.

O público é quem usa o editor SQL do Ordo no Postgres, no MySQL ou no SQLite: um dev que conhece SQL e roda scripts curtos de consulta e manutenção nos bancos do dia a dia.

Vale a pena porque o editor já executa cada comando separadamente e sabe onde o script parou. A informação existe e só não chega à tela.

## Objetivos

- Rodar um script uma vez e conseguir ver o resultado de todo comando que devolve linhas, sem rodar de novo.
- Saber, para cada comando, se ele rodou, quantas linhas devolveu ou afetou e quanto tempo levou.
- Script com um comando só continua exatamente como hoje: mesma tela e mesmos atalhos.

Como medir:

- Nenhum fluxo comum exige rodar um script em partes só para ver um resultado intermediário.
- Quando um script falha ou é cancelado no meio, a tela mostra sem ambiguidade quais comandos rodaram, qual falhou e quais não rodaram.

## Histórias de usuário

- Como dev, quero rodar três `SELECT`s de uma vez e alternar entre os resultados, para comparar dados sem reexecutar nada.
- Como dev, quero ver quantas linhas cada `UPDATE` de um script de correção afetou, para conferir que a correção pegou o que eu esperava.
- Como dev, quando o 3º de 5 comandos falha, quero ver os resultados dos 2 primeiros e o erro no 3º, sabendo que o 4º e o 5º não rodaram.
- Como dev, quero cancelar um script longo e continuar vendo o que já tinha terminado.
- Como dev, quero exportar ou copiar o resultado de um comando específico do script, não só o do último.

## Funcionalidades principais

### F1. Uma aba por resultado

Cada comando que devolve linhas ganha a sua aba de resultado. É o caso principal: comparar consultas.

1. Cada comando que devolve linhas (inclusive uma escrita com `RETURNING`) ganha uma aba de resultado própria, na ordem do script.
2. O rótulo da aba identifica o comando pelo número da posição no script e pelo começo do texto.
3. Quando o script termina, fica ativa a aba do último comando que devolveu linhas, como hoje.
4. Cada aba tem tudo o que a grade de resultado já tem: painel de valor, copiar como JSON, redimensionar colunas e seguir chave estrangeira quando se aplica. Carregar mais linhas em lotes vale só para o último comando. Os anteriores mostram as primeiras 1000 linhas e o total ("mostrando 1000 de N; rode o comando sozinho para ver todas").
5a. Até 20 comandos com linhas ganham aba (o último sempre ganha). Os demais aparecem só no resumo, com o total de linhas.
5. Um script com um comando só não mostra abas: a área de resultado fica igual à de hoje.

### F2. Resumo da execução

Uma visão "Execução" funciona como log do script. É ela que responde ao "o que aconteceu?" num script de escrita.

6. Quando o script tem mais de um comando, a visão "Execução" lista todos na ordem, com:
   - o texto do comando (resumido);
   - a situação: concluído, erro, não executado ou cancelado;
   - as linhas devolvidas ou afetadas;
   - a duração.
7. Selecionar no resumo um comando que devolveu linhas leva à aba dele.
8. Selecionar um comando no resumo destaca o trecho dele no editor.
9. Quando um comando falha, o resumo mostra o erro nele e marca os seguintes como não executados. A mensagem sobre o que já foi confirmado continua como é hoje (por exemplo, "Os 2 comandos anteriores já rodaram e, sem BEGIN no script, já foram confirmados").

### F3. Erro, cancelamento e timeout

10. Os resultados dos comandos que terminaram antes de um erro, de um cancelamento ou de um timeout continuam abertos e navegáveis.
11. O timeout continua contando por comando, como hoje.
12. Fechar o resultado (rodar de novo, fechar a aba do editor) libera todos os resultados do script, não só o último.

### F4. Export, cópia e histórico

13. Exportar a partir de uma aba de resultado exporta o resultado daquele comando. O export continua aceitando só scripts de leitura.
14. Copiar como JSON vale para a aba ativa.
15. O histórico continua com uma entrada por script executado, como hoje.

## Experiência do usuário

- As abas de resultado ficam entre o editor e a grade. A "Execução" vem primeiro, e depois uma aba por comando com linhas.
- O teclado alcança tudo: há um atalho para ir à próxima aba de resultado e à anterior, e o foco não se perde ao trocar de aba.
- O leitor de tela anuncia o número do comando e a situação de cada aba ("comando 3 de 5, erro").
- Um comando com erro tem a marca de erro visível na própria aba e no resumo. A cor não é o único sinal.

## Restrições técnicas de alto nível

- Fidelidade dos dados: os valores em cada aba seguem o mesmo contrato da grade atual (protocolo texto, números grandes sem perda).
- Um script com muitos comandos que devolvem linhas não pode travar a tela, esgotar a memória nem prender conexões do banco indefinidamente. O techspec define o limite e o que acontece acima dele (por exemplo, comandos além do limite aparecem só no resumo).
- O comportamento de segurança não muda: confirmação de destrutivos, confirmação de toda escrita em `prod` e somente leitura imposto pelo banco valem para o script inteiro, como hoje.
- Vale para Postgres, MySQL e SQLite.

## Fora de escopo

- Rodar os comandos de um script em paralelo.
- Transação implícita em volta do script. Continua sem: cada comando é confirmado sozinho, salvo um `BEGIN` do próprio script.
- Comparar dois resultados lado a lado.
- Console do Mongo e console do Redis.
- Guardar os resultados entre aberturas do app (eles continuam morrendo com o app).

## Histórico

**2026-10-27**. Documento criado.

**2026-10-27**. No techspec, o requisito 4 mudou: carregar mais linhas vale só para o último comando, porque uma sessão do banco mantém um único resultado aberto por vez. Os anteriores ficam com o primeiro lote e o total. Entrou o requisito 5a (limite de 20 abas), que a seção de restrições deixava para o techspec. As duas decisões foram tomadas com o usuário.
