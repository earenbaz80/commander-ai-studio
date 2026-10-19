---
id: superpowers
name: Superpowers Workflow
version: 1.0.0
type: agent
description: Encadena brainstorming, plan y verificación para tareas complejas
author: Commander AI
tags: [workflow, planning, debugging, verification]
permissions:
  - fs.read
  - fs.grep
  - shell.run
---

## Description
Flujo completo para entregar código robusto: brainstorming → plan → implementación incremental → tests/build → revisión.

## Usage
```text
skill load superpowers
```

## Implementation
1. Define el problema y margen de fuerza (brainstorming).
2. Diseña un plan corto y critica riesgos.
3. Implementa cambios mínimos y coherentes.
4. Ejecuta verificaciones explícitas (`tsc --noEmit`, `npm run lint`, `npm run build`, tests).
5. Documenta todo lo que tocó y cualquier deuda.

## Examples
- tareas que mezclan UI, backend y estado
- cambios con alta probabilidad de regresión
- cuando se pide “haz todo”
