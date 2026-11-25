/**
 * Desinstalación de un plugin instalado desde un marketplace.
 *
 * Instalar convierte el plugin en piezas nativas (skills, agentes y servidores
 * MCP), así que borrar el manifiesto no desinstala nada: quedaban las skills
 * copiadas en el proyecto. Aquí se borra exactamente lo que el manifiesto dice
 * haber escrito y nada más — nunca por patrón, para no tocar archivos ajenos.
 */
import fs from 'fs';
import path from 'path';
import { getToolsConfig, writeConfig } from '../config/index.js';
import { PLUGIN_SKILLS_DIR, pluginSkillsPath } from '../../skills/layout.js';

/** Mismo id que aceptan el manifiesto y las rutas de plugins. */
const PLUGIN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export interface UninstallResult {
  id: string;
  /** Rutas borradas, relativas al proyecto. */
  removed: string[];
  /** Servidores MCP quitados de la config. */
  mcpServers: string[];
}

interface InstalledManifest {
  id?: string;
  components?: { commands?: string[]; agents?: string[]; skills?: string[]; mcp?: string[] };
  /** Rutas (relativas al proyecto) escritas al instalar. Formato nuevo. */
  written?: string[];
}

/**
 * Borra un plugin instalado y las piezas que copió.
 *
 * `root` es el proyecto donde vive `.commander/plugins` y `skills`; por defecto
 * el cwd del servidor. La config MCP es del proceso, así que sólo se toca
 * cuando el root es el proyecto del servidor (en los tests con root temporal no
 * se debe reescribir la config real).
 */
export function uninstallInstalledPlugin(id: string, options: { root?: string } = {}): UninstallResult {
  if (!PLUGIN_ID_RE.test(id) || id.includes('..')) throw new Error('Id de plugin inválido');

  const root = path.resolve(options.root || process.cwd());
  const pluginsDir = path.join(root, '.commander', 'plugins');
  const skillsDir = path.join(root, 'skills');
  const manifestPath = path.join(pluginsDir, `${id}.manifest.json`);

  let manifest: InstalledManifest | null = null;
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      manifest = null; // manifiesto corrupto: se borra igual, sin tocar skills
    }
  }

  const candidates = new Set<string>();
  // Un archivo pudo escribirse con el slug a secas o con el prefijo del plugin
  // cuando ya existía otro igual (`<id>-<slug>.md`).
  const addSkillFile = (folder: 'agents' | 'commands', slug: string) => {
    if (!slug) return;
    candidates.add(path.join(skillsDir, folder, `${slug}.md`));
    candidates.add(path.join(skillsDir, folder, `${id}-${slug}.md`));
  };

  const components = manifest?.components;
  for (const slug of components?.commands || []) addSkillFile('commands', String(slug));
  for (const slug of components?.skills || []) addSkillFile('commands', String(slug));
  for (const slug of components?.agents || []) addSkillFile('agents', String(slug));
  for (const rel of Array.isArray(manifest?.written) ? manifest.written : []) {
    candidates.add(path.resolve(root, String(rel)));
  }

  // Sólo se borra dentro de las dos carpetas que el plugin declara como suyas:
  // una ruta del manifiesto con `..` no puede sacar el borrado de ahí.
  const within = (dir: string, file: string) => {
    const relative = path.relative(dir, file);
    return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  };

  const removed: string[] = [];
  for (const file of candidates) {
    if (!within(skillsDir, file) && !within(pluginsDir, file)) continue;
    try {
      if (!fs.statSync(file).isFile()) continue;
      fs.unlinkSync(file);
      removed.push(path.relative(root, file));
    } catch {
      // Ya no estaba: no es un error de la desinstalación.
    }
  }

  const mcpServers: string[] = [];
  // El manifiesto es la fuente normal; el sidecar que escribe la instalación
  // sigue diciendo qué servidores tocó aunque el manifiesto se haya corrompido.
  // Sin él, desinstalar dejaba esos servidores configurados para siempre.
  const sidecarPath = path.join(pluginsDir, `${id}.mcp.json`);
  const names = new Set<string>(Array.isArray(components?.mcp) ? components.mcp.map(String) : []);
  if (fs.existsSync(sidecarPath)) {
    try {
      const sidecar = JSON.parse(fs.readFileSync(sidecarPath, 'utf8')) as { servers?: unknown };
      if (Array.isArray(sidecar?.servers)) for (const name of sidecar.servers) names.add(String(name));
    } catch {
      // Sidecar ilegible: queda lo que diga el manifiesto.
    }
  }
  if (names.size > 0 && root === path.resolve(process.cwd())) {
    try {
      const tools: any = getToolsConfig();
      const servers = tools?.mcp?.servers;
      if (servers && typeof servers === 'object') {
        // `writeConfig` fusiona con el fichero: un `null` borra la clave. Borrar
        // en memoria y reenviar el objeto no persistía nada y el servidor
        // volvía en la siguiente lectura.
        const removal: Record<string, null> = {};
        for (const name of names) {
          if (!Object.prototype.hasOwnProperty.call(servers, name)) continue;
          removal[name] = null;
        }
        const present = Object.keys(removal);
        if (present.length > 0) {
          writeConfig({ tools: { mcp: { servers: removal } } } as any, 'project');
          mcpServers.push(...present);
        }
      }
    } catch {
      // Sin config legible, el resto de la desinstalación sigue.
    }
  }

  // Formato nuevo: el plugin tiene su propia carpeta bajo `skills/plugins`.
  const pluginSkillsDir = pluginSkillsPath(skillsDir, id);
  if (fs.existsSync(pluginSkillsDir)) {
    fs.rmSync(pluginSkillsDir, { recursive: true, force: true });
    removed.push(path.relative(root, pluginSkillsDir));
  }
  const pluginsSkillsRoot = path.join(skillsDir, PLUGIN_SKILLS_DIR);
  try {
    if (fs.existsSync(pluginsSkillsRoot) && fs.readdirSync(pluginsSkillsRoot).length === 0) {
      fs.rmdirSync(pluginsSkillsRoot);
      removed.push(path.relative(root, pluginsSkillsRoot));
    }
  } catch {
    // La carpeta no está vacía o ya no existe: no es un error.
  }

  const pluginDir = path.join(pluginsDir, id);
  if (fs.existsSync(pluginDir)) {
    fs.rmSync(pluginDir, { recursive: true, force: true });
    removed.push(path.relative(root, pluginDir));
  }
  for (const file of [manifestPath, sidecarPath, path.join(pluginsDir, `${id}.zip`)]) {
    if (!fs.existsSync(file)) continue;
    fs.unlinkSync(file);
    removed.push(path.relative(root, file));
  }

  return { id, removed, mcpServers };
}
