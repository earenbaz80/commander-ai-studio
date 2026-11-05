/**
 * Contenido y datos puros de Nono.
 * Sin dependencias de React: puro dato, testeable y reutilizable.
 */
import type { Language as I18nLanguage } from '../../i18n/translations';
import type { ParameterConfig } from '../../types/studio';

export type Language = I18nLanguage;
export type NonoExpression =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'surprised'
  | 'angry'
  | 'wink'
  | 'sleepy'
  | 'thinking'
  | 'error'
  | 'love'
  | 'cool'
  | 'watch'
  | 'curious';

/** Evento contextual de la app para que Nono reaccione. */
export interface NonoStatusEvent {
  type: 'generating' | 'done' | 'error' | 'success' | 'mode' | 'new_prompt';
  /** Detalle opcional (p. ej. el nuevo modo activo). */
  detail?: string;
}

export interface Message {
  id: string;
  text: string;
  fromUser: boolean;
  timestamp: string;
}

export interface FloatingAssistantProps {
  lang?: Language;
  /** Nombre del usuario para el saludo flotante (opcional). */
  displayName?: string;
  /** Callback para el botón "Nuevo prompt" del mini-chat (opcional) */
  onNewPrompt?: () => void;
  /** Último evento contextual de la app (generando, error, cambio de modo…). */
  status?: NonoStatusEvent | null;
  /** Acciones rápidas reales de la app (opcionales; sin ellas no se muestran chips). */
  onOpenWorkbench?: () => void;
  onOpenCompile?: () => void;
  onOpenGallery?: () => void;
  onOpenSearch?: () => void;
  /** Configuración del modelo para responder con IA real (fallback a plantillas). */
  selectedModel?: string;
  selectedProvider?: string;
  parameters?: ParameterConfig;
  /** ID (path) del proyecto activo para scoping de memoria durable de Nono. */
  projectId?: string | null;
  /** Si true, Nono se renderiza como panel acoplado (no flotante). */
  docked?: boolean;
  /** Callback para alternar entre modo flotante y acoplado. */
  onToggleDock?: () => void;
  /** Información del proyecto actual para sugerencias contextuales de Nono. */
  projectInfo?: {
    path?: string;
    files?: string[];
    hasPackageJson?: boolean;
    hasTsConfig?: boolean;
    hasGit?: boolean;
    framework?: string;
    mainLanguage?: string;
    goal?: string; // Goal/tarea actual del agente
    mode?: 'chat' | 'freeform' | 'agent'; // Modo actual
  };
  /** Configuración de sugerencias (frecuencia, tipo, etc.). */
  suggestionConfig?: {
    idleTimeMs?: number; // Tiempo de inactividad antes de sugerir (default: 15000)
    maxSuggestions?: number; // Máximo de sugerencias a mostrar (default: 3)
    includeModeSpecific?: boolean; // Incluir sugerencias por modo (default: true)
    includeProjectSpecific?: boolean; // Incluir sugerencias por proyecto (default: true)
    includeTaskSpecific?: boolean; // Incluir sugerencias por tarea (default: true)
  };
  /** Contexto de código del chat para que Nono razone sobre él (opcional). */
  codeContext?: string;
  /** Si true, Nono no se renderiza en pantalla. */
  hidden?: boolean;
  /** Hay algo procesándose en el chat o en el agente: Nono lo acompaña. */
  busy?: boolean;
}

/** Handle imperativo para abrir Nono desde fuera (ej. @nono en el chat general). */
export type FloatingAssistantHandle = {
  openWithPrompt: (prompt: string, sendImmediately?: boolean) => void;
};

export const GREETINGS_ES = [
  '¡Hola! Soy Nono, ¿en qué puedo ayudarte?',
  '¡Hey! ¿Necesitas algo?',
  '¡Hola terrícola! Listo para ayudarte.',
  '¿Qué tal? Nono al rescate.',
  '¡Hola! Pregúntame lo que quieras.',
];

