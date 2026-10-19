# Skill Schema (P1 #9)

Cada skill es un archivo Markdown con front-matter YAML y secciones estructuradas.

## Front-matter requerido

```yaml
---
id: string              # Identificador único (kebab-case)
name: string            # Nombre legible
version: string         # SemVer
type: "command" | "agent" | "template"  # Tipo de skill
description: string     # Descripción breve (1 línea)
author: string          # Autor/origen
tags: string[]          # Tags para búsqueda/filtrado
requires:               # Dependencias opcionales
  - "skill-id"
permissions:            # Permisos mínimos requeridos
  - "fs.read"
  - "fs.write"
  - "shell.run"
---
```

## Secciones del cuerpo (orden recomendado)

### `## Description`
Descripción extendida, casos de uso, ejemplos.

### `## Usage`
```bash
# Ejemplos de uso
skill run my-skill --arg value
```

### `## Parameters` (opcional)
Tabla o lista de parámetros:
| Nombre | Tipo | Requerido | Default | Descripción |
|--------|------|-----------|---------|-------------|

### `## Implementation` (para commands/agents)
Código o pasos de ejecución. Para **commands**: script bash/JS. Para **agents**: prompt + herramientas.

### `## Examples` (opcional)
Casos de uso reales.

---

## Tipos de skill

### `type: "command"`
- Ejecutable directo (bash, node, python, etc.)
- Se invoca con `skill run <id> [args]`
- Output: stdout/stderr

### `type: "agent"`
- Sub-agente con prompt + herramientas
- Se invoca con `task run <id> "goal"`
- Tiene su propio contexto, plan, steps

### `type: "template"`
- Plantilla de archivos/proyecto
- Se invoca con `template apply <id> [dest]`
- Genera estructura de archivos

---

## Ejemplo: command

```markdown
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
Ejecuta comprobación de tipos TypeScript y linting ESLint en el proyecto actual.

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
```

---

## Ejemplo: agent

```markdown
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
```

---

## Ejemplo: template

```markdown
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
Genera la estructura completa de un componente React moderno.

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
```

---

## Loader API (referencia)

```typescript
interface SkillLoader {
  loadAll(): Promise<Skill[]>
  load(id: string): Promise<Skill | null>
  findByTag(tag: string): Promise<Skill[]>
  findByType(type: SkillType): Promise<Skill[]>
}

interface Skill {
  id: string
  name: string
  version: string
  type: 'command' | 'agent' | 'template'
  description: string
  author: string
  tags: string[]
  permissions: string[]
  requires: string[]
  description: string
  usage: string
  parameters: Parameter[]
  implementation: string
  examples: string
  rawMarkdown: string
}
```