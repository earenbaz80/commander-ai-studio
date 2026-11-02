/**
 * Sonda de modelos de Gemini: qué existe hoy y cuáles contestan con esta key.
 *
 * Existe por un error concreto: se sacaron dos modelos lite de la cadena de
 * respaldo por un timeout de 15 s, y al rato los mismos medían 0,46 s. La cuota
 * de Gemini es por modelo y se recupera en minutos, así que decidir con una
 * sola llamada —o con lo que lista `ListModels`— sale mal.
 *
 * No imprime la clave, sólo ids, estado y latencia.
 *
 * Uso:
 *   npm run models:probe              # la cadena real + el catálogo
 *   npm run models:probe -- --all     # todos los que aceptan generateContent
 *   npm run models:probe -- --timeout 30000
 *
 * Aviso: `ListModels` incluye ids retirados (los `2.5-*` dan 404) y modelos que
 * sólo funcionan por otra API —imagen, TTS, `antigravity-*` (Interactions API)—.
 * Un 400 «only supports … API» aquí no es un modelo roto: es otro endpoint.
 */
import { readFileSync } from 'node:fs';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

const args = process.argv.slice(2);
const valueOf = (name) => {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1] ?? null;
};
const probeAll = args.includes('--all');
const timeoutMs = Number(valueOf('--timeout') ?? 20000);

/** La key sale del entorno o de `.env`; nunca se imprime. */
function readKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  try {
    const env = readFileSync('.env', 'utf8');
    return env.match(/^GEMINI_API_KEY=(.+)$/m)?.[1]?.trim() || '';
  } catch {
    return '';
  }
}

const key = readKey();
if (!key) {
  console.error('✖ falta GEMINI_API_KEY (entorno o .env)');
  process.exit(2);
}

/** Todos los ids que la cuenta puede generar, con su límite de contexto. */
async function listModels() {
  const models = [];
  let pageToken = '';
  for (let page = 0; page < 10; page++) {
    const url = `${BASE}/models?key=${key}&pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) {
      console.error(`✖ ListModels respondió ${res.status}`);
      return models;
    }
    const data = await res.json();
    for (const m of data.models || []) {
      models.push({
        id: String(m.name || '').replace(/^models\//, ''),
        methods: m.supportedGenerationMethods || [],
        inputLimit: m.inputTokenLimit ?? null,
      });
    }
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  return models;
}

/** Un ping de 8 tokens: lo mínimo que demuestra que el modelo contesta. */
async function probe(id) {
  const started = Date.now();
  try {
    const res = await fetch(`${BASE}/models/${id}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
        generationConfig: { maxOutputTokens: 8 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Date.now() - started;
    if (res.ok) {
      await res.text();
      return { id, status: res.status, ms, detail: '' };
    }
    const text = await res.text();
    let detail = text.slice(0, 60);
    try {
      const error = JSON.parse(text).error || {};
      const message = String(error.message || '');
      detail = [
        error.status || error.code || '',
        /quota|exhausted/i.test(message) ? 'cuota' : '',
        /high demand|unavailable/i.test(message) ? 'demanda' : '',
        /not found|not supported/i.test(message) ? 'no-existe' : '',
        /only supports/i.test(message) ? 'otra-api' : '',
      ]
        .filter(Boolean)
        .join(' ');
    } catch {
      /* respuesta no JSON: se queda el recorte */
    }
    return { id, status: res.status, ms, detail };
  } catch (e) {
    return { id, status: 'SIN RESPUESTA', ms: Date.now() - started, detail: e.name };
  }
}

/**
 * La cadena real, leída del módulo compartido: Node no puede importar TypeScript
 * desde aquí. Sin esto la sonda no vería nunca los lite, que son justo los que
 * hay que vigilar cuando los grandes están en 429.
 */
function chainIds() {
  try {
    const source = readFileSync('src/config/geminiModels.ts', 'utf8');
    const start = source.indexOf('GEMINI_FALLBACK_MODELS');
    if (start < 0) return [];
    const open = source.indexOf('[', start);
    const close = source.indexOf(']', open);
    if (open < 0 || close < 0) return [];
    const ids = [...source.slice(open, close).matchAll(/'([^']+)'/g)].map((m) => m[1]);
    const first = /GEMINI_DEFAULT_MODEL\s*=\s*'([^']+)'/.exec(source)?.[1];
    return [first, ...ids].filter(Boolean);
  } catch {
    return [];
  }
}

/** Ids que se ofrecen en el selector: el catálogo. */
function catalogIds() {
  try {
    const catalog = JSON.parse(readFileSync('models.json', 'utf8'));
    return (catalog.models || []).filter((m) => m.provider === 'google').map((m) => m.id);
  } catch {
    return [];
  }
}

const listed = await listModels();
const generative = listed.filter((m) => m.methods.includes('generateContent'));
const ids = probeAll
  ? generative.map((m) => m.id)
  : [...new Set([...chainIds(), ...catalogIds(), 'gemini-3.7-flash'])];

console.log(
  `${listed.length} modelos en la cuenta · ${generative.length} aceptan generateContent · sondeando ${ids.length}`
);
console.log('modelo\testado\tlatencia\tdetalle');

let answered = 0;
for (const id of ids) {
  const r = await probe(id);
  if (r.status === 200) answered++;
  console.log(`${r.id}\t${r.status}\t${r.ms} ms\t${r.detail}`);
}

console.log(`\n${answered}/${ids.length} contestan ahora. La cuota cambia en minutos: repite antes de concluir.`);
process.exitCode = answered > 0 ? 0 : 1;
