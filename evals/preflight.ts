/**
 * Comprobación previa del modelo en modo live.
 *
 * Una pasada live cuesta cinco tareas. Si el modelo pedido no responde —cuota
 * agotada, id retirado, key sin plan—, hoy se descubre en la primera tarea, se
 * sustituye en silencio y la pasada termina sin registrarse: tokens gastados
 * para nada. Esto pregunta una sola vez, con una llamada mínima, antes de
 * empezar.
 *
 * La sonda (`probeModel`) vive en `src/lib/modelProbe.ts` porque el editor de la
 * cadena de respaldo usa la misma: dos interpretaciones distintas de la misma
 * respuesta HTTP acabarían diciendo cosas distintas sobre el mismo modelo. Aquí
 * queda sólo la POLÍTICA de la pasada (`decidePreflight`), que es lo que se
 * puede probar sin abrir ningún puerto.
 *
 * La sonda no fuerza `fallbackModels`: así responde a la pregunta que importa
 * para una pasada — ¿qué va a pasar cuando el agente pida este modelo? — y no a
 * una versión idealizada.
 */
import type { PreflightProbe } from '../src/lib/modelProbe.js';

export { probeModel, PREFLIGHT_TIMEOUT_MS } from '../src/lib/modelProbe.js';
export type { PreflightProbe } from '../src/lib/modelProbe.js';

export interface PreflightDecision {
  /** `false` = no lanzar las tareas. */
  proceed: boolean;
  /** Lo que se imprime, en orden. */
  lines: string[];
}

/**
 * Qué hacer con el resultado de la sonda.
 *
 * Por defecto una sustitución ABORTA: seguir gastaría las cinco tareas para
 * producir una pasada que ni se registra (ver `decideRecording`). `--allow-fallback`
 * permite continuar a sabiendas, y el aviso deja claro que esa pasada no cuenta
 * como medida del modelo pedido.
 *
 * Un fallo (nadie contestó) no se puede puentear: no hay nada que medir.
 */
export function decidePreflight(
  probe: PreflightProbe,
  opts: { model: string; allowFallback?: boolean }
): PreflightDecision {
  const { model, allowFallback = false } = opts;

  if (probe.status === 'ok') {
    return {
      proceed: true,
      lines: [`✓ modelo: ${probe.model || model} responde en la comprobación previa`],
    };
  }

  if (probe.status === 'substituted') {
    const from = probe.fallback?.from || model;
    const to = probe.fallback?.to || 'otro modelo';
    if (allowFallback) {
      return {
        proceed: true,
        lines: [
          `⚠ modelo: ${from} no responde; contestaría ${to}`,
          `  --allow-fallback activo: se miden las tareas con ${to}, y esta pasada no se registrará`,
        ],
      };
    }
    return {
      proceed: false,
      lines: [
        `✖ modelo: ${from} no responde; contestaría ${to}`,
        '  no se lanzan las tareas: medirían otro modelo y la pasada no se registraría',
        `  repite cuando vuelva la cuota, o añade --allow-fallback para medir ${to} a sabiendas`,
      ],
    };
  }

  return {
    proceed: false,
    lines: [
      `✖ modelo: ${model} no respondió a la comprobación previa (${probe.error || 'sin detalle'})`,
      '  no se lanzan las tareas: sin respuesta no hay nada que medir',
      '  revisa la API key, la cuota y EVAL_BASE_URL antes de repetir',
    ],
  };
}
