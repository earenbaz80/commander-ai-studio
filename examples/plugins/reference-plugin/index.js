/**
 * Plugin de referencia: registra cada hook del lifecycle sin alterar la corrida.
 *
 * Copia esta carpeta a `.commander/plugins/reference-plugin/` y ejecuta una
 * sesión. El registro va a `.commander/reference-plugin.log` (una línea JSON
 * por hook) o al fichero que indique `COMMANDER_REFERENCE_PLUGIN_LOG`.
 *
 * Es observacional a propósito: `beforeTool`/`afterTool` no devuelven `{ input }`
 * ni `{ result }`, así que las tools se ejecutan exactamente igual. Un fallo al
 * escribir el log tampoco rompe la sesión: el runtime aísla el error.
 */
import fs from 'node:fs';
import path from 'node:path';

let sequence = 0;

function record(ctx, hook) {
  sequence += 1;
  const root = String(ctx.root || process.cwd());
  const file = process.env.COMMANDER_REFERENCE_PLUGIN_LOG
    || path.join(root, '.commander', 'reference-plugin.log');
  const entry = {
    seq: sequence,
    hook,
    at: new Date().toISOString(),
    sessionId: ctx.sessionId,
    toolId: ctx.toolId,
    phase: ctx.phase,
    turn: ctx.turn,
    ok: ctx.ok,
    reason: ctx.reason,
  };
  if (hook === 'error') entry.error = String(ctx.error || '').slice(0, 500);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch {
    /* un logger caído no debe romper la corrida */
  }
}

export default {
  sessionStart: (ctx) => record(ctx, 'sessionStart'),
  beforeModel: (ctx) => record(ctx, 'beforeModel'),
  afterModel: (ctx) => record(ctx, 'afterModel'),
  beforeTool: (ctx) => record(ctx, 'beforeTool'),
  afterTool: (ctx) => record(ctx, 'afterTool'),
  sessionEnd: (ctx) => record(ctx, 'sessionEnd'),
  stop: (ctx) => record(ctx, 'stop'),
  error: (ctx) => record(ctx, 'error'),
};
