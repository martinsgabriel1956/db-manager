# PRD: Análise de memória e chaves grandes no Redis

## Visão geral

Quando um Redis enche a memória, a primeira pergunta é "quais chaves estão ocupando isso?". O Ordo navega as chaves por `SCAN` e mostra o `INFO`, mas não responde essa pergunta. Hoje o caminho é o `redis-cli --bigkeys` ou o `--memkeys`, fora do app e sem agrupar por prefixo.

O público é o dev que opera Redis de cache, de fila e de sessão em vários ambientes, inclusive em produção, onde a pergunta costuma aparecer.

## Objetivos

- Encontrar as chaves que mais ocupam memória e os prefixos que mais pesam num database, sem sair do Ordo.
- Fazer a análise sem prejudicar o servidor: sempre `SCAN`, ritmo limitado e parada a qualquer momento.
- Como medir: diagnosticar "o que está ocupando a memória" sem precisar do `redis-cli` e sem comandos que bloqueiem o servidor.

## Histórias de usuário

- Como dev, quero ver as 100 maiores chaves de um database por memória, para achar o vazamento.
- Como dev, quero ver quanto cada prefixo (`session:`, `cache:user:`) ocupa no total, porque o problema costuma ser um padrão, não uma chave.
- Como dev, quero limitar a análise a um padrão, para olhar só o que importa.
- Como dev em produção, quero parar a análise se vir o servidor sofrer e ainda ficar com o resultado parcial.
- Como dev, quero abrir uma chave grande direto da lista.

## Funcionalidades principais

### F1. Rodar a análise

1. A aba do database ganha a seção "Memória", ao lado de Chaves, Console e Servidor.
2. A seção tem um campo de padrão (o mesmo formato da busca de chaves; vazio = tudo) e o botão "Analisar".
3. A análise percorre o database inteiro por `SCAN`, nunca por `KEYS`, e lê o tamanho e a memória de cada chave.
4. Enquanto roda, mostra o progresso (chaves analisadas e total aproximado do database) e o tempo decorrido.
5. "Parar" interrompe a qualquer momento. O resultado parcial fica na tela, marcado como parcial.
6. A análise roda em ritmo limitado, com pausa entre lotes, para não competir com a aplicação.
7. Um aviso sobre o custo da análise fica sempre visível na seção. Em `prod` ela roda como nos outros ambientes, sem confirmação, porque é leitura.

### F2. Resultado

8. A seção mostra as maiores chaves por memória (padrão 100), com nome, tipo, memória, número de elementos e TTL.
9. Mostra também um resumo por tipo (quantidade de chaves, memória total e maior chave de cada tipo).
10. E um resumo por prefixo, agrupado pelo separador configurado na conexão, com quantidade de chaves e memória total, ordenável.
11. Selecionar uma chave abre a chave na seção Chaves.
12. Quando o servidor recusa a leitura de memória por chave (comum em serviços gerenciados), a análise usa o número de elementos ou o tamanho da string e diz isso na tela.
13. O resultado fica na tela até a próxima análise ou o fechamento da aba. Não é guardado.

### F3. Topologias

14. No Redis Cluster, a análise percorre todos os nós master e soma os resultados.
15. No Sentinel, ela roda contra o master que o sentinel indicar, como as outras operações.

## Experiência do usuário

- As tabelas de chaves, tipos e prefixos usam o mesmo estilo das outras listas do Redis, com ordenação por teclado.
- Os tamanhos aparecem em unidades legíveis (KiB, MiB).
- O botão "Parar" fica no mesmo lugar do "Analisar" enquanto a análise roda, e o leitor de tela recebe o progresso sem excesso de anúncios.
- O aviso de custo é texto fixo e discreto, não um diálogo.

## Restrições técnicas de alto nível

- Sempre `SCAN`, nunca `KEYS`, como em todo o app.
- O ritmo da análise precisa ser conservador por padrão: um database com milhões de chaves pode levar minutos, e isso é aceitável.
- A memória por chave é uma estimativa do próprio servidor. A tela não pode apresentá-la como exata.
- Funciona em conexão somente leitura (os comandos usados são de leitura).

## Fora de escopo

- Apagar chaves em lote a partir do resultado.
- Análise contínua, agendada ou com histórico entre execuções.
- Análise offline de arquivo RDB.
- Exportar o resultado.

## Histórico

**2026-10-27**. Documento criado.
