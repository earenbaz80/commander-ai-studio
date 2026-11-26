/**
 * Migraciones reales sobre SQLite para el backend gestionado (PL3).
 *
 * El contrato (`BackendAdapter.migrate`) dice qué hay que devolver; esto lo
 * ejecuta de verdad: una tabla `schema_migrations` registra lo aplicado, cada
 * migración corre en su propia transacción y repetir la tanda no vuelve a
 * tocar el esquema.
 *
 * Un fallo no deja el esquema a medias: se revierte esa migración, se informa
 * en `failed` y se corta la tanda. Las siguientes pueden depender de la que
 * falló, así que aplicarlas «por si acaso» es peor que parar.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { BackendMigration, BackendMigrationResult } from './types';

/** Tabla de control; no la declara ninguna migración de la app. */
export const MIGRATIONS_TABLE = 'schema_migrations';

/** Valida la tanda completa antes de tocar la base: ids únicos y SQL no vacío. */
export function validateMigrations(
  migrations: ReadonlyArray<BackendMigration>
): BackendMigration[] {
  const seen = new Set<string>();
  const batch: BackendMigration[] = [];
  for (const migration of migrations) {
    const id = String(migration?.id ?? '').trim();
    if (!id) throw new Error('Hay una migración sin id');
    if (seen.has(id)) throw new Error(`Migración duplicada: ${id}`);
    const sql = String(migration?.sql ?? '');
    if (!sql.trim()) throw new Error(`La migración ${id} no tiene SQL`);
    seen.add(id);
    batch.push({ id, sql });
  }
  return batch;
}

function appliedIds(db: DatabaseSync): string[] {
  const rows = db.prepare(`SELECT id FROM ${MIGRATIONS_TABLE}`).all() as unknown as {
    id: string;
  }[];
  return rows.map((row) => String(row.id));
}

/** Aplica en orden, en transacción por migración, saltando las ya aplicadas. */
export function runSqliteMigrations(
  db: DatabaseSync,
  migrations: ReadonlyArray<BackendMigration>
): BackendMigrationResult {
  const batch = validateMigrations(migrations);
  db.exec(
    `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (\n` +
      '  id TEXT PRIMARY KEY,\n' +
      '  applied_at INTEGER NOT NULL\n' +
      ')'
  );
  const applied = new Set(appliedIds(db));
  const result: BackendMigrationResult = { applied: [], skipped: [], failed: [] };

  for (const migration of batch) {
    if (applied.has(migration.id)) {
      result.skipped.push(migration.id);
      continue;
    }
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare(`INSERT INTO ${MIGRATIONS_TABLE} (id, applied_at) VALUES (?, ?)`).run(
        migration.id,
        Date.now()
      );
      db.exec('COMMIT');
      result.applied.push(migration.id);
    } catch (error: any) {
      try {
        db.exec('ROLLBACK');
      } catch {
        /* la transacción ya estaba cerrada */
      }
      result.failed.push({
        id: migration.id,
        message: String(error?.message ?? error),
      });
      break;
    }
  }

  return result;
}

/** Migraciones aplicadas en la base, en el orden en que se registraron. */
export function appliedMigrationIds(db: DatabaseSync): string[] {
  return appliedIds(db).sort();
}

/**
 * Lee `migrations/*.sql`; el id es el nombre sin extensión y el orden es el
 * lexicográfico, así que `0001-…`, `0002-…` se aplican como se espera.
 */
export function loadMigrations(dir: string): BackendMigration[] {
  const names = fs
    .readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
  return names.map((name) => ({
    id: name.replace(/\.sql$/i, ''),
    sql: fs.readFileSync(path.join(dir, name), 'utf8'),
  }));
}