export const GREETINGS_EN = [
  'Hi! I\'m Nono, how can I help?',
  'Hey! Need anything?',
  'Hello earthling! Ready to assist.',
  'What\'s up? Nono to the rescue.',
  'Hi! Ask me anything.',
];

export const GREETINGS_DE = [
  'Hallo! Ich bin Nono, wie kann ich helfen?',
  'Hey! Brauchst du etwas?',
  'Hallo Erdling! Bereit zu helfen.',
  'Na, wie läuft\'s? Nono zur Rettung.',
  'Hallo! Frag mich einfach.',
];

/** Preguntas dinámicas que Nono muestra al pasar el puntero por encima. */
export function buildHoverQuestions(lang: Language, displayName?: string): string[] {
  const name = (displayName || '').trim();
  if (lang === 'es') {
    return [
      name ? `${name}, ¿en qué te ayudo?` : '¿En qué te ayudo?',
      '¿Ya tienes un plan?',
      '¿Necesitas una mano?',
      '¿Qué construimos hoy?',
      '¿Pregúntame lo que quieras!',
      '¿Probamos otro modelo?',
      '¿Reviso tu código?',
      '¿Abro el Workbench?',
    ];
  }
  if (lang === 'de') {
    return [
      name ? `${name}, wie kann ich helfen?` : 'Wie kann ich helfen?',
      'Hast du schon einen Plan?',
      'Brauchst du eine Hand?',
      'Was bauen wir heute?',
      'Frag mich einfach!',
      'Probieren wir ein anderes Modell?',
      'Soll ich deinen Code prüfen?',
      'Soll ich die Workbench öffnen?',
    ];
  }
  return [
    name ? `${name}, how can I help?` : 'How can I help?',
    'Do you have a plan yet?',
    'Need a hand?',
    'What are we building today?',
    'Ask me anything!',
    'Shall we try another model?',
    'Want me to review your code?',
    'Shall I open the Workbench?',
  ];
}

const RESPONSES_ES: Record<string, string[]> = {
  'hola': ['¡Hola! ¿Cómo estás?', '¡Hey! Qué gusto verte.'],
  'ayuda': ['Puedo ayudarte con comandos, navegación y configuración. ¿Qué necesitas?', 'Cuéntame tu problema y buscaremos solución.'],
  'gracias': ['¡De nada! Para eso estoy.', '¡Un placer ayudarte!'],
  'adios': ['¡Hasta luego! Aquí estaré si me necesitas.', '¡Adiós! Que tengas buen día.'],
  'error': ['Ups, algo salió mal. ¿Intentamos de nuevo?', 'Eso no funcionó como esperaba...'],
  'procesando': ['Déjame pensar...', 'Procesando tu solicitud...', 'Un momento, estoy en ello.'],
  default: [
    'Interesante... cuéntame más.',
    'Entiendo. ¿Algo más en lo que pueda ayudarte?',
    'Buena pregunta. Déjame pensar...',
    'No estoy seguro, pero podemos averiguarlo juntos.',
    '¡Fascinante! ¿Qué más necesitas?',
  ],
};

const RESPONSES_EN: Record<string, string[]> = {
  'hello': ['Hi! How are you?', 'Hey! Good to see you.'],
  'help': ['I can help with commands, navigation, and settings. What do you need?', 'Tell me your problem and we\'ll find a solution.'],
  'thanks': ['You\'re welcome! That\'s what I\'m here for.', 'Happy to help!'],
  'bye': ['Goodbye! I\'ll be here if you need me.', 'Bye! Have a great day.'],
  'error': ['Oops, something went wrong. Try again?', 'That didn\'t work as expected...'],
  'processing': ['Let me think...', 'Processing your request...', 'One moment, I\'m on it.'],
  default: [
    'Interesting... tell me more.',
    'I see. Anything else I can help with?',
    'Good question. Let me think...',
    'I\'m not sure, but we can figure it out together.',
    'Fascinating! What else do you need?',
  ],
};

