import { describe, expect, it } from 'vitest';
import { sessionFileName, sessionToMarkdown } from '../../src/agent/sessionExport';
import type { AgentStep } from '../../src/agent/types';

/** Paso mínimo con los campos que `AgentStep` exige, sin duplicar `type`. */
function step(partial: Partial<AgentStep> & Pick<AgentStep, 'type'>): AgentStep {
  return {
    id: partial.id ?? 'step',
    ts: partial.ts ?? 1700000000000,
    type: partial.type,
    title: partial.title ?? '',
    content: partial.content ?? '',
    status: partial.status ?? 'done',
    toolId: partial.toolId,
    input: partial.input,
    output: partial.output,
    durationMs: partial.durationMs,
  } as AgentStep;
}

describe('export de la corrida', () => {
  it('incluye la tarea y una sola entrada por fichero tocado', () => {
    const steps: AgentStep[] = [
      step({ type: 'thought', content: 'Voy a tocar dos archivos' }),
      step({ type: 'tool_call', toolId: 'fs.edit', input: { path: 'src/a.ts', oldString: 'a', newString: 'b' } }),
      step({ type: 'tool_call', toolId: 'fs.edit', input: { path: 'src/a.ts', oldString: 'b', newString: 'c' } }),
    ];
    const md = sessionToMarkdown({ task: 'Arreglar el bug', steps });
    expect(md).toContain('## Tarea');
    expect(md).toContain('Arreglar el bug');
    expect(md).toContain('## Ficheros tocados');
    expect((md.match(/- `src\/a\.ts`/g) ?? []).length).toBe(1);
  });

  it('etiqueta los pasos y guarda el input crudo en JSON', () => {
    const steps: AgentStep[] = [
      step({
        type: 'tool_call',
        toolId: 'shell.run',
        input: { command: 'npm test' },
        output: { ok: true },
        durationMs: 1200,
      }),
    ];
    const md = sessionToMarkdown({ steps });
    expect(md).toContain('**Acción** `shell.run`');
    expect(md).toContain('objetivo: `npm test`');
    expect(md).toContain('duración: 1200 ms');
    expect(md).toContain('```json');
    expect(md).not.toContain('## Tarea');
  });

  it('el nombre del fichero lleva marca de tiempo y extensión .md', () => {
    const name = sessionFileName();
    expect(name).toMatch(/^sesion-agente-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.md$/);
  });
});
