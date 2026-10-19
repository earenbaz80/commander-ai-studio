---
id: lint-typescript
name: Lint TypeScript
version: 1.0.0
type: command
description: Ejecuta tsc --noEmit y eslint en el proyecto
author: Commander AI
tags: [lint, typescript, quality]
permissions:
  - shell.run
---

## Description
Ejecuta comprobación de tipos TypeScript (`tsc --noEmit`) y linting ESLint en el proyecto actual.

## Usage
```bash
skill run lint-typescript
skill run lint-typescript --fix
```

## Parameters
| Nombre | Tipo | Requerido | Default | Descripción |
|--------|------|-----------|---------|-------------|
| --fix  | bool | no        | false   | Aplica auto-fix de ESLint |

## Implementation
```bash
#!/bin/bash
set -e
echo "🔍 TypeScript check..."
npx tsc --noEmit
echo "🔍 ESLint..."
npx eslint . --ext .ts,.tsx
```

## Examples
```bash
skill run lint-typescript
skill run lint-typescript --fix
```