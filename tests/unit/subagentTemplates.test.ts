import { describe, expect, it } from 'vitest';
import { AGENT_TOOLS } from '../../security';
import { listTemplates, resolveSubagentPolicy } from '../../src/agent/subagentTemplates';

describe('plantillas de subagente', () => {
  it('define los seis roles con allowlist válida, modo coherente y maxSteps > 0', () => {
    const templates = listTemplates();
    expect(templates.map((t) => t.name)).toEqual([
      'file-explorer',
      'researcher',
      'reviewer',
      'planner',
      'coder',
      'tester',
    ]);

    for (const template of templates) {
      expect(template.defaultMaxSteps).toBeGreaterThan(0);
      expect(template.allowedTools).not.toBeNull();
      for (const tool of template.allowedTools ?? []) {
        expect(AGENT_TOOLS.has(tool), `${template.name} pide ${tool}`).toBe(true);
      }

      const resolved = resolveSubagentPolicy({ template: template.name });
      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.policy.mode).toBe(template.defaultMode);
        expect(resolved.policy.allowedTools).toEqual(template.allowedTools);
        expect(resolved.policy.maxSteps).toBe(template.defaultMaxSteps);
      }
    }
  });

  it('coder construye y tester edita, ambos en build', () => {
    const coder = resolveSubagentPolicy({ template: 'coder' });
    const tester = resolveSubagentPolicy({ template: 'tester' });
    expect(coder.ok && coder.policy.mode).toBe('build');
    expect(tester.ok && tester.policy.mode).toBe('build');
    if (coder.ok) {
      expect(coder.policy.allowedTools).toEqual(
        expect.arrayContaining(['fs.write', 'fs.edit', 'shell.run', 'read_diagnostics'])
      );
    }
    if (tester.ok) {
      expect(tester.policy.allowedTools).toEqual(
        expect.arrayContaining(['fs.read', 'fs.edit', 'shell.run', 'read_diagnostics'])
      );
    }
  });

  it('rechaza plantilla o tool desconocidas y una allowlist incoherente con el modo', () => {
    const plantilla = resolveSubagentPolicy({ template: 'inexistente' });
    expect(plantilla.ok).toBe(false);
    if (!plantilla.ok) expect(plantilla.error).toMatch(/Plantilla de subagente desconocida/);

    const tool = resolveSubagentPolicy({ template: 'coder', allowedTools: ['fs.write', 'no.existe'] });
    expect(tool.ok).toBe(false);
    if (!tool.ok) expect(tool.error).toMatch(/Tool desconocida/);

    const modo = resolveSubagentPolicy({ allowedTools: ['fs.write'], mode: 'readonly' });
    expect(modo.ok).toBe(false);
    if (!modo.ok) expect(modo.error).toMatch(/Modo readonly/);
  });

  it('un allowedTools vacío es explícito y maxSteps se recorta a 1..50', () => {
    const vacio = resolveSubagentPolicy({ template: 'coder', allowedTools: [] });
    expect(vacio.ok && vacio.policy.allowedTools).toEqual([]);

    const bajo = resolveSubagentPolicy({ maxSteps: 0 });
    const alto = resolveSubagentPolicy({ maxSteps: 999 });
    expect(bajo.ok && bajo.policy.maxSteps).toBe(1);
    expect(alto.ok && alto.policy.maxSteps).toBe(50);
  });
});
