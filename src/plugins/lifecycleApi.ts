/**
 * Ejecuta hooks de lifecycle para los bucles que no corren en `AgentSession`.
 *
 * El navegador (`AgentLoop`) y el CLI (`runAgent`) no pueden leer
 * `.commander/plugins` por su cuenta: uno no tiene fs y el otro puede apuntar a
 * otro servidor. Ambos mandan el hook aquí y esta ruta llama al mismo
 * `runPluginHook` que usa el bucle del servidor.
 *
 * Los hooks son observacionales: la respuesta sólo informa qué plugins corrieron
 * y qué errores hubo; nunca cambia el resultado del agente. El `root` se valida
 * con la misma puerta que el resto de rutas de proyecto.
 */
import { Router } from 'express';
import { resolveProjectPath } from '../../projects';
import {
  runPluginHook,
  type PluginErrorContext,
  type PluginLifecycleHookName,
  type PluginModelContext,
  type PluginSessionContext,
  type PluginSessionEndContext,
  type PluginStopContext,
} from '../../pluginsRuntime';

export const pluginLifecycleRouter = Router();

const HOOKS: readonly PluginLifecycleHookName[] = [
  'sessionStart',
  'beforeModel',
  'afterModel',
  'sessionEnd',
  'stop',
  'error',
];

function isLifecycleHook(value: unknown): value is PluginLifecycleHookName {
  return typeof value === 'string' && (HOOKS as readonly string[]).includes(value);
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

pluginLifecycleRouter.post('/lifecycle', async (req, res) => {
  const hook = req.body?.hook;
  if (!isLifecycleHook(hook)) {
    return res.status(400).json({ success: false, error: 'hook inválido' });
  }
  const raw = req.body?.context;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return res.status(400).json({ success: false, error: 'context inválido' });
  }
  const context = raw as Record<string, unknown>;

  // Sin `root` no se adivina el proyecto del servidor: ejecutar sus plugins por
  // un contexto incompleto sería peor que rechazar el hook.
  const rootInput = text(context.root, 1024);
  if (!rootInput) {
    return res.status(400).json({ success: false, error: 'root requerido' });
  }

  let root: string;
  try {
    root = resolveProjectPath('.', rootInput).root;
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || 'root inválido' });
  }

  const base = {
    sessionId: text(context.sessionId, 200),
    root,
    goal: text(context.goal, 4000),
    model: text(context.model, 200),
  };

  try {
    let ctx:
      | PluginSessionContext
      | PluginModelContext
      | PluginSessionEndContext
      | PluginStopContext
      | PluginErrorContext;
    switch (hook) {
      case 'beforeModel':
      case 'afterModel': {
        const turn = Math.max(1, Math.floor(Number(context.turn) || 1));
        if (hook === 'beforeModel') {
          ctx = { ...base, phase: 'before', turn };
        } else {
          const ok = context.ok !== false;
          ctx = {
            ...base,
            phase: 'after',
            turn,
            ok,
            ...(ok ? {} : { error: text(context.error, 2000) || 'el modelo falló' }),
          };
        }
        break;
      }
      case 'sessionEnd':
        ctx = { ...base, answer: text(context.answer, 20_000) };
        break;
      case 'stop':
        ctx = { ...base, reason: context.reason === 'timeout' ? 'timeout' : 'user' };
        break;
      case 'error':
        ctx = { ...base, error: text(context.error, 2000) || 'error' };
        break;
      default:
        ctx = base;
    }
    return res.json({ success: true, ...(await runPluginHook(root, hook, ctx)) });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || 'hook falló' });
  }
});

export default pluginLifecycleRouter;
