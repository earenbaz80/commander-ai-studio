import * as fs from 'fs';

const filePath = process.argv[2] || 'src/components/AgentMode.tsx';
let content = fs.readFileSync(filePath, 'utf8');

// Reparar patrones rotos por el reemplazo global anterior
// Patrón: useState<Type>(() => loadX()}) -> useState<Type>(() => loadX())
content = content.replace(
  /useState<([A-Za-z]+)>\(\(\) => load([A-Za-z]+)\)\}/g,
  'useState<$1>(() => load$2())'
);

// Patrón: useMemo(() => metricsSummary(loadMetrics().slice(0, 100}}, ...) -> useMemo(() => metricsSummary(loadMetrics().slice(0, 100)), ...)
content = content.replace(
  /useMemo\(\(\) => metricsSummary\(loadMetrics\(\)\.slice\(0, 100\}\}/g,
  'useMemo(() => metricsSummary(loadMetrics().slice(0, 100))'
);

// Patrón: onStartTask(goal.trim()}; -> onStartTask(goal.trim());
content = content.replace(
  /onStartTask\(goal\.trim\(\)\};/g,
  'onStartTask(goal.trim());'
);

// Patrón: handleUninstallPlugin(p.id); -> handleUninstallPlugin(p.id)
// No, esto es correcto.

// Reparar patrones }} que deberían ser ) en cierres de JSX
// Buscar: }} seguido de ) en cierres de expresiones JSX
// Pero cuidado con los }} legítimos

// Patrón: setPlugins(prev => prev.filter(p => p.id !== id)}; -> setPlugins(prev => prev.filter(p => p.id !== id));
content = content.replace(
  /setPlugins\(prev => prev\.filter\(p => p\.id !== id\)\};/g,
  'setPlugins(prev => prev.filter(p => p.id !== id));'
);

// Patrón: setState((s) => ({ ...s, conflictOutput: null })}; -> setState((s) => ({ ...s, conflictOutput: null }));
content = content.replace(
  /setState\(\(s\) => \(\{ \.\.\.s, conflictOutput: null \)\};/g,
  'setState((s) => ({ ...s, conflictOutput: null }));'
);

// Patrón: deleteSession(s.id); setSessions(loadSessions()}; -> deleteSession(s.id); setSessions(loadSessions());
content = content.replace(
  /setSessions\(loadSessions\(\)\};/g,
  'setSessions(loadSessions());'
);

// Patrón: String(JSON.stringify(step.input, null, 2)}} -> String(JSON.stringify(step.input, null, 2))
content = content.replace(
  /String\(JSON\.stringify\(step\.input, null, 2\)\}\}/g,
  'String(JSON.stringify(step.input, null, 2))'
);

content = content.replace(
  /String\(JSON\.stringify\(step\.output, null, 2\)\}\}/g,
  'String(JSON.stringify(step.output, null, 2))'
);

// Escribir el archivo reparado
fs.writeFileSync(filePath, content, 'utf8');
console.log('Archivo reparado exitosamente');
