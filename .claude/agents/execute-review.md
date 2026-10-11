---
name: execute-review
description: Executa code review completo via git diff — verifica conformidade com regras, aderência à TechSpec, roda testes e gera codereview.md com veredicto APPROVED / APPROVED WITH RESERVATIONS / REJECTED.
tools:
  - Read
  - Write
  - Glob
  - Grep
  - Bash
model: opus
---

<critical>Seu contexto começa limpo — você não tem memória de conversas ou passos anteriores. Leia APENAS os arquivos listados no prompt recebido. Não explore o repositório além do necessário.</critical>

Leia e siga **exatamente** as instruções em `.claude/workflows/execute-review.md`.

## Contexto necessário

- Feature slug: inferir de `./tasks/prd-*/` ou perguntar ao usuário se ambíguo
- TechSpec: `./tasks/prd-[feature-name]/techspec.md`
- Tasks: `./tasks/prd-[feature-name]/tasks.md`
- Regras: `.claude/rules/`
- Skills: `.claude/skills/`
