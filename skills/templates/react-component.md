---
id: react-component
name: React Component Template
version: 1.0.0
type: template
description: Genera un componente React con TypeScript, tests y Storybook
author: Commander AI
tags: [react, typescript, component, testing]
permissions:
  - fs.write
---

## Description
Genera la estructura completa de un componente React moderno con TypeScript, tests y Storybook.

## Usage
```bash
template apply react-component src/components/MyButton
```

## Parameters
| Nombre | Tipo | Requerido | Default | Descripción |
|--------|------|-----------|---------|-------------|
| name   | string | sí       | -       | Nombre del componente (PascalCase) |
| dest   | string | sí       | -       | Directorio destino |

## Implementation
```typescript
// Genera estos archivos:
// {{dest}}/{{name}}.tsx
// {{dest}}/{{name}}.test.tsx
// {{dest}}/{{name}}.stories.tsx
// {{dest}}/index.ts
```

## Examples
```bash
template apply react-component src/components/Button
```