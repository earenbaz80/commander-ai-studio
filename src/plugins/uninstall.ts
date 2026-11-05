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

  const removed: string[] = [];
  for (const file of candidates) {
    // Sólo se borran ficheros de `skills/` del proyecto: una ruta del manifiesto
    // con `..` no puede sacar el borrado de ahí.
    const relative = path.relative(skillsDir, file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) continue;
    try {
      if (!fs.statSync(file).isFile()) continue;
      fs.unlinkSync(file);
      removed.push(path.relative(root, file));
    } catch {
      // Ya no estaba: no es un error de la desinstalación.
    }
  }

  const mcpServers: string[] = [];
  const names = Array.isArray(components?.mcp) ? components.mcp.map(String) : [];
  if (names.length > 0 && root === path.resolve(process.cwd())) {
    try {
      const tools: any = getToolsConfig();
      const servers = tools?.mcp?.servers;
      if (servers && typeof servers === 'object') {
        let changed = false;
        for (const name of names) {
          if (!Object.prototype.hasOwnProperty.call(servers, name)) continue;
          delete servers[name];
          mcpServers.push(name);
          changed = true;
        }
        if (changed) writeConfig({ tools }, 'project');
      }
    } catch {
      // Sin config legible, el resto de la desinstalación sigue.
    }
  }

  const pluginDir = path.join(pluginsDir, id);
  if (fs.existsSync(pluginDir)) {
    fs.rmSync(pluginDir, { recursive: true, force: true });
    removed.push(path.relative(root, pluginDir));
  }
  for (const file of [manifestPath, path.join(pluginsDir, `${id}.zip`)]) {
    if (!fs.existsSync(file)) continue;
    fs.unlinkSync(file);
    removed.push(path.relative(root, file));
  }

  return { id, removed, mcpServers };
}
