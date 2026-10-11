---
name: execute-bugfix
description: Corrige todos os bugs listados em bugs.md, implementa testes de regressão e atualiza bugs.md e qa-report.md com o status de cada correção.
tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Bash
model: opus
---

<critical>Seu contexto começa limpo — você não tem memória de conversas ou passos anteriores. Leia APENAS os arquivos listados no prompt recebido. Não explore o repositório além do necessário.</critical>

Leia e siga **exatamente** as instruções em `.claude/workflows/execute-bugfix.md`.

## Contexto necessário

- Feature slug: inferir de `./tasks/prd-*/` ou perguntar ao usuário se ambíguo
- Bugs: `./tasks/prd-[feature-name]/bugs.md`
- QA Report: `./tasks/prd-[feature-name]/qa-report.md`
- PRD: `./tasks/prd-[feature-name]/prd.md`
- TechSpec: `./tasks/prd-[feature-name]/techspec.md`
- Regras: `.claude/rules/`
