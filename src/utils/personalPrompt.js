const { writeFile, execute, runTests, initProject, auditProject } = require('./personalAgent');

async function handlePrompt(desire) {
  const lower = desire.toLowerCase().trim();
  
  // === PATTERN 1: "crear proyecto [nombre]" ===
  if (lower.startsWith('crear proyecto') || lower.startsWith('nuevo proyecto')) {
    const match = desire.match(/crear proyecto (.+) ?/i);
    const name = match ? match[1].trim() : 'mi-app';
    return await initProject(name);
  }
  
  // === PATTERN 2: "crear [archivo] con [contenido]" ===
  if (lower.startsWith('crear ') && lower.includes('con')) {
    const match = desire.match(/crear (.+) con (.+) ?/i);
    if (match) {
      const [, path, content] = match;
      return await writeFile(path.trim(), content.trim());
    }
    // Alternativo: solo ruta (usar contenido por default)
    const pathMatch = desire.match(/crear (.+)/i);
    if (pathMatch) {
      return await writeFile(pathMatch[1].trim(), '# Componente creado por Commander AI Studio Agent');
    }
    return { success: false, output: 'Formato: "crear Archivo.tsx con contenido..."' };
  }
  
  // === PATTERN 3: "ejecutar tests" o "tests" ===
  if (lower.includes('test') || lower.includes('tests') || lower.includes('pasar')) {
    return await runTests();
  }
  
  // === PATTERN 4: "build" ===
  if (lower.includes('build')) {
    return await execute('npm run build');
  }
  
  // === PATTERN 5: "git init y primer commit" ===
  if (lower.includes('git init') || lower.includes('primer commit') || lower.includes('primer commit')) {
    return await execute('git init && git add -A && git commit -m "init Commander AI Studio agent"');
  }
  
  // === PATTERN 5: "instalar [dependencias]" ===
  if (lower.includes('instalar') || lower.includes('dependencies')) {
    const match = desire.match(/instalar (.+)/i);
    const pkgs = match ? match[1] : 'react react-dom';
    return await execute(`npm install ${pkgs}`);
  }
  
  // === PATTERN 6: "auditar proyecto" ===
if (lower.includes('auditar') || lower.includes('auditor')) {
    const { auditProject } = require('./personalAgent');
    return await auditProject();
}

// === PATTERN 7: "git status" / "estado git" ===
if (lower.includes('git status') || lower.includes('estado del git') || lower.includes('estado del repositorio')) {
    const { gitStatus } = require('./personalAgent');
    return await gitStatus();
}

// === PATTERN 8: "git log" / "historial" / "commits" ===
if (lower.includes('git log') || lower.includes('historial') || lower.includes('commits')) {
    const { gitLog } = require('./personalAgent');
    return await gitLog();
}

// === PATTERN 9: "leer [archivo]" ===
if (lower.startsWith('leer ') || lower.startsWith('mostrar ') || lower.startsWith('ver archivo')) {
    const { readFile } = require('./personalAgent');
    const match = desire.match(/(?:leer|mostrar|ver archivo) (.+)/i);
    if (match) return await readFile(match[1].trim());
    return { success: false, output: 'Formato: "leer ruta/archivo"' };
}

// === PATTERN 10: "eliminar [archivo]" ===
if (lower.startsWith('eliminar ') || lower.startsWith('borrar ')) {
    const { deleteFile } = require('./personalAgent');
    const match = desire.match(/(?:eliminar|borrar) (.+)/i);
    if (match) return await deleteFile(match[1].trim());
    return { success: false, output: 'Formato: "eliminar ruta/archivo"' };
}

// === PATTERN 11: "copiar [origen] a [destino]" ===
if (lower.startsWith('copiar ')) {
    const { copyFile } = require('./personalAgent');
    const match = desire.match(/copiar (.+) a (.+)/i);
    if (match) return await copyFile(match[1].trim(), match[2].trim());
    return { success: false, output: 'Formato: "copiar origen a destino"' };
}

// === PATTERN 12: "contar líneas [archivo]" ===
if (lower.includes('contar l') || lower.includes('líneas') || lower.includes('lineas')) {
    const { countLines } = require('./personalAgent');
    const match = desire.match(/(?:líneas|lineas) (?:de )?(.+)/i);
    if (match) return await countLines(match[1].trim());
    return { success: false, output: 'Formato: "contar líneas de archivo"' };
}

// === PATTERN 13: "imports de [archivo]" ===
if (lower.includes('imports') || lower.includes('importaciones')) {
    const { getImports } = require('./personalAgent');
    const match = desire.match(/(?:imports|importaciones) (?:de )?(.+)/i);
    if (match) return await getImports(match[1].trim());
    return { success: false, output: 'Formato: "imports de archivo"' };
}

// === PATTERN 14: "qué framework" / "detectar framework" ===
if (lower.includes('framework') || lower.includes('qué tecnología') || lower.includes('que tecnologia')) {
    const { detectFramework } = require('./personalAgent');
    return await detectFramework();
}

// === PATTERN 15: "verificar tipos" / "tsc" ===
if (lower.includes('typescript') || lower.includes('verificar tipos') || lower.includes('tsc')) {
    return await execute('npx tsc --noEmit');
}

// === PATTERN 16: "ver estructura" / "árbol" ===
if (lower.includes('estructura') || lower.includes('árbol') || lower.includes('arbol') || lower.includes('carpetas')) {
    return await execute('dir /s /b src 2>nul || find src -type f');
}

// === PATTERN 17: "docs para [función/clase]" ===
if (lower.includes('docs') || lower.includes('documentation') || lower.includes('ver docs')) {
    const match = desire.match(/(?:docs|documentation|ver docs) (?:para|de )?(.+)/i);
    if (match) return await execute(`npx tsc --noEmit --help | head -20`);
    return { success: false, output: 'Formato: "docs para función o clase"' };
}

// === PATTERN 18: "migración de dependencias" ===
if (lower.includes('migración') || lower.includes('actualizar') || lower.includes('update')) {
    const match = desire.match(/(?:migración|actualizar|update) (?:de )?(.+)?/i);
    const pkg = match ? match[2].trim() : '';
    if (pkg) return await execute(`npm install ${pkg}@latest`);
    return await execute('npm outdated');
}

// === PATTERN 19: "completion para [función]" ===
if (lower.includes('completion') || lower.includes('autocomplete')) {
    const match = desire.match(/(?:completion|autocomplete) (?:para|de )?(.+)/i);
    if (match) return await execute(`npx tsc --noEmit`);
    return { success: false, output: 'Formato: "completion para función o archivo"' };
}

// === PATTERN 20: "add tests para este [componente]" ===
if (lower.includes('add tests') || lower.includes('agregar tests') || lower.includes('tests para')) {
    const match = desire.match(/(?:add|agregar) tests (?:para|de )?(.+)?/i);
    const target = match ? match[2].trim() : 'componente actual';
    return await execute(`npx vitest run --include ${target} 2>&1 | head -30`);
}

// === PATTERN 21: "refactor this function" ===
if (lower.includes('refactor this') || lower.includes('refactor la')) {
    return await execute('npx tsc --noEmit');
}

// === PATTERN 22: "fix this error" ===
if (lower.includes('fix this') || lower.includes('solucionar este') || lower.includes('fix error')) {
    return await execute('npx tsc --noEmit 2>&1 | head -20');
}

// === PATTERN 23: "auditar proyecto" ===
if (lower.includes('audit') || lower.includes('auditar')) {
  return await auditProject();
}

// === PATTERN 24: "refactorizar proyecto" ===
if (lower.includes('refactor project') || lower.includes('refactorizar proyecto') || lower.includes('full refactor')) {
  await auditProject();
  return await execute('npx tsc --noEmit 2>&1 | head -30');
}

// Default - patrón no reconocido
  return { 
    success: false, 
    output: 'No entendí el comando. Usa:\n- "crear proyecto nombre"\n- "crear archivo con contenido"\n- "ejecutar tests"\n- "build"\n- "git init"\n- "instalar pakquetes"' 
  };
}

module.exports = { handlePrompt };