const RESPONSES_DE: Record<string, string[]> = {
  'hallo': ['Hallo! Wie geht es dir?', 'Hey! Schön, dich zu sehen.'],
  'hilfe': ['Ich kann bei Befehlen, Navigation und Einstellungen helfen. Was brauchst du?', 'Beschreibe dein Problem, dann finden wir eine Lösung.'],
  'danke': ['Gern geschehen! Dafür bin ich da.', 'Freut mich, zu helfen!'],
  'tschüss': ['Bis später! Ich bin da, wenn du mich brauchst.', 'Tschüss! Einen schönen Tag noch.'],
  'fehler': ['Ups, da ist etwas schiefgelaufen. Nochmal versuchen?', 'Das hat nicht wie erwartet funktioniert...'],
  'verarbeit': ['Lass mich nachdenken...', 'Ich verarbeite deine Anfrage...', 'Einen Moment, ich bin dran.'],
  default: [
    'Interessant... erzähl mir mehr.',
    'Verstehe. Kann ich sonst noch helfen?',
    'Gute Frage. Lass mich nachdenken...',
    'Ich bin nicht sicher, aber wir finden es gemeinsam heraus.',
    'Faszinierend! Was brauchst du noch?',
  ],
};

export function getExpressionForText(text: string): NonoExpression {
  const lower = text.toLowerCase();
  if (lower.includes('hola') || lower.includes('hello') || lower.includes('hey') || lower.includes('hallo')) return 'happy';
  // El usuario frustrado («no funciona», «falla») enfada a Nono; la cara de
  // error (ojos en aspa) queda para fallos reales de la app vía `status`.
  if (lower.includes('error') || lower.includes('fallo') || lower.includes('failed') || lower.includes('fehler')) return 'angry';
  if (lower.includes('gracias') || lower.includes('thanks') || lower.includes('danke')) return 'love';
  if (lower.includes('adios') || lower.includes('bye') || lower.includes('chao') || lower.includes('tschüss')) return 'happy';
  if (lower.includes('ayuda') || lower.includes('help') || lower.includes('hilfe')) return 'thinking';
  if (lower.includes('?')) return 'surprised';
  return 'neutral';
}

/** Texto del saludo flotante que escribe Nono (solo lo muestra Nono). */
export function buildGreeting(lang: Language, displayName?: string): string {
  const name = (displayName || '').trim();
  if (lang === 'es') {
    return name
      ? `¡Hola, ${name}! Soy Nono. ¿En qué puedo ayudarte hoy?`
      : '¡Hola! Soy Nono. ¿En qué puedo ayudarte hoy?';
  }
  if (lang === 'de') {
    return name
      ? `Hallo, ${name}! Ich bin Nono. Wie kann ich dir heute helfen?`
      : 'Hallo! Ich bin Nono. Wie kann ich dir heute helfen?';
  }
  return name
    ? `Hello, ${name}! I'm Nono. How can I help you today?`
    : "Hello! I'm Nono. How can I help you today?";
}

export function getResponse(text: string, lang: Language): string {
  const lower = text.toLowerCase();
  const responses = lang === 'es' ? RESPONSES_ES : lang === 'de' ? RESPONSES_DE : RESPONSES_EN;
  for (const [key, value] of Object.entries(responses)) {
    if (key !== 'default' && lower.includes(key)) {
      return value[Math.floor(Math.random() * value.length)];
    }
  }
  const defaults = responses.default;
  return defaults[Math.floor(Math.random() * defaults.length)];
}

// Remove 3D effects from Nono head - flat retro design
// 3D gradients and filters removed for simpler vectorial appearance

