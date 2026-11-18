/**
 * Banco del runtime local: mide el endpoint de streaming contra la respuesta
 * completa con el mismo turno que manda el agente (system prompt + tools +
 * historial), en caliente y con prefijo frío.
 *
 * No instala, descarga ni reemplaza nada del runtime: sólo habla con una app
 * que ya está corriendo (`npm run dev`) y usa el modelo que le pidas. Si hay
 * otro modelo cargado se niega a seguir, salvo `--allow-restart`.
 *
 * Uso: npm run bench:local -- [opciones]
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { buildSystemPrompt } from '../src/agent/llm';
import { toOpenAITools } from '../src/agent/providers';

const { values } = parseArgs({
  options: {
    app: { type: 'string', default: 'http://127.0.0.1:3283' },
    model: { type: 'string' },
    reps: { type: 'string', default: '3' },
    'max-tokens': { type: 'string', default: '256' },
    context: { type: 'string', default: '16384' },
    long: { type: 'boolean', default: false },
    cold: { type: 'boolean', default: false },
    pad: { type: 'string', default: '0' },
    'allow-restart': { type: 'boolean', default: false },
    json: { type: 'string' },
    help: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

const USAGE = `Banco del runtime local (streaming contra respuesta completa)

Uso: npm run bench:local -- [opciones]

  --app <url>         App corriendo (default http://127.0.0.1:3283)
  --model <archivo>   GGUF de local_models; default el cargado o el 0.5B
  --reps <n>          Repeticiones por modo (default 3)
  --max-tokens <n>    Tokens máximos por respuesta (default 256)
  --context <n>       contextLength enviado al runtime (default 16384)
  --long               Pide un plan de 4 párrafos en vez de un paso corto
  --cold               Prefijo distinto en cada petición: mide sin caché de prompt
  --pad <n>            Agrega n bloques de historial (~400 tokens cada uno)
  --allow-restart      Permite que el runtime cambie de modelo
  --json <ruta>        Guarda las mediciones crudas en un archivo
  --help               Esta ayuda

Ejemplos:
  npm run bench:local
  npm run bench:local -- --model Qwen2.5-7B-Instruct-Q4_K_M.gguf --long
  npm run bench:local -- --cold --reps 2 --json bench.json
`;

const DEFAULT_MODEL = 'qwen2.5-0.5b-instruct-q4_k_m.gguf';

const REPS = Math.max(1, Number(values.reps));
const MAX_TOKENS = Math.max(1, Number(values['max-tokens']));
const CONTEXT = Math.max(512, Number(values.context));
const PAD = Math.max(0, Number(values.pad));
const LONG = Boolean(values.long);
const COLD = Boolean(values.cold);
const APP = String(values.app).replace(/\/+$/, '');

interface Run {
  mode: 'full' | 'stream';
  rep: number;
  ttftMs: number;
  firstTextMs: number;
  totalMs: number;
  tokens: number;
  chunks: number;
}

interface BenchReport {
  app: string;
  model: string;
  context: number;
  maxTokens: number;
  reps: number;
  long: boolean;
  cold: boolean;
  pad: number;
  promptTokens: number;
  runs: Run[];
}

const round = (value: number) => Math.round(value);
const ms = (value: number) => `${round(value)} ms`;

function median(list: number[]): number {
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

async function getRuntime(): Promise<{ state?: string; model?: string; modelName?: string; baseUrl?: string }> {
  const res = await fetch(`${APP}/api/local-models/runtime`);
  if (!res.ok) throw new Error(`GET /api/local-models/runtime → HTTP ${res.status}`);
  return (await res.json()) as any;
}

/** Turno de agente: system prompt real, catálogo real y un paso ya ejecutado. */
function buildMessages(model: string) {
  const goal =
    'Añade un endpoint GET /api/health/version que devuelva la versión de package.json y su commit corto.';
  const agentsMdPath = path.join(process.cwd(), 'AGENTS.md');
  const agentsMd = fs.existsSync(agentsMdPath) ? fs.readFileSync(agentsMdPath, 'utf8') : undefined;

  const system = buildSystemPrompt({
    goal,
    cwd: process.cwd(),
    history: [],
    toolSchema: '',
    recentSteps: [],
    plan: [],
    agentsMd,
    mode: 'build',
  });

  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: system },
    { role: 'user', content: goal },
    {
      role: 'assistant',
      content: 'Voy a leer el server para ver dónde van los endpoints de salud antes de agregar el nuevo.',
    },
  ];

  for (let index = 0; index < PAD; index += 1) {
    messages.push({
      role: index % 2 === 0 ? 'assistant' : 'user',
      content:
        index % 2 === 0
          ? `Reviso el bloque ${index + 1} del handler de salud para confirmar cómo arma la respuesta.`
          : `RESULTADO de fs.grep {"pattern":"api/health"}:\n${Array.from(
              { length: 10 },
              (_, line) => `server.ts:${4100 + index * 10 + line}: app.get('/api/health/${index}', (_req, res) => res.json({ ok: true }));`
            ).join('\n')}`,
    });
  }

  messages.push({
    role: 'user',
    content:
      'RESULTADO de fs.read {"path":"server.ts","offset":1,"limit":60}:\n' +
      "import express from 'express';\nconst app = express();\n" +
      "app.get('/api/health', (_req, res) => res.json({ ok: true, version: pkg.version }));\n\n" +
      (LONG
        ? 'Continúa: explica en 4 párrafos el plan de implementación, qué toca en server.ts, qué tests agrega y cómo lo verificás.'
        : 'Continúa: da el siguiente paso concreto (toolCall o respuesta final).'),
  });

  return { messages, tools: toOpenAITools(), model };
}

