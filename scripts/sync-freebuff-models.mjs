/**
 * Añade al catálogo los modelos de Freebuff que sirven para el agente.
 *
 * El catálogo por defecto NO incluye Freebuff: sin `FREEBUFF_API_KEY` cada
 * modelo de ese proveedor fallaría al elegirlo, y no tiene sentido enseñar 9
 * entradas que no se pueden llamar. Cuando haya clave, este script las mete (y
 * lo puedes repetir cuando Freebuff añada modelos).
 *
 * Sólo entran los que declaran `capabilities.toolCalls`: de los 280 del catálogo
 * público, el resto sólo hace chat y en modo agente gastarían un paso fallido
 * por intento. La lista vive en `src/config/freebuff-models.json` y la comparten
 * la app, el proxy y este script; si la API sirve otros, avisa.
 *
 * Uso: npm run models:freebuff
 * La API de modelos es pública; la clave sólo hace falta para conversar.
 */
import fs from 'node:fs';

const API = 'https://freebuff.com/api/v1/paid/models';
const FILES = ['models.json', 'public/models.json'];
const ACRONYMS = new Set(['gpt', 'glm', 'vl', 'oss', 'ai', 'ui', 'rl', 'moe', 'it']);
/** Única fuente de ids: la misma que importa `src/config/freebuffModels.ts`. */
const CONFIG = 'src/config/freebuff-models.json';
const KNOWN = new Set(JSON.parse(fs.readFileSync(CONFIG, 'utf8')).toolModels);

/** `deepseek-v4.1-flash` → `Deepseek v4.1 Flash`. */
function pretty(id) {
  return id
    .split(/[-_]/)
    .map((word) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      if (/\d/.test(word)) return word;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/** Una entrada por línea, con el espaciado del resto del catálogo. */
function emit(entry) {
  const body = Object.entries(entry)
    .map(([key, value]) => `${JSON.stringify(key)}: ${JSON.stringify(value)}`)
    .join(', ');
  return `    { ${body} }`;
}

const response = await fetch(API);
if (!response.ok) {
  console.error(`✖ la API de Freebuff respondió ${response.status}`);
  process.exit(1);
}
const { data } = await response.json();
if (!Array.isArray(data) || data.length === 0) {
  console.error('✖ la API de Freebuff no devolvió modelos');
  process.exit(1);
}

const usable = data.filter((model) => model?.capabilities?.toolCalls);
const unknown = usable.filter((model) => !KNOWN.has(model.id)).map((model) => model.id);
if (unknown.length > 0) {
  console.error(`✖ Freebuff tiene modelos con tool-calling que no están en FREEBUFF_TOOL_MODELS: ${unknown.join(', ')}`);
  console.error(`  añádelos a ${CONFIG} antes de seguir`);
  process.exit(1);
}

const entries = usable.map((model) => ({
  id: `freebuff/${model.id}`,
  name: pretty(model.id),
  provider: 'freebuff',
  description: 'Freebuff · con tool-calling',
  contextWindow: '—',
  supportsTools: true,
}));

for (const file of FILES) {
  const catalog = JSON.parse(fs.readFileSync(file, 'utf8'));
  const others = (catalog.models || []).filter((model) => model.provider !== 'freebuff');
  const lines = [...others, ...entries].map(emit).join(',\n');
  const text = `{\n  "version": ${JSON.stringify(catalog.version || '2.5.0')},\n  "synced": ${JSON.stringify(new Date().toISOString().slice(0, 10))},\n  "models": [\n${lines}\n  ]\n}\n`;
  JSON.parse(text); // no escribir un fichero que no parsea
  fs.writeFileSync(file, text);
  console.log(`${file}: ${others.length} previos + ${entries.length} de Freebuff`);
}

if (process.env.FREEBUFF_API_KEY) {
  console.log('✓ FREEBUFF_API_KEY presente: los modelos ya se pueden llamar');
} else {
  console.log('· FREEBUFF_API_KEY no está definida: aparecerán en el selector pero fallarán al usarlos');
  console.log('  se obtiene en Freebuff → Account → Developer API y va en .env');
}
