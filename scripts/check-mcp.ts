/**
 * Comprueba, con el cliente MCP real, que cada servidor del registro arranca y
 * responde `tools/list`.
 *
 * Sirve para lo que ningún test unitario cubre: que las entradas configuradas
 * (comandos, `npx`, rutas con espacios) se levanten en esta máquina y hablen el
 * protocolo. Las hace pasar por `stdioMcpRequest`, no por un handshake propio.
 *
 * `tools/list` no autentica a nadie: un servidor con la credencial equivocada
 * pasa esta prueba igual. Por eso además se avisa de los `${VAR}` del bloque
 * `env` que no se resuelven —el servidor recibiría el texto literal—, que es la
 * forma que tiene el registro versionado de no guardar secretos.
 *
 * Uso: `npm run check:mcp` (todos) o `npm run check:mcp -- pixelforge context7`.
 * Sale 1 si alguno no arranca o no expone tools; 0 si todos responden.
 */
import dotenv from 'dotenv';
import { getToolsConfig } from '../src/config/index.js';
import { stdioMcpRequest, resolveServerEnv } from '../src/mcp/client.js';

/** Arranque en frío de `npx` incluye bajar el paquete: 60 s es el techo. */
const TIMEOUT_MS = Number(process.env.MCP_CHECK_TIMEOUT_MS) || 60_000;
/** Cuántos nombres de tool se imprimen antes de resumir el resto. */
const MAX_NOMBRES = 6;

dotenv.config({ quiet: true });

/** Placeholders del `env` que el entorno no resuelve. */
function variablesSinResolver(env: Record<string, string> | undefined): string[] {
  if (!env) return [];
  const faltan: string[] = [];
  for (const [clave, valor] of Object.entries(resolveServerEnv(env))) {
    for (const match of valor.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
      faltan.push(`${match[1]} (para ${clave})`);
    }
  }
  return faltan;
}

function resumirTools(tools: string[]): string {
  const cabeza = tools.slice(0, MAX_NOMBRES).join(', ');
  return tools.length > MAX_NOMBRES ? `${cabeza}, +${tools.length - MAX_NOMBRES} más` : cabeza;
}

const registro = getToolsConfig().mcp?.servers ?? {};
const pedidos = process.argv.slice(2).filter((arg) => !arg.startsWith('-'));
const nombres = pedidos.length > 0 ? pedidos : Object.keys(registro);

if (Object.keys(registro).length === 0) {
  console.log('[check:mcp] el registro está vacío (tools.mcp.servers en commander.json)');
  process.exit(0);
}

console.log(`[check:mcp] ${nombres.length} servidor(es), ${TIMEOUT_MS / 1000}s por servidor\n`);

let fallos = 0;
const avisos: string[] = [];

for (const nombre of nombres) {
  const server = registro[nombre];
  if (!server) {
    fallos++;
    console.log(`  ✗ ${nombre}: no está en tools.mcp.servers`);
    continue;
  }

  for (const falta of variablesSinResolver(server.env)) avisos.push(`${nombre}: falta ${falta}`);

  const inicio = Date.now();
  const r = await stdioMcpRequest(nombre, 'tools/list', undefined, { timeoutMs: TIMEOUT_MS });
  const ms = Date.now() - inicio;

  if (!r.ok) {
    fallos++;
    console.log(`  ✗ ${nombre}  ${(ms / 1000).toFixed(1)}s  ${r.error ?? 'fallo sin detalle'}`);
    continue;
  }

  const tools: string[] = (r.data?.tools ?? []).map((t: any) => String(t?.name ?? '?'));
  if (tools.length === 0) {
    fallos++;
    console.log(`  ✗ ${nombre}  ${(ms / 1000).toFixed(1)}s  arrancó pero no expone ninguna tool`);
    continue;
  }

  const etiqueta = tools.length === 1 ? 'tool' : 'tools';
  console.log(`  ✓ ${nombre}  ${(ms / 1000).toFixed(1)}s  ${tools.length} ${etiqueta}: ${resumirTools(tools)}`);
}

for (const aviso of avisos) console.warn(`[check:mcp] aviso: ${aviso}`);

const ok = nombres.length - fallos;
if (fallos === 0) {
  const cola = avisos.length > 0 ? ` (${avisos.length} aviso(s) de entorno)` : '';
  console.log(`\n[check:mcp] ${ok}/${nombres.length} servidores listan tools${cola}`);
  process.exit(0);
}

console.error(`\n[check:mcp] ${fallos}/${nombres.length} servidor(es) con problemas`);
process.exit(1);
