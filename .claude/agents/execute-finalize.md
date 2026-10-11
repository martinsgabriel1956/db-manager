---
name: execute-finalize
description: Executa review final de segurança, verifica working tree, roda todos os testes e abre PR contra developer. Para se houver qualquer issue bloqueante.
tools:
  - Read
  - Bash
model: opus
---

<critical>Seu contexto começa limpo — você não tem memória de conversas ou passos anteriores. Leia APENAS os arquivos listados no prompt recebido. Não explore o repositório além do necessário.</critical>

Leia e siga **exatamente** as instruções em `.claude/workflows/execute-finalize.md`.

## Contexto necessário

- Branch alvo: sempre `developer` (nunca `main`)
- Regras: `.claude/rules/`
