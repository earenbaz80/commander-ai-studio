import { describe, expect, it } from 'vitest';
import {
  expandCommand,
  findCommand,
  withAgentInstructions,
  type ProjectPrompt,
} from '../../src/agent/customPrompts';

const commands: ProjectPrompt[] = [
  {
    id: 'revisar',
    name: 'Revisar',
    description: 'Revisa el diff actual',
    body: 'Revisa el diff y señala qué rompe.\n\nFoco: $ARGUMENTS',
  },
  {
    id: 'prueba',
    name: 'Prueba',
    description: 'Escribe una prueba para algo',
    body: 'Escribe una prueba para $1 con el caso $2.',
  },
  {
    id: 'resumen',
    name: 'Resumen',
    description: 'Resume sin argumentos',
    body: 'Resume el estado del repo.',
  },
];

describe('comandos del proyecto', () => {
  it('encuentra el comando por id o por nombre, con argumentos', () => {
    expect(findCommand('/revisar el diff', commands)?.command.id).toBe('revisar');
    expect(findCommand('/revisar el diff', commands)?.args).toBe('el diff');
    expect(findCommand('/Revisar', commands)?.command.id).toBe('revisar');
    expect(findCommand('revisar sin barra', commands)).toBeNull();
    expect(findCommand('/desconocido', commands)).toBeNull();
  });

  it('sustituye $ARGUMENTS y deja el resto del cuerpo', () => {
    expect(expandCommand('/revisar sólo auth', commands)).toBe(
      'Revisa el diff y señala qué rompe.\n\nFoco: sólo auth'
    );
  });

  it('sustituye $1..$9 por argumentos posicionales', () => {
    expect(expandCommand('/prueba parser caso-vacío', commands)).toBe(
      'Escribe una prueba para parser con el caso caso-vacío.'
    );
  });

  it('añade los argumentos al final si la plantilla no tiene marcadores', () => {
    expect(expandCommand('/resumen urgente', commands)).toBe('Resume el estado del repo.\n\nurgente');
  });

  it('deja el texto intacto si no es un comando conocido', () => {
    expect(expandCommand('arregla el bug', commands)).toBe('arregla el bug');
    expect(expandCommand('/otro cosa', commands)).toBe('/otro cosa');
  });

  it('prefija el agente sin perder la tarea', () => {
    const agent: ProjectPrompt = { id: 'revisor', name: 'Revisor', description: '', body: 'Eres estricto.' };
    const out = withAgentInstructions('Arregla el bug', agent);
    expect(out.startsWith('[AGENTE: Revisor]')).toBe(true);
    expect(out).toContain('Eres estricto.');
    expect(out).toContain('TAREA:\nArregla el bug');
    expect(withAgentInstructions('Arregla el bug', null)).toBe('Arregla el bug');
  });
});
