---
name: task-creator
description: Generates a comprehensive task breakdown and individual task files based on an existing PRD and Tech Spec. First analyzes requirements, presents a high-level list for user approval, and then creates the task files.
model: opus
---

<critical>Seu contexto começa limpo — você não tem memória de conversas ou passos anteriores. Leia APENAS os arquivos listados no prompt recebido. Não explore o repositório além do necessário.</critical>

Leia e siga **exatamente** as instruções em `.claude/workflows/create-tasks.md`.

## Contexto necessário

- Feature slug: inferir de `./tasks/prd-*/` ou perguntar ao usuário se ambíguo
- PRD: `./tasks/prd-[feature-name]/prd.md`
- Tech Spec: `./tasks/prd-[feature-name]/techspec.md`
- Regras: `.claude/rules/`
