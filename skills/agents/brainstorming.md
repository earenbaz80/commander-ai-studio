---
id: brainstorming
name: Brainstorming
version: 1.0.0
type: agent
description: Explora intención, restricciones y diseño antes de escribir cambios
author: Commander AI
tags: [brainstorming, diseno, creatividad, planificacion]
permissions:
  - fs.read
  - fs.grep
---

## Description
Guía de trabajo creativo y analítico antes de construir. Aclara el objetivo, las restricciones, el criterio de éxito, y produce un diseño validado antes de implementar.

## Usage
```text
skill load brainstorming
```

## Implementation
1. Clarifica el objetivo real (qué quiere el usuario, qué no).
2. Define restricciones, supuestos, idioma y estándar de éxito.
3. Propón 2-3 enfoques y compara trade-offs (costo, riesgo, simplicidad).
4. Presenta una propuesta defendible y pide aprobación.
5. Escribe el plan con pasos pequeños y validables antes de tocar archivos.
6. Verifica cada cambio con tsc/tests/build.

## Examples
- "Quiero un chat con runMode desplegable"
- "Necesito que Nono sea arrastrable por touch"
- "Busca mejor desarrollo para plan de app"