let nonceSeq = 0;

function requestBody(base: ReturnType<typeof buildMessages>) {
  const messages = COLD
    ? base.messages.map((message, index) =>
        index === 0
          ? { ...message, content: `[lote ${Date.now()}-${nonceSeq++}]\n\n${message.content}` }
          : message
      )
    : base.messages;
  return {
    model: base.model,
    messages,
    temperature: 0,
    maxTokens: MAX_TOKENS,
    contextLength: CONTEXT,
    tools: base.tools,
  };
}

async function runFull(body: unknown, rep: number): Promise<Run> {
  const started = performance.now();
  const res = await fetch(`${APP}/api/local-models/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => ({}));
  const totalMs = performance.now() - started;
  if (!res.ok || !data.success) {
    throw new Error(`/generate HTTP ${res.status}: ${String(data.error || '').slice(0, 200)}`);
  }
  return {
    mode: 'full',
    rep,
    // Sin streaming no hay texto hasta que termina: el "primer token" es el total.
    ttftMs: totalMs,
    firstTextMs: totalMs,
    totalMs,
    tokens: Number(data.metrics?.responseTokens || 0),
    chunks: 0,
  };
}

async function runStream(body: unknown, rep: number): Promise<Run> {
  const started = performance.now();
  const res = await fetch(`${APP}/api/local-models/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => '');
    throw new Error(`/stream HTTP ${res.status}: ${detail.slice(0, 200)}`);
  }

  let ttftMs = 0;
  let firstTextMs = 0;
  let chunks = 0;
  let tokens = 0;
  let buffer = '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf('\n\n');
    while (index >= 0) {
      const frame = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 2);
      index = buffer.indexOf('\n\n');
      if (!frame.startsWith('data: ')) continue;
      const payload: any = JSON.parse(frame.slice(6));
      if (payload.type === 'chunk') {
        if (!ttftMs) ttftMs = performance.now() - started;
        if (String(payload.text || '') && !firstTextMs) firstTextMs = performance.now() - started;
        chunks += 1;
      }
      if (payload.type === 'done') tokens = Number(payload.metrics?.responseTokens || 0);
      if (payload.type === 'error') throw new Error(`stream error: ${String(payload.error).slice(0, 200)}`);
    }
  }

  return {
    mode: 'stream',
    rep,
    ttftMs,
    firstTextMs: firstTextMs || ttftMs,
    totalMs: performance.now() - started,
    tokens,
    chunks,
  };
}

