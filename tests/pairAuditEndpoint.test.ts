/**
 * Auditoría del emparejamiento (G2 C5) y token fuera de logs y auditoría (C6).
 *
 * El server propio es necesario por el entorno: la ruta del archivo de auditoría
 * es una variable del proceso (`COMMANDER_PAIR_AUDIT_FILE`), y el caso lee el
 * archivo para comprobar que el token del enlace y la cookie no están ahí.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnServer, type ServerHarness } from './helpers/serverHarness.js';

let srv: ServerHarness;
let dir: string;
let auditPath: string;
let sessionId: string;

interface AuditEntry {
  action: string;
  result: string;
  deviceId?: string;
  sessionId?: string;
  reason?: string;
}

async function auditEntries(): Promise<{ entries: AuditEntry[]; raw: string }> {
  const res = await srv.request('GET', '/api/pair/audit');
  assert.equal(res.status, 200, res.raw);
  return { entries: res.body.entries as AuditEntry[], raw: res.raw };
}

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commander-pair-audit-'));
  auditPath = path.join(dir, 'audit.jsonl');
  srv = await spawnServer({ env: { COMMANDER_PAIR_AUDIT_FILE: auditPath } });
  const res = await srv.request('POST', '/api/agent/sessions', {
    goal: 'Sesión para la auditoría de pair (G2)',
  });
  assert.equal(res.status, 200, res.raw);
  sessionId = String(res.body.session.id);
});

after(async () => {
  await srv?.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('auditoría de emisión, canje y baja', () => {
  test('registra las tres acciones y no guarda el token ni la cookie', async () => {
    const issued = await srv.request('POST', '/api/pair/issue', { sessionId });
    assert.equal(issued.status, 200, issued.raw);
    const token = String(issued.body.token);

    const redeemed = await srv.request(
      'POST',
      '/api/pair/redeem',
      { token },
      { headers: { Origin: srv.baseUrl } }
    );
    assert.equal(redeemed.status, 200, redeemed.raw);
    const deviceId = String(redeemed.body.device.id);
    const rawCookie = redeemed.headers['set-cookie'];
    const cookieValue = String(Array.isArray(rawCookie) ? rawCookie[0] : rawCookie).split(';')[0];

    const afterRedeem = await auditEntries();
    assert.ok(
      afterRedeem.entries.some(
        (entry) => entry.action === 'issued' && entry.result === 'ok' && entry.sessionId === sessionId
      ),
      `falta la emisión auditada: ${afterRedeem.raw}`
    );
    assert.ok(
      afterRedeem.entries.some(
        (entry) => entry.action === 'redeemed' && entry.result === 'ok' && entry.deviceId === deviceId
      ),
      `falta el canje auditado: ${afterRedeem.raw}`
    );

    // Reusar el enlace deja un fallo con motivo, no una segunda credencial.
    const reused = await srv.request(
      'POST',
      '/api/pair/redeem',
      { token },
      { headers: { Origin: srv.baseUrl } }
    );
    assert.equal(reused.status, 401, reused.raw);

    const revoked = await srv.request('DELETE', `/api/pair/devices/${deviceId}`, undefined, {
      headers: { Origin: srv.baseUrl },
    });
    assert.equal(revoked.status, 200, revoked.raw);

    const final = await auditEntries();
    assert.ok(
      final.entries.some(
        (entry) =>
          entry.action === 'redeemed' && entry.result === 'error' && entry.reason === 'used'
      ),
      `el reuso no quedó auditado con su motivo: ${final.raw}`
    );
    assert.ok(
      final.entries.some(
        (entry) => entry.action === 'revoked' && entry.result === 'ok' && entry.deviceId === deviceId
      ),
      `la baja no quedó auditada: ${final.raw}`
    );

    const onDisk = fs.readFileSync(auditPath, 'utf8');
    const everything = `${final.raw}\n${onDisk}\n${srv.logs()}`;
    assert.equal(everything.includes(token), false, 'el token del enlace apareció en auditoría o logs');
    assert.equal(everything.includes(cookieValue), false, 'la cookie apareció en auditoría o logs');
  });

  test('la baja de un id inexistente se audita como error', async () => {
    const missing = await srv.request('DELETE', '/api/pair/devices/dev_noexiste', undefined, {
      headers: { Origin: srv.baseUrl },
    });
    assert.equal(missing.status, 404, missing.raw);

    const { entries, raw } = await auditEntries();
    assert.ok(
      entries.some(
        (entry) =>
          entry.action === 'revoked' && entry.result === 'error' && entry.reason === 'not-found'
      ),
      `la baja fallida no quedó auditada: ${raw}`
    );
  });
});
