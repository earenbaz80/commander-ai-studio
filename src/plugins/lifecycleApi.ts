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

  let root: string;
  try {
    root = resolveProjectPath('.', text(context.root, 1024) || process.cwd()).root;
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
    let result;
    if (hook === 'beforeModel' || hook === 'afterModel') {
      const turn = Number(context.turn);
      const ctx: PluginModelContext = {
        ...base,
        phase: hook === 'beforeModel' ? 'before' : 'after',
        turn: Number.isFinite(turn) && turn > 0 ? Math.floor(turn) : 1,
        ...(hook === 'afterModel'
          ? {
              ok: context.ok !== false,
              ...(context.ok === false
                ? { error: text(context.error, 2000) || 'el modelo falló' }
                : {}),
            }
          : {}),
      };
      result = await runPluginHook(root, hook, ctx);
    } else if (hook === 'sessionEnd') {
      const ctx: PluginSessionEndContext = {
        ...base,
        answer: text(context.answer, 20_000),
      };
      result = await runPluginHook(root, hook, ctx);
    } else if (hook === 'stop') {
      const ctx: PluginStopContext = {
        ...base,
        reason: context.reason === 'timeout' ? 'timeout' : 'user',
      };
      result = await runPluginHook(root, hook, ctx);
    } else if (hook === 'error') {
      const ctx: PluginErrorContext = {
        ...base,
        error: text(context.error, 2000) || 'error',
      };
      result = await runPluginHook(root, hook, ctx);
    } else {
      const ctx: PluginSessionContext = base;
      result = await runPluginHook(root, hook, ctx);
    }
    return res.json({ success: true, ...result });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error?.message || 'hook falló' });
  }
});

export default pluginLifecycleRouter;
