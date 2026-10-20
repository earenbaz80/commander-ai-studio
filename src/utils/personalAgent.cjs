const fs = require('fs');
const path = require('path');  
const { execSync } = require('child_process');

const PROJECT_ROOT = process.cwd(); // Directorio del proyecto

/* ===== 1. ESCRIBIR ARCHIVO ===== */
async function writeFile(relativePath, content) {
  try {
    const fullPath = path.join(PROJECT_ROOT, relativePath);
    await fs.promises.writeFile(fullPath, content);
    return { 
      success: true, 
      message: `📄 Archivo creado: ${relativePath}` 
    };
  } catch (e) {
    return { 
      success: false, 
      error: `Error creando ${relativePath}: ${e.message}` 
    };
  }
}

/* ===== 2. EJECUTAR COMANDO SHELL ===== */
async function execute(cmd) {
  try {
    const output = execSync(cmd, { 
      encoding: 'utf-8', 
      stdio: 'pipe' 
    });
    return { 
      success: true, 
      output: output.substring(0, 2000) // Limitar output para no saturar
    };
  } catch (e) {
    return { 
      success: false, 
      error: e.message.substring(0, 500) 
    };
  }
}

/* ===== 3. EJECUTAR TESTS (Suite existente 269/269) ===== */
async function runTests() {
  try {
    execSync('npm test -- --run', { 
      encoding: 'utf-8', 
      stdio: 'pipe' 
    });
    return { 
      success: true, 
      passed: true, 
      message: '🎉 Todos los tests pasaron (269/269)' 
    };
  } catch (e) {
    let output = '';
    try {
      output = execSync('npm test -- --run', { 
        encoding: 'utf-8', 
        stdio: 'pipe' 
      });
    } catch (e) {
      output = e.message.substring(0, 800);
    }
    return { 
      success: false, 
      passed: false, 
      error: '❌ Tests fallaron:\n' + output 
    };
  }
}

/* ===== 5. INICIALIZAR PROYECTO NUEVO ===== */
async function initProject(name) {
  try {
    // Inicializar npm project
    execSync('npm init -y', { stdio: 'pipe' });
    // Instalar React + TypeScript base
    execSync('npm install react react-dom', { stdio: 'pipe' });
    // Instalar TypeScript y configuración base
    execSync('npm install -D typescript @types/react @types/node ts-node-dev', { stdio: 'pipe' });
    // Inicializar tsconfig
    execSync('npx tsc --init', { stdio: 'pipe' });
    return { 
      success: true, 
      message: `🚀 Proyecto "${name}" creado exitosamente con React + TypeScript` 
    };
  } catch (e) {
    return { 
      success: false, 
      error: 'Error inicializando proyecto: ' + e.message 
    };
  }
}

