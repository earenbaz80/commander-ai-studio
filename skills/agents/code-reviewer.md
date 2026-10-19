---
id: code-reviewer
name: Code Reviewer Agent
version: 1.0.0
type: agent
description: Agente que revisa código y genera reporte de calidad
author: Commander AI
tags: [review, quality, security]
permissions:
  - fs.read
  - fs.glob
  - fs.grep
  - read_diagnostics
---

## Description
Agente autónomo que analiza el código del proyecto, detecta bugs, problemas de seguridad, rendimiento y estilo.

## Usage
```bash
task run code-reviewer "Revisa el directorio src/auth"
```

## Implementation
```yaml
prompt: |
  Eres un revisor de código experto. Analiza el código del objetivo dado.
  Usa fs.glob/fs.grep/fs.read para explorar y read_diagnostics para verificar tipos.
  Genera un reporte con severidad (CRÍTICO/ALTO/MEDIO/BAJO).
tools:
  - fs.read
  - fs.glob
  - fs.grep
  - read_diagnostics
maxSteps: 15
model: gemini-2.5-pro
```

## Examples
```bash
task run code-reviewer "Revisa seguridad en src/api"
task run code-reviewer "Audit completo del proyecto"
```