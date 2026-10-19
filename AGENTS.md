# AGENTS.md — Commander AI Studio

## Reglas para agentes autónomos
- Lee antes de editar: usa `fs.read` / `fs.glob` / `fs.grep` para contexto exacto.
- Ediciones mínimas: prefiere `fs.edit` con `oldString` exacto; solo `fs.write` para crear.
- No rompas build: tras editar TS, el proyecto debe pasar `tsc --noEmit` y `vite build`.
- Seguridad: nunca ejecutes comandos fuera de allowlist (npm/npx/node/python/git/ls/cat/echo/tsc/vite). Pide aprobación para writes.
- Estilo: TypeScript estricto, Tailwind, UI retro Norton (azul #000080, cyan #00ffff, amarillo #ffff55).
- Responde con JSON válido al orquestador: thought/plan/toolCalls/answer/finish.
- Si terminas, marca `finish:true` con resumen de archivos tocados.
