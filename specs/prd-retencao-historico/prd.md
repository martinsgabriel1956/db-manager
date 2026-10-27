# PRD: Retenção do histórico

## Visão geral

O histórico guarda todo script executado, toda edição salva, todo comando de console e todo export, sem limite de idade (decisão do M2: "sem limite de retenção por enquanto"). Com meses de uso, ele cresce sem parar, e a busca passa a mostrar muita coisa velha. Além disso, comandos antigos de produção ficam guardados para sempre.

O público é qualquer usuário do Ordo. O problema aparece com o tempo de uso, e o app precisa resolvê-lo sozinho antes de virar open source.

## Objetivos

- O histórico deixa de crescer para sempre: entradas mais velhas que N dias saem sozinhas.
- Entradas favoritas nunca saem pela retenção.
- Ninguém perde histórico antigo sem ter sido avisado.
- Como medir: o tamanho do histórico fica estável com o uso contínuo, e nenhuma entrada favorita é apagada pela retenção.

## Histórias de usuário

- Como dev, quero que o histórico guarde só os últimos 90 dias, sem eu precisar fazer nada.
- Como dev, quero mudar esse período ou desligar a limpeza.
- Como dev, quero que as queries que marquei como favoritas fiquem para sempre.
- Como dev, quero limpar o histórico agora (exceto as favoritas), vendo quantas entradas vão sair.
- Como dev que já usa o Ordo há meses, não quero que a atualização apague meu histórico antigo sem me avisar.

## Funcionalidades principais

### F1. Regra de retenção

1. O histórico guarda entradas por N dias. O padrão é 90, e 0 significa guardar para sempre.
2. As entradas favoritas nunca são apagadas pela retenção, qualquer que seja a idade.
3. A limpeza acontece sozinha, sem o usuário pedir e sem travar o uso do app.
4. Depois de uma limpeza grande, o espaço em disco é devolvido: o arquivo do histórico diminui.

### F2. Configurar

5. A aba Histórico ganha a configuração "Guardar por N dias", com a opção de guardar para sempre.
6. Diminuir o período mostra quantas entradas serão apagadas e pede confirmação antes de aplicar.
7. A aba Histórico mostra o total de entradas e o espaço ocupado.

### F3. Limpar agora

8. "Limpar histórico…" apaga todas as entradas que não são favoritas e pede confirmação mostrando quantas sairão.
9. A ação não pode ser desfeita, e o diálogo diz isso.

### F4. Primeira vez

10. Na primeira limpeza depois da atualização, se a regra padrão fosse apagar entradas que já existem, o app avisa antes, mostrando quantas entradas são e de quando é a mais antiga. As opções são aplicar os 90 dias, escolher outro período ou guardar para sempre.
11. Até o usuário responder, nada é apagado.

## Experiência do usuário

- A configuração fica na própria aba Histórico (o app não tem tela de preferências), num lugar discreto, sem competir com a busca.
- Os números do diálogo são concretos ("2 341 entradas, a mais antiga de 3 de março de 2026").
- O aviso da primeira vez aparece uma vez só, e a escolha vale para as próximas limpezas.
- Os controles funcionam pelo teclado e têm nome acessível.

## Restrições técnicas de alto nível

- Arquivos de histórico de versões anteriores precisam continuar abrindo, como já acontece com a coluna de favoritas.
- A limpeza não pode bloquear a gravação de novas entradas nem a busca.
- A configuração fica guardada junto com o estado do app e sobrevive a atualizações.

## Fora de escopo

- Retenção por quantidade de entradas ou por tamanho.
- Período diferente por conexão ou por ambiente.
- Apagar o histórico de uma conexão quando ela é excluída (o comportamento atual não muda).
- Apagar entradas individuais.
- Exportar o histórico.

## Histórico

**2026-10-27**. Documento criado. Substitui o "sem limite de retenção por enquanto" do M2.
