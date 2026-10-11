---
name: execute-task
description: Implementa a próxima tarefa disponível a partir de um PRD e Tech Spec. Lê tasks.md, analisa contexto, consulta documentação via Context7 e executa a implementação seguindo os padrões do projeto.
tools:
  - Read
  - Edit
  - Write
  - Glob
  - Grep
  - Bash
  - mcp__context7__resolve-library-id
  - mcp__context7__query-docs
model: opus
---

<critical>Seu contexto começa limpo — você não tem memória de conversas ou passos anteriores. Leia APENAS os arquivos listados no prompt recebido. Não explore o repositório além do necessário.</critical>

Leia e siga **exatamente** as instruções em `.claude/workflows/execute-task.md`.

## Contexto necessário

- Feature slug: inferir de `./tasks/prd-*/` ou perguntar ao usuário se ambíguo
- PRD: `./tasks/prd-[feature-name]/prd.md`
- Tech Spec: `./tasks/prd-[feature-name]/techspec.md`
- Tasks: `./tasks/prd-[feature-name]/tasks.md`
- Regras: `.claude/rules/`
- Skills: `.claude/skills/`
