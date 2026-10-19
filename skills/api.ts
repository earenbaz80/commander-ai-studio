/**
 * Skill Plugin API (P1 #9) - Endpoints HTTP para skills.
 *
 * Expone los skills como API REST para el cliente.
 */

// @ts-ignore - express types from main project
import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { loadAllSkills, findSkillById, findSkillsByTag, findSkillsByType, loadSkill } from './loader';

const router = Router();

/** GET /api/skills - Lista todos los skills */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const skills = await loadAllSkills();
    return res.json({ success: true, skills });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/** GET /api/skills/:id - Obtiene un skill por ID */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const skill = await findSkillById(req.params.id as string);
    if (!skill) return res.status(404).json({ success: false, error: 'Skill no encontrado' });
    return res.json({ success: true, skill });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/** GET /api/skills/tag/:tag - Filtra por tag */
router.get('/tag/:tag', async (req: Request, res: Response) => {
  try {
    const skills = await findSkillsByTag(req.params.tag as string);
    return res.json({ success: true, skills });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/** GET /api/skills/type/:type - Filtra por tipo */
router.get('/type/:type', async (req: Request, res: Response) => {
  const type = req.params.type as string;
  if (!['command', 'agent', 'template'].includes(type)) {
    return res.status(400).json({ success: false, error: 'Tipo inválido' });
  }
  try {
    const skills = await findSkillsByType(type as 'command' | 'agent' | 'template');
    return res.json({ success: true, skills });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/** POST /api/skills/:id/execute - Ejecuta un command skill (simplificado) */
router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const skill = await findSkillById(req.params.id as string);
    if (!skill) return res.status(404).json({ success: false, error: 'Skill no encontrado' });
    if (skill.type !== 'command') {
      return res.status(400).json({ success: false, error: 'Solo commands son ejecutables directamente' });
    }
    return res.json({
      success: true,
      skill: { id: skill.id, name: skill.name },
      script: skill.implementation,
      note: 'Ejecuta este script en el entorno del cliente con los permisos adecuados',
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e.message });
  }
});

/** POST /api/skills/import - Importa skills Markdown desde carpeta externa */
router.post('/import', async (req: Request, res: Response) => {
  try {
    const { sourceDir, overwrite = false } = req.body ?? {};
    if (!sourceDir || typeof sourceDir !== 'string') {
      return res.status(400).json({ success: false, error: 'sourceDir (string) es requerido' });
    }

    const resolvedSource = path.resolve(process.cwd(), sourceDir);
    const skillRoot = process.env.SKILLS_ROOT || path.join(process.cwd(), 'skills');
    if (!fs.existsSync(resolvedSource) || !fs.statSync(resolvedSource).isDirectory()) {
      return res.status(400).json({ success: false, error: 'sourceDir no existe o no es directorio' });
    }

    const walker = (dir: string): string[] => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      const out: string[] = [];
      for (const entry of entries) {
        const next = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walker(next));
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) out.push(next);
      }
      return out;
    };

    const markdownFiles = walker(resolvedSource);
    const imported: string[] = [];
    const skipped: { file: string; reason: string }[] = [];

    for (const file of markdownFiles) {
      const skill = await loadSkill(file);
      if (!skill) {
        skipped.push({ file, reason: 'front-matter inválido' });
        continue;
      }

      let category = 'commands';
      if (skill.type === 'agent') category = 'agents';
      if (skill.type === 'template') category = 'templates';

      const relatives = path.relative(resolvedSource, file).split(path.sep);
      if (['commands', 'agents', 'templates'].includes(relatives[0]?.toLowerCase())) {
        category = relatives[0].toLowerCase();
      }

      const destDir = path.join(skillRoot, category);
      fs.mkdirSync(destDir, { recursive: true });
      const dest = path.join(destDir, path.basename(file));
      if (fs.existsSync(dest) && !overwrite) {
        skipped.push({ file, reason: 'ya existe (overwrite=false)' });
        continue;
      }
      fs.copyFileSync(file, dest);
      imported.push(dest);
    }

    return res.json({ success: true, imported: imported.length, importedFiles: imported, skipped });
  } catch (e: any) {
    return res.status(500).json({ success: false, error: e?.message || 'import failed' });
  }
});

export default router;