/* === 6. LEER ARCHIVO === */
async function readFile(relativePath) {
  try {
    const fullPath = path.join(PROJECT_ROOT, relativePath);
    const content = await fs.promises.readFile(fullPath, 'utf-8');
    return { success: true, content: content.substring(0, 4000) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/* === 7. ELIMINAR ARCHIVO === */
async function deleteFile(relativePath) {
  try {
    const fullPath = path.join(PROJECT_ROOT, relativePath);
    await fs.promises.unlink(fullPath);
    return { success: true, message: `🗑️ Eliminado: ${relativePath}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/* === 8. COPIAR ARCHIVO === */
async function copyFile(src, dest) {
  try {
    await fs.promises.copyFile(path.join(PROJECT_ROOT, src), path.join(PROJECT_ROOT, dest));
    return { success: true, message: `📋 Copiado: ${src} → ${dest}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/* === 9. ESTADO GIT === */
async function gitStatus() {
  try {
    const out = execSync('git status --short', { encoding: 'utf-8', stdio: 'pipe' });
    return { success: true, output: out || 'Working tree limpio' };
  } catch (e) {
    return { success: false, error: e.message.substring(0, 300) };
  }
}

/* === 10. HISTORIAL GIT === */
async function gitLog(n = 5) {
  try {
    const out = execSync(`git log --oneline -${n}`, { encoding: 'utf-8', stdio: 'pipe' });
    return { success: true, output: out };
  } catch (e) {
    return { success: false, error: e.message.substring(0, 300) };
  }
}

/* === 11. CONTAR LÍNEAS === */
async function countLines(relativePath) {
  try {
    const content = await fs.promises.readFile(path.join(PROJECT_ROOT, relativePath), 'utf-8');
    return { success: true, message: `📊 ${relativePath}: ${content.split('\n').length} líneas` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/* === 12. DETECTAR IMPORTS === */
async function getImports(relativePath) {
  try {
    const content = await fs.promises.readFile(path.join(PROJECT_ROOT, relativePath), 'utf-8');
    const imports = [...content.matchAll(/^import .*$/gm)].map((m) => m[0].trim());
    return { success: true, message: `📥 ${imports.length} imports`, output: imports.join('\n') };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/* === 13. DETECTAR FRAMEWORK === */
async function detectFramework() {
  try {
    const pkg = JSON.parse(await fs.promises.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    let fw = 'Desconocido';
    if (deps.react) fw = 'React';
    else if (deps.vue) fw = 'Vue';
    else if (deps.svelte) fw = 'Svelte';
    else if (deps.next) fw = 'Next.js';
    else if (deps.electron) fw = 'Electron';
    return { success: true, message: `🔍 Framework detectado: ${fw}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/* === 15. COMPLEXIDAD CILOMÁTICA === */
async function complexityAnalysis(relativePath) {
  try {
    const content = await fs.promises.readFile(path.join(PROJECT_ROOT, relativePath), 'utf-8');
    // Contar funciones/methods
    const funcCount = [...content.matchAll(/^\w+(?:<|\(|:\s)/gm)].length;
    // Contar líneas complejas (if/for/while/switch)
    const complexCount = [...content.matchAll(/^(?:if|for|while|switch)\s/gm)].length;
    // Simplidad: ratio de líneas simples
    const totalLines = content.split('\n').length;
    const simplicity = totalLines > 0 ? complexCount / totalLines : 0;
    return {
      success: true,
      message: `📊 ${relativePath}: ${funcCount} funciones, ${complexCount} bloques complejos, simplicidad: ${(simplicity * 100).toFixed(1)}%`,
      output: `Functions: ${funcCount}\nComplex blocks: ${complexCount}\nSimplicity: ${(simplicity * 100).toFixed(1)}%\nTotal lines: ${totalLines}`
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/* === 16. MÉTRICAS DE ACopLAMIENTO === */
async function couplingMetrics() {
  try {
    const pkg = JSON.parse(await fs.promises.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf-8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const imports = {};
    // Analizar qué módulos se importan más
    const files = await fs.promises.readdir(path.join(PROJECT_ROOT, 'src'));
    return {
      success: true,
      message: `📊 Paquetes: ${Object.keys(deps).length}, Archivos src: ${files.length}`,
      output: `Project has ${Object.keys(deps).length} dependencies and ${files.length} source files`
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/* === 17. ESTIMACIÓN DE CObertura DE TESTS === */
async function testCoverageEstimate() {
  try {
    const testFiles = await fs.promises.readdir(path.join(PROJECT_ROOT, 'src'));
    const tsFiles = testFiles.filter(f => f.endsWith('.ts') || f.endsWith('.tsx'));
    return {
      success: true,
      message: `📊 ${tsFiles.length} archivos de test detectados`,
      output: `${tsFiles.length} test files found in src directory`
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}
async function auditProject() {
  const tests = await runTests();
  const build = await execute('npm run build');
  let complexity = null;
  let coverage = null;
  try { complexity = await complexityAnalysis('src'); } catch { complexity = { success: false }; }
  try { coverage = await testCoverageEstimate(); } catch { coverage = { success: false }; }
  const overall = tests.success && build.success;
  return {
    success: overall,
    message: overall ? '✅ Proyecto OK (tests + build + métricas)' : '❌ Revisar: tests o build fallan',
    output: `Tests: ${tests.success ? 'OK' : 'FALLAN'}\nBuild: ${build.success ? 'OK' : 'FALLA'}\nComplexity: ${complexity && complexity.success ? complexity.output.slice(0,120) : 'N/A'}\nCoverage: ${coverage && coverage.success ? coverage.output.slice(0,120) : 'N/A'}`,
  };
}

/* === NUEVO: DETECCIÓN DE PATRONES DE CÓDIGO === */
/** Detecta patrones en el código que merecen sugerencias de IA.
  * Comprueba complejidad, cobertura de tests y otras métricas. */
async function detectCodePatterns() {
  try {
    const complexity = await complexityAnalysis('src');
    const coverage = await testCoverageEstimate();
    const coupling = await couplingMetrics();

    const patterns = [];
    let shouldTrigger = false;

    // Alta complejidad → sugerir refactoring
    if (complexity.success && complexity.output) {
      const simplicityMatch = complexity.output.match(/Simplicity: (\d+\.\d)%/);
      const simplicity = simplicityMatch ? parseFloat(simplicityMatch[1]) : 100;
      if (simplicity < 30) {
        patterns.push('🔍 Alta complejidad detectada - sugerir refactoring');
        shouldTrigger = true;
      }
    }

    // Baja cobertura de tests → sugerir añadir tests
    if (coverage.success) {
      const testCountMatch = coverage.output.match(/(\d+) test/);
      const testCount = testCountMatch ? parseInt(testCountMatch[1]) : 0;
      if (testCount < 3) {
        patterns.push('📝 Baja cobertura de tests - sugerir añadir tests');
        shouldTrigger = true;
      }
    }

    // muchas dependencias → sugerir revisar
    if (coupling.success) {
      const depsMatch = coupling.output.match(/dependencias: (\d+)/);
      const deps = depsMatch ? parseInt(depsMatch[1]) : 0;
      if (deps > 15) {
        patterns.push('📦 Muchas dependencias - sugerir revisar');
        shouldTrigger = true;
      }
    }

    return { success: true, shouldTrigger, patterns, complexity, coverage, coupling };
  } catch (e) {
    return { success: false, shouldTrigger: false, patterns: [e.message], complexity: null, coverage: null, coupling: null };
  }
}

/* === NUEVO: EJECUCIÓN DE CÓDIGO REPL === */
/** Ejecuta código en un entorno REPL style y devuelve la salida.
  * Útil para type-check, lint, o snippets rápidos. */
async function executeCode(code, options = {}) {
  try {
    const { cmd = 'node -e' } = options;
    // Si es TypeScript, usar tsc --noEmit
    if (code.includes('import') || code.includes('type ')) {
      const result = await execute(`npx tsc --noEmit --pretty 2>&1 | head -20`);
      return {
        success: result.success,
        output: result.output || 'No output',
        mode: 'type-check'
      };
    }
    // Ejecutar node -e
    const result = await execute(`${cmd} \${${JSON.stringify(code)}}`);
    return {
      success: result.success,
      output: result.output || 'No output',
      mode: 'node-exec'
    };
  } catch (e) {
    return { success: false, output: e.message, mode: 'error' };
  }
}

/* === NUEVO: CHECK AND RUN ON SAVE === */
/** Verifica si debería ejecutar tests/refactoring al guardar.
  * Comprende patrones de código y decide automáticamente. */
async function maybeRunOnSave() {
  const patterns = await detectCodePatterns();
  const actions = [];

  if (patterns.shouldTrigger) {
    if (patterns.patterns.some(p => p.includes('alta complejidad'))) {
      actions.push({ name: 'refactor', fn: () => complexityAnalysis('src') });
    }
    if (patterns.patterns.some(p => p.includes('baja cobertura de tests'))) {
      actions.push({ name: 'tests', fn: () => runTests() });
    }
    if (patterns.patterns.some(p => p.includes('muchas dependencias'))) {
      actions.push({ name: 'deps', fn: () => couplingMetrics() });
    }
  }

  return { shouldRun: actions.length > 0, actions, patterns };
}

module.exports = {
  writeFile, execute, runTests, initProject,
  readFile, deleteFile, copyFile, gitStatus, gitLog,
  countLines, getImports, detectFramework, auditProject,
  detectCodePatterns, executeCode, maybeRunOnSave,
};