/** Genera sugerencias contextuales tipo Google AI Studio basadas en modo, proyecto y tarea. */
export function generateProjectSuggestions(projectInfo: FloatingAssistantProps['projectInfo'], lang: Language, suggestionConfig: FloatingAssistantProps['suggestionConfig']): string[] {
  if (!projectInfo) return [];
  
  const { files = [], hasPackageJson, hasTsConfig, hasGit, framework, mainLanguage, goal, mode } = projectInfo;
  const config = suggestionConfig ?? { idleTimeMs: 15000, maxSuggestions: 3, includeModeSpecific: true, includeProjectSpecific: true, includeTaskSpecific: true };
  const { maxSuggestions = 3, includeModeSpecific = true, includeProjectSpecific = true, includeTaskSpecific = true } = config;
  
  const suggestions: string[] = [];
  
  // Helper to limit array to maxSuggestions
  const limitSuggestions = (arr: string[]) => arr.slice(0, maxSuggestions);
  
  // 1. SUGERENCIAS POR MODO (si está habilitado)
  if (includeModeSpecific && mode) {
    if (lang === 'es') {
      if (mode === 'chat') {
        suggestions.push('¿Probamos otro modelo?');
        suggestions.push('¿Reiniciamos la conversación?');
        suggestions.push('¿Abrimos el Workbench?');
      } else if (mode === 'freeform') {
        suggestions.push('¿Completamos más texto?');
        suggestions.push('¿Probamos otro modelo?');
        suggestions.push('¿Guardamos este freeform?');
      } else if (mode === 'agent') {
        suggestions.push('¿Revisamos el progress del agente?');
        suggestions.push('¿Cambiamos de modelo?');
        suggestions.push('¿Hacemos pause al agente?');
      }
    } else if (lang === 'de') {
      if (mode === 'chat') {
        suggestions.push('Probieren wir ein anderes Modell?');
        suggestions.push('Starten wir die Unterhaltung neu?');
        suggestions.push('Öffnen wir die Workbench?');
      } else if (mode === 'freeform') {
        suggestions.push('Vervollständigen wir mehr Text?');
        suggestions.push('Probieren wir ein anderes Modell?');
        suggestions.push('Speichern wir dieses Freeform?');
      } else if (mode === 'agent') {
        suggestions.push('Prüfen wir den Fortschritt des Agenten?');
        suggestions.push('Wechseln wir das Modell?');
        suggestions.push('Pausieren wir den Agenten?');
      }
    } else {
      if (mode === 'chat') {
        suggestions.push('Shall we try another model?');
        suggestions.push('Shall we restart the conversation?');
        suggestions.push('Shall we open the Workbench?');
      } else if (mode === 'freeform') {
        suggestions.push('Shall we complete more text?');
        suggestions.push('Shall we try another model?');
        suggestions.push('Shall we save this freeform?');
      } else if (mode === 'agent') {
        suggestions.push('Check the agent progress?');
        suggestions.push('Change the model?');
        suggestions.push('Pause agent execution?');
      }
    }
  }
  
  // 2. SUGERENCIAS POR PROYECTO (si está habilitado)
  if (includeProjectSpecific) {
    // Project-specific suggestions based on files and config
    if (hasPackageJson) {
      if (lang === 'es') {
        suggestions.push('¿Ejecutamos `npm test` para verificar el proyecto?');
        suggestions.push('¿Configuramos scripts personalizados en package.json?');
      } else if (lang === 'de') {
        suggestions.push('Führen wir `npm test` aus, um das Projekt zu prüfen?');
        suggestions.push('Eigene Skripte in package.json konfigurieren?');
      } else {
        suggestions.push('Shall we run `npm test` to verify the project?');
        suggestions.push('Configure custom scripts in package.json?');
      }
    }
    if (hasTsConfig) {
      if (lang === 'es') {
        suggestions.push('¿Ejecutamos `tsc --noEmit` para type-checking?');
        suggestions.push('¿Habilitamos `strict: true` en tsconfig.json?');
      } else if (lang === 'de') {
        suggestions.push('`tsc --noEmit` für die Typprüfung ausführen?');
        suggestions.push('`strict: true` in tsconfig.json aktivieren?');
      } else {
        suggestions.push('Run `tsc --noEmit` for type-checking?');
        suggestions.push('Enable `strict: true` in tsconfig.json?');
      }
    }
    if (hasGit) {
      if (lang === 'es') {
        suggestions.push('¿Creamos un checkpoint antes de cambios mayores?');
        suggestions.push('¿Configuramos hooks de pre-commit con husky?');
      } else if (lang === 'de') {
        suggestions.push('Vor größeren Änderungen einen Checkpoint erstellen?');
        suggestions.push('Pre-Commit-Hooks mit husky konfigurieren?');
      } else {
        suggestions.push('Create a checkpoint before major changes?');
        suggestions.push('Configure pre-commit hooks with husky?');
      }
    }
    if (mainLanguage === 'typescript' || mainLanguage === 'javascript') {
      if (lang === 'es') {
        suggestions.push('¿Ejecutamos ESLint para encontrar issues?');
        suggestions.push('¿Añadimos Prettier para formateo consistente?');
      } else if (lang === 'de') {
        suggestions.push('ESLint ausführen, um Probleme zu finden?');
        suggestions.push('Prettier für einheitliche Formatierung hinzufügen?');
      } else {
        suggestions.push('Run ESLint to find issues?');
        suggestions.push('Add Prettier for consistent formatting?');
      }
    }
    if (files.some(f => f.endsWith('.test.ts') || f.endsWith('.spec.ts'))) {
      if (lang === 'es') {
        suggestions.push('¿Ejecutamos tests con coverage?');
      } else if (lang === 'de') {
        suggestions.push('Tests mit Coverage ausführen?');
      } else {
        suggestions.push('Run tests with coverage?');
      }
    }
    if (files.some(f => f.endsWith('.md'))) {
      if (lang === 'es') {
        suggestions.push('¿Generamos documentación automática?');
      } else if (lang === 'de') {
        suggestions.push('Automatische Dokumentation generieren?');
      } else {
        suggestions.push('Generate automatic documentation?');
      }
    }
    if (files.some(f => f.includes('Dockerfile') || f.includes('docker-compose'))) {
      if (lang === 'es') {
        suggestions.push('¿Optimizamos el Dockerfile para producción?');
      } else if (lang === 'de') {
        suggestions.push('Das Dockerfile für die Produktion optimieren?');
      } else {
        suggestions.push('Optimize Dockerfile for production?');
      }
    }
    if (framework) {
      if (lang === 'es') {
        suggestions.push(`¿Revisamos las mejores prácticas de ${framework}?`);
      } else if (lang === 'de') {
        suggestions.push(`Best Practices für ${framework} prüfen?`);
      } else {
        suggestions.push(`Review ${framework} best practices?`);
      }
    }
  }
  
  // 3. SUGERENCIAS POR TAREA/GOAL (si está habilitado y hay goal)
  if (includeTaskSpecific && goal) {
    // Extract key words from goal to generate relevant suggestions
    const goalLower = goal.toLowerCase();
    
    if (lang === 'es') {
      // General task-based suggestions
      suggestions.push('¿Revisamos el código por seguridad?');
      suggestions.push('¿Mejoramos la accesibilidad?');
      suggestions.push('¿Optimizamos el rendimiento?');
      
      // Task-specific based on goal keywords
      if (goalLower.includes('typescript') || goalLower.includes('javascript')) {
        suggestions.push('¿Añadimos TypeScript/JS a el proyecto?');
      }
      if (goalLower.includes('docker') || goalLower.includes('contener')) {
        suggestions.push('¿Configuramos Docker para este proyecto?');
      }
      if (goalLower.includes('test') || goalLower.includes('pruebas')) {
        suggestions.push('¿Ejecutamos tests de validación?');
      }
      if (goalLower.includes('document') || goalLower.includes('doc')) {
        suggestions.push('¿Generamos documentación?');
      }
      if (goalLower.includes('deploy') || goalLower.includes('publicar')) {
        suggestions.push('¿Desplegamos la aplicación?');
      }
      if (goalLower.includes('optim') || goalLower.includes('mejor')) {
        suggestions.push('¿Optimizamos el rendimiento?');
      }
    } else if (lang === 'de') {
      suggestions.push('Code auf Sicherheit prüfen?');
      suggestions.push('Barrierefreiheit verbessern?');
      suggestions.push('Leistung optimieren?');

      if (goalLower.includes('typescript') || goalLower.includes('javascript')) {
        suggestions.push('TypeScript/JS zum Projekt hinzufügen?');
      }
      if (goalLower.includes('docker') || goalLower.includes('container')) {
        suggestions.push('Docker für dieses Projekt konfigurieren?');
      }
      if (goalLower.includes('test') || goalLower.includes('tests')) {
        suggestions.push('Validierungstests ausführen?');
      }
      if (goalLower.includes('document') || goalLower.includes('doc')) {
        suggestions.push('Dokumentation generieren?');
      }
      if (goalLower.includes('deploy') || goalLower.includes('publish')) {
        suggestions.push('Die Anwendung bereitstellen?');
      }
      if (goalLower.includes('optim') || goalLower.includes('improve')) {
        suggestions.push('Leistung optimieren?');
      }
    } else {
      suggestions.push('Review code for security?');
      suggestions.push('Improve accessibility?');
      suggestions.push('Optimize performance?');
      
      if (goalLower.includes('typescript') || goalLower.includes('javascript')) {
        suggestions.push('Add TypeScript/JS to the project?');
      }
      if (goalLower.includes('docker') || goalLower.includes('container')) {
        suggestions.push('Configure Docker for this project?');
      }
      if (goalLower.includes('test') || goalLower.includes('tests')) {
        suggestions.push('Run validation tests?');
      }
      if (goalLower.includes('document') || goalLower.includes('doc')) {
        suggestions.push('Generate documentation?');
      }
      if (goalLower.includes('deploy') || goalLower.includes('publish')) {
        suggestions.push('Deploy the application?');
      }
      if (goalLower.includes('optim') || goalLower.includes('improve')) {
        suggestions.push('Optimize performance?');
      }
    }
  }
  
  // 4. Añadir algunas sugerencias genéricas si aún no hemos alcanzado maxSuggestions
  const genericSuggestionsES = [
    '¿Revisamos el código por seguridad?',
    '¿Mejoramos la accesibilidad?',
    '¿Optimizamos el rendimiento?',
    '¿Añadimos tests E2E?',
    '¿Configuramos CI/CD?',
  ];
  const genericSuggestionsEN = [
    'Review code for security?',
    'Improve accessibility?',
    'Optimize performance?',
    'Add E2E tests?',
    'Configure CI/CD?',
  ];
  const genericSuggestionsDE = [
    'Code auf Sicherheit prüfen?',
    'Barrierefreiheit verbessern?',
    'Leistung optimieren?',
    'E2E-Tests hinzufügen?',
    'CI/CD konfigurieren?',
  ];
  
  // Fill remaining slots with generic suggestions if under maxSuggestions
  let remainingSlots = maxSuggestions - suggestions.length;
  if (remainingSlots > 0 && lang === 'es') {
    for (let i = 0; i < remainingSlots && i < genericSuggestionsES.length; i++) {
      // Only add if not already in suggestions
      if (!suggestions.includes(genericSuggestionsES[i])) {
        suggestions.push(genericSuggestionsES[i]);
      }
    }
  } else if (remainingSlots > 0 && lang === 'de') {
    for (let i = 0; i < remainingSlots && i < genericSuggestionsDE.length; i++) {
      if (!suggestions.includes(genericSuggestionsDE[i])) {
        suggestions.push(genericSuggestionsDE[i]);
      }
    }
  } else if (remainingSlots > 0 && lang === 'en') {
    for (let i = 0; i < remainingSlots && i < genericSuggestionsEN.length; i++) {
      if (!suggestions.includes(genericSuggestionsEN[i])) {
        suggestions.push(genericSuggestionsEN[i]);
      }
    }
  }
  
  return limitSuggestions(suggestions);
}