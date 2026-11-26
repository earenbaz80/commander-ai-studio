import { describe, it, expect } from 'vitest';
import { FakeBackendAdapter } from '../../deploy/backend/fakeAdapter';
import { backendSecretName, BACKEND_BINDING_KINDS } from '../../deploy/backend/types';
import type { BackendBindingKind, BackendRotation } from '../../deploy/backend/types';

/**
 * Contrato de `BackendAdapter` (PL3), ejercitado contra el doble en memoria.
 *
 * Lo que se fija aquí es lo que cualquier adaptador real debe cumplir: migrar es
 * idempotente, el estado no inventa bindings y, sobre todo, **ningún resultado
 * transporta el valor de un secreto**; el valor sale una sola vez por el sink.
 */

function adapter(): FakeBackendAdapter {
  return new FakeBackendAdapter({
    now: () => new Date('2026-11-23T10:00:00.000Z'),
    secretFactory: (name) => `valor-${name.toLowerCase()}`,
  });
}

function collect(): { sink: { write: (name: string, value: string) => void }; seen: [string, string][] } {
  const seen: [string, string][] = [];
  return {
    seen,
    sink: {
      write: (name: string, value: string) => {
        seen.push([name, value]);
      },
    },
  };
}

describe('backend adapter contract', () => {
  it('aprovisiona los tres bindings y deja el backend listo', async () => {
    const backend = adapter();
    const status = await backend.provision({ projectId: 'app-uno', bindings: [...BACKEND_BINDING_KINDS] });

    expect(status.provider).toBe('fake');
    expect(status.projectId).toBe('app-uno');
    expect(status.ready).toBe(true);
    expect(status.bindings.map((binding) => binding.kind)).toEqual(['database', 'storage', 'auth']);
    expect(status.bindings.every((binding) => binding.state === 'ready')).toBe(true);
    expect(new Set(status.bindings.map((binding) => binding.resourceId)).size).toBe(3);
    expect(status.secretNames).toEqual([]);
    expect(status.migrations).toEqual({ applied: [], pending: [] });
  });

  it('repetir el aprovisionamiento no duplica recursos ni cambia sus ids', async () => {
    const backend = adapter();
    const first = await backend.provision({ projectId: 'app-uno', bindings: ['database', 'storage'] });
    const second = await backend.provision({ projectId: 'app-uno', bindings: ['database', 'auth'] });

    expect(second.bindings).toHaveLength(3);
    expect(second.bindings.find((binding) => binding.kind === 'database')?.resourceId).toBe(
      first.bindings.find((binding) => binding.kind === 'database')?.resourceId
    );
  });

  it('un proyecto sin aprovisionar devuelve estado vacío, no un error', async () => {
    const status = await adapter().status('app-sin-backend');

    expect(status.ready).toBe(false);
    expect(status.bindings).toEqual([]);
    expect(status.secretNames).toEqual([]);
  });

  it('migra en orden y repetir la tanda no vuelve a aplicar nada', async () => {
    const backend = adapter();
    await backend.provision({ projectId: 'app-uno', bindings: ['database'] });

    const migrations = [
      { id: '0001-init', sql: 'create table notas (id text primary key)' },
      { id: '0002-indice', sql: 'create index notas_id on notas (id)' },
    ];
    const first = await backend.migrate({ projectId: 'app-uno', migrations });
    expect(first.applied).toEqual(['0001-init', '0002-indice']);
    expect(first.skipped).toEqual([]);
    expect(first.failed).toEqual([]);

    const second = await backend.migrate({ projectId: 'app-uno', migrations });
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual(['0001-init', '0002-indice']);

    const status = await backend.status('app-uno');
    expect(status.migrations).toEqual({ applied: ['0001-init', '0002-indice'], pending: [] });
    expect(status.ready).toBe(true);
  });

  it('una tanda con ids duplicados no aplica ninguna migración', async () => {
    const backend = adapter();
    await backend.provision({ projectId: 'app-uno', bindings: ['database'] });

    await expect(
      backend.migrate({
        projectId: 'app-uno',
        migrations: [
          { id: '0001-init', sql: 'create table a (id text)' },
          { id: '0001-init', sql: 'create table b (id text)' },
        ],
      })
    ).rejects.toThrow(/duplicada/);

    const status = await backend.status('app-uno');
    expect(status.migrations.applied).toEqual([]);
  });

  it('rota credenciales: el valor sale sólo por el sink y el estado guarda nombres', async () => {
    const backend = adapter();
    await backend.provision({ projectId: 'app-uno', bindings: ['database', 'storage', 'auth'] });
    const { sink, seen } = collect();

    const rotation: BackendRotation = await backend.rotateSecrets({ projectId: 'app-uno', sink });

    expect(rotation.rotated).toEqual(['DATABASE_URL', 'STORAGE_SECRET', 'AUTH_SECRET']);
    expect(rotation.createdAt).toBe('2026-11-23T10:00:00.000Z');
    expect(seen).toEqual([
      ['DATABASE_URL', 'valor-database_url'],
      ['STORAGE_SECRET', 'valor-storage_secret'],
      ['AUTH_SECRET', 'valor-auth_secret'],
    ]);

    const status = await backend.status('app-uno');
    expect(status.secretNames).toEqual(rotation.rotated);
    const serialized = JSON.stringify({ status, rotation });
    for (const [, value] of seen) expect(serialized).not.toContain(value);
  });

  it('rota sólo los bindings pedidos y rechaza uno que el proyecto no tiene', async () => {
    const backend = adapter();
    await backend.provision({ projectId: 'app-uno', bindings: ['database'] });
    const { sink, seen } = collect();

    const rotation = await backend.rotateSecrets({ projectId: 'app-uno', kinds: ['database'], sink });
    expect(rotation.rotated).toEqual([backendSecretName('database')]);
    expect(seen).toHaveLength(1);

    await expect(
      backend.rotateSecrets({ projectId: 'app-uno', kinds: ['auth'], sink })
    ).rejects.toThrow(/no tiene el binding auth/);
  });

  it('aísla bindings, migraciones y credenciales entre proyectos', async () => {
    const backend = adapter();
    await backend.provision({ projectId: 'app-uno', bindings: ['database', 'auth'] });
    await backend.provision({ projectId: 'app-dos', bindings: ['database'] });
    await backend.migrate({
      projectId: 'app-uno',
      migrations: [{ id: '0001-init', sql: 'create table a (id text)' }],
    });
    const { sink } = collect();
    await backend.rotateSecrets({ projectId: 'app-uno', sink });

    const uno = await backend.status('app-uno');
    const dos = await backend.status('app-dos');

    expect(uno.migrations.applied).toEqual(['0001-init']);
    expect(dos.migrations.applied).toEqual([]);
    expect(dos.secretNames).toEqual([]);
    expect(dos.bindings.map((binding) => binding.kind)).toEqual(['database']);
    expect(
      dos.bindings.find((binding) => binding.kind === 'database')?.resourceId
    ).not.toBe(uno.bindings.find((binding) => binding.kind === 'database')?.resourceId);
  });

  it('rechaza entradas inválidas sin aprovisionar nada', async () => {
    const backend = adapter();

    await expect(backend.provision({ projectId: '  ', bindings: ['database'] })).rejects.toThrow(
      /no tiene id/
    );
    await expect(backend.provision({ projectId: 'app-uno', bindings: [] })).rejects.toThrow(
      /al menos un binding/
    );
    await expect(
      backend.provision({
        projectId: 'app-uno',
        bindings: ['database', 'realtime'] as unknown as BackendBindingKind[],
      })
    ).rejects.toThrow(/Binding desconocido/);
    await expect(backend.status('')).rejects.toThrow(/no tiene id/);
    await expect(
      backend.migrate({ projectId: 'app-uno', migrations: [{ id: '0001', sql: 'select 1' }] })
    ).rejects.toThrow(/no tiene un backend aprovisionado/);

    const status = await backend.status('app-uno');
    expect(status.bindings).toEqual([]);
  });
});
