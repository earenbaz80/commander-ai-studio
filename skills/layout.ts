/**
 * Ubicación de las piezas nativas de un plugin instalado.
 *
 * Decisión de F4B (criterio 4): las skills instaladas **se quedan** en
 * `skills/plugins/<id>/`, no se mueven bajo `.commander/`. `skills/` es el árbol
 * que el proyecto versiona y revisa —el loader descubre ahí los tres formatos y
 * git puede ignorar `skills/plugins/` en bloque sin ocultar las skills propias—,
 * mientras que `.commander/` guarda estado de máquina (permisos, worktrees, la
 * copia del plugin y sus manifiestos).
 *
 * La ruta vive aquí para que loader, instalación y desinstalación no la repitan:
 * moverla, si algún día se decide, es un cambio en un solo sitio.
 */
import path from 'path';

/** Subcarpeta del árbol de skills donde vive cada plugin instalado. */
export const PLUGIN_SKILLS_DIR = 'plugins';

/** Raíz del plugin dentro de `skills/`: `<skills>/plugins/<id>`. */
export function pluginSkillsPath(skillsRoot: string, id: string): string {
  return path.join(skillsRoot, PLUGIN_SKILLS_DIR, id);
}