async function main() {
  if (values.help) {
    console.log(USAGE);
    return;
  }

  const runtime = await getRuntime().catch((error: Error) => {
    throw new Error(`${error.message}\n¿Está corriendo la app? Probá "npm run dev".`);
  });
  // `/api/local-models/runtime` publica el archivo cargado en `model`.
  const runningModel = runtime.model || runtime.modelName;
  const model = String(values.model || runningModel || DEFAULT_MODEL);

  if (runtime.state === 'running' && runningModel && runningModel !== model && !values['allow-restart']) {
    throw new Error(
      `El runtime tiene cargado ${runningModel}.\n` +
        `Pediste ${model}. Cargá ese modelo o pasá --allow-restart para que el bench lo cambie.`
    );
  }

  const request = buildMessages(model);
  const promptChars = request.messages.reduce((sum, message) => sum + message.content.length, 0);

  console.log(`app=${APP}`);
  console.log(
    `modelo=${model} contexto=${CONTEXT} maxTokens=${MAX_TOKENS} reps=${REPS} ` +
      `modo=${LONG ? 'turno largo' : 'turno corto'} ${COLD ? 'prefijo frío' : 'prefijo cacheado'}` +
      (PAD ? ` pad=${PAD}` : '')
  );
  console.log(`prompt≈${Math.ceil(promptChars / 4)} tokens de texto + ${request.tools.length} tools`);

  // Calentamiento: carga del modelo en el runtime y deja el prefijo en caché.
  const warmStarted = performance.now();
  const warm = await fetch(`${APP}/api/local-models/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...requestBody(request) }),
  });
  const warmBody: any = await warm.json().catch(() => ({}));
  console.log(
    `calentamiento: ${ms(performance.now() - warmStarted)}` +
      (warmBody.success ? '' : ` (error: ${String(warmBody.error || warm.status).slice(0, 160)})`)
  );
  if (!warmBody.success) throw new Error('el runtime no respondió en el calentamiento');

  const runs: Run[] = [];
  for (let rep = 1; rep <= REPS; rep += 1) {
    // Alterna el orden para que el calentamiento de caché no favorezca a uno.
    const order: Array<'full' | 'stream'> = rep % 2 === 1 ? ['full', 'stream'] : ['stream', 'full'];
    for (const mode of order) {
      const run = mode === 'full' ? await runFull(requestBody(request), rep) : await runStream(requestBody(request), rep);
      runs.push(run);
      const rate = run.totalMs > 0 ? (run.tokens / (run.totalMs / 1000)).toFixed(1) : '0';
      const chunksRate = run.chunks && run.totalMs ? (run.chunks / (run.totalMs / 1000)).toFixed(1) : '-';
      console.log(
        `${mode.padEnd(6)} rep${rep}: primer_token=${ms(run.firstTextMs)} total=${ms(run.totalMs)} ` +
          `tokens=${run.tokens} t/s=${rate} chunks=${run.chunks} chunks/s=${chunksRate}`
      );
    }
  }

  const full = runs.filter((run) => run.mode === 'full');
  const stream = runs.filter((run) => run.mode === 'stream');
  const fullFirst = median(full.map((run) => run.firstTextMs));
  const streamFirst = median(stream.map((run) => run.firstTextMs));

  console.log('\nresumen (mediana)');
  console.log(
    `completa: primer_token=${ms(fullFirst)} total=${ms(median(full.map((run) => run.totalMs)))} ` +
      `tokens=${median(full.map((run) => run.tokens))}`
  );
  console.log(
    `stream:   primer_token=${ms(streamFirst)} total=${ms(median(stream.map((run) => run.totalMs)))} ` +
      `tokens=${median(stream.map((run) => run.tokens))} chunks=${median(stream.map((run) => run.chunks))}`
  );
  console.log(
    `primera señal: ${ms(fullFirst - streamFirst)} antes con streaming ` +
      `(${(streamFirst > 0 ? fullFirst / streamFirst : 0).toFixed(1)}×)`
  );

  if (values.json) {
    const report: BenchReport = {
      app: APP,
      model,
      context: CONTEXT,
      maxTokens: MAX_TOKENS,
      reps: REPS,
      long: LONG,
      cold: COLD,
      pad: PAD,
      promptTokens: Math.ceil(promptChars / 4),
      runs,
    };
    fs.writeFileSync(String(values.json), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`mediciones guardadas en ${values.json}`);
  }
}

main().catch((error: Error) => {
  console.error(`\nbench:local falló: ${error.message}`);
  process.exitCode = 1;
});
